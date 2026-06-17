"""Finance API: import, dashboard, transactions, config."""
from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session

from app.crud_finance import (
    apply_category_mapping,
    clear_all_transactions,
    count_transactions,
    delete_transaction,
    get_uncategorized,
    list_transactions,
    recategorize_rules,
)
from app.database import get_db
from app.schemas import (
    FinanceConfigUpdate,
    FinanceFolderCreate,
    FinanceManualCreate,
    FinanceProcessResult,
    FinanceTransactionResponse,
    FinanceUploadResult,
)
from app.services.finance.config import FINANCE_INBOX, get_finance_config, save_finance_config
from app.services.finance.dashboard import build_dashboard, build_meta
from app.services.finance.detect import detect_account
from app.services.finance.processor import process_bank_files
from app.services.finance.upload import create_account_folder, save_upload_to_inbox

router = APIRouter(prefix="/api/finance", tags=["finance"])


@router.get("/config")
def read_config():
    cfg = get_finance_config()
    safe = {k: v for k, v in cfg.items() if k != "gdrive_credentials_path"}
    safe["has_gdrive_credentials"] = bool(cfg.get("gdrive_credentials_path"))
    return safe


@router.put("/config")
def update_config(body: FinanceConfigUpdate):
    cfg = get_finance_config()
    data = body.model_dump(exclude_unset=True)
    cfg.update(data)
    return save_finance_config(cfg)


@router.get("/folders")
def list_folders():
    cfg = get_finance_config()
    folder_map = cfg.get("folder_map") or {}
    folders = []
    for name in sorted(folder_map.keys()):
        inbox = FINANCE_INBOX / name
        pending = len(list(inbox.glob("*.csv"))) if inbox.is_dir() else 0
        folders.append({"name": name, "drive_folder_id": folder_map[name], "pending_files": pending})
    return {"folders": folders, "archive": str(cfg.get("archive_folder_id", ""))}


@router.post("/folders")
def add_folder(body: FinanceFolderCreate):
    try:
        return create_account_folder(body.name, body.drive_folder_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/detect")
async def detect_upload(file: UploadFile = File(...)):
    raw = await file.read()
    try:
        content = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        content = raw.decode("latin-1", errors="replace")
    cfg = get_finance_config()
    accounts = list((cfg.get("folder_map") or {}).keys())
    result = detect_account(file.filename or "upload.csv", content, accounts)
    return result


@router.post("/upload", response_model=FinanceUploadResult)
async def upload_csv(
    file: UploadFile = File(...),
    account: Optional[str] = Form(None),
    auto_process: bool = Form(True),
    db: Session = Depends(get_db),
):
    raw = await file.read()
    filename = file.filename or "upload.csv"
    try:
        content = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        content = raw.decode("latin-1", errors="replace")

    cfg = get_finance_config()
    accounts = list((cfg.get("folder_map") or {}).keys())
    detection = detect_account(filename, content, accounts)
    auto_detected = False

    chosen = (account or "").strip()
    if not chosen:
        if detection.get("auto_detected") and detection.get("detected_account"):
            chosen = detection["detected_account"]
            auto_detected = True
        else:
            raise HTTPException(
                status_code=422,
                detail={
                    "message": "Kunde inte avgöra konto automatiskt. Ange account.",
                    "detection": detection,
                },
            )

    if chosen not in accounts:
        create_account_folder(chosen)
        accounts.append(chosen)

    saved = save_upload_to_inbox(chosen, filename, raw)
    process_result = None
    if auto_process:
        process_result = FinanceProcessResult(**process_bank_files(db))

    return FinanceUploadResult(
        ok=True,
        account=chosen,
        filename=saved["filename"],
        auto_detected=auto_detected,
        detection=detection,
        process=process_result,
    )


@router.post("/process", response_model=FinanceProcessResult)
def run_process(db: Session = Depends(get_db)):
    result = process_bank_files(db)
    return FinanceProcessResult(**result)


def _parse_date(val: Optional[str]) -> Optional[date]:
    if not val:
        return None
    try:
        return date.fromisoformat(val[:10])
    except ValueError:
        return None


@router.get("/meta")
def finance_meta(db: Session = Depends(get_db)):
    return build_meta(db)


@router.get("/dashboard")
def dashboard(
    year: Optional[int] = None,
    account: Optional[str] = None,
    category: Optional[str] = None,
    typ: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    exclude_overforing: bool = False,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
):
    return build_dashboard(
        db,
        year=year,
        account=account or None,
        category=category or None,
        typ=typ or None,
        date_from=_parse_date(date_from),
        date_to=_parse_date(date_to),
        exclude_overforing=exclude_overforing,
        search=search or None,
    )


@router.get("/transactions")
def transactions(
    account: Optional[str] = None,
    category: Optional[str] = None,
    typ: Optional[str] = None,
    year: Optional[int] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    search: Optional[str] = None,
    exclude_overforing: bool = False,
    sort_by: str = Query("txn_date", pattern="^(txn_date|amount|description|account|category)$"),
    sort_dir: str = Query("desc", pattern="^(asc|desc)$"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    df, dt = _parse_date(date_from), _parse_date(date_to)
    filters = dict(
        account=account, category=category, typ=typ, year=year,
        date_from=df, date_to=dt, search=search, exclude_overforing=exclude_overforing,
    )
    items = list_transactions(db, sort_by=sort_by, sort_dir=sort_dir, limit=limit, offset=offset, **filters)
    total = count_transactions(db, **filters)
    return {"total": total, "offset": offset, "limit": limit, "items": items}


@router.post("/manual", response_model=FinanceTransactionResponse, status_code=201)
def create_manual(body: FinanceManualCreate, db: Session = Depends(get_db)):
    from app.crud_finance import create_transaction
    from app.services.finance.categorizer import enrich_transaction
    from app.services.finance.config import get_finance_config

    cfg = get_finance_config()
    row = body.model_dump()
    row["is_manual"] = True
    row["manual_category"] = row.pop("category", None)
    row["source_file"] = None
    row["sender"] = None
    row["receiver"] = None
    enrich_transaction(row, cfg.get("own_accounts_regex") or "")
    return create_transaction(db, row)


@router.delete("/transactions/{txn_id}", status_code=204)
def remove_transaction(txn_id: int, db: Session = Depends(get_db)):
    if not delete_transaction(db, txn_id):
        raise HTTPException(status_code=404, detail="Transaktion hittades inte")


@router.delete("/transactions", status_code=200)
def wipe_transactions(db: Session = Depends(get_db)):
    count = clear_all_transactions(db)
    return {"deleted": count}


@router.post("/recategorize")
def recategorize(
    method: str = Query("rules", pattern="^(rules|ai)$"),
    only_ovrigt: bool = False,
    db: Session = Depends(get_db),
):
    cfg = get_finance_config()
    if method == "rules":
        changed = recategorize_rules(db, cfg.get("own_accounts_regex") or "", only_ovrigt=only_ovrigt)
        return {"ok": True, "method": "rules", "changed": changed}

    # AI method
    from app.services.finance.ai_finance import categorize_with_ai

    rows = get_uncategorized(db)
    if not rows:
        return {"ok": True, "method": "ai", "changed": 0, "message": "Inga okategoriserade transaktioner."}
    payload = [
        {"id": t.id, "description": t.description, "amount": t.amount, "typ": t.typ}
        for t in rows
    ]
    result = categorize_with_ai(payload, cfg)
    if not result["ok"]:
        raise HTTPException(status_code=502, detail={"message": "AI-kategorisering misslyckades", "errors": result.get("errors")})
    changed = apply_category_mapping(db, result["mapping"])
    return {
        "ok": True,
        "method": "ai",
        "changed": changed,
        "processed": result.get("used", 0),
        "errors": result.get("errors", []),
    }


@router.get("/ai/test")
def ai_test():
    from app.services.finance.ai_finance import test_connection

    return test_connection(get_finance_config())
