"""
FastAPI-app för Operation Bredehall 11.
Dashboard, CRUD för uppgifter, filtrering (nästa månad/kvartal/år).
"""
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

from app.database import engine, init_db
from app.middleware.auth import ApiKeyMiddleware
from app.migrations import run_migrations
from app.routers import finance as finance_router
from app.routers import tasks as tasks_router
from app.routers import calendar as calendar_router
from app.routers import ai as ai_router
from app.seed.seed_tasks import seed_if_empty
from app.seed.seed_loans import seed_loans_if_empty

logger = logging.getLogger(__name__)


def _migrate_finance_on_startup() -> None:
    """Persist config renames and fix mis-filed Patrik Nordea transactions."""
    import json

    from app.crud_finance import migrate_el_category, migrate_house_purchase_duplicates, migrate_patrik_lonekonto_transactions
    from app.database import SessionLocal
    from app.services.finance.config import CONFIG_PATH, get_finance_config, migrate_legacy_config, save_finance_config

    if CONFIG_PATH.exists():
        try:
            with open(CONFIG_PATH, encoding="utf-8") as f:
                stored = json.load(f)
            migrated = migrate_legacy_config(dict(stored))
            if migrated.get("folder_map") != stored.get("folder_map") or migrated.get("account_numbers") != stored.get(
                "account_numbers"
            ):
                save_finance_config(migrated)
        except (json.JSONDecodeError, OSError):
            pass
    else:
        get_finance_config()

    from app.services.finance.config import sync_ha_options

    sync_ha_options()

    db = SessionLocal()
    try:
        migrate_patrik_lonekonto_transactions(db)
        migrate_house_purchase_duplicates(db)
        migrate_el_category(db)
    except Exception:
        logger.exception("Finance data migration failed")
        db.rollback()
    finally:
        db.close()

# Sökväg till statiska filer (frontend)
STATIC_DIR = Path(__file__).resolve().parent / "static"
STATIC_DIR.mkdir(parents=True, exist_ok=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Vid start: skapa tabeller, seed om tom, märk interna överföringar."""
    init_db()
    run_migrations(engine)
    seed_if_empty()
    seed_loans_if_empty()
    _migrate_finance_on_startup()
    _tag_internal_transfers_on_startup()
    _sync_finance_categories_static()
    yield


def _sync_finance_categories_static() -> None:
    """Write sorted category list for frontend (works even if API cache is stale)."""
    import json

    from app.services.finance.categorizer import sorted_categories

    path = STATIC_DIR / "data" / "finance-categories.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"categories": sorted_categories()}
    path.write_text(json.dumps({**payload, "count": len(payload["categories"])}, ensure_ascii=False, indent=2), encoding="utf-8")


def _tag_internal_transfers_on_startup() -> None:
    """Backfill: categorise historical transfers between own accounts as
    "Överföring" so they don't count as income/expense. Idempotent and safe to
    run on every boot."""
    from app.crud_finance import detect_internal_transfers
    from app.database import SessionLocal
    from app.services.finance.config import get_finance_config

    cfg = get_finance_config()
    db = SessionLocal()
    try:
        detect_internal_transfers(db, own_accounts_regex=cfg.get("own_accounts_regex") or "")
    except Exception:
        logger.exception("Internal transfer backfill failed")
        db.rollback()
    finally:
        db.close()


app = FastAPI(
    title="Operation Bredehall 11",
    description="Smart underhållsplanerare och ekonomi för villan",
    lifespan=lifespan,
)
app.add_middleware(ApiKeyMiddleware)

app.include_router(finance_router.router)
app.include_router(tasks_router.router)
app.include_router(calendar_router.router)
app.include_router(ai_router.router)

if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/")
def root():
    """Dashboard om index.html finns, annars Hello World."""
    index_file = STATIC_DIR / "index.html"
    if index_file.exists():
        return FileResponse(index_file, media_type="text/html")
    return PlainTextResponse("Hello from Operation Bredehall 11 – underhållsplaneraren kör!")


@app.get("/health", response_class=PlainTextResponse)
def health():
    return "ok"


@app.get("/api/auth/status")
def auth_status():
    from app.middleware.auth import get_app_api_key

    key = get_app_api_key()
    return {"auth_required": bool(key)}
