from urllib.parse import quote

from app.consent import CONSENT_VERSION
from app.models import UserRole
from tests.conftest import CASE_TEXT, CASE_TITLE

PDF = b"%PDF-1.4\n" + b"x" * 100


def _case(client) -> str:
    res = client.post("/api/cases", json={"title": CASE_TITLE, "text": CASE_TEXT,
                                           "lgpd_consent": True, "consent_version": CONSENT_VERSION})
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _put(client, case_id, data=PDF, name="doc.pdf"):
    return client.post(f"/api/cases/{case_id}/evidence", content=data,
                       headers={"Content-Type": "application/octet-stream",
                                "X-Filename": quote(name)})


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
    assert _put(client, cid, b"%PDF-" + b"0" * 2_623_000).status_code == 413
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


def test_erased_case_refuses_uploads(login, session):
    import uuid
    from datetime import datetime, timezone

    from sqlalchemy import update

    from app.models import Case

    client, _ = login(UserRole.CLIENT)
    cid = _case(client)
    session.execute(update(Case).where(Case.id == uuid.UUID(cid))
                    .values(raw_text_erased_at=datetime.now(timezone.utc)))
    session.commit()
    res = _put(client, cid)
    assert res.status_code == 409 and res.json()["detail"] == "Este caso não aceita mais anexos."


def test_anonymous_and_other_roles(login, client_factory):
    owner, _ = login(UserRole.CLIENT)
    cid = _case(owner)
    eid = _put(owner, cid).json()["id"]
    anon = client_factory()
    assert anon.get(f"/api/cases/{cid}/evidence").status_code == 401
    assert _put(anon, cid).status_code == 401
    for role in (UserRole.LAWYER, UserRole.ADMIN):
        c, _ = login(role)
        assert c.get(f"/api/cases/{cid}/evidence").status_code == 403
        assert c.get(f"/api/cases/{cid}/evidence/{eid}").status_code == 403
        assert _put(c, cid).status_code == 403
        assert c.delete(f"/api/cases/{cid}/evidence/{eid}").status_code == 403


def test_evidence_of_case_a_is_404_under_case_b(login):
    client, _ = login(UserRole.CLIENT)
    a, b = _case(client), _case(client)
    eid = _put(client, a).json()["id"]
    assert client.get(f"/api/cases/{b}/evidence/{eid}").status_code == 404
    assert client.delete(f"/api/cases/{b}/evidence/{eid}").status_code == 404
    assert client.get(f"/api/cases/{a}/evidence/{eid}").status_code == 200


def test_html_text_body_is_415(login):
    client, _ = login(UserRole.CLIENT)
    cid = _case(client)
    assert _put(client, cid, b"<html><script>alert(1)</script></html>", "a.txt").status_code == 415


def test_hostile_filename_is_sanitised_in_content_disposition(login):
    client, _ = login(UserRole.CLIENT)
    cid = _case(client)
    hostile = '../../a"b\r\nSet-Cookie: x=1.pdf'
    eid = _put(client, cid, name=hostile).json()["id"]
    dl = client.get(f"/api/cases/{cid}/evidence/{eid}")
    assert dl.headers["content-disposition"] == 'attachment; filename="abSet-Cookie x1.pdf"'
    assert "set-cookie" not in dl.headers


def test_filename_header_missing_defaults_and_long_is_422(login):
    client, _ = login(UserRole.CLIENT)
    cid = _case(client)
    res = client.post(f"/api/cases/{cid}/evidence", content=PDF)
    assert res.status_code == 201 and res.json()["filename"] == "anexo"
    long = client.post(f"/api/cases/{cid}/evidence", content=PDF, headers={"X-Filename": "a" * 400})
    assert long.status_code == 422
