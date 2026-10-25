from app.consent import CONSENT_VERSION
from app.models import UserRole

BODY = {"title": "Obra", "text": "Texto do caso com mais de quarenta caracteres para valer.", "lgpd_consent": True, "consent_version": CONSENT_VERSION}


def test_area_defaults_to_outros(login):
    client, _ = login(UserRole.CLIENT)
    res = client.post("/api/cases", json=BODY)
    assert res.status_code == 201 and res.json()["area"] == "OUTROS"


def test_area_is_stored_and_validated(login):
    client, _ = login(UserRole.CLIENT)
    ok = client.post("/api/cases", json={**BODY, "area": "ALUGUEL"})
    assert ok.json()["area"] == "ALUGUEL"
    bad = client.post("/api/cases", json={**BODY, "area": "PENAL"})
    assert bad.status_code == 422
    assert set(bad.json()) == {"detail", "errors"}
    assert "PENAL" not in bad.text


def test_lowercase_and_null_area_are_rejected_without_echo(login):
    client, _ = login(UserRole.CLIENT)
    for value in ("aluguel", None):
        res = client.post("/api/cases", json={**BODY, "area": value})
        assert res.status_code == 422
        assert set(res.json()) == {"detail", "errors"}
        assert "aluguel" not in res.text
        assert BODY["title"] not in res.text and BODY["text"] not in res.text


def test_judges_see_the_area_without_pii(login):
    client, _ = login(UserRole.CLIENT)
    cid = client.post("/api/cases", json={**BODY, "area": "CONSUMIDOR"}).json()["id"]
    client.post(f"/api/cases/{cid}/approve")
    judge, _ = login(UserRole.JUDGE)
    assert judge.get("/api/judge/queue").json()[0]["area"] == "CONSUMIDOR"
