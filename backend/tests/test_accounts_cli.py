import io

import pytest
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from app.models import User, UserRole
from app.security.passwords import verify_password
from scripts import create_user as cli
from scripts import seed_demo_users

STRONG = "senha-forte-do-juiz-123"


@pytest.fixture
def run(monkeypatch, engine):
    monkeypatch.setattr(cli, "_session_factory", lambda: sessionmaker(bind=engine))

    def _run(argv, stdin=STRONG + "\n"):
        monkeypatch.setattr("sys.stdin", io.StringIO(stdin))
        return cli.main(argv)

    return _run


def _user(session, email):
    session.expire_all()
    return session.scalar(select(User).where(User.email == email))


def test_creates_judge_with_password_from_stdin(run, session, capsys):
    assert run(["--email", "Juiza@Tribunal.jus.br", "--role", "JUDGE", "--password-stdin"]) == 0
    user = _user(session, "juiza@tribunal.jus.br")
    assert user.role is UserRole.JUDGE
    assert verify_password(STRONG, user.password_hash)
    out = capsys.readouterr().out
    assert "JUDGE" in out and str(user.id) in out and STRONG not in out


@pytest.mark.parametrize("role", ["LAWYER", "ADMIN"])
def test_creates_other_server_side_roles(run, session, role):
    assert run(["--email", f"{role.lower()}@exemplo.com", "--role", role, "--password-stdin"]) == 0
    assert _user(session, f"{role.lower()}@exemplo.com").role is UserRole(role)


def test_client_role_is_refused(run):
    with pytest.raises(SystemExit) as exc:
        run(["--email", "c@exemplo.com", "--role", "CLIENT", "--password-stdin"])
    assert exc.value.code == 2


def test_existing_email_is_never_overwritten(run, session, make_user, capsys):
    existing = make_user(UserRole.CLIENT, email="dup@exemplo.com")
    old_hash = existing.password_hash
    assert run(["--email", "dup@exemplo.com", "--role", "JUDGE", "--password-stdin"]) == 1
    user = _user(session, "dup@exemplo.com")
    assert user.role is UserRole.CLIENT and user.password_hash == old_hash
    assert "já existe" in capsys.readouterr().err


@pytest.mark.parametrize("password", ["curta", "x" * 129])
def test_weak_or_oversized_password_is_refused(run, session, password, capsys):
    assert run(["--email", "j@exemplo.com", "--role", "JUDGE", "--password-stdin"], password + "\n") == 1
    assert _user(session, "j@exemplo.com") is None
    assert password not in capsys.readouterr().err


def test_invalid_email_is_refused(run, session):
    assert run(["--email", "sem-arroba", "--role", "JUDGE", "--password-stdin"]) == 1
    assert session.scalar(select(User)) is None


def test_interactive_password_must_be_confirmed(run, session, monkeypatch):
    answers = iter([STRONG, STRONG + "-diferente"])
    monkeypatch.setattr(cli.getpass, "getpass", lambda prompt="": next(answers))
    assert run(["--email", "j@exemplo.com", "--role", "LAWYER"]) == 1
    assert _user(session, "j@exemplo.com") is None


def test_interactive_password_creates_account(run, session, monkeypatch):
    answers = iter([STRONG, STRONG])
    monkeypatch.setattr(cli.getpass, "getpass", lambda prompt="": next(answers))
    assert run(["--email", "j@exemplo.com", "--role", "LAWYER"]) == 0
    assert verify_password(STRONG, _user(session, "j@exemplo.com").password_hash)


def test_creation_is_logged_without_secrets(run, caplog):
    import logging

    with caplog.at_level(logging.INFO, logger="app.accounts"):
        run(["--email", "j@exemplo.com", "--role", "JUDGE", "--password-stdin"])
    messages = [r.getMessage() for r in caplog.records]
    assert len(messages) == 1 and messages[0].startswith("account created: role=JUDGE id=")
    assert STRONG not in caplog.text and "j@exemplo.com" not in caplog.text


def test_seed_demo_users_refuses_production(monkeypatch, engine, session):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setattr(seed_demo_users, "_session_factory", lambda: sessionmaker(bind=engine))
    with pytest.raises(SystemExit) as exc:
        seed_demo_users.main()
    assert exc.value.code != 0
    assert session.scalar(select(User)) is None
