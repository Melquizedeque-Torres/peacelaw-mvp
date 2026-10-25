import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import sessionmaker

from app.models import Case, CaseStatus, User, UserRole
from scripts import seed_evaluator_accounts as seed


@pytest.fixture
def run(monkeypatch, engine):
    monkeypatch.setattr(seed, "_session_factory", lambda: sessionmaker(bind=engine))
    return seed.main


def test_refuses_without_the_public_demo_flag(run, session, capsys):
    assert run([]) == 2
    assert session.scalar(select(func.count()).select_from(User)) == 0
    assert "--public-demo" in capsys.readouterr().err


def test_refuses_a_database_that_has_real_accounts(run, session, make_user):
    make_user(UserRole.CLIENT, email="pessoa.real@exemplo.com")
    assert run(["--public-demo"]) == 1
    assert session.scalar(select(func.count()).select_from(User)) == 1  # nothing was created


def test_seeds_four_accounts_that_can_log_in_and_sample_cases(run, session, client_factory):
    assert run(["--public-demo"]) == 0
    for email, role, password in seed.ACCOUNTS:
        res = client_factory().post("/api/auth/login", json={"email": email, "password": password})
        assert res.status_code == 200 and res.json()["role"] == role.value
    statuses = sorted(s.value for s in session.scalars(select(Case.status)))
    assert statuses == sorted([CaseStatus.READY_FOR_JUDGE.value, CaseStatus.EVALUATED.value, CaseStatus.EVALUATED.value])
    judge = client_factory()
    judge.post("/api/auth/login", json={"email": seed.ACCOUNTS[1][0], "password": seed.ACCOUNTS[1][2]})
    queue = judge.get("/api/judge/queue").json()
    assert len(queue) == 1 and "Carlos Menezes" not in queue[0]["anonymized_text"]
    lawyer = client_factory()
    lawyer.post("/api/auth/login", json={"email": seed.ACCOUNTS[2][0], "password": seed.ACCOUNTS[2][2]})
    assert len(lawyer.get("/api/lawyer/board").json()) == 2


def test_is_idempotent_and_resets_changed_passwords(run, session, client_factory):
    assert run(["--public-demo"]) == 0
    assert run(["--public-demo"]) == 0
    assert session.scalar(select(func.count()).select_from(User)) == 4
    assert session.scalar(select(func.count()).select_from(Case)) == 3
    email, _, password = seed.ACCOUNTS[0]
    assert client_factory().post("/api/auth/login", json={"email": email, "password": password}).status_code == 200
