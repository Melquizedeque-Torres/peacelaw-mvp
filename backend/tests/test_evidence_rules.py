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
    ("a" * 300 + ".pdf", ("a" * 116) + ".pdf"),
    ("   ", "anexo"),
    ("evil\r\nX: y.png", "evilX y.png"),
])
def test_safe_filename(raw, clean):
    assert safe_filename(raw) == clean


@pytest.mark.parametrize("data,kind", [
    (b"\x1aE\xdf\xa3" + b"\x9fB\x86\x81\x01" * 4, "audio/webm"),  # WebM/Matroska (Chrome, Edge, Firefox)
    (b"OggS\x00\x02" + b"\x00" * 20, "audio/ogg"),  # Ogg Opus (Firefox)
    (b"\x00\x00\x00\x20ftypM4A \x00\x00\x00\x00" + b"\x00" * 16, "audio/mp4"),  # Safari / iOS
    (b"RIFF\x24\x08\x00\x00WAVEfmt " + b"\x00" * 16, "audio/wav"),
    (b"ID3\x03\x00\x00\x00\x00\x00\x21" + b"\x00" * 20, "audio/mpeg"),
    (b"\xff\xfb\x90\x00" + b"\x00" * 20, "audio/mpeg"),
])
def test_sniff_detects_voice_note_formats(data, kind):
    assert sniff(data) == kind


def test_sniff_does_not_mistake_other_binaries_for_audio():
    assert sniff(b"RIFF\x24\x08\x00\x00AVI LIST" + b"\x00" * 8) is None
    assert sniff(b"\x00\x00\x00\x20ftypmp42" + b"\x00" * 8) == "audio/mp4"
    assert sniff(b"\x00\x00\x00\x20ftyp") is None
