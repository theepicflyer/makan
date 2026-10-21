"""Browser login: OIDC against Pocket ID, with a user picker for local development."""

from authlib.integrations.starlette_client import OAuth, OAuthError
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from makan.config import get_settings
from makan.db import get_db
from makan.models import User

router = APIRouter()
_oauth: OAuth | None = None


def _client():
    global _oauth
    settings = get_settings()
    if not settings.oidc_config_url:
        return None
    if _oauth is None:
        _oauth = OAuth()
        _oauth.register(
            "pocketid",
            server_metadata_url=settings.oidc_config_url,
            client_id=settings.oidc_client_id,
            client_secret=settings.oidc_client_secret,
            client_kwargs={"scope": "openid profile email", "code_challenge_method": "S256"},
        )
    return _oauth.pocketid


def upsert_user(db: Session, *, sub: str, email: str | None, name: str | None) -> User:
    user = db.scalar(select(User).where(User.oidc_sub == sub))
    if user is None:
        user = User(oidc_sub=sub, email=email, name=name or (email or "user").split("@")[0])
        db.add(user)
    else:
        user.email = email or user.email
        user.name = name or user.name
    db.flush()
    return user


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    uid = request.session.get("uid")
    user = db.get(User, uid) if uid else None
    if user is None:
        raise HTTPException(401, "Not signed in")
    return user


@router.get("/api/auth/config")
def auth_config():
    settings = get_settings()
    return {"oidc": bool(settings.oidc_config_url), "dev": settings.dev_login}


@router.get("/auth/login")
async def login(request: Request):
    client = _client()
    if client is None:
        return RedirectResponse("/login")
    return await client.authorize_redirect(
        request, f"{get_settings().public_url}/auth/web/callback"
    )


@router.get("/auth/web/callback")
async def callback(request: Request, db: Session = Depends(get_db)):
    client = _client()
    if client is None:
        raise HTTPException(404)
    try:
        token = await client.authorize_access_token(request)
    except OAuthError as exc:
        raise HTTPException(400, f"Login failed: {exc.error}") from exc
    info = token.get("userinfo") or {}
    email = (info.get("email") or "").lower() or None
    allowed = get_settings().allowed_email_set
    if allowed and (email is None or email not in allowed):
        raise HTTPException(403, "This account isn't allowed to use makan.")
    user = upsert_user(
        db, sub=info["sub"], email=email, name=info.get("name") or info.get("preferred_username")
    )
    request.session["uid"] = user.id
    return RedirectResponse("/")


@router.post("/api/auth/dev-login")
async def dev_login(request: Request, payload: dict, db: Session = Depends(get_db)):
    if not get_settings().dev_login:
        raise HTTPException(404)
    name = str(payload.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "name required")
    user = upsert_user(db, sub=f"dev:{name.lower()}", email=f"{name.lower()}@dev.local", name=name)
    request.session["uid"] = user.id
    return {"ok": True}


@router.post("/api/auth/logout")
async def logout(request: Request):
    request.session.clear()
    return {"ok": True}
