# PeaceLaw — Guia de deploy em produção

Este guia lista **o que precisa existir fora do código** para colocar o PeaceLaw em
produção. O código já recusa subir em produção com configuração insegura
(`APP_ENV=production` sem `CORS_ORIGINS`, com `COOKIE_SECURE=false` ou com
`JWT_SECRET` curto).

## Arquitetura

```
navegador ──HTTPS──▶ Vercel (um projeto, dois serviços)
                       ├─ /*      ──▶ Next.js (frontend)
                       └─ /api/*  ──▶ FastAPI (backend) ──TLS──▶ Neon Postgres
```

- O navegador fala com um único domínio; a Vercel roteia `/api/*` para o serviço do
  backend (ver seção 3).
- O cookie de sessão é `httpOnly`, `Secure`, `SameSite=Lax` e de primeira parte (o
  `/api` é servido pelo mesmo domínio do frontend).

## 1. Segredos (cofre)

Guarde em um gerenciador de segredos (Vercel/Render/Fly secrets, AWS Secrets
Manager, Doppler, 1Password…). **Nunca** em arquivo versionado.

| Variável | Onde | Como gerar |
|---|---|---|
| `DATABASE_URL` | backend | Neon → Connect (use um **role de aplicação** sem permissão de DDL; rode migrações com outro role) |
| `JWT_SECRET` | backend | `python -c "import secrets; print(secrets.token_urlsafe(64))"` (≥ 48 caracteres, exigido) |
| `RAW_TEXT_KEYS` | backend | `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` — a 1ª chave cifra, todas decifram |

**Rotação de `RAW_TEXT_KEYS`:** adicione a chave nova **na frente**, faça deploy,
re-salve as linhas (job de rotação com `MultiFernet.rotate`) e só então remova a
chave antiga. Perder a chave = perder os relatos originais.

## 2. Variáveis de ambiente

**Backend**

| Variável | Valor em produção |
|---|---|
| `APP_ENV` | `production` |
| `CORS_ORIGINS` | o domínio público do frontend, ex. `https://app.peacelaw.com.br` (sem localhost) |
| `COOKIE_SECURE` | não definir (padrão `true`) |
| `ENABLE_API_DOCS` | não definir (docs desligados) |
| `RATE_LIMIT_STORE` | `db` (obrigatório em serverless) |
| `RATE_LIMIT_LOGIN_PER_15MIN`, `RATE_LIMIT_LOGIN_IP_PER_15MIN`, `RATE_LIMIT_REGISTER_PER_HOUR`, `RATE_LIMIT_MAX_KEYS` | padrões são adequados |
| `MAX_BODY_BYTES` | `131072` (padrão) |
| `RAW_TEXT_RETENTION_DAYS` | `180` (deve bater com a página `/privacidade`) |

**Frontend**

| Variável | Valor |
|---|---|
| `BACKEND_URL` | **não definir na Vercel** (a plataforma roteia `/api`); só em dev local: `http://127.0.0.1:8000` |

## 3. Vercel: projeto e serviços

Um único projeto Vercel (time `<seu-time-vercel>`) publica os dois serviços, declarados em
`vercel.json` na raiz:

- `frontend` (`frontend/`, Next.js) atende tudo, exceto `/api/*`;
- `backend` (`backend/`, FastAPI, entrypoint `main:app`) atende `/api/(.*)`.

O roteamento `/api` é feito pela plataforma (rewrites de topo do `vercel.json`). Por
isso **não defina `BACKEND_URL` na Vercel**: o rewrite do `next.config.ts` só vale
localmente (`BACKEND_URL=http://127.0.0.1:8000`). `backend/.vercelignore` deixa fora do
pacote `.venv`, `.env*`, `tests` e `scripts`; `app/content` e `migrations` continuam
incluídos.

Vincule o repositório ao projeto (cria a pasta `.vercel`, que está no `.gitignore`):

```bash
vercel link --scope <seu-time-vercel>
```

## 4. Variáveis de ambiente por ambiente

Defina cada variável no ambiente certo (`production`, `preview`, `development`). Valores
simples:

```bash
vercel env add APP_ENV production            # digite: production
vercel env add CORS_ORIGINS production       # https://<dominio-publico>
vercel env add RATE_LIMIT_STORE production   # db
```

**Segredos** (`DATABASE_URL`, `JWT_SECRET`, `RAW_TEXT_KEYS`) entram por stdin a partir
de um arquivo temporário fora do repositório, nunca como argumento nem em histórico do
shell; apague o arquivo em seguida:

```bash
vercel env add JWT_SECRET production < jwt_secret.txt
vercel env add DATABASE_URL production < database_url.txt
vercel env add RAW_TEXT_KEYS production < raw_text_keys.txt
```

- `RATE_LIMIT_STORE=db` é **obrigatório em produção**: em serverless não há memória
  compartilhada entre instâncias, então o limite precisa viver no Postgres.
- Em `preview`, use um banco/branch Neon separado e `CORS_ORIGINS` do domínio de preview;
  nunca reutilize os segredos de produção.
- `BACKEND_URL` **não** é definida na Vercel (ver seção 3).

## 5. Deploy e proteção

```bash
vercel deploy --prod
```

- Aplique as migrações (`alembic upgrade head`) com o role de migração, a partir de uma
  máquina de confiança, **antes** de promover a versão que as exige.
- Mantenha a **Deployment Protection** ligada até o lançamento: o site só abre para
  quem está autenticado na Vercel. Desligue-a apenas no dia do lançamento público.
- HTTPS e HSTS são fornecidos pela plataforma e pelo `next.config.ts`; o limite de body
  (`MAX_BODY_BYTES`) e o rate limiting por banco continuam ativos no backend.

## 6. Contas de juízes e advogados

O cadastro público só cria **clientes**. Contas `JUDGE`/`LAWYER`/`ADMIN` são criadas
no servidor com o script auditado (a senha é digitada duas vezes sem eco, ou lida do
stdin; nunca vai em argumento, log ou saída):

```bash
cd backend
.venv/bin/python -m scripts.create_user --email juiza@tribunal.jus.br --role JUDGE
# automação/cofre: pipe a senha pelo stdin, ex.: echo "$SENHA" | ... --password-stdin
```

Só `JUDGE`, `LAWYER` e `ADMIN`; e-mail existente nunca é alterado; o log registra apenas
papel e id. `scripts/seed_demo_users.py` **recusa rodar** com `APP_ENV=production`.

## 7. LGPD

- Agende o job de retenção diariamente (`scripts/purge_raw_text.py`, ver
  `backend/README.md`). Já existe o workflow `.github/workflows/retention.yml` (03:15 BRT;
  defina os secrets `DATABASE_URL` e `RAW_TEXT_KEYS` no repositório; o disparo manual
  começa em `dry-run`). Ele registra apenas os IDs apagados (trilha de auditoria).
- Preencha os placeholders da página `/privacidade` (razão social do controlador e
  e-mail do encarregado) e **submeta o texto e o termo de consentimento à revisão
  jurídica** — ambos estão marcados como minuta.
- Mudou o termo de consentimento? Atualize `CONSENT_VERSION`/`CONSENT_TEXT` no
  backend **e** a constante de fallback do frontend; o backend recusa (409) envios
  com versão diferente da vigente.
- Backups e o histórico do Neon guardam dados antigos pelo período de retenção
  configurado no Neon (hoje 6 h no projeto `peacelaw`); documente esse prazo.

## 8. Checklist final

- [ ] Segredos no cofre; `.env` fora do servidor de build.
- [ ] `APP_ENV=production`, `CORS_ORIGINS` com o domínio real.
- [ ] `vercel.json` com os serviços `frontend` e `backend`; `BACKEND_URL` **não** definida na Vercel.
- [ ] `RATE_LIMIT_STORE=db` em produção.
- [ ] `alembic upgrade head` executado (head atual: ver `alembic current`).
- [ ] Deployment Protection ligada até o lançamento.
- [ ] Job de retenção agendado.
- [ ] `/privacidade` e termo revisados por advogado; placeholders preenchidos.
- [ ] Contas demo **não** criadas em produção.
- [ ] CI (`.github/workflows/ci.yml`: pytest, lint, tsc, vitest, build, `npm audit`, `pip-audit`) verde no GitHub.
