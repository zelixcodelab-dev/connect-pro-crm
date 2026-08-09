"""Global CRM pipeline configuration.

The lead pipeline *keys* are fixed (all automations depend on them), but the
platform owner can rename, reorder and show/hide the stages. This config is
GLOBAL (one document in the shared platform DB) and is consumed by every
company's CRM UI (board, funnel, filters).
"""
from db import gdb

# Canonical stage keys + their default labels. Order here is the default order.
CANONICAL_STAGES = [
    {"key": "new", "label": "New"},
    {"key": "not_connected", "label": "Not Connected"},
    {"key": "interested", "label": "Interested"},
    {"key": "follow_up", "label": "Follow-up"},
    {"key": "converted", "label": "Converted"},
    {"key": "application_submitted", "label": "Application Submitted"},
    {"key": "admission_confirmed", "label": "Admission Confirmed"},
    {"key": "fee_paid", "label": "Fee Paid"},
    {"key": "completed", "label": "Completed"},
    {"key": "not_turned", "label": "Not Turned"},
    {"key": "lost", "label": "Lost"},
]
CANONICAL_KEYS = [s["key"] for s in CANONICAL_STAGES]
_DEFAULT_LABEL = {s["key"]: s["label"] for s in CANONICAL_STAGES}
PIPELINE_DOC_ID = "pipeline"


def normalize_pipeline(stages):
    """Coerce arbitrary input into the full canonical stage list, in the
    supplied order, with valid labels + hidden flags. Unknown keys are
    dropped and any missing canonical keys are appended in default order so
    the pipeline is always complete (keys never disappear)."""
    seen: dict = {}
    order: list = []
    for s in (stages or []):
        if not isinstance(s, dict):
            continue
        k = (s.get("key") or "").strip()
        if k in CANONICAL_KEYS and k not in seen:
            label = (s.get("label") or "").strip() or _DEFAULT_LABEL[k]
            seen[k] = {"key": k, "label": label, "hidden": bool(s.get("hidden"))}
            order.append(k)
    for k in CANONICAL_KEYS:
        if k not in seen:
            seen[k] = {"key": k, "label": _DEFAULT_LABEL[k], "hidden": False}
            order.append(k)
    return [seen[k] for k in order]


async def get_pipeline_stages():
    doc = await gdb.app_config.find_one({"id": PIPELINE_DOC_ID}, {"_id": 0})
    return normalize_pipeline((doc or {}).get("stages"))


async def save_pipeline_stages(stages):
    norm = normalize_pipeline(stages)
    await gdb.app_config.update_one(
        {"id": PIPELINE_DOC_ID},
        {"$set": {"id": PIPELINE_DOC_ID, "stages": norm}},
        upsert=True,
    )
    return norm
