"""Rule-based PII redaction (MVP layer of Privacy by Design).

Ported from the design system's client-side `redact()`; extended with CNPJ, CEP,
financial amounts (R$, US$, RS, "mil"/"milhão"/"reais" forms), bank data (agência, conta
with corrente/poupança/salário/pagamento, c/c, cc), RG (incl. "registro geral"), CNH (incl.
"carteira de habilitação), passport, card numbers (CARTAO, 13-19 digits with optional space/hyphen separators), CNJ
court case numbers (PROCESSO) and space-separated CPFs (Segurança/LGPD source). Currency
prefixes and the "Nº" separator are case-insensitive; names tolerate up to 5 spaces
between words. All quantifiers are bounded (see the 20k adversarial timing test). Over-redaction is accepted;
leaks are not.
Patterns run in priority order. A lower-priority match never erases a higher-priority
hit: it only contributes the fragments of its span that are still uncovered.

All-caps names (runs of any length, minus a stoplist of legal acronyms), single names after cues
("Sr.", "atendente", "meu nome é"...) and "S.A."/"S/A"/"LTDA" companies are covered.
Ordinary caps prose ("NÃO PAGUEI A MULTA") stays readable: in an all-caps run, common
Portuguese words (`_COMMON_WORDS`, accent-insensitive) break it, and only sub-runs of two or
more non-common words are names (DA/DE/DO/DAS/DOS bridge two such words). A run containing a
known first name (`_FIRST_NAMES`) is redacted whole, common words included ("JOÃO DIAS",
"LUZ BANCO"), so common-word surnames do not leak. Mixed-case runs of two or more Capitalised
words are always names ("Seu Banco" is over-redacted on purpose). A cue name stops at the first
common word ("o atendente Paulo Disse que" keeps "Disse").

Known limits (to be covered by an NER layer): single-word names without a cue, nicknames,
lowercase names and a lone all-caps name without a cue are not detected; an all-caps name
of common words only and without a listed first name, or split by a common word ("CARLOS NÃO
VEIO" leaves a lone CARLOS if CARLOS were unlisted), escapes; a run with a first name also
loses its neighbouring common words (over-redaction); abbreviated street titles ("Rua Cel. Fulano") stop at the period; address
tails after the house number ("apto 5", "número 12") are not redacted.
"""

import re
import unicodedata
from bisect import bisect_right
from collections.abc import Iterator
from dataclasses import dataclass

_UPPER = "A-ZÀ-ÖØ-Ý"
_LOWER = "a-zß-öø-ÿ"
# Between a keyword and its number: spaces, colons, and an optional "nº"/"n.".
# Written as one character class plus one optional group so backtracking stays linear.
_SEP = r"[\s:]*(?:[nN](?:[º°oO]\.?|\.)?[\s:]*)?"
_STOPLIST = (
    "CPF|CNPJ|RG|CNH|CEP|LGPD|OAB|STF|STJ|TJ|TJSP|INSS|PIX|SA|LTDA|ME|EIRELI|BR|SP|RJ|MG|UF"
    "|CLT|CDC|PROCON"
)
# One all-caps word (>= 2 letters); stoplist acronyms never count, so they also end a run.
_CAPS_WORD = rf"(?!(?:{_STOPLIST})(?!\w))[{_UPPER}]{{2,40}}(?!\w)"
# Capitalised ("Paulo") or all-caps ("PAULO") word, for names introduced by a cue.
_CUE_WORD = rf"(?:[{_UPPER}][{_LOWER}]{{1,40}}|{_CAPS_WORD})(?!\w)"
_CUES = (
    r"sr|sra|srta|dr|dra|dona|atendente|funcionári[oa]|gerente|responsável"
    r"|vendedor|vendedora|chamad[oa]|meu\s{1,5}nome\s{1,5}é|me\s{1,5}chamo"
)
# Common Portuguese words (accent-stripped, upper-case) that are never part of a name
# candidate: articles, prepositions, pronouns and frequent complaint vocabulary.
_COMMON_WORDS = frozenset({
    "A", "ABUSIVA", "ABUSIVO", "ACORDO", "AINDA", "ALERTA", "ALUGUEIS", "ALUGUEL",
    "ANO", "ANOS", "ANTES", "AO", "AOS", "APARTAMENTO", "APOS", "AQUELA",
    "AQUELE", "AS", "ASSUNTO", "ATE", "ATENCAO", "ATENDENTE", "ATENDEU", "ATENDEUME",
    "ATENDIMENTO", "ATRASO", "ATRASOS", "ATRASOU", "AUDIENCIA", "AUTOR", "AUTORA", "AVISO",
    "BANCO", "BANCOS", "BOA", "BOM", "CANCELAMENTO", "CANCELEI", "CANCELOU", "CARTAO",
    "CASA", "CASO", "CLIENTE", "CLIENTES", "COBRANCA", "COBRANCAS", "COBRARAM", "COBROU",
    "COM", "COMO", "COMPRA", "COMPRAS", "COMPREI", "COMPROU", "CONCLUSAO", "CONSUMIDOR",
    "CONTA", "CONTAS", "CONTRA", "CONTRATEI", "CONTRATO", "CONTRATOS", "CONTRATOU", "CREDITO",
    "DA", "DANO", "DANOS", "DAS", "DATA", "DE", "DEBITO", "DEFEITO",
    "DEFEITOS", "DEPOIS", "DESCONTO", "DESCONTOS", "DESCRICAO", "DESDE", "DEVOLUCAO", "DEVOLVER",
    "DEVOLVEU", "DIA", "DIAS", "DINHEIRO", "DIREITO", "DIREITOS", "DISSE", "DISSERAM",
    "DIVIDA", "DIVIDAS", "DO", "DOCUMENTO", "DOCUMENTOS", "DOS", "DOUTOR", "DOUTORA",
    "E", "ELA", "ELAS", "ELE", "ELES", "EM", "EMPRESA", "EMPRESAS",
    "ENTAO", "ENTRE", "ENTREGA", "ENTREGAR", "ENTREGOU", "ERA", "ERRO", "ERROS",
    "ESSA", "ESSE", "ESTA", "ESTAO", "ESTE", "EU", "EXIJO", "FALEI",
    "FALOU", "FALTA", "FATO", "FATOS", "FAVOR", "FAZ", "FEZ", "FINAL",
    "FISCAL", "FIZ", "FOI", "FOMOS", "FORNECEDOR", "FRAUDE", "FUI", "GARANTIA",
    "GERENTE", "GOLPE", "HA", "HAVIA", "HOJE", "IMOVEL", "IMPORTANTE", "INDENIZACAO",
    "INDEVIDA", "INDEVIDO", "INICIAL", "ISSO", "ISTO", "JA", "JUIZ", "JUIZA",
    "JUROS", "JUSTICA", "LHE", "LHES", "LIGOU", "LIGUEI", "LOJA", "LOJAS",
    "MA", "MAIS", "MAS", "MATERIAIS", "MATERIAL", "MAU", "ME", "MENOS",
    "MES", "MESES", "MEU", "MEUS", "MINHA", "MINHAS", "MORAIS", "MORAL",
    "MOTIVO", "MOTIVOS", "MUITA", "MUITO", "MULTA", "MULTAS", "NA", "NADA",
    "NAO", "NAS", "NEGOU", "NO", "NOME", "NOS", "NOSSA", "NOSSO",
    "NOTA", "NOVA", "NOVO", "NUMERO", "NUNCA", "O", "OBRA", "OBRAS",
    "OBRIGADA", "OBRIGADO", "ONDE", "ONTEM", "OS", "OU", "PAGAMENTO", "PAGAMENTOS",
    "PAGAMOS", "PAGAR", "PAGO", "PAGOU", "PAGUEI", "PARA", "PARCELA", "PARCELAS",
    "PARCIAL", "PECO", "PEDIDO", "PEDIDOS", "PELA", "PELAS", "PELO", "PELOS",
    "PESSIMA", "PESSIMO", "PETICAO", "PLANO", "POR", "PORQUE", "POUCO", "PRA",
    "PRAZO", "PRAZOS", "PRECISO", "PREJUIZO", "PREJUIZOS", "PRIMEIRA", "PRIMEIRO", "PROBLEMA",
    "PROBLEMAS", "PROCESSO", "PROCESSOS", "PRODUTO", "PRODUTOS", "PROIBIDO", "PROMETEU", "PROPRIETARIA",
    "PROPRIETARIO", "PROTOCOLO", "PROVA", "PROVAS", "PROVIDENCIA", "PROVIDENCIAS", "QUANDO", "QUE",
    "QUERO", "RE", "RECEBEU", "RECEBI", "RECIBO", "RECLAMACAO", "RECLAMACOES", "RECUSOU",
    "REEMBOLSO", "REFORMA", "RELATO", "REQUEIRO", "REQUERENTE", "REQUERIDA", "REQUERIDO", "RESOLVER",
    "RESOLVEU", "RESPONSAVEL", "RESPOSTA", "RESPOSTAS", "RESSARCIMENTO", "RESUMO", "REU", "SAO",
    "SE", "SEGUNDA", "SEGUNDO", "SEGURO", "SEM", "SEMPRE", "SENHOR", "SENHORA",
    "SENTENCA", "SER", "SERASA", "SERVICO", "SERVICOS", "SEU", "SEUS", "SIM",
    "SOB", "SOBRE", "SOLICITACAO", "SOLICITACOES", "SOLICITEI", "SOLICITO", "SOLUCAO", "SPC",
    "SUA", "SUAS", "TAMBEM", "TAXA", "TAXAS", "TE", "TEM", "TENHO",
    "TINHA", "TITULO", "TODA", "TODAS", "TODO", "TODOS", "TOTAL", "TROCA",
    "TU", "TUDO", "UM", "UMA", "UMAS", "UNICA", "UNICO", "UNS",
    "URGENCIA", "URGENTE", "VALOR", "VALORES", "VENDA", "VENDEDOR", "VENDEDORA", "VOCE",
    "VOCES",
})
# Frequent Brazilian first names (accent-stripped, upper-case). An all-caps run containing
# one is a name as a whole, even when its other words are common ("JOÃO DIAS", "LUZ BANCO").
_FIRST_NAMES = frozenset({
    "ADEMIR", "ADILSON", "ADRIANA", "ADRIANO", "ALAN", "ALBERTO", "ALESSANDRO", "ALEX",
    "ALEXANDRE", "ALICE", "ALICIA", "ALINE", "ALISSON", "AMANDA", "AMELIA", "ANA",
    "ANDERSON", "ANDRE", "ANDREA", "ANDREIA", "ANGELA", "ANGELICA", "ANTONIO", "APARECIDA",
    "BARBARA", "BEATRIZ", "BENEDITO", "BIANCA", "BRANCA", "BRENDA", "BRUNA", "BRUNO",
    "CAMILA", "CAMILLA", "CARLA", "CARLOS", "CAROLINA", "CASSIO", "CECILIA", "CLARA",
    "CLAUDIA", "CLAUDIO", "CLEBER", "CLEITON", "CLOVIS", "CONCEICAO", "CRISTIANE", "CRISTIANO",
    "CRISTINA", "DALILA", "DANIEL", "DANIELA", "DANTE", "DAVI", "DEBORA", "DENISE",
    "DIANA", "DIEGO", "DIRCE", "DORES", "DOUGLAS", "EDGAR", "EDNA", "EDSON",
    "EDUARDO", "ELAINE", "ELIANA", "ELIANE", "ELIAS", "ELISA", "ELISANGELA", "ELISEU",
    "ELIZABETE", "EMANUEL", "EMERSON", "ENZO", "ERICA", "ERICK", "ESTER", "EVANDRO",
    "FABIANA", "FABIANO", "FABIO", "FABRICIO", "FATIMA", "FAUSTO", "FELICIA", "FELIPE",
    "FERNANDO", "FLAVIA", "FLAVIO", "FRANCISCO", "GABRIEL", "GABRIELA", "GAEL", "GERALDO",
    "GERSON", "GILBERTO", "GILMAR", "GILSON", "GIOVANA", "GIOVANNA", "GISELE", "GLAUCIA",
    "GLEICE", "GLORIA", "GRACA", "GUILHERME", "GUSTAVO", "HEITOR", "HELDER", "HELENA",
    "HELIO", "HELOISA", "HENRIQUE", "HUGO", "IARA", "IGOR", "INGRID", "IRENE",
    "ISAAC", "ISABEL", "ISABELA", "ISADORA", "ISMAEL", "IVAN", "IVONE", "JACQUELINE",
    "JAIR", "JANAINA", "JANDIRA", "JAQUELINE", "JEFERSON", "JEFFERSON", "JESSICA", "JOANA",
    "JOAO", "JOAQUIM", "JOEL", "JONAS", "JONATHAN", "JORGE", "JOSE", "JOSEFA",
    "JOSEFINA", "JOSIANE", "JOSUE", "JULIA", "JULIANA", "JULIANO", "JULIO", "KAREN",
    "KARINA", "KATIA", "KELLY", "KLEBER", "LAIS", "LARA", "LARISSA", "LAURA",
    "LAURO", "LAZARO", "LEANDRO", "LEILA", "LEONARDO", "LETICIA", "LIDIA", "LILIANE",
    "LIVIA", "LORENA", "LORENZO", "LOURDES", "LUANA", "LUCAS", "LUCELIA", "LUCIA",
    "LUCIANA", "LUCIANO", "LUCIMAR", "LUIS", "LUISA", "LUIZ", "LUIZA", "LUMA",
    "LUZ", "MADALENA", "MAGDA", "MAIARA", "MANOEL", "MANUEL", "MARCELA", "MARCELO",
    "MARCIA", "MARCIO", "MARCO", "MARCOS", "MARGARIDA", "MARIA", "MARIANA", "MARILIA",
    "MARINA", "MARIO", "MARLENE", "MARLI", "MARTA", "MATEUS", "MATHEUS", "MAURICIO",
    "MAURO", "MAYARA", "MELISSA", "MICHELE", "MIGUEL", "MIRIAN", "MONICA", "MURILO",
    "NAIR", "NATALIA", "NATAN", "NATHALIA", "NEIDE", "NELSON", "NEUSA", "NICOLE",
    "NILTON", "NILZA", "NOEMI", "ODETE", "OFELIA", "OLIVIA", "OSCAR", "OSVALDO",
    "OTAVIO", "PALOMA", "PAMELA", "PATRICIA", "PAULA", "PAULO", "PEDRO", "PEROLA",
    "PIETRO", "PRISCILA", "RAFAEL", "RAFAELA", "RAIMUNDO", "RAQUEL", "REBECA", "REGINA",
    "RENAN", "RENATA", "RENATO", "RICARDO", "RITA", "ROBERTO", "ROBSON", "RODRIGO",
    "ROGERIO", "ROSA", "ROSALIA", "ROSANA", "ROSANGELA", "ROSELI", "ROSIMEIRE", "RUBENS",
    "RUBIA", "RUTE", "SABRINA", "SALETE", "SAMUEL", "SANDRA", "SEBASTIAO", "SELMA",
    "SERGIA", "SERGIO", "SEVERINO", "SILVANA", "SILVIA", "SILVIO", "SIMONE", "SOLANGE",
    "SONIA", "SOPHIA", "STEFANY", "STELLA", "SUELEN", "TAINA", "TANIA", "TATIANA",
    "TATIANE", "TELMA", "TERESA", "TEREZA", "TEREZINHA", "THAIS", "THIAGO", "TIAGO",
    "ULISSES", "VAGNER", "VALDEMAR", "VALDIR", "VALERIA", "VALMIR", "VANESSA", "VERA",
    "VERONICA", "VICENTE", "VICTOR", "VILMA", "VINICIUS", "VITOR", "VITORIA", "VIVIANE",
    "WAGNER", "WALDEMAR", "WALTER", "WANDA", "WANDERLEY", "WASHINGTON", "WELLINGTON", "WESLEY",
    "WILLIAM", "WILSON", "YARA", "YASMIN", "YURI", "ZECA", "ZELIA", "ZILDA",
    "ZULEIDE",
})


_CONNECTORS = frozenset({"DA", "DE", "DO", "DAS", "DOS"})


def _norm(word: str) -> str:
    stripped = unicodedata.normalize("NFD", word)
    return "".join(c for c in stripped if not unicodedata.combining(c)).upper()


def _is_common(word: str) -> bool:
    return _norm(word) in _COMMON_WORDS


_MAGNITUDE = r"(?i:milh(?:ões|ão)|bilh(?:ões|ão)|mil)"

_CAPS_RUN = re.compile(rf"(?<!\w){_CAPS_WORD}(?:\s{{1,5}}{_CAPS_WORD})+")
_WORD = re.compile(rf"[{_UPPER}{_LOWER}]+")
_CUE_NAME = re.compile(
    rf"(?<!\w)(?i:{_CUES})[,:]?\.?[,:]?\s{{1,5}}"
    rf"(?P<name>{_CUE_WORD}(?:\s{{1,5}}(?:d[aeo]s?\s{{1,5}})?{_CUE_WORD}){{0,3}})"
)

_ANY_WORD = rf"[{_UPPER}{_LOWER}]{{2,40}}"
_ANY_NAME = rf"{_ANY_WORD}(?:\s{{1,5}}(?:d[aeo]s?\s{{1,5}})?{_ANY_WORD}){{0,3}}"
# Self-introduction cues accept lowercase names ("meu nome é joão da silva"): the span still
# stops at the first ordinary word, so "meu nome é joão e moro" keeps "e moro".
_SELF_CUE_NAME = re.compile(
    rf"(?<!\w)(?i:meu\s{{1,5}}nome\s{{1,5}}(?:é|e)|me\s{{1,5}}chamo|nome\s{{1,5}}completo)"
    rf"[\s:,]{{1,6}}(?P<name>{_ANY_NAME})"
)
# Residence/origin cues: "moro em Curitiba", "natural de Porto Alegre".
_PLACE_CUE = re.compile(
    rf"(?<!\w)(?i:moro|moramos|mora|morava|moravam|resido|residimos|residente|domiciliad[oa]"
    rf"|natural|cidade)\s{{1,5}}(?i:em|de|do|da|na|no)\s{{1,5}}(?P<name>{_ANY_NAME})"
)

_PLACE_OK = frozenset({"SAO"})

_MIXED_RUN = re.compile(
    rf"(?<!\w)(?!(?i:{_CUES})(?!\w))[{_UPPER}][{_LOWER}]+"
    rf"(?:\s{{1,5}}(?:d[aeo]s?\s{{1,5}})?[{_UPPER}][{_LOWER}]+)+"
)

_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("EMAIL", re.compile(
        r"(?<![\w.+-])[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){1,8}"
    )),
    ("PROCESSO", re.compile(r"\b\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\b")),
    ("VALOR", re.compile(
        r"\b(?i:R\s?\$|RS|US\$)\s*\d(?:[\d.,]{0,20}\d)?(?:\s*" + _MAGNITUDE + r")?"
        r"|\d(?:[\d.,]{0,20}\d)?(?:\s*" + _MAGNITUDE + r")?\s+(?:de\s+)?(?i:reais|real)\b"
    )),
    ("BANCO", re.compile(
        r"\b(?i:ag(?:ência|encia|\.)?)" + _SEP + r"\d{3,5}(?:-[\dXx])?"
        r"|\b(?i:conta(?:[\s-]+(?:corrente|poupança|salário|pagamento))?|c/c|cc)"
        + _SEP + r"\d{3,12}(?:-[\dXx])?"
    )),
    ("RG", re.compile(
        r"\b(?i:rg|r\.g\.|registro\s+geral)" + _SEP
        + r"(?:[A-Z]{2}-?)?[\dXx][\dXx.\-]{4,14}[\dXx]"
        r"|\b\d{1,2}\.\d{3}\.\d{3}-[\dXx]\b"
    )),
    ("CNH", re.compile(
        r"\b(?i:cnh|carteira\s+de\s+habilitação)\b" + _SEP + r"\d{9,12}\b"
    )),
    ("PASSAPORTE", re.compile(
        r"\b(?i:passaporte)" + _SEP + r"[A-Z]{1,2}\s?\d{6,9}"
        r"|\b[A-Z]{2}\d{6}\b"
    )),
    ("CNPJ", re.compile(r"\b\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2}\b")),
    # 13-19 digits, optional single space/hyphen between digits (card numbers).
    ("CARTAO", re.compile(r"(?<!\+)\b\d(?:[ -]?\d){12,18}\b")),
    ("CPF", re.compile(r"\b\d{3}[. ]?\d{3}[. ]?\d{3}[- ]?\d{2}\b")),
    ("TELEFONE", re.compile(
        r"(?:\+55\s?)?(?:\(?\b\d{2}\)?\s?9?\d{4}-?\d{4}\b|\b\d{4,5}-\d{4}\b)"
    )),
    ("IP", re.compile(r"\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b")),
    # Only dates introduced by a birth cue: ordinary contract dates stay readable.
    ("NASCIMENTO", re.compile(
        r"(?i:nascid[oa]\s{1,5}em|data\s{1,5}de\s{1,5}nascimento|nascimento)[\s:]{1,5}"
        r"(?:\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{1,2}\s{1,5}de\s{1,5}[A-Za-zçÇ]{3,9}\s{1,5}de\s{1,5}\d{4})"
    )),
    ("CEP", re.compile(r"\b\d{5}-\d{3}\b")),
    ("ENDERECO", re.compile(
        rf"\b(?i:Rua|Avenida|Av\.|Travessa|Alameda|Praça|Rodovia)\s[^,.\n]+(?:,\s?\d+)?"
    )),
    ("EMPRESA", re.compile(
        rf"(?:[{_UPPER}][{_UPPER}{_LOWER}]{{1,40}}\s){{1,8}}"
        r"(?:(?:Ltda|LTDA|Eireli|EIRELI|ME)(?!\w)\.?|S\.A\.?(?!\w)|S/A(?!\w))"
    )),
    # Single name after a cue ("Sr.", "atendente", "meu nome é"): only the name is redacted.
    ("NOME", _CUE_NAME),
    ("NOME", _SELF_CUE_NAME),
    ("LUGAR", _PLACE_CUE),
    # Two or more all-caps words, any run length (words and separators are disjoint, so
    # the repetition is linear).
    ("NOME", _CAPS_RUN),
    ("NOME", _MIXED_RUN),
)


@dataclass(frozen=True)
class Hit:
    label: str
    start: int
    end: int


@dataclass(frozen=True)
class RedactionResult:
    text: str
    hits: tuple[Hit, ...]

    @property
    def counts(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for hit in self.hits:
            counts[hit.label] = counts.get(hit.label, 0) + 1
        return counts


def _caps_name_spans(match: re.Match[str]) -> Iterator[tuple[int, int]]:
    """A run with a known first name whole, else its sub-runs of >= 2 non-common words (DA/DE/DO/DAS/DOS bridge names)."""
    if any(_norm(w.group()) in _FIRST_NAMES for w in _WORD.finditer(match.group())):
        yield match.span()  # a known first name: the whole run is a name
        return
    run: list[tuple[int, int, bool]] = []  # (start, end, is_name_word)

    def flush() -> Iterator[tuple[int, int]]:
        while run and not run[-1][2]:
            run.pop()
        if sum(1 for *_, is_name in run if is_name) >= 2:
            yield run[0][0], run[-1][1]
        run.clear()

    for word in _WORD.finditer(match.group()):
        norm = _norm(word.group())
        start, end = match.start() + word.start(), match.start() + word.end()
        if norm not in _COMMON_WORDS:
            run.append((start, end, True))
        elif norm in _CONNECTORS and run and run[-1][2]:
            run.append((start, end, False))
        else:
            yield from flush()
    yield from flush()


def _cue_name_span(match: re.Match[str], allowed: frozenset[str] = frozenset()) -> tuple[int, int] | None:
    """The cue name up to the first common word ("Paulo Disse" -> "Paulo")."""
    base = match.start("name")
    last_end = None
    pending = False
    for word in _WORD.finditer(match.group("name")):
        norm = _norm(word.group())
        if norm not in _COMMON_WORDS or norm in allowed:
            last_end = base + word.end()
            pending = False
        elif norm in _CONNECTORS and last_end is not None and not pending:
            pending = True
        else:
            break
    return None if last_end is None else (base, last_end)


def _uncovered(
    start: int, end: int, starts: list[int], ends: list[int]
) -> list[tuple[int, int]]:
    """Return the parts of [start, end) not covered by accepted spans.

    `starts`/`ends` hold the accepted (non-overlapping) spans sorted by start, so only
    the spans intersecting the range are visited (bisect): O(log n + k).
    """
    fragments: list[tuple[int, int]] = []
    cursor = start
    i = max(bisect_right(starts, start) - 1, 0)
    while i < len(starts) and starts[i] < end:
        if ends[i] > cursor:
            if starts[i] > cursor:
                fragments.append((cursor, starts[i]))
            cursor = max(cursor, ends[i])
        i += 1
    if cursor < end:
        fragments.append((cursor, end))
    return fragments


def _trimmed(text: str, start: int, end: int) -> tuple[int, int] | None:
    while start < end and text[start].isspace():
        start += 1
    while end > start and text[end - 1].isspace():
        end -= 1
    return (start, end) if start < end else None


def _accept(
    label: str, span: tuple[int, int], text: str,
    hits: list[Hit], starts: list[int], ends: list[int], drop_lone_tail: bool = False,
) -> None:
    for start, end in _uncovered(*span, starts, ends):
        bounds = _trimmed(text, start, end)
        if bounds is not None:
            # "Paulo Disse" after a cue: the cue rule kept "Paulo", so a lone leftover word
            # of the Capitalised run is not a name.
            if drop_lone_tail and start > span[0] and len(text[bounds[0]:bounds[1]].split()) == 1:
                continue
            hits.append(Hit(label, *bounds))
            pos = bisect_right(starts, bounds[0])
            starts.insert(pos, bounds[0])
            ends.insert(pos, bounds[1])


def redact_pii(text: str) -> RedactionResult:
    hits: list[Hit] = []
    starts: list[int] = []  # accepted spans, sorted by start and never overlapping
    ends: list[int] = []
    for label, pattern in _PATTERNS:
        for match in pattern.finditer(text):
            if pattern is _CAPS_RUN:
                spans = list(_caps_name_spans(match))
            elif pattern is _CUE_NAME or pattern is _SELF_CUE_NAME or pattern is _PLACE_CUE:
                # "São" is a common word elsewhere but starts many place names.
                cue_span = _cue_name_span(match, _PLACE_OK if pattern is _PLACE_CUE else frozenset())
                spans = [cue_span] if cue_span else []
            else:
                spans = [match.span()]
            for span in spans:
                _accept(label, span, text, hits, starts, ends,
                        drop_lone_tail=pattern is _MIXED_RUN)
    hits.sort(key=lambda h: h.start)

    parts: list[str] = []
    cursor = 0
    for hit in hits:
        parts.append(text[cursor:hit.start])
        parts.append(f"[{hit.label}]")
        cursor = hit.end
    parts.append(text[cursor:])
    return RedactionResult(text="".join(parts), hits=tuple(hits))
