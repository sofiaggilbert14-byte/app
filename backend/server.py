import os
import re
import asyncio
import logging
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional

import requests
import jwt
from fastapi import FastAPI, APIRouter, HTTPException, Depends, status
from fastapi.responses import PlainTextResponse
from fastapi.security import OAuth2PasswordBearer
from passlib.context import CryptContext
from pydantic import BaseModel
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("iptv")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

# ---------------------------------------------------------------------------
# Admin auth (single admin, password from env is the source of truth)
# ---------------------------------------------------------------------------
JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALG = "HS256"
ACCESS_TOKEN_MINUTES = int(os.environ.get("ACCESS_TOKEN_MINUTES", "720"))
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/auth/login", auto_error=True)

_credentials_exc = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Could not validate credentials",
    headers={"WWW-Authenticate": "Bearer"},
)


def hash_password(p: str) -> str:
    return pwd_context.hash(p)


def verify_password(p: str, h: str) -> bool:
    try:
        return pwd_context.verify(p, h)
    except Exception:
        return False


def create_access_token(sub: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_MINUTES)
    return jwt.encode({"sub": sub, "exp": exp}, JWT_SECRET, algorithm=JWT_ALG)


async def require_admin(token: str = Depends(oauth2_scheme)) -> str:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        if payload.get("sub") != "admin":
            raise _credentials_exc
        return "admin"
    except _credentials_exc.__class__:
        raise
    except Exception:
        raise _credentials_exc


async def seed_admin():
    """Env password is the source of truth — keep the hash in sync on startup."""
    if not ADMIN_PASSWORD:
        return
    await db.admins.update_one(
        {"_id": "admin"},
        {"$set": {"password_hash": hash_password(ADMIN_PASSWORD),
                  "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )

app = FastAPI()
api_router = APIRouter(prefix="/api")

DEFAULT_M3U = os.environ.get("SOURCE_M3U_URL", "")
DEFAULT_EPG = os.environ.get("SOURCE_EPG_URL", "")

# ---------------------------------------------------------------------------
# In-memory cache of parsed guide data
# ---------------------------------------------------------------------------
CACHE = {
    "channels": [],          # list of channel dicts
    "programs": {},          # channel_id -> list of program dicts (sorted by start)
    "last_refresh": None,    # datetime
    "refreshing": False,
    "error": None,
}
_lock = asyncio.Lock()
REFRESH_TTL = timedelta(minutes=30)

EXTINF_ATTR = re.compile(r'([a-zA-Z0-9\-]+)="([^"]*)"')


def _stream_type(url: str) -> str:
    u = url.lower().split("?")[0]
    if u.endswith(".m3u8"):
        return "hls"
    if u.endswith(".ts"):
        return "ts"
    return "unknown"


def _https(url: str) -> str:
    if url and url.startswith("http://"):
        return "https://" + url[len("http://"):]
    return url


def parse_m3u(text: str):
    channels = []
    lines = text.splitlines()
    i = 0
    idx = 0
    used_ids = set()
    while i < len(lines):
        line = lines[i].strip()
        if line.startswith("#EXTINF"):
            attrs = dict(EXTINF_ATTR.findall(line))
            name = line.split(",", 1)[1].strip() if "," in line else attrs.get("tvg-name", "Channel")
            # find the next non-comment line as the URL
            url = ""
            j = i + 1
            while j < len(lines):
                nxt = lines[j].strip()
                if nxt and not nxt.startswith("#"):
                    url = nxt
                    break
                j += 1
            tvg_id = attrs.get("tvg-id", "").strip()
            base = tvg_id if tvg_id else re.sub(r"[^a-zA-Z0-9]+", "-", name).lower()
            cid = base
            if cid in used_ids:
                cid = f"{base}#{idx}"
            used_ids.add(cid)
            channels.append({
                "id": cid,
                "tvg_id": tvg_id,
                "name": name,
                "logo": _https(attrs.get("tvg-logo", "").strip()),
                "group": attrs.get("group-title", "").strip(),
                "url": url,
                "stream_type": _stream_type(url),
            })
            idx += 1
            i = j + 1
        else:
            i += 1
    return channels


def _parse_xmltv_time(s: str) -> Optional[datetime]:
    if not s:
        return None
    s = s.strip()
    try:
        if " " in s:
            return datetime.strptime(s, "%Y%m%d%H%M%S %z").astimezone(timezone.utc)
        return datetime.strptime(s[:14], "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
    except Exception:
        return None


def parse_xmltv(text: str):
    """Return (icons_by_channel_id, programs_by_channel_id)."""
    icons = {}
    programs = {}
    # iterparse for memory efficiency
    try:
        root = ET.fromstring(text)
    except ET.ParseError as e:
        logger.warning("XMLTV parse error: %s", e)
        return icons, programs

    for ch in root.findall("channel"):
        cid = ch.get("id", "")
        icon_el = ch.find("icon")
        if cid and icon_el is not None and icon_el.get("src"):
            icons[cid] = icon_el.get("src")

    for pr in root.findall("programme"):
        cid = pr.get("channel", "")
        start = _parse_xmltv_time(pr.get("start", ""))
        stop = _parse_xmltv_time(pr.get("stop", ""))
        if not cid or start is None:
            continue
        title_el = pr.find("title")
        desc_el = pr.find("desc")
        cat_el = pr.find("category")
        programs.setdefault(cid, []).append({
            "title": (title_el.text or "").strip() if title_el is not None else "No Title",
            "desc": (desc_el.text or "").strip() if desc_el is not None else "",
            "category": (cat_el.text or "").strip() if cat_el is not None else "",
            "start": start.isoformat(),
            "stop": stop.isoformat() if stop else None,
        })

    for cid in programs:
        programs[cid].sort(key=lambda p: p["start"])
    return icons, programs


def _fetch(url: str) -> str:
    resp = requests.get(url, timeout=60, headers={"User-Agent": "GridStream/1.0"})
    resp.raise_for_status()
    return resp.text


def _do_refresh(m3u_url: str, epg_url: str):
    logger.info("Refreshing sources...")
    m3u_text = _fetch(m3u_url)
    channels = parse_m3u(m3u_text)
    icons, programs = ({}, {})
    if epg_url:
        try:
            epg_text = _fetch(epg_url)
            icons, programs = parse_xmltv(epg_text)
        except Exception as e:
            logger.warning("EPG fetch/parse failed: %s", e)
    # merge logos from EPG when M3U logo missing; force https so mobile/web can load them
    for ch in channels:
        if not ch["logo"] and ch["tvg_id"] in icons:
            ch["logo"] = icons[ch["tvg_id"]]
        ch["logo"] = _https(ch["logo"])
    logger.info("Parsed %d channels, %d channels with programs", len(channels), len(programs))
    return channels, programs


async def get_source_urls():
    doc = await db.settings.find_one({"_id": "source"})
    if doc:
        return doc.get("m3u_url", DEFAULT_M3U), doc.get("epg_url", DEFAULT_EPG)
    return DEFAULT_M3U, DEFAULT_EPG


async def refresh_cache(force: bool = False):
    async with _lock:
        if CACHE["refreshing"]:
            return
        if not force and CACHE["last_refresh"] and datetime.now(timezone.utc) - CACHE["last_refresh"] < REFRESH_TTL:
            return
        CACHE["refreshing"] = True
    try:
        m3u_url, epg_url = await get_source_urls()
        loop = asyncio.get_event_loop()
        channels, programs = await loop.run_in_executor(None, _do_refresh, m3u_url, epg_url)
        CACHE["channels"] = channels
        CACHE["programs"] = programs
        CACHE["last_refresh"] = datetime.now(timezone.utc)
        CACHE["error"] = None
    except Exception as e:
        logger.exception("Refresh failed")
        CACHE["error"] = str(e)
    finally:
        CACHE["refreshing"] = False


async def ensure_loaded():
    if not CACHE["channels"] and not CACHE["refreshing"]:
        await refresh_cache(force=True)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
class SourceSettings(BaseModel):
    m3u_url: str
    epg_url: str


class AdminLogin(BaseModel):
    username: str
    password: str


@api_router.post("/auth/login")
async def admin_login(body: AdminLogin):
    admin = await db.admins.find_one({"_id": "admin"})
    # Username and password are both case-sensitive.
    if (
        body.username != ADMIN_USERNAME
        or not admin
        or not verify_password(body.password, admin.get("password_hash", ""))
    ):
        raise HTTPException(status_code=401, detail="Incorrect username or password")
    return {"access_token": create_access_token("admin"), "token_type": "bearer"}


@api_router.get("/auth/verify")
async def admin_verify(_: str = Depends(require_admin)):
    return {"ok": True}


@api_router.get("/")
async def root():
    return {"message": "GridStream IPTV API"}


@api_router.get("/proxy")
async def proxy(url: str):
    """Web-preview-only CORS proxy. The shipped native app fetches directly and
    never calls this — it exists so the browser preview can load m3u4u sources."""
    if not (url.startswith("http://") or url.startswith("https://")):
        raise HTTPException(status_code=400, detail="Invalid url")
    try:
        r = requests.get(
            url,
            timeout=45,
            allow_redirects=True,
            headers={"User-Agent": "Mozilla/5.0 (GridStream)"},
        )
        r.raise_for_status()
        return PlainTextResponse(content=r.text)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Proxy fetch failed: {e}")



@api_router.get("/status/source")
async def source_status():
    m3u_url, epg_url = await get_source_urls()
    channels_with_epg = sum(1 for c in CACHE["channels"] if c["tvg_id"] in CACHE["programs"])
    return {
        "m3u_url": m3u_url,
        "epg_url": epg_url,
        "channel_count": len(CACHE["channels"]),
        "channels_with_epg": channels_with_epg,
        "last_refresh": CACHE["last_refresh"].isoformat() if CACHE["last_refresh"] else None,
        "refreshing": CACHE["refreshing"],
        "error": CACHE["error"],
    }


@api_router.post("/refresh")
async def force_refresh():
    await refresh_cache(force=True)
    return await source_status()


@api_router.get("/settings")
async def get_settings():
    m3u_url, epg_url = await get_source_urls()
    return {"m3u_url": m3u_url, "epg_url": epg_url}


@api_router.post("/settings")
async def update_settings(s: SourceSettings, _: str = Depends(require_admin)):
    await db.settings.update_one(
        {"_id": "source"},
        {"$set": {"m3u_url": s.m3u_url, "epg_url": s.epg_url}},
        upsert=True,
    )
    await refresh_cache(force=True)
    return await source_status()


@api_router.get("/channels")
async def get_channels():
    await ensure_loaded()
    return {"channels": CACHE["channels"], "count": len(CACHE["channels"])}


def _window_programs(tvg_id: str, start: datetime, end: datetime):
    out = []
    for p in CACHE["programs"].get(tvg_id, []):
        ps = datetime.fromisoformat(p["start"])
        pe = datetime.fromisoformat(p["stop"]) if p["stop"] else ps + timedelta(minutes=30)
        if pe <= start or ps >= end:
            continue
        out.append(p)
    return out


@api_router.get("/guide")
async def get_guide(start: Optional[str] = None, hours: int = 24):
    await ensure_loaded()
    now = datetime.now(timezone.utc)
    if start:
        try:
            win_start = datetime.fromisoformat(start.replace("Z", "+00:00"))
        except Exception:
            win_start = now - timedelta(hours=1)
    else:
        win_start = now - timedelta(hours=1)
    hours = max(1, min(hours, 72))
    win_end = win_start + timedelta(hours=hours)

    channels = []
    for c in CACHE["channels"]:
        channels.append({**c, "programs": _window_programs(c["tvg_id"], win_start, win_end)})
    return {
        "start": win_start.isoformat(),
        "end": win_end.isoformat(),
        "now": now.isoformat(),
        "channels": channels,
    }


@api_router.get("/search")
async def search(q: str):
    await ensure_loaded()
    ql = q.lower().strip()
    if not ql:
        return {"channels": [], "programs": []}
    now = datetime.now(timezone.utc)
    ch_results = [c for c in CACHE["channels"] if ql in c["name"].lower()][:60]
    prog_results = []
    id_to_channel = {c["tvg_id"]: c for c in CACHE["channels"]}
    for tvg_id, progs in CACHE["programs"].items():
        ch = id_to_channel.get(tvg_id)
        if not ch:
            continue
        for p in progs:
            pe = datetime.fromisoformat(p["stop"]) if p["stop"] else None
            if pe and pe < now:
                continue
            if ql in p["title"].lower():
                prog_results.append({**p, "channel_id": ch["id"], "channel_name": ch["name"], "channel_logo": ch["logo"]})
            if len(prog_results) >= 100:
                break
        if len(prog_results) >= 100:
            break
    prog_results.sort(key=lambda p: p["start"])
    return {"channels": ch_results, "programs": prog_results[:80]}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    await seed_admin()
    asyncio.create_task(refresh_cache(force=True))


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
