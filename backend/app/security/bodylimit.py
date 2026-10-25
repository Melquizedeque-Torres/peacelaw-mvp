import json
import re

_BODY = json.dumps({"detail": "Requisição grande demais."}).encode()


class _TooLarge(Exception):
    pass


class BodySizeLimitMiddleware:
    """Pure ASGI: rejects /api/ bodies over the limit, by Content-Length and by streamed bytes."""

    def __init__(self, app, headers: dict[str, str], max_bytes, path_limits=None) -> None:
        self.app = app
        self.headers = headers
        self.max_bytes = max_bytes  # callable, read per request so env changes apply
        # {regex for the exact path: callable limit}; applies to POST only
        self.path_limits = [(re.compile(p), fn) for p, fn in (path_limits or {}).items()]

    def _limit_for(self, scope) -> int:
        if scope.get("method") == "POST":
            for pattern, limit in self.path_limits:
                if pattern.fullmatch(scope["path"]):
                    return limit()
        return self.max_bytes()

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not scope["path"].startswith("/api/"):
            return await self.app(scope, receive, send)
        limit = self._limit_for(scope)
        declared = dict(scope["headers"]).get(b"content-length")
        if declared is not None:
            try:
                too_big = int(declared) > limit
            except ValueError:
                too_big = False
            if too_big:
                return await self._reject(send)

        seen = 0
        started = False
        rejected = False

        async def counting_receive():
            nonlocal seen, rejected
            message = await receive()
            if message["type"] == "http.request":
                seen += len(message.get("body", b""))
                if seen > limit:
                    # FastAPI turns body-read errors into its own 400, so answer here
                    # and swallow whatever the app tries to send afterwards.
                    if not started and not rejected:
                        rejected = True
                        await self._reject(send)
                    raise _TooLarge
            return message

        async def tracking_send(message):
            nonlocal started
            if rejected:
                return
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, counting_receive, tracking_send)
        except (_TooLarge, BaseExceptionGroup) as exc:
            # BaseHTTPMiddleware layers wrap the app's exception in a TaskGroup group.
            if not rejected or (
                isinstance(exc, BaseExceptionGroup)
                and exc.subgroup(_TooLarge) is None
            ):
                raise

    async def _reject(self, send):
        headers = [(k.lower().encode(), v.encode()) for k, v in self.headers.items()]
        headers += [
            (b"content-type", b"application/json"),
            (b"content-length", str(len(_BODY)).encode()),
            (b"cache-control", b"no-store"),
        ]
        await send({"type": "http.response.start", "status": 413, "headers": headers})
        await send({"type": "http.response.body", "body": _BODY})
