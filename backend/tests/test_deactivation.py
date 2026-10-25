import uuid

from sqlalchemy import select

from app.models import AuditEvent, User, UserRole
from tests.conftest import PASSWORD


def test_deactivate_blocks_login_and_kills_sessions(login, client_factory):
    admin, _ = login(UserRole.ADMIN)
    judge_client, judge = login(UserRole.JUDGE)
    assert admin.post(f"/api/admin/users/{judge.id}/deactivate").status_code == 204
    assert judge_client.get("/api/auth/me").status_code == 401
    fresh = client_factory()
    res = fresh.post("/api/auth/login", json={"email": judge.email, "password": PASSWORD})
    assert res.status_code == 401 and res.json()["detail"] == "E-mail ou senha inválidos."


def test_inactive_and_wrong_password_look_identical(login, client_factory):
    admin, _ = login(UserRole.ADMIN)
    _, judge = login(UserRole.JUDGE)
    admin.post(f"/api/admin/users/{judge.id}/deactivate")
    a = client_factory().post("/api/auth/login", json={"email": judge.email, "password": PASSWORD})
    b = client_factory().post(
        "/api/auth/login", json={"email": judge.email, "password": "outra-senha-qualquer-1"}
    )
    assert (a.status_code, a.json()) == (b.status_code, b.json())


def test_reactivate_restores_login(login, client_factory):
    admin, _ = login(UserRole.ADMIN)
    judge_client, judge = login(UserRole.JUDGE)
    admin.post(f"/api/admin/users/{judge.id}/deactivate")
    assert admin.post(f"/api/admin/users/{judge.id}/reactivate").status_code == 204
    assert judge_client.get("/api/auth/me").status_code == 401  # old sessions stay dead
    res = client_factory().post("/api/auth/login", json={"email": judge.email, "password": PASSWORD})
    assert res.status_code == 200


def test_inactive_user_token_is_dead_even_if_version_matches(login, session):
    client, user = login(UserRole.JUDGE)
    session.execute(User.__table__.update().where(User.id == user.id).values(is_active=False))
    session.commit()
    session.expire_all()
    assert client.get("/api/auth/me").status_code == 401


def test_cannot_deactivate_self(login):
    admin, me = login(UserRole.ADMIN)
    res = admin.post(f"/api/admin/users/{me.id}/deactivate")
    assert res.status_code == 409 and res.json()["detail"] == "Você não pode desativar a própria conta."
    assert admin.get("/api/auth/me").status_code == 200


def test_another_admin_can_be_deactivated_and_caller_stays_active(login, make_user):
    admin, _ = login(UserRole.ADMIN)
    other = make_user(UserRole.ADMIN)
    res = admin.post(
        f"/api/admin/users/{other.id}/deactivate", json={"admin_password": PASSWORD}
    )
    assert res.status_code == 204
    assert admin.get("/api/auth/me").status_code == 200


def test_audit_rows_and_listing(login, session):
    admin, _ = login(UserRole.ADMIN)
    _, judge = login(UserRole.JUDGE)
    admin.post(f"/api/admin/users/{judge.id}/deactivate")
    admin.post(f"/api/admin/users/{judge.id}/reactivate")
    actions = [r.action for r in session.scalars(select(AuditEvent))]
    assert sorted(actions) == ["user.deactivate", "user.reactivate"]  # multiset: timestamps may tie
    users = {u["id"]: u for u in admin.get("/api/admin/users").json()}
    assert users[str(judge.id)]["is_active"] is True and "password" not in str(users)


def test_repeat_calls_are_idempotent_without_extra_audit(login, session):
    admin, _ = login(UserRole.ADMIN)
    _, judge = login(UserRole.JUDGE)
    assert admin.post(f"/api/admin/users/{judge.id}/reactivate").status_code == 204  # already active
    assert admin.post(f"/api/admin/users/{judge.id}/deactivate").status_code == 204
    version = session.scalar(select(User.token_version).where(User.id == judge.id))
    assert admin.post(f"/api/admin/users/{judge.id}/deactivate").status_code == 204
    session.expire_all()
    assert session.scalar(select(User.token_version).where(User.id == judge.id)) == version
    assert admin.post(f"/api/admin/users/{judge.id}/reactivate").status_code == 204
    assert admin.post(f"/api/admin/users/{judge.id}/reactivate").status_code == 204
    actions = [r.action for r in session.scalars(select(AuditEvent))]
    assert sorted(actions) == ["user.deactivate", "user.reactivate"]  # multiset: timestamps may tie


def test_only_admins_and_unknown_ids(login):
    client, _ = login(UserRole.LAWYER)
    assert client.post("/api/admin/users/00000000-0000-0000-0000-000000000000/deactivate").status_code == 403
    admin, _ = login(UserRole.ADMIN)
    assert admin.post("/api/admin/users/00000000-0000-0000-0000-000000000000/deactivate").status_code == 404
    assert admin.post("/api/admin/users/00000000-0000-0000-0000-000000000000/reactivate").status_code == 404


def test_deactivating_a_lawyer_returns_mediations_to_the_board(login, evaluated_case, session):
    from app.models import Case, CaseStatus

    case_id = evaluated_case()
    lawyer_client, lawyer = login(UserRole.LAWYER)
    assert lawyer_client.post(f"/api/cases/{case_id}/match").status_code == 200
    admin, _ = login(UserRole.ADMIN)
    assert admin.post(f"/api/admin/users/{lawyer.id}/deactivate").status_code == 204
    session.expire_all()
    case = session.get(Case, uuid.UUID(case_id))
    assert case.status is CaseStatus.EVALUATED and case.lawyer_id is None
    other_client, _ = login(UserRole.LAWYER)
    assert case_id in [c["id"] for c in other_client.get("/api/lawyer/board").json()]


def test_deactivating_a_client_hides_their_opportunities(login, evaluated_case, session):
    from app.models import Case

    case_id = evaluated_case()
    lawyer_client, _ = login(UserRole.LAWYER)
    assert case_id in [c["id"] for c in lawyer_client.get("/api/lawyer/board").json()]
    admin, _ = login(UserRole.ADMIN)
    owner_id = session.get(Case, uuid.UUID(case_id)).client_id
    assert admin.post(f"/api/admin/users/{owner_id}/deactivate").status_code == 204
    assert case_id not in [c["id"] for c in lawyer_client.get("/api/lawyer/board").json()]
    assert admin.post(f"/api/admin/users/{owner_id}/reactivate").status_code == 204
    assert case_id in [c["id"] for c in lawyer_client.get("/api/lawyer/board").json()]


def test_failed_stepup_is_audited(login, make_user, session):
    admin, me = login(UserRole.ADMIN)
    other = make_user(UserRole.ADMIN)
    res = admin.post(f"/api/admin/users/{other.id}/deactivate", json={"admin_password": "errada-errada-123"})
    assert res.status_code == 400
    rows = session.scalars(select(AuditEvent).where(AuditEvent.action == "admin.stepup_failed")).all()
    assert [(r.actor_id, r.target_id) for r in rows] == [(me.id, None)]
