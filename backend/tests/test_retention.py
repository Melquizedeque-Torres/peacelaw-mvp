from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text, update

from app.models import Case, CaseStatus, UserRole
from app.retention import DEFAULT_RETENTION_DAYS, purge_raw_text, purge_raw_text_ids, retention_days
from scripts import purge_raw_text as cli


def _case(session, owner, status, age_days, erased=False):
    case = Case(
        client_id=owner.id,
        title="t",
        raw_text="relato original",
        anonymized_text="relato [NOME]",
        status=status,
        raw_text_erased_at=datetime.now(timezone.utc) if erased else None,
    )
    session.add(case)
    session.commit()
    when = datetime.now(timezone.utc) - timedelta(days=age_days)
    session.execute(update(Case).where(Case.id == case.id).values(updated_at=when))
    session.commit()
    session.expire_all()
    return case.id


def _raw(session, case_id):
    return session.get(Case, case_id).raw_text


@pytest.fixture
def owner(make_user):
    return make_user(UserRole.CLIENT)


def test_default_days(monkeypatch):
    monkeypatch.delenv("RAW_TEXT_RETENTION_DAYS", raising=False)
    assert retention_days() == DEFAULT_RETENTION_DAYS == 180
    monkeypatch.setenv("RAW_TEXT_RETENTION_DAYS", "30")
    assert retention_days() == 30
    monkeypatch.setenv("RAW_TEXT_RETENTION_DAYS", "abc")
    with pytest.raises(ValueError):
        retention_days()


def test_old_resolved_is_erased_others_are_kept(session, owner):
    old = _case(session, owner, CaseStatus.RESOLVED, 200)
    recent = _case(session, owner, CaseStatus.RESOLVED, 10)
    open_old = _case(session, owner, CaseStatus.IN_MEDIATION, 400)
    done = _case(session, owner, CaseStatus.RESOLVED, 500, erased=True)
    before = session.get(Case, done).raw_text_erased_at

    assert purge_raw_text(session, days=180) == 2 - 1  # only `old` (done is already erased)
    session.expire_all()
    assert _raw(session, old) == ""
    erased = session.get(Case, old)
    assert erased.raw_text_erased_at is not None
    assert erased.anonymized_text == "relato [NOME]"
    assert erased.status == CaseStatus.RESOLVED
    assert _raw(session, recent) == "relato original"
    assert _raw(session, open_old) == "relato original"
    assert session.get(Case, done).raw_text_erased_at == before


def test_dry_run_changes_nothing_and_run_is_idempotent(session, owner):
    old = _case(session, owner, CaseStatus.RESOLVED, 200)
    assert purge_raw_text(session, days=180, dry_run=True) == 1
    session.expire_all()
    assert _raw(session, old) == "relato original"
    assert session.get(Case, old).raw_text_erased_at is None

    assert purge_raw_text(session, days=180) == 1
    assert purge_raw_text(session, days=180) == 0
    assert purge_raw_text(session, days=180, dry_run=True) == 0


def test_erased_value_is_ciphertext_of_empty_string(session, owner):
    old = _case(session, owner, CaseStatus.RESOLVED, 200)
    purge_raw_text(session, days=180)
    stored = session.execute(text("select raw_text from cases")).scalar_one()
    assert stored and "relato" not in stored
    assert _raw(session, old) == ""


def test_cli_dry_run_prints_only_a_count(monkeypatch, capsys, engine, session, owner):
    _case(session, owner, CaseStatus.RESOLVED, 200)
    from sqlalchemy.orm import sessionmaker

    monkeypatch.setattr(cli, "_session_factory", lambda: sessionmaker(bind=engine))
    monkeypatch.delenv("RAW_TEXT_RETENTION_DAYS", raising=False)
    cli.main(["--dry-run"])
    out = capsys.readouterr().out
    assert out.startswith("1 relato") and "relato original" not in out
    session.expire_all()
    assert session.execute(text("select count(*) from cases where raw_text_erased_at is not null")).scalar() == 0


def test_erased_ids_are_logged_without_any_text(session, owner, caplog):
    import logging

    old = _case(session, owner, CaseStatus.RESOLVED, 200)
    _case(session, owner, CaseStatus.RESOLVED, 10)
    with caplog.at_level(logging.INFO, logger="app.retention"):
        assert purge_raw_text_ids(session, days=180) == [old]
    assert [r.getMessage() for r in caplog.records] == [
        f"retention: raw_text erased for case {old}"
    ]
    assert "relato" not in caplog.text


def test_dry_run_logs_nothing(session, owner, caplog):
    import logging

    _case(session, owner, CaseStatus.RESOLVED, 200)
    with caplog.at_level(logging.INFO, logger="app.retention"):
        purge_raw_text_ids(session, days=180, dry_run=True)
    assert caplog.records == []


def test_cli_prints_erased_ids_only(monkeypatch, capsys, engine, session, owner):
    from sqlalchemy.orm import sessionmaker

    old = _case(session, owner, CaseStatus.RESOLVED, 200)
    monkeypatch.setattr(cli, "_session_factory", lambda: sessionmaker(bind=engine))
    monkeypatch.delenv("RAW_TEXT_RETENTION_DAYS", raising=False)
    cli.main([])
    out = capsys.readouterr().out
    assert out.startswith("1 relato") and f"caso {old}" in out and "relato original" not in out
