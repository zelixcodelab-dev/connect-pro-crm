"""Google Sheets lead-import integration.

Server-side Google OAuth 2.0 + Sheets/Drive access. Lets a Super Admin connect
a Google account, then import leads from a spreadsheet into a Campaign — reusing
the existing lead pipeline (phone normalisation + dedup from routers.leads).

Endpoints (prefix /api):
  GET  /google/status                       connection status
  GET  /google/connect-url                  start OAuth (returns Google auth URL)
  GET  /oauth/sheets/callback               OAuth redirect target (public)
  POST /google/disconnect                   drop stored credentials
  POST /google/create-template              create a formatted lead sheet
  GET  /google/spreadsheets                 list the user's spreadsheets
  GET  /google/spreadsheets/{id}/worksheets list tabs of a spreadsheet
  POST /google/fetch-leads                  read + validate + dedup (preview)
  POST /google/import                       import selected rows into a campaign
  POST /google/config                       save per-campaign sync config
  POST /google/sync                         "Sync Now" (auto-import new rows)
  GET  /google/imports                      import history for a campaign
"""
from __future__ import annotations

import asyncio
import hashlib
import os
import re
import uuid
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from db import db, gdb, set_current_tenant
from auth_lib import get_current_user
from routers.leads import _normalize_phone, LEAD_SOURCES

logger = logging.getLogger("google_sheets")
router = APIRouter(prefix="/api", tags=["google-sheets"])

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.metadata.readonly",
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
]
HEADER = ["name", "phone", "email", "course", "place", "source", "notes"]
REQUIRED_COLS = ["name", "phone"]
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


def _gid() -> str:
    return uuid.uuid4().hex


def _cfg():
    cid = os.environ.get("GOOGLE_CLIENT_ID")
    csec = os.environ.get("GOOGLE_CLIENT_SECRET")
    redirect = os.environ.get("GOOGLE_OAUTH_REDIRECT_URI")
    return cid, csec, redirect


def _require_cfg():
    cid, csec, redirect = _cfg()
    if not (cid and csec and redirect):
        raise HTTPException(400, "Google Sheets is not configured on the server yet. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_OAUTH_REDIRECT_URI.")
    return cid, csec, redirect


def _frontend_base(redirect: str) -> str:
    # Derive the app origin from the redirect URI so the callback can bounce
    # back to the SPA regardless of environment.
    return redirect.split("/api/")[0] if "/api/" in redirect else redirect


def _flow(state: Optional[str] = None):
    from google_auth_oauthlib.flow import Flow
    cid, csec, redirect = _require_cfg()
    return Flow.from_client_config(
        {"web": {
            "client_id": cid,
            "client_secret": csec,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
        }},
        scopes=SCOPES,
        redirect_uri=redirect,
        state=state,
    )


def _require_super(user: dict):
    if user.get("role") != "super_admin":
        raise HTTPException(403, "Only a Super Admin can manage the Google Sheets integration")


def _require_manager(user: dict):
    if user.get("role") not in ("super_admin", "office_admin"):
        raise HTTPException(403, "Not allowed")


async def _integration_doc():
    return await db.google_integration.find_one({"id": "google"}, {"_id": 0})


async def _creds_for_current_tenant():
    """Build google Credentials from the stored integration, refreshing the
    access token when expired. Raises 400 with a clear message when the
    account is not connected."""
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request as GoogleRequest

    doc = await _integration_doc()
    if not doc or doc.get("status") != "connected":
        raise HTTPException(400, "No Google account is connected. Connect one in Settings → Integrations.")
    cid, csec, _ = _require_cfg()
    creds = Credentials(
        token=doc.get("access_token"),
        refresh_token=doc.get("refresh_token"),
        token_uri="https://oauth2.googleapis.com/token",
        client_id=cid,
        client_secret=csec,
        scopes=doc.get("scopes") or SCOPES,
    )
    expiry = doc.get("token_expiry")
    dt = None
    if expiry:
        try:
            dt = datetime.fromisoformat(expiry)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
        except Exception:
            dt = None
    if not dt or _now() >= (dt - timedelta(seconds=60)):
        if not creds.refresh_token:
            raise HTTPException(400, "Google session expired and cannot refresh. Please reconnect your Google account.")
        try:
            await asyncio.to_thread(creds.refresh, GoogleRequest())
        except Exception as e:
            logger.error("Google token refresh failed: %s", e)
            raise HTTPException(400, "Google session expired. Please reconnect your Google account.")
        new_expiry = creds.expiry.replace(tzinfo=timezone.utc).isoformat() if creds.expiry else None
        await db.google_integration.update_one(
            {"id": "google"},
            {"$set": {"access_token": creds.token, "token_expiry": new_expiry}},
        )
    return creds


async def _service(api: str, version: str):
    from googleapiclient.discovery import build
    creds = await _creds_for_current_tenant()
    return await asyncio.to_thread(lambda: build(api, version, credentials=creds, cache_discovery=False))


# --------------------------------------------------------------------------
# Connection lifecycle
# --------------------------------------------------------------------------
@router.get("/google/status")
async def google_status(user: dict = Depends(get_current_user)):
    _require_manager(user)
    cid, csec, redirect = _cfg()
    configured = bool(cid and csec and redirect)
    doc = await _integration_doc() if configured else None
    return {
        "configured": configured,
        "connected": bool(doc and doc.get("status") == "connected"),
        "account_email": (doc or {}).get("account_email"),
        "connected_at": (doc or {}).get("connected_at"),
        "status": (doc or {}).get("status") or "disconnected",
    }


@router.get("/google/connect-url")
async def google_connect_url(user: dict = Depends(get_current_user)):
    _require_super(user)
    _require_cfg()
    state = _gid()
    flow = _flow(state=state)
    url, _ = await asyncio.to_thread(
        lambda: flow.authorization_url(access_type="offline", prompt="consent", include_granted_scopes="true")
    )
    await gdb.google_oauth_state.update_one(
        {"state": state},
        {"$set": {"state": state, "tenant_id": user.get("tenant_id"), "user_id": user.get("id"), "created_at": _now_iso()}},
        upsert=True,
    )
    return {"url": url}


@router.get("/oauth/sheets/callback")
async def google_callback(code: Optional[str] = None, state: Optional[str] = None, error: Optional[str] = None):
    _, _, redirect = _cfg()
    base = _frontend_base(redirect or "")
    if error or not code or not state:
        return RedirectResponse(f"{base}/settings?google=error")
    st = await gdb.google_oauth_state.find_one({"state": state})
    if not st:
        return RedirectResponse(f"{base}/settings?google=error")
    await gdb.google_oauth_state.delete_one({"state": state})
    set_current_tenant(st.get("tenant_id"))
    try:
        flow = _flow(state=state)
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            await asyncio.to_thread(flow.fetch_token, code=code)
        creds = flow.credentials
        granted = set(creds.scopes or [])
        if "https://www.googleapis.com/auth/spreadsheets" not in granted:
            return RedirectResponse(f"{base}/settings?google=scope")
        # Fetch the connected account email.
        from googleapiclient.discovery import build
        email = None
        try:
            oauth2 = await asyncio.to_thread(lambda: build("oauth2", "v2", credentials=creds, cache_discovery=False))
            info = await asyncio.to_thread(lambda: oauth2.userinfo().get().execute())
            email = info.get("email")
        except Exception:
            email = None
        expiry = creds.expiry.replace(tzinfo=timezone.utc).isoformat() if creds.expiry else None
        await db.google_integration.update_one(
            {"id": "google"},
            {"$set": {
                "id": "google",
                "account_email": email,
                "access_token": creds.token,
                "refresh_token": creds.refresh_token,
                "token_expiry": expiry,
                "scopes": list(creds.scopes or SCOPES),
                "status": "connected",
                "connected_at": _now_iso(),
                "connected_by": st.get("user_id"),
            }},
            upsert=True,
        )
        return RedirectResponse(f"{base}/settings?google=connected")
    except Exception as e:
        logger.error("Google OAuth callback failed: %s", e)
        return RedirectResponse(f"{base}/settings?google=error")


@router.post("/google/disconnect")
async def google_disconnect(user: dict = Depends(get_current_user)):
    _require_super(user)
    await db.google_integration.delete_one({"id": "google"})
    return {"ok": True}


# --------------------------------------------------------------------------
# Spreadsheet operations
# --------------------------------------------------------------------------
@router.post("/google/create-template")
async def create_template(user: dict = Depends(get_current_user)):
    _require_super(user)
    sheets = await _service("sheets", "v4")
    title = f"CRM Leads – {datetime.now().strftime('%d %b %Y %H:%M')}"

    def _create():
        ss = sheets.spreadsheets().create(body={"properties": {"title": title}}).execute()
        sid = ss["spreadsheetId"]
        sheets.spreadsheets().values().update(
            spreadsheetId=sid, range="A1", valueInputOption="RAW",
            body={"values": [HEADER, ["Rahul", "9876543210", "rahul@example.com", "BCA", "Bangalore", "Meta Ads", "Interested"]]},
        ).execute()
        return ss

    ss = await asyncio.to_thread(_create)
    return {
        "spreadsheet_id": ss["spreadsheetId"],
        "name": title,
        "url": ss.get("spreadsheetUrl") or f"https://docs.google.com/spreadsheets/d/{ss['spreadsheetId']}/edit",
    }


@router.get("/google/spreadsheets")
async def list_spreadsheets(user: dict = Depends(get_current_user)):
    _require_manager(user)
    drive = await _service("drive", "v3")

    def _list():
        res = drive.files().list(
            q="mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
            fields="files(id,name,modifiedTime)", orderBy="modifiedTime desc", pageSize=100,
        ).execute()
        return res.get("files", [])

    files = await asyncio.to_thread(_list)
    return {"spreadsheets": [{"id": f["id"], "name": f["name"]} for f in files]}


@router.get("/google/spreadsheets/{spreadsheet_id}/worksheets")
async def list_worksheets(spreadsheet_id: str, user: dict = Depends(get_current_user)):
    _require_manager(user)
    sheets = await _service("sheets", "v4")

    def _get():
        return sheets.spreadsheets().get(spreadsheetId=spreadsheet_id, fields="sheets.properties").execute()

    try:
        meta = await asyncio.to_thread(_get)
    except Exception:
        raise HTTPException(404, "Spreadsheet not found or you don't have access.")
    tabs = [
        {"id": s["properties"]["sheetId"], "title": s["properties"]["title"]}
        for s in meta.get("sheets", [])
    ]
    return {"worksheets": tabs}


# --------------------------------------------------------------------------
# Fetch + validate + dedup
# --------------------------------------------------------------------------
class FetchIn(BaseModel):
    spreadsheet_id: str
    worksheet_title: str
    campaign_id: str


def _row_hash(spreadsheet_id: str, worksheet_title: str, cells: dict) -> str:
    raw = "|".join([
        spreadsheet_id, worksheet_title,
        (cells.get("name") or "").strip().lower(),
        _normalize_phone(cells.get("phone")),
        (cells.get("email") or "").strip().lower(),
        (cells.get("course") or "").strip().lower(),
        (cells.get("place") or "").strip().lower(),
    ])
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


async def _campaign_in_scope(campaign_id: str, user: dict) -> dict:
    scope = {} if user.get("role") == "super_admin" else {"office": user.get("office")}
    c = await db.campaigns.find_one({**scope, "id": campaign_id}, {"_id": 0, "id": 1, "office": 1, "name": 1})
    if not c:
        raise HTTPException(404, "Campaign not found in your scope")
    return c


async def _read_and_classify(spreadsheet_id: str, worksheet_title: str, campaign: dict):
    sheets = await _service("sheets", "v4")

    def _read():
        return sheets.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id, range=f"'{worksheet_title}'"
        ).execute()

    try:
        res = await asyncio.to_thread(_read)
    except Exception:
        raise HTTPException(404, "Could not read that worksheet. It may have been deleted or renamed.")
    values = res.get("values", [])
    if not values:
        raise HTTPException(400, "The sheet is empty. Add a header row: " + ", ".join(HEADER))
    header = [str(h or "").strip().lower() for h in values[0]]
    col_idx = {h: i for i, h in enumerate(header)}
    missing = [c for c in REQUIRED_COLS if c not in col_idx]
    if missing:
        raise HTTPException(400, f"Missing required columns: {', '.join(missing)}. Please use the approved lead format: {', '.join(HEADER)}")

    # Dedup reference sets.
    crm = await db.leads.find({}, {"_id": 0, "phone": 1, "campaign_id": 1}).to_list(20000)
    crm_phones = set()
    campaign_phones = set()
    for l in crm:
        k = _normalize_phone(l.get("phone"))
        if not k:
            continue
        crm_phones.add(k)
        if l.get("campaign_id") == campaign["id"]:
            campaign_phones.add(k)
    prior = await db.google_sheet_import.find(
        {"spreadsheet_id": spreadsheet_id, "worksheet_title": worksheet_title, "status": {"$in": ["imported", "existing"]}},
        {"_id": 0, "row_hash": 1},
    ).to_list(20000)
    imported_hashes = {p.get("row_hash") for p in prior}

    def cell(row, key):
        i = col_idx.get(key)
        return str(row[i]).strip() if (i is not None and i < len(row)) else ""

    rows = []
    counts = {"total": 0, "new": 0, "duplicate": 0, "invalid": 0}
    seen_phone_this_fetch = set()
    for offset, raw in enumerate(values[1:]):
        row_number = offset + 2
        if not any(str(c).strip() for c in raw):
            continue  # skip fully-blank rows
        cells = {k: cell(raw, k) for k in HEADER}
        name = cells["name"]
        phone_norm = _normalize_phone(cells["phone"])
        rh = _row_hash(spreadsheet_id, worksheet_title, cells)
        status = "new"
        reason = ""
        if not name:
            status, reason = "invalid", "Missing name"
        elif not cells["phone"]:
            status, reason = "invalid_phone", "Missing phone"
        elif len(phone_norm) != 10:
            status, reason = "invalid_phone", "Invalid Indian phone number"
        elif cells["email"] and not _EMAIL_RE.match(cells["email"]):
            status, reason = "invalid_email", "Invalid email format"
        elif rh in imported_hashes:
            status, reason = "duplicate_sheet", "Already imported from this sheet"
        elif phone_norm in campaign_phones or phone_norm in seen_phone_this_fetch:
            status, reason = "duplicate_campaign", "Already in this campaign"
        elif phone_norm in crm_phones:
            status, reason = "duplicate_crm", "Already exists in CRM"
        if status == "new":
            seen_phone_this_fetch.add(phone_norm)
            counts["new"] += 1
        elif status.startswith("invalid"):
            counts["invalid"] += 1
        else:
            counts["duplicate"] += 1
        counts["total"] += 1
        rows.append({
            "row_number": row_number, "row_hash": rh,
            "name": name, "phone": cells["phone"], "phone_normalized": phone_norm,
            "email": cells["email"], "course": cells["course"], "place": cells["place"],
            "source": cells["source"], "notes": cells["notes"],
            "status": status, "reason": reason,
        })
    return rows, counts


@router.post("/google/fetch-leads")
async def fetch_leads(payload: FetchIn, user: dict = Depends(get_current_user)):
    _require_manager(user)
    campaign = await _campaign_in_scope(payload.campaign_id, user)
    rows, counts = await _read_and_classify(payload.spreadsheet_id, payload.worksheet_title, campaign)
    return {"rows": rows, "counts": counts, "last_sync": _now_iso(), "campaign": {"id": campaign["id"], "name": campaign.get("name")}}


# --------------------------------------------------------------------------
# Import
# --------------------------------------------------------------------------
class ImportIn(BaseModel):
    spreadsheet_id: str
    spreadsheet_name: Optional[str] = None
    worksheet_title: str
    campaign_id: str
    row_numbers: List[int] = []
    include_existing: bool = False


def _lead_source(src: str) -> str:
    s = (src or "").strip().lower().replace(" ", "_")
    return s if s in LEAD_SOURCES else "google_sheets"


async def _do_import(payload: ImportIn, user: dict, campaign: dict, auto: bool = False):
    rows, _ = await _read_and_classify(payload.spreadsheet_id, payload.worksheet_title, campaign)
    selected = set(payload.row_numbers or [])
    office = campaign.get("office")
    now = _now_iso()
    new_leads = []
    import_records = []
    imported = existing = duplicates = invalid = 0

    for r in rows:
        if not auto and r["row_number"] not in selected:
            continue
        st = r["status"]
        base_rec = {
            "id": _gid(), "campaign_id": campaign["id"],
            "spreadsheet_id": payload.spreadsheet_id, "spreadsheet_name": payload.spreadsheet_name,
            "worksheet_title": payload.worksheet_title, "row_number": r["row_number"],
            "row_hash": r["row_hash"], "imported_at": now, "imported_by": user.get("id"),
        }
        if st == "new":
            lead_id = _gid()
            new_leads.append({
                "id": lead_id, "name": r["name"], "phone": r["phone"], "email": r["email"],
                "course": r["course"], "place": r["place"], "source": _lead_source(r["source"]),
                "status": "new", "assigned_to_user_id": None, "office": office,
                "campaign_id": campaign["id"], "next_follow_up": None, "notes": r["notes"],
                "follow_ups": [], "created_by_user_id": user.get("id"),
                "created_at": now, "updated_at": now,
                "import_source": "google_sheets", "google_spreadsheet_id": payload.spreadsheet_id,
                "google_sheet_name": payload.worksheet_title, "google_row_number": r["row_number"],
                "imported_at": now,
            })
            import_records.append({**base_rec, "lead_id": lead_id, "status": "imported", "error_message": None})
            imported += 1
        elif st == "duplicate_crm" and payload.include_existing:
            # Find the existing CRM lead by normalized phone.
            cand = await db.leads.find({}, {"_id": 0, "id": 1, "phone": 1, "campaign_id": 1}).to_list(20000)
            match = next((c for c in cand if _normalize_phone(c.get("phone")) == r["phone_normalized"]), None)
            if match and match.get("campaign_id") != campaign["id"]:
                await db.leads.update_one(
                    {"id": match["id"]},
                    {"$set": {"campaign_id": campaign["id"], "office": office, "updated_at": now}},
                )
                import_records.append({**base_rec, "lead_id": match["id"], "status": "existing", "error_message": None})
                existing += 1
            else:
                import_records.append({**base_rec, "lead_id": (match or {}).get("id"), "status": "duplicate", "error_message": "Already in campaign"})
                duplicates += 1
        elif st.startswith("duplicate"):
            import_records.append({**base_rec, "lead_id": None, "status": "duplicate", "error_message": r["reason"]})
            duplicates += 1
        else:  # invalid*
            import_records.append({**base_rec, "lead_id": None, "status": "invalid", "error_message": r["reason"]})
            invalid += 1

    if new_leads:
        await db.leads.insert_many([dict(d) for d in new_leads])
    if import_records:
        await db.google_sheet_import.insert_many([dict(d) for d in import_records])

    history = {
        "id": _gid(), "campaign_id": campaign["id"], "spreadsheet_id": payload.spreadsheet_id,
        "spreadsheet_name": payload.spreadsheet_name, "worksheet_title": payload.worksheet_title,
        "fetched": len([r for r in rows]), "imported": imported, "existing": existing,
        "duplicates": duplicates, "invalid": invalid, "imported_by": user.get("id"),
        "imported_by_name": user.get("name"), "status": "completed",
        "source": "auto_sync" if auto else "manual", "created_at": now,
    }
    await db.google_import_history.insert_one(dict(history))
    history.pop("_id", None)
    return {"imported": imported, "existing": existing, "duplicates": duplicates, "invalid": invalid, "history": history}


@router.post("/google/import")
async def import_leads(payload: ImportIn, user: dict = Depends(get_current_user)):
    _require_manager(user)
    campaign = await _campaign_in_scope(payload.campaign_id, user)
    if not payload.row_numbers:
        raise HTTPException(400, "No leads selected to import")
    return await _do_import(payload, user, campaign, auto=False)


# --------------------------------------------------------------------------
# Sync config + manual "Sync Now"
# --------------------------------------------------------------------------
class ConfigIn(BaseModel):
    campaign_id: str
    spreadsheet_id: str
    spreadsheet_name: Optional[str] = None
    worksheet_title: str
    sync_enabled: bool = False


@router.post("/google/config")
async def save_config(payload: ConfigIn, user: dict = Depends(get_current_user)):
    _require_manager(user)
    await _campaign_in_scope(payload.campaign_id, user)
    doc = payload.model_dump()
    doc["updated_at"] = _now_iso()
    await db.google_sheet_config.update_one({"campaign_id": payload.campaign_id}, {"$set": doc}, upsert=True)
    return {"ok": True, "config": doc}


@router.get("/google/config")
async def get_config(campaign_id: str = Query(...), user: dict = Depends(get_current_user)):
    _require_manager(user)
    cfg = await db.google_sheet_config.find_one({"campaign_id": campaign_id}, {"_id": 0})
    return {"config": cfg}


class SyncIn(BaseModel):
    campaign_id: str


@router.post("/google/sync")
async def sync_now(payload: SyncIn, user: dict = Depends(get_current_user)):
    _require_manager(user)
    campaign = await _campaign_in_scope(payload.campaign_id, user)
    cfg = await db.google_sheet_config.find_one({"campaign_id": payload.campaign_id}, {"_id": 0})
    if not cfg:
        raise HTTPException(400, "No Google Sheet is configured for this campaign yet.")
    imp = ImportIn(
        spreadsheet_id=cfg["spreadsheet_id"], spreadsheet_name=cfg.get("spreadsheet_name"),
        worksheet_title=cfg["worksheet_title"], campaign_id=payload.campaign_id,
        include_existing=False,
    )
    result = await _do_import(imp, user, campaign, auto=True)
    await db.google_sheet_config.update_one(
        {"campaign_id": payload.campaign_id}, {"$set": {"last_sync_at": _now_iso()}}
    )
    return result


@router.get("/google/imports")
async def import_history(campaign_id: str = Query(...), user: dict = Depends(get_current_user)):
    _require_manager(user)
    await _campaign_in_scope(campaign_id, user)
    docs = await db.google_import_history.find({"campaign_id": campaign_id}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return {"imports": docs}
