from datetime import datetime, timedelta, timezone

from app.models import Case, CaseArea, CaseStatus, UserRole


def _case(session, owner_id, status, score, *, lawyer_id=None, area=CaseArea.CIVIL, minute=0):
    case = Case(
        client_id=owner_id,
        lawyer_id=lawyer_id,
        title="Caso",
        raw_text="texto",
        anonymized_text="texto anonimizado",
        status=status,
        ai_probability_score=score,
        area=area,
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc) + timedelta(minutes=minute),
        updated_at=datetime(2026, 1, 1, tzinfo=timezone.utc) + timedelta(minutes=minute),
    )
    session.add(case)
    session.flush()
    return str(case.id)


def test_offset_pages_return_only_opportunities(login, make_user, session):
    lawyer, me = login(UserRole.LAWYER)
    owner = make_user(UserRole.CLIENT)
    opps = [
        _case(session, owner.id, CaseStatus.EVALUATED, score, minute=i)
        for i, score in enumerate((10.0, 50.0, 30.0))
    ]
    mediation = _case(session, owner.id, CaseStatus.IN_MEDIATION, 5.0, lawyer_id=me.id)
    resolved = _case(session, owner.id, CaseStatus.RESOLVED, 5.0, lawyer_id=me.id)
    session.commit()

    page1 = lawyer.get("/api/lawyer/board?limit=2&offset=0").json()
    assert [c["id"] for c in page1] == [mediation, opps[1], opps[2], resolved]
    page2 = lawyer.get("/api/lawyer/board?limit=2&offset=2").json()
    assert [c["id"] for c in page2] == [opps[0]]
    assert {"evidence_count", "suggested"} <= set(page2[0])
    assert lawyer.get("/api/lawyer/board?limit=2&offset=4").json() == []


def test_paging_has_no_duplicates_or_gaps_and_keeps_suggested_first(login, make_user, session):
    lawyer, _ = login(UserRole.LAWYER)
    assert lawyer.put("/api/lawyer/areas", json={"areas": ["FAMILIA"]}).status_code == 200
    owner = make_user(UserRole.CLIENT)
    expected = [
        _case(session, owner.id, CaseStatus.EVALUATED, 20.0, area=CaseArea.FAMILIA, minute=1),
        _case(session, owner.id, CaseStatus.EVALUATED, 10.0, area=CaseArea.FAMILIA, minute=2),
        _case(session, owner.id, CaseStatus.EVALUATED, 90.0, area=CaseArea.CIVIL, minute=3),
        _case(session, owner.id, CaseStatus.EVALUATED, 60.0, area=CaseArea.CIVIL, minute=4),
        _case(session, owner.id, CaseStatus.EVALUATED, None, area=CaseArea.CIVIL, minute=5),
    ]
    session.commit()

    seen: list[dict] = []
    for offset in range(0, 5, 2):
        seen += lawyer.get(f"/api/lawyer/board?limit=2&offset={offset}").json()
    assert [c["id"] for c in seen] == expected
    assert [c["suggested"] for c in seen] == [True, True, False, False, False]
    assert len({c["id"] for c in seen}) == 5
