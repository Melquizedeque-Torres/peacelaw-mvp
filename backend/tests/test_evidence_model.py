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
