from app.privacy.redaction import redact_pii


def test_ip_addresses_are_redacted():
    out = redact_pii("O acesso veio do IP 192.168.0.10 e de 200.201.202.203.")
    assert "192.168.0.10" not in out.text and "200.201.202.203" not in out.text
    assert out.counts["IP"] == 2


def test_birth_dates_are_redacted_but_ordinary_dates_stay():
    out = redact_pii("Nascido em 03/04/1985, assinei o contrato em 12/05/2024.")
    assert "03/04/1985" not in out.text
    assert "12/05/2024" in out.text
    out = redact_pii("Data de nascimento: 3 de abril de 1985.")
    assert "1985" not in out.text


def test_lowercase_names_after_a_self_introduction_cue_are_redacted():
    for text, leaked in [
        ("Meu nome é joão da silva e moro longe.", "silva"),
        ("me chamo maria aparecida souza, tenho 40 anos", "souza"),
        ("Nome completo: carlos eduardo pereira", "pereira"),
    ]:
        out = redact_pii(text)
        assert leaked not in out.text.lower(), out.text
        assert out.counts.get("NOME", 0) >= 1


def test_cue_name_stops_at_ordinary_words():
    out = redact_pii("meu nome é joão e moro em casa alugada")
    assert "joão" not in out.text and "casa alugada" in out.text


def test_places_after_residence_cues_are_redacted():
    for text, leaked in [
        ("Eu moro em Curitiba desde 2015.", "Curitiba"),
        ("Moramos em São José dos Pinhais.", "Pinhais"),
        ("sou residente em Belo Horizonte", "Horizonte"),
        ("natural de Porto Alegre", "Alegre"),
        ("moro em curitiba", "curitiba"),
    ]:
        out = redact_pii(text)
        assert leaked not in out.text, out.text
        assert out.counts.get("LUGAR") == 1


def test_residence_cue_without_a_place_changes_nothing():
    assert redact_pii("Moro em casa alugada").text == "Moro em casa alugada"
    assert redact_pii("A empresa mora em um contrato antigo").counts.get("LUGAR") is None
