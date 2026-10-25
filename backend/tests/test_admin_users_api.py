import uuid

import pytest
from sqlalchemy import select

from app.models import AuditEvent, Case, CaseStatus, User, UserRole
from tests.conftest import PASSWORD

NEW = {"email": "novo.juiz@exemplo.com", "role": "JUDGE", "password": "senha-forte-123"}


def _audit(session):
    session.expire_all()
    return list(session.scalars(select(AuditEvent)))


def _calls(client, target):
    return [
        client.get("/api/admin/stats"),
        client.get("/api/admin/users"),
        client.post("/api/admin/users", json=NEW),
        client.post(f"/api/admin/users/{target}/revoke-sessions"),
    ]


def test_anonymous_is_401(client_factory):
    for res in _calls(client_factory(), uuid.uuid4()):
        assert res.status_code == 401


@pytest.mark.parametrize("role", [UserRole.CLIENT, UserRole.JUDGE, UserRole.LAWYER])
def test_non_admin_is_403(login, session, role):
    client, user = login(role)
    for res in _calls(client, user.id):
        assert res.status_code == 403
    assert _audit(session) == []


def test_stats_counts_and_zeros(login, session, make_user):
    admin, _ = login(UserRole.ADMIN)
    body = admin.get("/api/admin/stats").json()
    assert set(body["cases_by_status"]) == {s.value for s in CaseStatus}
    assert set(body["users_by_role"]) == {r.value for r in UserRole}
    assert all(v == 0 for v in body["cases_by_status"].values())
    assert body["users_by_role"] == {"CLIENT": 0, "JUDGE": 0, "LAWYER": 0, "ADMIN": 1}

    client = make_user(UserRole.CLIENT)
    make_user(UserRole.JUDGE)
    session.add(
        Case(
            client_id=client.id,
            title="Obra abandonada",
            raw_text="texto bruto sigiloso",
            anonymized_text="texto anonimizado sigiloso",
            status=CaseStatus.READY_FOR_JUDGE,
        )
    )
    session.commit()
    res = admin.get("/api/admin/stats")
    body = res.json()
    assert body["cases_by_status"]["READY_FOR_JUDGE"] == 1
    assert body["cases_by_status"]["DRAFT"] == 0
    assert body["users_by_role"]["JUDGE"] == 1
    assert body["users_by_role"]["CLIENT"] == 1
    for leak in ("raw_text", "anonymized_text", "title", "sigiloso", "Obra"):
        assert leak not in res.text


def test_users_list_shape_order_and_pagination(login, make_user):
    admin, _ = login(UserRole.ADMIN)
    for _i in range(3):
        make_user(UserRole.CLIENT)
    res = admin.get("/api/admin/users")
    assert res.status_code == 200
    rows = res.json()
    assert len(rows) == 4
    assert set(rows[0]) == {"id", "email", "role", "created_at", "is_active", "totp_enabled"}
    for leak in ("raw_text", "anonymized_text", "title", "password"):
        assert leak not in res.text
    assert len(admin.get("/api/admin/users?limit=2").json()) == 2
    assert len(admin.get("/api/admin/users?limit=2&offset=3").json()) == 1
    assert admin.get("/api/admin/users?limit=101").status_code == 422
    assert admin.get("/api/admin/users?limit=0").status_code == 422
    assert admin.get("/api/admin/users?offset=-1").status_code == 422


def test_create_user_can_login_and_is_audited(login, session, client_factory):
    admin, admin_user = login(UserRole.ADMIN)
    res = admin.post("/api/admin/users", json=NEW)
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["role"] == "JUDGE" and body["email"] == NEW["email"]
    assert "password" not in res.text

    judge = client_factory()
    assert (
        judge.post(
            "/api/auth/login", json={"email": NEW["email"], "password": NEW["password"]}
        ).status_code
        == 200
    )
    rows = _audit(session)
    assert len(rows) == 1
    row = rows[0]
    assert row.action == "user.create"
    assert str(row.target_id) == body["id"]
    assert row.actor_id == admin_user.id
    assert NEW["email"] not in str(row.__dict__)


def test_create_duplicate_email_is_409(login, session):
    admin, _ = login(UserRole.ADMIN)
    assert admin.post("/api/admin/users", json=NEW).status_code == 201
    existing = session.scalars(select(User).where(User.email == NEW["email"])).one()
    hash_before, version_before = existing.password_hash, existing.token_version
    before = len(_audit(session))
    res = admin.post("/api/admin/users", json={**NEW, "role": "LAWYER", "password": "outra-senha-123"})
    assert res.status_code == 409
    session.expire_all()
    existing = session.scalars(select(User).where(User.email == NEW["email"])).one()
    assert existing.password_hash == hash_before
    assert existing.token_version == version_before
    assert len(_audit(session)) == before
    assert session.scalars(select(User).where(User.email == NEW["email"])).all()[0].role == (
        UserRole.JUDGE
    )


def test_create_rejects_client_and_bad_input(login, session):
    admin, _ = login(UserRole.ADMIN)
    assert admin.post("/api/admin/users", json={**NEW, "role": "CLIENT"}).status_code == 422
    assert admin.post("/api/admin/users", json={**NEW, "role": "OWNER"}).status_code == 422
    assert admin.post("/api/admin/users", json={**NEW, "password": "curta"}).status_code == 422
    assert _audit(session) == []


def test_revoke_sessions_ends_target_session(login, session):
    admin, _ = login(UserRole.ADMIN)
    judge, judge_user = login(UserRole.JUDGE)
    assert judge.get("/api/auth/me").status_code == 200
    res = admin.post(f"/api/admin/users/{judge_user.id}/revoke-sessions")
    assert res.status_code == 204
    assert judge.get("/api/auth/me").status_code == 401
    assert admin.get("/api/auth/me").status_code == 200
    rows = _audit(session)
    assert [(r.action, r.target_id) for r in rows] == [("user.revoke_sessions", judge_user.id)]


def test_revoke_unknown_is_404_without_audit(login, session):
    admin, _ = login(UserRole.ADMIN)
    assert admin.post(f"/api/admin/users/{uuid.uuid4()}/revoke-sessions").status_code == 404
    assert _audit(session) == []


def test_admin_can_revoke_self(login, session):
    admin, admin_user = login(UserRole.ADMIN)
    assert admin.post(f"/api/admin/users/{admin_user.id}/revoke-sessions").status_code == 204
    assert admin.get("/api/admin/stats").status_code == 401
    again = admin.post(
        "/api/auth/login", json={"email": admin_user.email, "password": PASSWORD}
    )
    assert again.status_code == 200  # logging in again still works
    assert admin.get("/api/admin/stats").status_code == 200


def test_users_list_orders_by_created_at_desc_then_id(login, session, make_user):
    from datetime import datetime, timedelta, timezone

    admin, admin_user = login(UserRole.ADMIN)
    base = datetime(2030, 1, 1, tzinfo=timezone.utc)
    old = make_user(UserRole.CLIENT)
    new = make_user(UserRole.CLIENT)
    tie_a = make_user(UserRole.CLIENT)
    tie_b = make_user(UserRole.CLIENT)
    admin_user.created_at = base - timedelta(days=30)
    old.created_at = base - timedelta(days=10)
    new.created_at = base + timedelta(days=10)
    tie_a.created_at = tie_b.created_at = base
    session.commit()
    ids = [r["id"] for r in admin.get("/api/admin/users").json()]
    tied = sorted([str(tie_a.id), str(tie_b.id)])
    assert ids == [str(new.id), *tied, str(old.id), str(admin_user.id)]


def test_users_list_filters_by_role(login, make_user):
    admin, _ = login(UserRole.ADMIN)
    make_user(UserRole.CLIENT)
    make_user(UserRole.CLIENT)
    make_user(UserRole.JUDGE)
    clients = admin.get("/api/admin/users?role=CLIENT").json()
    assert len(clients) == 2 and {r["role"] for r in clients} == {"CLIENT"}
    assert [r["role"] for r in admin.get("/api/admin/users?role=JUDGE").json()] == ["JUDGE"]
    assert len(admin.get("/api/admin/users?role=ADMIN").json()) == 1
    assert admin.get("/api/admin/users?role=LAWYER").json() == []
    assert len(admin.get("/api/admin/users").json()) == 4
    assert admin.get("/api/admin/users?role=OWNER").status_code == 422
    assert len(admin.get("/api/admin/users?role=CLIENT&limit=1&offset=1").json()) == 1
