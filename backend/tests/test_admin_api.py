from app.models import UserRole


def test_pitch_requires_login(client_factory):
    res = client_factory().get("/api/admin/pitch")
    assert res.status_code == 401


def test_pitch_is_for_admins_only(login):
    for role in (UserRole.CLIENT, UserRole.JUDGE, UserRole.LAWYER):
        client, _ = login(role)
        res = client.get("/api/admin/pitch")
        assert res.status_code == 403
        assert "PeaceLaw" not in res.text


def test_admin_gets_the_portuguese_pitch(login):
    admin, _ = login(UserRole.ADMIN)
    res = admin.get("/api/admin/pitch")
    assert res.status_code == 200
    assert res.headers["Cache-Control"] == "no-store"
    html = res.json()["html"]
    assert "Roteiro" in html and "Fluxograma" in html and "<svg" in html


def test_pitch_markup_is_inert():
    from app.routers.admin import pitch_html

    html = pitch_html().lower()
    for forbidden in ("<script", "javascript:", "onclick=", "onerror=", "<iframe", "http://", "https://"):
        assert forbidden not in html
