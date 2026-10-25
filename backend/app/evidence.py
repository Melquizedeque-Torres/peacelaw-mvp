import re
import unicodedata
from collections.abc import Iterable

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Case, EvidenceFile

MAX_FILES = 5
MAX_BYTES = 2_621_440


def sniff(data: bytes) -> str | None:
    if data.startswith(b"%PDF-"):
        return "application/pdf"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    # Voice notes recorded in the browser: WebM/Matroska (Chrome, Edge, Firefox), Ogg (Firefox),
    # MP4/M4A (Safari, iOS), plus WAV and MP3 for files. Served only to their owner as attachments.
    if data.startswith(b"\x1a\x45\xdf\xa3"):
        return "audio/webm"
    if data.startswith(b"OggS"):
        return "audio/ogg"
    if len(data) >= 12 and data[4:8] == b"ftyp":
        return "audio/mp4"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WAVE":
        return "audio/wav"
    if data.startswith(b"ID3") or (len(data) >= 2 and data[0] == 0xFF and data[1] & 0xE0 == 0xE0):
        return "audio/mpeg"
    if data and b"\x00" not in data:
        try:
            data.decode("utf-8")
        except UnicodeDecodeError:
            return None
        # Plain text only: markup would be rendered if ever served inline.
        head = data[:512].lstrip().lower()
        if head.startswith((b"<", b"mz")):
            return None
        return "text/plain"
    return None


def safe_filename(name: str) -> str:
    name = name.replace("\\", "/").rsplit("/", 1)[-1]
    name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    name = re.sub(r"[^A-Za-z0-9._ -]", "", name).strip(" .")
    if not name:
        return "anexo"
    if len(name) > 120:
        stem, dot, ext = name.rpartition(".")
        name = (stem[: 120 - len(ext) - 1] + "." + ext) if dot else name[:120]
    return name


def with_evidence_count(db: Session, cases: Iterable[Case]) -> list[Case]:
    """Set `evidence_count` (live, non-erased files) on each case with one grouped query."""
    cases = list(cases)
    if not cases:
        return cases
    counts = dict(
        db.execute(
            select(EvidenceFile.case_id, func.count())
            .where(
                EvidenceFile.case_id.in_([c.id for c in cases]),
                EvidenceFile.erased_at.is_(None),
            )
            .group_by(EvidenceFile.case_id)
        ).all()
    )
    for case in cases:
        setattr(case, "evidence_count", counts.get(case.id, 0))
    return cases
