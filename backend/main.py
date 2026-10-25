import os

import logging

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from sqlalchemy import text

from app import errors
from app.db import _session_factory
from app.config import cookie_secure, evidence_max_bytes, max_body_bytes
from app.security.bodylimit import BodySizeLimitMiddleware
from app.routers import admin, auth, cases, consent, evidence, judge, lawyer, totp

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
}
DEFAULT_CORS_ORIGINS = "http://localhost:3000,http://127.0.0.1:3000"


def _is_production() -> bool:
    return os.environ.get("APP_ENV", "development").strip().lower() == "production"


def _cors_origins() -> list[str]:
    raw = os.environ.get("CORS_ORIGINS", "" if _is_production() else DEFAULT_CORS_ORIGINS)
    return [o.strip() for o in raw.split(",") if o.strip()]


def _docs_enabled() -> bool:
    explicit = os.environ.get("ENABLE_API_DOCS", "").strip().lower()
    return explicit == "true" or (not _is_production() and explicit != "false")


def create_app() -> FastAPI:
    env = os.environ.get("APP_ENV", "development").strip().lower()
    if env not in ("development", "production"):
        raise RuntimeError(
            f"APP_ENV inválido: {env!r}. Use 'development' ou 'production'."
        )
    if _is_production() and not _cors_origins():
        raise RuntimeError(
            "CORS_ORIGINS é obrigatório quando APP_ENV=production "
            "(origens separadas por vírgula, ex.: https://app.exemplo.com)."
        )
    if _is_production():
        if not cookie_secure():
            raise RuntimeError(
                "COOKIE_SECURE=false não é permitido com APP_ENV=production "
                "(COOKIE_SECURE=false is not allowed in production)."
            )
        if len(os.environ.get("JWT_SECRET", "")) < 48:
            raise RuntimeError(
                "JWT_SECRET precisa ter ao menos 48 caracteres com APP_ENV=production "
                "(JWT_SECRET must be at least 48 characters in production)."
            )
    docs = _docs_enabled()
    app = FastAPI(
        title="PeaceLaw API",
        version="0.1.0",
        docs_url="/docs" if docs else None,
        redoc_url="/redoc" if docs else None,
        openapi_url="/openapi.json" if docs else None,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=_cors_origins(),
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["Content-Type"],
    )

    STATE_CHANGING = frozenset({"POST", "PUT", "PATCH", "DELETE"})

    @app.middleware("http")
    async def reject_cross_site_writes(request: Request, call_next):
        # Defence in depth on top of SameSite=Lax: a browser always sends Origin on
        # cross-site writes. Absent Origin (server-to-server) passes.
        if request.method in STATE_CHANGING and request.url.path.startswith("/api/"):
            origin = request.headers.get("origin")
            own = f"{request.url.scheme}://{request.url.netloc}"
            if origin is not None and origin != own and origin not in _cors_origins():
                return JSONResponse(
                    status_code=status.HTTP_403_FORBIDDEN,
                    content={"detail": "Origem não permitida."},
                )
        return await call_next(request)


    # Registered after the guard so it wraps it: even the 403 above is non-cacheable.
    @app.middleware("http")
    async def no_store_api_responses(request: Request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(RequestValidationError)
    async def sanitized_validation_error(
        _request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        # Pydantic's default body echoes each error's `input` (the submitted text),
        # which would leak raw_text. Expose only the field path and the message.
        errors = [
            {
                "field": ".".join(str(part) for part in err["loc"][1:]),
                "message": err["msg"],
            }
            for err in exc.errors()
        ]
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={"detail": "Dados inválidos.", "errors": errors},
        )

    @app.exception_handler(Exception)
    async def unhandled_error(_request: Request, _exc: Exception) -> JSONResponse:
        # Runs in ServerErrorMiddleware, outside the header middleware below, so the
        # security headers are attached here. No detail about the failure is exposed.
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"detail": errors.INTERNAL_ERROR},
            headers={**SECURITY_HEADERS, "Cache-Control": "no-store"},
        )

    app.include_router(admin.router)
    app.include_router(auth.router)
    app.include_router(cases.router)
    app.include_router(consent.router)
    app.include_router(evidence.router)
    app.include_router(judge.router)
    app.include_router(lawyer.router)
    app.include_router(totp.router)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/health")
    def api_health() -> JSONResponse:
        """Public uptime probe: proves the app can reach the database. Nothing else is exposed."""
        try:
            with _session_factory()() as session:
                session.execute(text("select 1"))
        except Exception:
            # No detail on the wire; the class of failure goes to the server log only.
            logging.getLogger("app.health").error("health check failed")
            return JSONResponse(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, content={"status": "unavailable"})
        return JSONResponse(content={"status": "ok"})

    # Registered just before security_headers, so it is the second outermost layer: it
    # rejects oversized bodies early and sets SECURITY_HEADERS on its own 413 itself.
    app.add_middleware(
        BodySizeLimitMiddleware,
        headers=SECURITY_HEADERS,
        max_bytes=max_body_bytes,
        path_limits={r"/api/cases/[0-9a-fA-F-]{36}/evidence": evidence_max_bytes},
    )

    # Registered last, so it is outermost: every response (CORS preflights, 403s,
    # 404s, docs) carries the headers.
    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        for name, value in SECURITY_HEADERS.items():
            response.headers[name] = value
        return response

    return app


app = create_app()
