from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select, update

from app.models import Case, CaseStatus, EvidenceFile, UserRole
from tests.test_evidence_api import _case, _put


def test_erase_original_blanks_evidence(login, session):
    client, _ = login(UserRole.CLIENT)
    cid = _case(client)
    _put(client, cid)
    assert client.post(f"/api/cases/{cid}/erase-original").status_code == 200
    session.expire_all()
    item = session.scalar(select(EvidenceFile))
    assert item.erased_at is not None and item.data == b"" and item.size_bytes == 0


def test_retention_blanks_evidence_too(login, session):
    from app.retention import purge_raw_text_ids

    client, _ = login(UserRole.CLIENT)
    cid = _case(client)
    _put(client, cid)
    old = datetime.now(timezone.utc) - timedelta(days=400)
    session.execute(update(Case).values(status=CaseStatus.RESOLVED, updated_at=old))
    session.commit()
    assert len(purge_raw_text_ids(session, days=180)) == 1
    session.expire_all()
    item = session.scalar(select(EvidenceFile))
    assert item.data == b"" and item.size_bytes == 0 and item.erased_at is not None


def test_third_parties_see_only_the_count(login, session):
    client, _ = login(UserRole.CLIENT)
    cid = _case(client)
    _put(client, cid, name="secretname.pdf")
    _put(client, cid, name="other.pdf")
    owner = client.get(f"/api/cases/{cid}").json()
    assert owner["evidence_count"] == 2
    client.post(f"/api/cases/{cid}/approve")
    judge, _ = login(UserRole.JUDGE)
    res = judge.get("/api/judge/queue")
    body = res.json()
    assert body[0]["evidence_count"] == 2
    assert "secretname" not in res.text and "data" not in body[0]
    session.execute(update(Case).values(status=CaseStatus.EVALUATED))
    session.commit()
    lawyer, _ = login(UserRole.LAWYER)
    board = lawyer.get("/api/lawyer/board")
    assert board.json()[0]["evidence_count"] == 2
    assert "secretname" not in board.text
    matched = lawyer.post(f"/api/cases/{cid}/match")
    assert matched.json()["evidence_count"] == 2


def test_erased_evidence_is_not_counted(login):
    client, _ = login(UserRole.CLIENT)
    cid = _case(client)
    assert client.get(f"/api/cases/{cid}").json()["evidence_count"] == 0
    _put(client, cid)
    assert client.get(f"/api/cases/{cid}").json()["evidence_count"] == 1
    assert client.post(f"/api/cases/{cid}/erase-original").json()["evidence_count"] == 0


def _assert_erased_is_invisible(client, session, cid, eid):
    assert client.get(f"/api/cases/{cid}/evidence").json() == []
    for res in (client.get(f"/api/cases/{cid}/evidence/{eid}"),
                client.delete(f"/api/cases/{cid}/evidence/{eid}")):
        assert res.status_code == 404 and res.json() == {"detail": "Anexo não encontrado."}
    session.expire_all()
    assert session.scalar(select(EvidenceFile)).filename == "anexo"


def test_erase_original_hides_evidence_and_drops_filename(login, session):
    client, _ = login(UserRole.CLIENT)
    cid = _case(client)
    eid = _put(client, cid, name="contrato-joao.pdf").json()["id"]
    assert client.post(f"/api/cases/{cid}/erase-original").status_code == 200
    _assert_erased_is_invisible(client, session, cid, eid)


def test_retention_hides_evidence_and_drops_filename(login, session):
    from app.retention import purge_raw_text_ids

    client, _ = login(UserRole.CLIENT)
    cid = _case(client)
    eid = _put(client, cid, name="contrato-joao.pdf").json()["id"]
    old = datetime.now(timezone.utc) - timedelta(days=400)
    session.execute(update(Case).values(status=CaseStatus.RESOLVED, updated_at=old))
    session.commit()
    assert len(purge_raw_text_ids(session, days=180)) == 1
    _assert_erased_is_invisible(client, session, cid, eid)


def test_deleting_a_case_removes_its_evidence_rows(login, session):
    client, _ = login(UserRole.CLIENT)
    cid = _case(client)
    _put(client, cid)
    _put(client, cid, name="b.pdf")
    assert session.scalar(select(func.count()).select_from(EvidenceFile)) == 2
    assert client.delete(f"/api/cases/{cid}").status_code == 204
    session.expire_all()
    assert session.scalar(select(func.count()).select_from(EvidenceFile)) == 0
