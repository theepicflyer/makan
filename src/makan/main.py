"""ASGI app: JSON API, browser login, the built web app, and the MCP endpoint, on one origin."""

import logging
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlparse

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from makan import api, auth
from makan.config import get_settings
from makan.db import session_scope
from makan.foods import load_reference
from makan.mcp_server import mcp
from makan.migrate import upgrade

log = logging.getLogger("makan")

# Client-side routes of the web app; everything else unmatched goes to the MCP/OAuth app.
SPA_ROUTES = ("/", "/login", "/foods", "/settings", "/history", "/day/{rest:path}", "/foods/{rest:path}")


def startup() -> None:
    settings = get_settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    upgrade()
    with session_scope() as db:
        loaded = load_reference(db, settings.reference_dir)
    if loaded:
        log.info("loaded %d reference foods", loaded)


def create_app() -> FastAPI:
    settings = get_settings()
    host = urlparse(settings.public_url).netloc
    mcp_app = mcp.http_app(path="/mcp", allowed_hosts=[host, "localhost:*", "127.0.0.1:*"])

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        startup()
        async with mcp_app.lifespan(app):
            yield

    app = FastAPI(title="makan", lifespan=lifespan, docs_url=None, redoc_url=None)
    app.add_middleware(
        SessionMiddleware,
        secret_key=settings.session_secret,
        session_cookie="makan_session",
        max_age=180 * 24 * 3600,
        same_site="lax",
        https_only=settings.public_url.startswith("https://"),
    )

    @app.middleware("http")
    async def require_app_header(request: Request, call_next):
        # Cross-site forms can't set custom headers, so this blocks CSRF on state-changing API calls.
        if (
            request.url.path.startswith("/api/")
            and request.method not in ("GET", "HEAD", "OPTIONS")
            and request.headers.get("x-makan") != "1"
        ):
            return JSONResponse({"detail": "missing X-Makan header"}, status_code=403)
        return await call_next(request)

    app.include_router(auth.router)
    app.include_router(api.router)

    static = settings.static_dir
    index = static / "index.html"
    if (static / "_app").is_dir():
        app.mount("/_app", StaticFiles(directory=static / "_app"), name="assets")
    for path in static.glob("*") if static.is_dir() else []:
        if path.is_file() and path.name != "index.html":
            app.add_api_route(f"/{path.name}", _file_route(path), methods=["GET"], include_in_schema=False)
    for dirpath in ("icons",):
        if (static / dirpath).is_dir():
            app.mount(f"/{dirpath}", StaticFiles(directory=static / dirpath), name=dirpath)

    async def spa(request: Request):
        if index.exists():
            return FileResponse(index, headers={"Cache-Control": "no-cache"})
        return JSONResponse({"detail": "web app not built; run npm run build in web/"}, status_code=503)

    for route in SPA_ROUTES:
        app.add_api_route(route, spa, methods=["GET"], include_in_schema=False)

    app.mount("/", mcp_app)
    return app


def _file_route(path: Path):
    headers = {"Cache-Control": "no-cache"} if path.name in ("sw.js", "manifest.webmanifest") else None

    async def serve():
        return FileResponse(path, headers=headers)

    return serve


app = create_app()
