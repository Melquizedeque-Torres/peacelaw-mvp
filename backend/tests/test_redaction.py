import time

import pytest

from app.privacy.redaction import redact_pii

EXAMPLE = (
    "Contratei a Reforma Fácil Ltda para reformar meu apartamento na Rua das Acácias, 142, "
    "em março de 2026. Paguei R$ 18.400 em duas parcelas. O responsável, Carlos Menezes, "
    "abandonou a obra na metade e não responde mais às mensagens. Meu CPF é 123.456.789-00 "
    "e meu telefone é (11) 98765-4321."
)


def test_redacts_all_pii_in_design_system_example():
    result = redact_pii(EXAMPLE)
    for secret in ["Reforma Fácil Ltda", "Rua das Acácias, 142", "Carlos Menezes",
                   "123.456.789-00", "98765-4321", "18.400"]:
        assert secret not in result.text
    assert result.text == (
        "Contratei a [EMPRESA] para reformar meu apartamento na [ENDERECO], "
        "em março de 2026. Paguei [VALOR] em duas parcelas. O responsável, [NOME], "
        "abandonou a obra na metade e não responde mais às mensagens. Meu CPF é [CPF] "
        "e meu telefone é [TELEFONE]."
    )


def test_counts_follow_order_of_appearance():
    result = redact_pii(EXAMPLE)
    assert list(result.counts) == ["EMPRESA", "ENDERECO", "VALOR", "NOME", "CPF", "TELEFONE"]
    assert result.counts == {
        "EMPRESA": 1, "ENDERECO": 1, "VALOR": 1, "NOME": 1, "CPF": 1, "TELEFONE": 1,
    }


def test_redacts_email_cnpj_and_cep():
    text = "CNPJ 12.345.678/0001-90, CEP 01310-100, e-mail joao.silva@exemplo.com.br"
    assert redact_pii(text).text == "CNPJ [CNPJ], CEP [CEP], e-mail [EMAIL]"


def test_text_without_pii_is_unchanged():
    text = "paguei a primeira parcela e a obra parou na metade."
    result = redact_pii(text)
    assert result.text == text
    assert result.hits == ()


def test_hits_point_at_original_spans():
    text = "Meu CPF é 123.456.789-00."
    (hit,) = redact_pii(text).hits
    assert hit.label == "CPF"
    assert text[hit.start:hit.end] == "123.456.789-00"


def test_lower_priority_match_keeps_uncovered_fragments():
    # The street match overlaps the CEP hit; house number and street name must still go.
    result = redact_pii("Moro na Rua das Flores 12 CEP 01310-100 em SP")
    assert result.text == "Moro na [ENDERECO] [CEP] [ENDERECO]"
    assert "Flores" not in result.text
    assert "12" not in result.text


def test_phone_with_country_code_is_fully_redacted():
    assert redact_pii("+55 11 98765-4321").text == "[TELEFONE]"


def test_phone_without_ddd_requires_hyphen_form():
    assert redact_pii("Ligue 3456-7890 ou 98765-4321.").text == "Ligue [TELEFONE] ou [TELEFONE]."


def test_street_keyword_is_case_insensitive():
    assert redact_pii("moro na rua das flores, 12 em sp").text == "moro na [ENDERECO] em sp"


def test_email_excludes_sentence_final_period():
    assert redact_pii("Escreva para joao@x.com.").text == "Escreva para [EMAIL]."


def test_repeated_label_is_counted_per_occurrence():
    result = redact_pii("CEP 01310-100 e CEP 04538-133")
    assert result.text == "CEP [CEP] e CEP [CEP]"
    assert result.counts == {"CEP": 2}


def test_street_name_with_digits_is_fully_redacted():
    assert redact_pii("Rua 7 de Setembro, 100").text == "[ENDERECO]"
    assert redact_pii("Rua 15 de Novembro, 200").text == "[ENDERECO]"


def test_lower_priority_span_split_around_higher_priority_hit():
    text = "Moro na Rua das Flores 12 CEP 01310-100 em SP"
    result = redact_pii(text)
    labels = [h.label for h in result.hits]
    assert labels == ["ENDERECO", "CEP", "ENDERECO"]
    for left, right in zip(result.hits, result.hits[1:]):
        assert left.end <= right.start
    assert "Flores" not in result.text
    assert "12" not in result.text
    assert result.text == "Moro na [ENDERECO] [CEP] [ENDERECO]"


@pytest.mark.parametrize(
    "adversarial",
    ids=lambda v: f"{v[:12]!r}-{len(v)}",
    argvalues=["a" * 19_999, "a." * 9_999, "Abc " * 4_999, "A" * 19_999, "1" * 19_999,
     "A " * 9_999, "Rua " + "a" * 19_990,
     "R$ " + "1." * 9_000, "conta " + "1" * 19_990, "RG " + "1" * 19_990,
     "Agência " + "1" * 19_990, "AB" * 9_999,
     "US$ " + "1" * 19_990, "RS " + "1" * 19_990, "R $ " + "1." * 9_000,
     "1" * 19_990 + " reais", "1 mil " * 3_330, "1 " * 9_990, "1" * 19_990 + " mil reais",
     "R$" + " " * 19_990, "1" + " " * 19_990,
     "ag" + " " * 19_990, "cc " + "1" * 19_990, "conta" + " " * 19_990,
     "conta-corrente " + "1" * 19_990, "conta salário " + "1" * 19_990,
     "rg" + " " * 19_990, "RG " + "1" * 19_990, "registro geral " + "1" * 19_990,
     "cnh " + "1" * 19_990, "carteira de habilitação " + "1" * 19_990,
     "passaporte " + "A" * 19_990, "passaporte " + "AB" * 9_990,
     "r$ " + "1." * 9_000, "rs" + " " * 19_990, "us$ " + "1" * 19_990,
     "conta N" + " " * 19_990, "conta Nº" + "1" * 19_990, "cnh " + "1" * 19_990 + "x",
     "cnh No." + " " * 19_990, "4111 " * 3_990, "4-" * 9_990, "1 " * 19_990 + "1",
     "0001234-56.2023.8.26.0100" * 800, "0001234-56." * 1_800, "1" * 7 + "-56." * 4_990,
     "123 " * 4_990, "123  " * 3_990, "Abc" + " " * 19_990, "Abc" + " de" * 6_660,
     "Abc    " * 2_850, "Abc" + " " * 5 + "Abc" + " " * 19_000],
)
def test_adversarial_20k_inputs_redact_in_bounded_time(adversarial):
    start = time.perf_counter()
    redact_pii(adversarial)
    assert time.perf_counter() - start < 0.2, adversarial[:30]


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Paguei R$ 18.400 em duas parcelas.", "Paguei [VALOR] em duas parcelas."),
        ("valor de R$ 1.234,56 e depois R$5.", "valor de [VALOR] e depois [VALOR]."),
        ("Agência 1234-5, conta corrente 98765-4 no banco.", "[BANCO], [BANCO] no banco."),
        ("ag. 0001 c/c 123456-7", "[BANCO] [BANCO]"),
        ("Meu RG 12.345.678-9 e RG nº MG-12.345.678", "Meu [RG] e [RG]"),
        ("RG: 1234567 emitido", "[RG] emitido"),
        ("CNH nº 12345678901 válida", "[CNH] válida"),
        ("passaporte FZ123456 e AB654321", "[PASSAPORTE] e [PASSAPORTE]"),
    ],
)
def test_redacts_financial_and_document_data(text, expected):
    assert redact_pii(text).text == expected


def test_prose_words_are_not_mistaken_for_bank_data():
    text = "a conta de luz chegou e a agência fechou cedo."
    assert redact_pii(text).text == text


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Paguei 18 mil reais.", "Paguei [VALOR]."),
        ("custou 5000 reais", "custou [VALOR]"),
        ("valor 20.000 reais", "valor [VALOR]"),
        ("18.400,00 reais", "[VALOR]"),
        ("1,5 milhão de reais", "[VALOR]"),
        ("US$ 500 e RS 300 e R $ 40", "[VALOR] e [VALOR] e [VALOR]"),
        ("R$ 18,4 mil", "[VALOR]"),
        ("R$ 2 milhões", "[VALOR]"),
        ("Ag 1234 cc 5678", "[BANCO] [BANCO]"),
        ("conta-corrente 12345-6", "[BANCO]"),
        ("conta salário 12345", "[BANCO]"),
        ("conta nº 1234567 ag 123", "[BANCO] [BANCO]"),
        ("rg 12345678", "[RG]"),
        ("Rg: 1234567", "[RG]"),
        ("registro geral 1234567", "[RG]"),
        ("cnh 12345678901", "[CNH]"),
        ("carteira de habilitação 12345678901", "[CNH]"),
        ("passaporte FZ 123456", "[PASSAPORTE]"),
        ("passaporte nº YC1234567", "[PASSAPORTE]"),
    ],
)
def test_redacts_pii_keyword_and_currency_variants(text, expected):
    assert redact_pii(text).text == expected


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("paguei r$ 5.000", "paguei [VALOR]"),
        ("r$1500", "[VALOR]"),
        ("Rs 200", "[VALOR]"),
        ("us$ 500", "[VALOR]"),
        ("conta Nº 1234-5", "[BANCO]"),
        ("Ag. Nº 123", "[BANCO]"),
        ("CNH Nº 123456789", "[CNH]"),
        ("RG Nº 1234567", "[RG]"),
        ("conta No. 1234567", "[BANCO]"),
        ("conta N. 1234567", "[BANCO]"),
        ("CNH 123456789012", "[CNH]"),
        ("cartao 4111111111111111", "cartao [CARTAO]"),
        ("4111 1111 1111 1111", "[CARTAO]"),
        ("4111-1111-1111-1111", "[CARTAO]"),
        ("0001234-56.2023.8.26.0100", "[PROCESSO]"),
        ("processo 0001234-56.2023.8.26.0100 em curso", "processo [PROCESSO] em curso"),
        ("123 456 789 00", "[CPF]"),
        ("Pedro    Alves", "[NOME]"),
        ("Pedro 	 Alves", "[NOME]"),
    ],
)
def test_redacts_second_round_leaks(text, expected):
    assert redact_pii(text).text == expected


def test_adversarial_input_redacts_in_bounded_time():
    import time

    for unit in ("R$1 ", "a@b.co "):
        text = (unit * (20000 // len(unit) + 1))[:20000]
        started = time.perf_counter()
        result = redact_pii(text)
        elapsed = time.perf_counter() - started
        assert len(result.hits) > 1000
        assert elapsed < 0.3, f"{unit!r} took {elapsed:.2f}s"


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Nome SAHDASHUU SADHUASDHU QWUQWUI", "Nome [NOME]"),
        ("CARLOS MENEZES abandonou", "[NOME] abandonou"),
        ("JOSÉ DE SOUSA ligou", "[NOME] ligou"),
        ("ANA MARIA DA SILVA SANTOS PEREIRA", "[NOME]"),
        ("ANA BIA CAIO DUDA ELIAS FABIO GABI HUGO IVAN falou", "[NOME] falou"),
        ("CPF " + " ".join(["ABC"] * 30) + " fim", "CPF [NOME] fim"),
        ("CPF 123.456.789-00 de CARLOS MENEZES", "CPF [CPF] de [NOME]"),
        ("CPF CARLOS MENEZES", "CPF [NOME]"),
        # stoplist words alone or in pairs are not names
        ("CPF e CNPJ", "CPF e CNPJ"),
        ("CPF CNPJ", "CPF CNPJ"),
        ("TJSP STJ", "TJSP STJ"),
        ("INSS PIX LGPD OAB", "INSS PIX LGPD OAB"),
        ("SP RJ MG", "SP RJ MG"),
        ("ACME COMERCIAL LTDA cobrou", "[EMPRESA] cobrou"),
        ("LUZ FORTE S.A. cobrou", "[EMPRESA] cobrou"),
        # cue-based single names
        ("falei com o atendente Paulo", "falei com o atendente [NOME]"),
        ("Sra. Joana ligou", "Sra. [NOME] ligou"),
        ("meu nome é Ana", "meu nome é [NOME]"),
        ("Me chamo Beto.", "Me chamo [NOME]."),
        ("o gerente, Carlos, disse", "o gerente, [NOME], disse"),
        ("Dr. SILVA atendeu", "Dr. [NOME] atendeu"),
        ("Dona Maria Souza veio", "Dona [NOME] veio"),
        ("a vendedora chamada Rita", "a vendedora chamada [NOME]"),
        ("o atendente foi grosseiro", "o atendente foi grosseiro"),
        ("seu cliente pagou", "seu cliente pagou"),
        # S.A. / Ltda companies
        ("A Luz Forte S.A. cobrou", "A [EMPRESA] cobrou"),
        ("A Reforma Fácil Ltda cobrou", "A [EMPRESA] cobrou"),
        ("Contrato com Reforma Fácil Ltda.", "Contrato com [EMPRESA]"),
        ("Banco Alfa S/A atrasou", "[EMPRESA] atrasou"),
    ],
)
def test_redacts_caps_names_cue_names_and_sa_companies(text, expected):
    assert redact_pii(text).text == expected


@pytest.mark.parametrize(
    "adversarial",
    ids=lambda v: f"{v[:12]!r}-{len(v)}",
    argvalues=[
        "AB " * 6_666, "AB  " * 4_999, "AB" + " " * 19_990, "AB" * 9_999,
        "ÁÉ " * 6_666, "CPF " * 4_999, "A" * 40 + " " * 19_950,
        "Sr. " * 4_999, "Sr." + " " * 19_990, "atendente " * 2_222,
        "atendente " + "A" * 19_990, "meu nome é " + " " * 19_980,
        "Dona Ana " * 2_222, "Sr, " * 4_999, "Luz Forte S.A. " * 1_333,
        "Luz " * 4_999 + "S.A.", "LTDA " * 3_999, "Seu Ab " * 2_856,
        "ABC " * 4_999, "ABC  " * 3_999, "ABC " * 4_999 + "x", "ÁÉÍ " * 4_999,
        "NÃO " * 4_999, "NÃO ABC " * 2_499, "DE ABC " * 2_856, "Paulo Disse " * 1_818,
        "atendente Disse " * 1_249,
    ],
)
def test_adversarial_caps_cue_and_company_inputs_are_bounded(adversarial):
    start = time.perf_counter()
    redact_pii(adversarial)
    assert time.perf_counter() - start < 0.3, adversarial[:30]


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        # ordinary caps prose stays readable
        ("NÃO PAGUEI A MULTA", "NÃO PAGUEI A MULTA"),
        ("A EMPRESA NÃO DEVOLVEU O DINHEIRO", "A EMPRESA NÃO DEVOLVEU O DINHEIRO"),
        ("PRODUTO COM DEFEITO", "PRODUTO COM DEFEITO"),
        ("RELATO DOS FATOS", "RELATO DOS FATOS"),
        ("COBRANÇA INDEVIDA URGENTE", "COBRANÇA INDEVIDA URGENTE"),
        ("Cobranca indevida: ATENCAO", "Cobranca indevida: ATENCAO"),
        # cue false positives
        ("o atendente Disse que", "o atendente Disse que"),
        ("a responsável Pela obra", "a responsável Pela obra"),
        # real names still redacted, also next to common words
        ("o atendente Paulo Disse que", "o atendente [NOME] Disse que"),
        ("MEU NOME É CARLOS MENEZES", "MEU NOME É [NOME]"),
        ("O CARLOS MENEZES NÃO VEIO", "O [NOME]"),
        ("RELATO DE JOÃO DA SILVA", "[NOME]"),
        ("NÃO PAGUEI A MULTA DE JOÃO DA SILVA", "NÃO PAGUEI A [NOME]"),
        ("BANCO ALFA S.A. COBROU", "[EMPRESA] COBROU"),
        ("JOÃO DA SILVA", "[NOME]"),
        ("Sr. Paulo ligou", "Sr. [NOME] ligou"),
    ],
)
def test_caps_prose_stays_readable_while_names_are_redacted(text, expected):
    assert redact_pii(text).text == expected


_FIRST = ["Maria", "José", "Ana", "João", "Antônio", "Francisco", "Carlos", "Paulo", "Pedro",
          "Lucas", "Luiz", "Marcos", "Luís", "Gabriel", "Rafael", "Daniel", "Marcelo", "Bruno",
          "Eduardo", "Felipe", "Rosa", "Graça", "Luz", "Glória", "Dores", "Vitória", "Clara",
          "Pérola", "Branca"]
_LAST = ["Silva", "Santos", "Oliveira", "Souza", "Rodrigues", "Ferreira", "Alves", "Pereira",
         "Lima", "Gomes", "Costa", "Ribeiro", "Martins", "Carvalho", "Almeida", "Lopes",
         "Soares", "Fernandes", "Vieira", "Barbosa", "Rocha", "Dias", "Nascimento", "Andrade",
         "Moreira", "Nunes", "Marques", "Machado", "Mendes", "Freitas", "Cardoso", "Ramos",
         "Gonçalves", "Santana", "Teixeira", "Campos", "Cruz", "Leite", "Pinto", "Monteiro",
         "Prado", "Fonseca", "Medeiros", "Bezerra", "Leal", "Brito", "Banco", "Bastos",
         "Nogueira", "Porto", "Neves", "Pacheco", "Paiva", "Sales", "Bueno", "Castro",
         "Ventura", "Matos", "Torres", "Fontes"]


def test_no_name_leaks_for_first_name_surname_matrix():
    leaks = []
    for first in _FIRST:
        for last in _LAST:
            for template, f, l in (
                ("O cliente {} {} reclamou.", first, last),
                ("O CLIENTE {} {} RECLAMOU.", first.upper(), last.upper()),
            ):
                out = redact_pii(template.format(f, l)).text
                if f in out or l in out:
                    leaks.append(out)
    assert not leaks, (len(leaks), leaks[:5])


def test_seu_and_cue_stop_words_behaviour():
    assert redact_pii("Seu João Silva ligou").text == "[NOME] ligou"
    assert redact_pii("o atendente Paulo Disse que").text == "o atendente [NOME] Disse que"
