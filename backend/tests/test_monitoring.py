from datetime import datetime, timedelta, timezone

from sqlalchemy import text

from app.models import AuditEvent, UserRole


def test_api_health_checks_the_database(client_factory):
    res = client_factory().get("/api/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}
    assert res.headers["cache-control"] == "no-store"


def test_api_health_reports_503_without_detail_when_db_is_down(client_factory, monkeypatch):
    import main

    class Broken:
        def __enter__(self):
            raise RuntimeError("postgres://secret-host/db password=hunter2")

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(main, "_session_factory", lambda: (lambda: Broken()))
    res = client_factory(raise_server_exceptions=False).get("/api/health")
    assert res.status_code == 503
    assert res.json() == {"status": "unavailable"}
    assert "hunter2" not in res.text


def test_stats_include_last_24h_activity_counts_only(login, session):
    admin, me = login(UserRole.ADMIN)
    old = datetime.now(timezone.utc) - timedelta(days=3)
    session.add(AuditEvent(actor_id=me.id, action="admin.stepup_failed"))
    session.add(AuditEvent(actor_id=me.id, action="admin.stepup_failed", created_at=old))
    session.add(AuditEvent(actor_id=me.id, action="user.create"))
    session.commit()
    body = admin.get("/api/admin/stats").json()
    assert body["last_24h"] == {"audit_events": 2, "stepup_failures": 1, "rate_limit_hits": 0}
