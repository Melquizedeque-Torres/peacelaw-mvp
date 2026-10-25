# B — Evidence Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a client attach evidence files (PDF, PNG, JPEG, TXT) to a case. Files are encrypted at rest, readable only by the owner, and erased with the original report.

**Architecture:** New table `evidence_files` with Fernet-encrypted bytes, an owner-only router, raw-body upload (no multipart dependency), per-route body-size override, and frontend wiring in the wizard and `CaseDetail`. Judges and lawyers only receive an `evidence_count`.

**Tech Stack:** FastAPI, SQLAlchemy, Alembic, cryptography (Fernet), Next.js, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-20-site-completion-design.md` (section B). Prerequisite: plan A finished (latest Alembic head `e5b1d0a47c92`).

## Global Constraints
- Backend from `backend/` with `.venv/Scripts/python -m …`; frontend from `frontend/`. Tests never touch Neon. pt-BR user messages in `app/errors.py`. Token classes only in components.
- Limits (verbatim from the spec): 5 files per case, 2.5 MB (2 621 440 bytes) per file, allowlist PDF/PNG/JPEG/plain text by content sniffing, filename sanitized, upload only while the case is `AWAITING_APPROVAL` or `READY_FOR_JUDGE`.
- Privacy: file bytes never appear in any judge, lawyer or admin response, in logs or in error bodies. Download uses `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`.
- Alembic revision chained from `e5b1d0a47c92`; applied to Neon `peacelaw-prod` with the owner role, then re-grant table privileges to `peacelaw_app` (`grant select, insert, update, delete on evidence_files to peacelaw_app`).
- Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Update `CONTINUE.md` at the end.

---

### Task 1: Model, migration and encryption helper

**Files:**
- Modify: `backend/app/models.py` (add `EvidenceFile`, relationship on `Case`)
- Modify: `backend/app/security/crypto.py` (add `encrypt_bytes`, `decrypt_bytes`)
- Create: `backend/migrations/versions/f6c2e1b58d03_evidence_files.py`
- Test: `backend/tests/test_evidence_model.py`

**Interfaces:** Produces `encrypt_bytes(data: bytes) -> bytes`, `decrypt_bytes(token: bytes) -> bytes`; `EvidenceFile(id, case_id, filename, content_type, size_bytes, data: bytes (deferred, encrypted), created_at, erased_at)`; `Case.evidence: list[EvidenceFile]`.

- [ ] **Step 1: Failing test**

```python
from sqlalchemy import text

from app.models import Case, CaseStatus, EvidenceFile, UserRole
from app.security.crypto import decrypt_bytes, encrypt_bytes


def test_bytes_round_trip_and_ciphertext_differs():
    token = encrypt_bytes(b"%PDF-1.4 segredo")
    assert token != b"%PDF-1.4 segredo" and decrypt_bytes(token) == b"%PDF-1.4 segredo"


def test_evidence_is_stored_encrypted_and_cascades(session, make_user):
    owner = make_user(UserRole.CLIENT)
    case = Case(client_id=owner.id, title="t", raw_text="r", anonymized_text="a",
                status=CaseStatus.AWAITING_APPROVAL)
    session.add(case)
    session.commit()
    session.add(EvidenceFile(case_id=case.id, filename="a.txt", content_type="text/plain",
                             size_bytes=5, data=b"hello"))
    session.commit()
    raw = session.execute(text("select data from evidence_files")).scalar_one()
    assert b"hello" not in bytes(raw)
    session.expire_all()
    assert session.query(EvidenceFile).one().data == b"hello"
    session.delete(case)
    session.commit()
    assert session.query(EvidenceFile).count() == 0
```

Run `.venv/Scripts/python -m pytest tests/test_evidence_model.py -q` → FAIL (ImportError).

- [ ] **Step 2: Implement.** In `crypto.py`:

```python
def encrypt_bytes(data: bytes) -> bytes:
    return _fernet().encrypt(data)


def decrypt_bytes(token: bytes) -> bytes:
    return _fernet().decrypt(token)


class EncryptedBytes(TypeDecorator[bytes]):
    """LargeBinary column stored as a Fernet token."""

    impl = LargeBinary
    cache_ok = True

    def process_bind_param(self, value: bytes | None, dialect: Dialect) -> bytes | None:
        return None if value is None else encrypt_bytes(value)

    def process_result_value(self, value: bytes | None, dialect: Dialect) -> bytes | None:
        return None if value is None else decrypt_bytes(bytes(value))
```

(import `LargeBinary` from sqlalchemy.) In `models.py` (import `LargeBinary`-free; use `EncryptedBytes`):

```python
class EvidenceFile(Base):
    __tablename__ = "evidence_files"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    case_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE"), index=True)
    filename: Mapped[str] = mapped_column(String(120))
    content_type: Mapped[str] = mapped_column(String(40))
    size_bytes: Mapped[int] = mapped_column(Integer)
    # Owner-only, encrypted at rest; deferred so metadata queries never decrypt.
    data: Mapped[bytes] = mapped_column(EncryptedBytes, deferred=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    erased_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
```

and on `Case`: `evidence: Mapped[list["EvidenceFile"]] = relationship(cascade="all, delete-orphan", passive_deletes=True)`. Import `EncryptedBytes` from `app.security.crypto`.

Migration `f6c2e1b58d03` (`down_revision = "e5b1d0a47c92"`): `op.create_table("evidence_files", id Uuid PK, case_id Uuid FK cases.id ondelete CASCADE not null, filename String(120) not null, content_type String(40) not null, size_bytes Integer not null, data LargeBinary not null, created_at DateTime(timezone=True) server_default now() not null, erased_at DateTime(timezone=True) null)` + `op.create_index("ix_evidence_files_case_id", ...)`; downgrade drops index and table. Use the same naming-convention style as existing revisions (`op.f` not required; follow `5d2a9c41e7b3`).

- [ ] **Step 3:** Run the test → PASS; run `.venv/Scripts/python -m alembic check` is skipped (no DB); full suite green.
- [ ] **Step 4: Commit** `feat(evidence): encrypted evidence_files table`.

### Task 2: Evidence endpoints (owner only)

**Files:**
- Create: `backend/app/evidence.py` (validation: sniffing, filename sanitizing)
- Create: `backend/app/routers/evidence.py`
- Modify: `backend/app/errors.py`, `backend/app/schemas.py` (`EvidenceOut`), `backend/main.py` (router + per-route limit), `backend/app/security/bodylimit.py` (`path_limits`), `backend/app/config.py` (`evidence_max_bytes()`)
- Test: `backend/tests/test_evidence_api.py`, `backend/tests/test_evidence_rules.py`

**Interfaces:**
- Produces: `evidence.sniff(data: bytes) -> str | None` (returns `"application/pdf"`, `"image/png"`, `"image/jpeg"`, `"text/plain"` or `None`), `evidence.safe_filename(name: str) -> str`, constants `MAX_FILES = 5`, `MAX_BYTES = 2_621_440`; `EvidenceOut(id, filename, content_type, size_bytes, created_at)`.
- Errors added to `errors.py`: `EVIDENCE_TYPE = "Formato não aceito. Envie PDF, JPG, PNG ou TXT."`, `EVIDENCE_TOO_BIG = "Arquivo acima de 2,5 MB."`, `EVIDENCE_LIMIT = "Limite de 5 arquivos por caso."`, `EVIDENCE_LOCKED = "Este caso não aceita mais anexos."`, `EVIDENCE_NOT_FOUND = "Anexo não encontrado."`.

- [ ] **Step 1: Failing unit tests** `tests/test_evidence_rules.py`

```python
import pytest

from app.evidence import safe_filename, sniff


@pytest.mark.parametrize("data,kind", [
    (b"%PDF-1.7\n...", "application/pdf"),
    (b"\x89PNG\r\n\x1a\n" + b"0" * 10, "image/png"),
    (b"\xff\xd8\xff\xe0" + b"0" * 10, "image/jpeg"),
    ("olá, isto é texto".encode(), "text/plain"),
])
def test_sniff_detects_allowed_types(data, kind):
    assert sniff(data) == kind


@pytest.mark.parametrize("data", [b"MZ\x90\x00", b"<html><script>", b"\x00\x01binary", b""])
def test_sniff_rejects_everything_else(data):
    assert sniff(data) is None


@pytest.mark.parametrize("raw,clean", [
    ("../../etc/passwd", "passwd"),
    ("C:\\Users\\a\\rg.pdf", "rg.pdf"),
    ("rel\u00e1torio final.pdf", "relatorio final.pdf"),
    ("a" * 300 + ".pdf", ("a" * 112) + ".pdf"),
    ("   ", "anexo"),
    ("evil\r\nX: y.png", "evilX y.png"),
])
def test_safe_filename(raw, clean):
    assert safe_filename(raw) == clean
```

- [ ] **Step 2: Implement `app/evidence.py`**

```python
import re
import unicodedata

MAX_FILES = 5
MAX_BYTES = 2_621_440


def sniff(data: bytes) -> str | None:
    if data.startswith(b"%PDF-"):
        return "application/pdf"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
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
```

Run unit tests → PASS (adjust only if a case in the table is wrong, never weaken the rejection rules).

- [ ] **Step 3: Failing API tests** `tests/test_evidence_api.py` (use fixtures `login`, `approved_case`, `session`; see `tests/test_cases_api.py` for how a case is created: `client.post("/api/cases", json={...})` with `lgpd_consent`, `consent_version`):

```python
from app.consent import CONSENT_VERSION
from app.models import UserRole

PDF = b"%PDF-1.4\n" + b"x" * 100


def _case(client) -> str:
    res = client.post("/api/cases", json={"title": "Obra", "text": "Texto do caso.",
                                           "lgpd_consent": True, "consent_version": CONSENT_VERSION})
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _put(client, case_id, data=PDF, name="doc.pdf"):
    return client.post(f"/api/cases/{case_id}/evidence?filename={name}", content=data,
                       headers={"Content-Type": "application/octet-stream"})


def test_owner_uploads_lists_downloads_deletes(login):
    client, _ = login(UserRole.CLIENT)
    cid = _case(client)
    up = _put(client, cid)
    assert up.status_code == 201
    meta = up.json()
    assert set(meta) == {"id", "filename", "content_type", "size_bytes", "created_at"}
    assert meta["content_type"] == "application/pdf" and meta["size_bytes"] == len(PDF)
    assert [m["id"] for m in client.get(f"/api/cases/{cid}/evidence").json()] == [meta["id"]]
    dl = client.get(f"/api/cases/{cid}/evidence/{meta['id']}")
    assert dl.status_code == 200 and dl.content == PDF
    assert dl.headers["content-disposition"].startswith("attachment")
    assert dl.headers["x-content-type-options"] == "nosniff"
    assert client.delete(f"/api/cases/{cid}/evidence/{meta['id']}").status_code == 204
    assert client.get(f"/api/cases/{cid}/evidence").json() == []


def test_others_get_404_and_roles_are_blocked(login):
    owner, _ = login(UserRole.CLIENT)
    cid = _case(owner)
    eid = _put(owner, cid).json()["id"]
    stranger, _ = login(UserRole.CLIENT)
    judge, _ = login(UserRole.JUDGE)
    for c in (stranger,):
        assert c.get(f"/api/cases/{cid}/evidence").status_code == 404
        assert c.get(f"/api/cases/{cid}/evidence/{eid}").status_code == 404
        assert _put(c, cid).status_code == 404
        assert c.delete(f"/api/cases/{cid}/evidence/{eid}").status_code == 404
    assert judge.get(f"/api/cases/{cid}/evidence").status_code == 403


def test_rejects_bad_type_too_big_and_too_many(login):
    client, _ = login(UserRole.CLIENT)
    cid = _case(client)
    assert _put(client, cid, b"MZ\x90\x00 exe", "a.pdf").status_code == 415
    assert _put(client, cid, b"%PDF-" + b"0" * 2_700_000).status_code == 413
    for i in range(5):
        assert _put(client, cid, name=f"f{i}.pdf").status_code == 201
    assert _put(client, cid, name="f6.pdf").status_code == 409


def test_upload_locked_after_evaluation(login, session):
    import uuid

    from sqlalchemy import update

    from app.models import Case, CaseStatus

    client, _ = login(UserRole.CLIENT)
    cid = _case(client)
    session.execute(update(Case).where(Case.id == uuid.UUID(cid)).values(status=CaseStatus.EVALUATED))
    session.commit()
    res = _put(client, cid)
    assert res.status_code == 409 and res.json()["detail"] == "Este caso não aceita mais anexos."
```

- [ ] **Step 4: Implement the router.** `backend/app/routers/evidence.py`:

```python
import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Request, Response, status
from sqlalchemy import func, select

from app import errors
from app.deps import ClientUser, SessionDep
from app.evidence import MAX_BYTES, MAX_FILES, safe_filename, sniff
from app.lifecycle import DELETABLE
from app.models import Case, EvidenceFile
from app.schemas import EvidenceOut

router = APIRouter(prefix="/api/cases/{case_id}/evidence", tags=["evidence"])


def _owned(db: SessionDep, case_id: uuid.UUID, client) -> Case:
    case = db.get(Case, case_id)
    if case is None or case.client_id != client.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, errors.CASE_NOT_FOUND)
    return case


@router.post("", status_code=status.HTTP_201_CREATED, response_model=EvidenceOut)
async def upload(case_id: uuid.UUID, request: Request, client: ClientUser, db: SessionDep,
                 filename: Annotated[str, Query(max_length=300)] = "anexo") -> EvidenceFile:
    case = _owned(db, case_id, client)
    if case.status not in DELETABLE:
        raise HTTPException(status.HTTP_409_CONFLICT, errors.EVIDENCE_LOCKED)
    data = await request.body()
    if len(data) > MAX_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, errors.EVIDENCE_TOO_BIG)
    kind = sniff(data)
    if kind is None:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, errors.EVIDENCE_TYPE)
    count = db.scalar(select(func.count()).select_from(EvidenceFile).where(EvidenceFile.case_id == case.id))
    if count >= MAX_FILES:
        raise HTTPException(status.HTTP_409_CONFLICT, errors.EVIDENCE_LIMIT)
    item = EvidenceFile(case_id=case.id, filename=safe_filename(filename), content_type=kind,
                        size_bytes=len(data), data=data)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.get("", response_model=list[EvidenceOut])
def list_evidence(case_id: uuid.UUID, client: ClientUser, db: SessionDep) -> list[EvidenceFile]:
    case = _owned(db, case_id, client)
    return list(db.scalars(select(EvidenceFile).where(EvidenceFile.case_id == case.id)
                           .order_by(EvidenceFile.created_at, EvidenceFile.id)))


def _item(db, case_id, evidence_id, client) -> EvidenceFile:
    case = _owned(db, case_id, client)
    item = db.get(EvidenceFile, evidence_id)
    if item is None or item.case_id != case.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, errors.EVIDENCE_NOT_FOUND)
    return item


@router.get("/{evidence_id}")
def download(case_id: uuid.UUID, evidence_id: uuid.UUID, client: ClientUser, db: SessionDep) -> Response:
    item = _item(db, case_id, evidence_id, client)
    return Response(
        content=item.data,
        media_type=item.content_type,
        headers={"Content-Disposition": f'attachment; filename="{item.filename}"',
                 "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store"},
    )


@router.delete("/{evidence_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete(case_id: uuid.UUID, evidence_id: uuid.UUID, client: ClientUser, db: SessionDep) -> None:
    db.delete(_item(db, case_id, evidence_id, client))
    db.commit()
```

`schemas.py`: `class EvidenceOut(BaseModel): model_config = ConfigDict(from_attributes=True); id: uuid.UUID; filename: str; content_type: str; size_bytes: int; created_at: datetime`. Add the five error strings to `errors.py`. Register `app.include_router(evidence.router)` in `main.py` (and `from app.routers import … evidence`).

**Body limit override.** `BodySizeLimitMiddleware.__init__` gains `path_limits: dict[str, int] | None`; in `__call__`, `limit = self.max_bytes()` becomes `limit = self._limit_for(scope["path"])` where `_limit_for` returns `evidence_max_bytes()` when the path matches `^/api/cases/[0-9a-f-]{36}/evidence$` (POST only) else `self.max_bytes()`. `config.evidence_max_bytes()` returns `MAX_BYTES + 4096`. Add a test in `tests/test_limits.py`: a 2.6 MB body to the evidence path reaches the app (413 comes from the endpoint JSON `Arquivo acima de 2,5 MB.`, not `Requisição grande demais.`), while the same body to `/api/cases` still gets the middleware's 413.

- [ ] **Step 5:** Run `tests/test_evidence_api.py tests/test_evidence_rules.py tests/test_limits.py` → PASS, then the full suite.
- [ ] **Step 6: Commit** `feat(evidence): owner-only upload, list, download and delete`.

### Task 3: Erasure paths and third-party views

**Files:**
- Modify: `backend/app/routers/cases.py` (`erase_original`), `backend/app/retention.py`
- Modify: `backend/app/schemas.py` (`CaseForJudge`, `CaseForLawyer` gain `evidence_count: int`; `CaseOwnerView` gains `evidence_count`)
- Modify: `backend/app/routers/judge.py`, `lawyer.py`
- Test: `backend/tests/test_evidence_privacy.py`

**Interfaces:** Consumes `EvidenceFile` (Task 1). Produces `evidence_count` on judge/lawyer/owner case schemas.

- [ ] **Step 1: Failing tests**

```python
from sqlalchemy import select, update

from app.models import Case, CaseStatus, EvidenceFile, UserRole
from tests.test_evidence_api import PDF, _case, _put


def test_erase_original_blanks_evidence(login, session):
    client, _ = login(UserRole.CLIENT)
    cid = _case(client)
    _put(client, cid)
    assert client.post(f"/api/cases/{cid}/erase-original").status_code == 200
    session.expire_all()
    item = session.scalar(select(EvidenceFile))
    assert item.erased_at is not None and item.data == b"" and item.size_bytes == 0


def test_retention_blanks_evidence_too(login, session):
    from datetime import datetime, timedelta, timezone

    from app.retention import purge_raw_text_ids

    client, _ = login(UserRole.CLIENT)
    cid = _case(client)
    _put(client, cid)
    old = datetime.now(timezone.utc) - timedelta(days=400)
    session.execute(update(Case).values(status=CaseStatus.RESOLVED, updated_at=old))
    session.commit()
    assert len(purge_raw_text_ids(session, days=180)) == 1
    session.expire_all()
    assert session.scalar(select(EvidenceFile)).data == b""


def test_third_parties_see_only_the_count(login, session):
    client, _ = login(UserRole.CLIENT)
    cid = _case(client)
    _put(client, cid)
    client.post(f"/api/cases/{cid}/approve")
    judge, _ = login(UserRole.JUDGE)
    body = judge.get("/api/judge/queue").json()
    assert body[0]["evidence_count"] == 1
    assert "filename" not in judge.get("/api/judge/queue").text
    assert "data" not in body[0]
```

- [ ] **Step 2: Implement.** In `erase_original`, after the case UPDATE and before `db.commit()`, run `db.execute(update(EvidenceFile).where(EvidenceFile.case_id == case_id, EvidenceFile.erased_at.is_(None)).values(data=b"", size_bytes=0, erased_at=now))` (the `EncryptedBytes` type encrypts the empty bytes). In `retention.purge_raw_text_ids`, inside the real (non-dry-run) branch, after computing `ids` blank evidence for those ids with the same UPDATE using `EvidenceFile.case_id.in_(ids)`. `evidence_count`: add a labelled scalar subquery `select(func.count()).where(EvidenceFile.case_id == Case.id).correlate(Case).scalar_subquery()` to the judge queue and lawyer board queries, mapping rows into the schema; for lists built from ORM objects, set `case.evidence_count` via a helper `with_evidence_count(db, cases)` in `app/evidence.py` that runs one grouped query (`select(EvidenceFile.case_id, func.count()).where(EvidenceFile.case_id.in_(ids)).group_by(EvidenceFile.case_id)`) and returns the cases with an `evidence_count` attribute set (`setattr`). Use it in `judge.queue`, `lawyer.board`, `cases.get_my_case` and `my_cases`'s detail path; schemas read `evidence_count: int = 0` from attributes.
- [ ] **Step 3:** Run the new tests and the full suite → PASS (existing key-set assertions in `test_judge_api.py`/`test_lawyer_api.py` (`LAWYER_KEYS`) must be updated to include `evidence_count`; update them in this task).
- [ ] **Step 4: Commit** `feat(evidence): erase with the original, expose only the count to third parties`.

### Task 4: Frontend — wizard upload, case detail, third-party counts

**Files:**
- Modify: `frontend/src/lib/api.ts` (types + methods), `frontend/src/components/design-system/UploadZone.tsx` (copy, limits), `frontend/src/features/client/NewCaseWizard.tsx`, `frontend/src/features/client/CaseDetail.tsx`, judge and lawyer case cards (show "N anexos").
- Create: `frontend/src/features/client/EvidenceList.tsx`
- Test: `frontend/src/features/client/evidence.test.tsx`; update `UploadZone.test.tsx`, `client.test.tsx`, `lawyer.test.tsx` fixtures (`evidence_count`).

**Ruling (controller, after the Task 2 review):** the original filename travels in the request header `X-Filename` (percent-encoded UTF-8), never in the URL query, so access logs do not record personal data. `rawRequest` must accept extra headers and send the `File` as the body with `Content-Type: application/octet-stream`.

**Interfaces:**
- Produces in `api.ts`:

```ts
export type Evidence = { id: string; filename: string; content_type: string; size_bytes: number; created_at: string };
// added to api:
uploadEvidence: (caseId: string, file: File) =>
  rawRequest<Evidence>(`/api/cases/${encodeURIComponent(caseId)}/evidence`, { method: "POST", body: file, headers: { "X-Filename": encodeURIComponent(file.name) } }),
listEvidence: (caseId: string) => request<Evidence[]>(`${caseUrl(caseId)}/evidence`),
deleteEvidence: (caseId: string, id: string) => request<void>(`${caseUrl(caseId)}/evidence/${encodeURIComponent(id)}`, { method: "DELETE" }),
evidenceDownloadUrl: (caseId: string, id: string) => `${caseUrl(caseId)}/evidence/${encodeURIComponent(id)}`,
```

`request()` currently forces JSON headers when `init.body` is set; add a `rawRequest` variant (or a parameter) that sends the `File` body with `Content-Type: application/octet-stream` and the same error handling (`parseError`, 401 handler). `CaseSummary`, `CaseForJudge`, `CaseForLawyer`, `CaseOwnerView` gain `evidence_count: number`.

- [ ] **Step 1: Failing tests** (`evidence.test.tsx`): (a) `api.uploadEvidence` sends `POST` with the file as body, `Content-Type: application/octet-stream`, and the encoded filename (mock `fetch`); (b) `EvidenceList` renders names, sizes (`formatFileSize`), a download link whose `href` equals `api.evidenceDownloadUrl`, and a "Remover" button that calls `api.deleteEvidence` then removes the row; (c) wizard: after `api.createCase` resolves, it calls `api.uploadEvidence` once per selected file, shows per-file failure ("Não foi possível enviar x.pdf") without blocking navigation to the review step; (d) judge/lawyer cards show "2 anexos" / "1 anexo" / nothing when 0.
- [ ] **Step 2: Implement.** `UploadZone`: `MAX_FILE_BYTES = 2.5 * 1024 * 1024` (message "Arquivo acima de 2,5 MB."), accepted types add `text/plain`/`.txt`, max 5 files ("Limite de 5 arquivos."), `DEFAULT_SECURITY_NOTE = "Os arquivos são criptografados e só você consegue baixá-los. Juízes e advogados não os veem."`; "Anexado (fica só no seu navegador)" becomes "Pronto para enviar". Wizard: keep `files` state; in submit, after `createCase`, `for (const f of files) await api.uploadEvidence(created.id, f)` collecting failures into a `uploadErrors` list shown on the review step; then proceed as today. `CaseDetail`: render `<EvidenceList caseId={id} editable={canDelete(status)} />` inside the owner section; hide it when `raw_text_erased_at` is set and the list is empty.
- [ ] **Step 3:** `npm test`, `npm run lint`, `npx tsc --noEmit`, `BACKEND_URL=http://127.0.0.1:8000 npm run build` green.
- [ ] **Step 4: Commit** `feat(evidence): upload from the wizard, manage in case detail`.

### Task 5: Deploy and verify in production

- [ ] **Step 1:** Push `main`; apply `alembic upgrade head` to `peacelaw-prod` with the owner role; re-grant on `evidence_files` to `peacelaw_app`; `vercel deploy --prod --scope <seu-time-vercel>`.
- [ ] **Step 2: Smoke** (agent-browser + protection bypass, as in plan A Task 4): register a client, create a case with one PDF and one TXT, confirm the files list, download compares byte-for-byte, a third file with an `.exe` renamed `.pdf` is rejected (415), judge view shows only "2 anexos", erase original blanks the files (download now returns empty), cleanup test data with the owner connection.
- [ ] **Step 3:** Update `CONTINUE.md`; commit and push.

## Self-review
- Spec B coverage: table (T1), endpoints and limits (T2), erase/retention and third-party metadata (T3), wizard/detail UI (T4), prod verification (T5). The body-limit override is in T2.
- Names consistent: `EvidenceFile`, `EvidenceOut`, `evidence_count`, `encrypt_bytes`, `MAX_BYTES`, `MAX_FILES`.
