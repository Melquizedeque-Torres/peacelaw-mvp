from app.models import UserRole

WEBM = b"\x1a\x45\xdf\xa3" + b"\x9fB\x86\x81\x01" * 200
BODY = {
    "title": "Relato por voz",
    "text": "Transcrição do áudio gravado pelo cliente, longa o bastante para passar a validação.",
    "lgpd_consent": True,
    "consent_version": "2026-10-20",
}


def _case_with_voice(client):
    case_id = client.post("/api/cases", json=BODY).json()["id"]
    res = client.post(f"/api/cases/{case_id}/evidence", content=WEBM, headers={"x-filename": "relato-1.webm"})
    assert res.status_code == 201, res.text
    return case_id, res.json()


def test_a_voice_note_is_stored_and_can_be_replayed_by_its_owner(login):
    client, _ = login(UserRole.CLIENT)
    case_id, item = _case_with_voice(client)
    assert item["content_type"] == "audio/webm" and item["filename"] == "relato-1.webm"
    got = client.get(f"/api/cases/{case_id}/evidence/{item['id']}")
    assert got.status_code == 200 and got.content == WEBM
    assert got.headers["content-type"] == "audio/webm"
    assert got.headers["content-disposition"].startswith("attachment")
    assert got.headers["x-content-type-options"] == "nosniff"
    assert client.get(f"/api/cases/{case_id}").json()["evidence_count"] == 1


def test_nobody_but_the_owner_can_hear_it(login, make_user):
    owner, _ = login(UserRole.CLIENT)
    case_id, item = _case_with_voice(owner)
    for role in (UserRole.CLIENT, UserRole.JUDGE, UserRole.LAWYER, UserRole.ADMIN):
        other, _ = login(role)
        assert other.get(f"/api/cases/{case_id}/evidence/{item['id']}").status_code in (403, 404)


def test_judges_see_the_transcript_text_only_and_a_count_never_the_audio(login):
    owner, _ = login(UserRole.CLIENT)
    case_id, _ = _case_with_voice(owner)
    assert owner.post(f"/api/cases/{case_id}/approve").status_code == 200
    judge, _ = login(UserRole.JUDGE)
    queue = judge.get("/api/judge/queue").json()
    mine = next(c for c in queue if c["id"] == case_id)
    assert mine["anonymized_text"].startswith("Transcrição do áudio")
    assert mine["evidence_count"] == 1
    assert "audio" not in str(mine).lower().replace("transcrição do áudio", "")


def test_erasing_the_original_also_erases_the_voice_notes(login):
    client, _ = login(UserRole.CLIENT)
    case_id, item = _case_with_voice(client)
    assert client.post(f"/api/cases/{case_id}/erase-original").status_code == 200
    assert client.get(f"/api/cases/{case_id}/evidence/{item['id']}").status_code == 404
    assert client.get(f"/api/cases/{case_id}/evidence").json() == []
