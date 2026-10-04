"""Finance API: import, dashboard, transactions, config."""
import os
from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session

from app.crud_finance import (
    apply_category_mapping,
    category_stats,
    clear_all_transactions,
    count_transactions,
    count_uncategorized,
    create_loan,
    delete_loan,
    delete_transaction,
    detect_internal_transfers,
    get_uncategorized,
    list_loans,
    list_locked_transactions,
    list_transactions,
    migrate_el_category,
    sum_transactions,
    sum_loans,
    update_loan,
    similar_transaction_info,
    update_transaction_category,
    upsert_loans,
)
from app.database import get_db
from app.schemas import (
    FinanceActivityLogListResponse,
    FinanceActivityLogResponse,
    FinanceAiApplyRequest,
    FinanceAiReviewedItem,
    FinanceAiReviewedListResponse,
    FinanceCategoryUpdate,
    FinanceCategoryUpdateResponse,
    FinanceSimilarTransactionsResponse,
    FinanceConfigUpdate,
    FinanceFolderCreate,
    FinanceLoanCreate,
    FinanceLoanParseTextRequest,
    FinanceLoanResponse,
    FinanceLoanUpdate,
    FinanceLoanUpsertRequest,
    FinanceManualCreate,
    FinanceProcessResult,
    FinanceTransactionResponse,
    FinanceUploadResult,
)
from app.services.finance.categorizer import CATEGORIES, sorted_categories
from app.services.finance.config import FINANCE_INBOX, get_finance_config, save_finance_config
from app.services.finance.dashboard import build_account_compare, build_dashboard, build_hero, build_meta
from app.services.finance.detect import detect_account
from app.services.finance.processor import process_bank_files
from app.services.finance.activity_log import (
    list_activity_log,
    log_finance_activity,
    parse_activity_details,
)
from app.services.finance.upload import create_account_folder, save_upload_to_inbox

router = APIRouter(prefix="/api/finance", tags=["finance"])

_MAX_UPLOAD_BYTES = 10 * 1024 * 1024


async def _read_upload_limited(file: UploadFile, max_bytes: int = _MAX_UPLOAD_BYTES) -> bytes:
    raw = await file.read()
    if len(raw) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"Filen är för stor (max {max_bytes // (1024 * 1024)} MB).",
        )
    return raw


def _require_ai_enabled(cfg: dict) -> None:
    if not cfg.get("ai_enabled"):
        raise HTTPException(status_code=403, detail="AI-kategorisering är avstängd i inställningarna.")


@router.get("/config")
def read_config():
    cfg = get_finance_config()
    safe = {k: v for k, v in cfg.items() if k not in ("gdrive_credentials_path", "ai_api_key")}
    safe["has_gdrive_credentials"] = bool(cfg.get("gdrive_credentials_path"))
    safe["has_ai_api_key"] = bool((cfg.get("ai_api_key") or "").strip())
    return safe


@router.put("/config")
def update_config(body: FinanceConfigUpdate):
    cfg = get_finance_config()
    data = body.model_dump(exclude_unset=True)
    ai_key = data.pop("ai_api_key", None)
    if ai_key is not None and ai_key.strip() and ai_key.strip() != "__UNCHANGED__":
        cfg["ai_api_key"] = ai_key.strip()
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
        account_numbers = cfg.get("account_numbers") or {}
        folders.append({
            "name": name,
            "account_number": (account_numbers.get(name) or "").strip(),
            "drive_folder_id": folder_map[name],
            "pending_files": pending,
        })
    return {"folders": folders, "archive": str(cfg.get("archive_folder_id", ""))}


@router.post("/folders")
def add_folder(body: FinanceFolderCreate, db: Session = Depends(get_db)):
    try:
        result = create_account_folder(body.name, body.drive_folder_id)
        if result.get("created"):
            log_finance_activity(
                db,
                event_type="account_created",
                account=body.name.strip(),
                summary=f"Nytt konto skapat: {body.name.strip()}",
            )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("/activity-log", response_model=FinanceActivityLogListResponse)
def read_activity_log(
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    event_type: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    rows, total = list_activity_log(db, limit=limit, offset=offset, event_type=event_type)
    items = []
    for r in rows:
        item = FinanceActivityLogResponse.model_validate(r)
        item.details = parse_activity_details(r.details)
        items.append(item)
    return FinanceActivityLogListResponse(
        total=total,
        offset=offset,
        limit=limit,
        items=items,
    )


@router.post("/detect")
async def detect_upload(file: UploadFile = File(...)):
    raw = await _read_upload_limited(file)
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
    raw = await _read_upload_limited(file)
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
        cfg = get_finance_config()
        accounts = list((cfg.get("folder_map") or {}).keys())

    saved = save_upload_to_inbox(chosen, filename, raw)
    process_result = None
    if auto_process:
        trusted = {f"{chosen}/{saved['filename']}"}
        process_result = FinanceProcessResult(**process_bank_files(db, trusted_keys=trusted))

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


@router.get("/hero")
def finance_hero(exclude_internal: bool = True, db: Session = Depends(get_db)):
    return build_hero(db, exclude_internal=exclude_internal)


@router.post("/detect-transfers")
def detect_transfers(db: Session = Depends(get_db)):
    """Re-scan all transactions and tag transfers between own accounts."""
    cfg = get_finance_config()
    changed = detect_internal_transfers(db, own_accounts_regex=cfg.get("own_accounts_regex") or "")
    return {"ok": True, "internal_transfers": changed}


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
    max_amount: Optional[float] = None,
    chart_max_amount: Optional[float] = 100000,
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
        max_amount=max_amount,
        chart_max_amount=chart_max_amount,
    )


@router.get("/transactions")
def transactions(
    account: Optional[str] = None,
    accounts: Optional[str] = Query(None, description="Kommaseparerade konton (jämförelse)"),
    category: Optional[str] = None,
    categories: Optional[str] = Query(None, description="Kommaseparerade kategorier"),
    flow: Optional[str] = Query(None, pattern="^(expense|income)$"),
    typ: Optional[str] = None,
    year: Optional[int] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    search: Optional[str] = None,
    exclude_overforing: bool = False,
    max_amount: Optional[float] = None,
    chart_max_amount: Optional[float] = None,
    chart_exclusions: bool = False,
    sort_by: str = Query("txn_date", pattern="^(txn_date|amount|description|account|category)$"),
    sort_dir: str = Query("desc", pattern="^(asc|desc)$"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    df, dt = _parse_date(date_from), _parse_date(date_to)
    acct_list = [a.strip() for a in accounts.split(",") if a.strip()] if accounts else None
    cat_list = [c.strip() for c in categories.split(",") if c.strip()] if categories else None
    filters = dict(
        account=account if not acct_list else None,
        accounts=acct_list,
        category=category if not cat_list else None,
        categories=cat_list,
        flow=flow,
        typ=typ,
        year=year,
        date_from=df,
        date_to=dt,
        search=search,
        exclude_overforing=exclude_overforing,
        max_amount=max_amount,
        chart_max_amount=chart_max_amount,
        chart_exclusions=chart_exclusions,
    )
    items = list_transactions(db, sort_by=sort_by, sort_dir=sort_dir, limit=limit, offset=offset, **filters)
    total = count_transactions(db, **filters)
    sum_amount = sum_transactions(db, **filters)
    return {"total": total, "offset": offset, "limit": limit, "sum_amount": sum_amount, "items": items}


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
    txn = create_transaction(db, row)
    log_finance_activity(
        db,
        event_type="manual_txn",
        account=body.account,
        transaction_count=1,
        summary=f"Manuell transaktion: {body.description or 'utan beskrivning'} → {body.account}",
        details={"amount": body.amount, "txn_date": str(body.txn_date)},
    )
    return txn


@router.delete("/transactions/{txn_id}", status_code=204)
def remove_transaction(txn_id: int, db: Session = Depends(get_db)):
    if not delete_transaction(db, txn_id):
        raise HTTPException(status_code=404, detail="Transaktion hittades inte")


@router.delete("/transactions", status_code=200, include_in_schema=False)
def wipe_transactions(db: Session = Depends(get_db)):
    if os.environ.get("ALLOW_WIPE") != "1":
        raise HTTPException(status_code=404, detail="Not found")
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
        el = migrate_el_category(db)
        internal = detect_internal_transfers(db, own_accounts_regex=cfg.get("own_accounts_regex") or "")
        return {
            "ok": True,
            "method": "rules",
            "changed": changed + el["retagged_el"],
            "rules_changed": changed,
            "el_retagged": el["retagged_el"],
            "internal_transfers": internal,
        }

    _require_ai_enabled(cfg)
    from app.services.finance.ai_finance import categorize_with_ai

    rows = get_uncategorized(db)
    if not rows:
        return {"ok": True, "method": "ai", "changed": 0, "message": "Inga okategoriserade transaktioner."}
    payload = [
        {"id": t.id, "description": t.description, "amount": t.amount, "typ": t.typ}
        for t in rows
    ]
    result = categorize_with_ai(payload, cfg)
    if not result["ok"] and not result.get("mapping"):
        raise HTTPException(status_code=502, detail={"message": "AI-kategorisering misslyckades", "errors": result.get("errors")})
    apply_result = apply_category_mapping(
        db,
        result["mapping"],
        lock_ids=[t["id"] for t in payload],
    )
    return {
        "ok": True,
        "method": "ai",
        "changed": apply_result["changed"],
        "by_category": apply_result["by_category"],
        "processed": result.get("used", 0),
        "skipped_uncertain": result.get("skipped", 0),
        "errors": result.get("errors", []),
    }


@router.get("/categories")
def list_categories():
    return {"categories": sorted_categories()}


@router.get("/compare")
def compare_accounts(
    account_a: str = Query(..., min_length=1),
    account_b: str = Query(..., min_length=1),
    categories: Optional[str] = Query(None, description="Kommaseparerade kategorier, tom = alla utgifter"),
    year: Optional[int] = None,
    month_from: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}$"),
    month_to: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}$"),
    months: int = Query(12, ge=1, le=60),
    exclude_overforing: bool = True,
    chart_max_amount: Optional[float] = Query(100000, ge=0),
    db: Session = Depends(get_db),
):
    cat_list = [c.strip() for c in categories.split(",")] if categories else None
    result = build_account_compare(
        db,
        account_a=account_a,
        account_b=account_b,
        categories=cat_list,
        year=year,
        month_from=month_from,
        month_to=month_to,
        months=months,
        exclude_overforing=exclude_overforing,
        chart_max_amount=chart_max_amount,
    )
    if result.get("error"):
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@router.get("/categories/stats")
def categories_stats(
    year: Optional[int] = None,
    month: Optional[int] = None,
    account: Optional[str] = None,
    expenses_only: bool = True,
    exclude_overforing: bool = False,
    db: Session = Depends(get_db),
):
    return {
        "year": year,
        "month": month,
        "account": account,
        "items": category_stats(
            db,
            year=year,
            month=month,
            account=account or None,
            expenses_only=expenses_only,
            exclude_overforing=exclude_overforing,
        ),
    }


@router.get("/transactions/{txn_id}/similar", response_model=FinanceSimilarTransactionsResponse)
def get_similar_transactions(txn_id: int, db: Session = Depends(get_db)):
    info = similar_transaction_info(db, txn_id)
    if not info:
        raise HTTPException(status_code=404, detail="Transaktion hittades inte")
    return info


@router.patch("/transactions/{txn_id}/category", response_model=FinanceCategoryUpdateResponse)
def patch_transaction_category(
    txn_id: int,
    body: FinanceCategoryUpdate,
    db: Session = Depends(get_db),
):
    if body.category not in CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Ogiltig kategori. Välj en av: {', '.join(CATEGORIES)}")
    updated, updated_count = update_transaction_category(
        db, txn_id, body.category, apply_to_similar=body.apply_to_similar
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Transaktion hittades inte")
    return FinanceCategoryUpdateResponse(transaction=updated, updated_count=updated_count)


@router.get("/ai/queue")
def ai_queue(db: Session = Depends(get_db)):
    total = count_uncategorized(db)
    preview = get_uncategorized(db, limit=5, offset=0)
    return {
        "total": total,
        "preview": [
            {"id": t.id, "description": t.description, "amount": t.amount, "txn_date": t.txn_date.isoformat()}
            for t in preview
        ],
    }


@router.post("/ai/batch")
def ai_batch(
    limit: Optional[int] = Query(None, ge=1, le=30),
    db: Session = Depends(get_db),
):
    from app.services.finance.ai_finance import categorize_batch, get_ai_settings

    cfg = get_finance_config()
    _require_ai_enabled(cfg)
    settings = get_ai_settings(cfg)
    batch_limit = limit if limit is not None else settings["batch_size"]
    rows = get_uncategorized(db, limit=batch_limit, offset=0)
    # Always take from start — applied/locked rows leave queue automatically
    if not rows:
        return {
            "ok": True,
            "done": True,
            "remaining": 0,
            "mapping": {},
            "preview": [],
            "errors": [],
            "batch_size": 0,
            "elapsed_seconds": 0,
        }

    payload = [{"id": t.id, "description": t.description, "amount": t.amount, "typ": t.typ} for t in rows]
    by_id = {t.id: t for t in rows}
    result = categorize_batch(payload, cfg)
    apply_result = {"changed": 0, "by_category": {}, "locked": 0}
    if result.get("ok"):
        log_items = []
        for p in result.get("preview") or []:
            tid = int(p.get("id"))
            t = by_id.get(tid)
            if not t:
                continue
            cat = str(p.get("category") or "Övrigt")
            conf = p.get("confidence")
            try:
                conf_val = round(float(conf), 2) if conf is not None else None
            except (TypeError, ValueError):
                conf_val = None
            log_items.append({
                "transaction_id": tid,
                "description": t.description or "",
                "amount": float(t.amount),
                "txn_date": t.txn_date.isoformat() if t.txn_date else None,
                "account": t.account,
                "previous_category": t.category,
                "category": cat,
                "confidence": conf_val,
                "is_ovrigt": cat == "Övrigt",
                "locked": True,
            })
        apply_result = apply_category_mapping(
            db,
            result.get("mapping") or {},
            lock_ids=result.get("reviewed_ids") or [t.id for t in rows],
        )
        if log_items:
            ovrigt_n = sum(1 for i in log_items if i["is_ovrigt"])
            changed_n = len(log_items) - ovrigt_n
            log_finance_activity(
                db,
                event_type="ai_categorize",
                summary=(
                    f"AI granskade {len(log_items)} transaktioner: "
                    f"{changed_n} kategoriserade, {ovrigt_n} lämnades som Övrigt"
                ),
                transaction_count=changed_n,
                skipped_count=ovrigt_n,
                details={"items": log_items},
            )
    remaining = count_uncategorized(db)
    return {
        "ok": result["ok"],
        "done": remaining == 0 and result["ok"],
        "remaining": remaining,
        "batch_size": len(payload),
        "changed": apply_result["changed"],
        "by_category": apply_result["by_category"],
        "locked": apply_result.get("locked", 0),
        "skipped_uncertain": result.get("skipped", []),
        "preview": result.get("preview", []),
        "current": payload[0]["description"][:80] if payload else "",
        "errors": result.get("errors", []),
        "elapsed_seconds": result.get("elapsed_seconds", 0),
        "timeout_seconds": settings["timeout_seconds"],
    }


@router.get("/ai/reviewed", response_model=FinanceAiReviewedListResponse)
def ai_reviewed(
    only_ovrigt: bool = Query(False),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """Browse locked non-manual transactions (past AI reviews without per-run log)."""
    rows, total = list_locked_transactions(
        db, only_ovrigt=only_ovrigt, limit=limit, offset=offset
    )
    return FinanceAiReviewedListResponse(
        total=total,
        offset=offset,
        limit=limit,
        items=[
            FinanceAiReviewedItem(
                id=t.id,
                txn_date=t.txn_date,
                description=t.description or "",
                amount=float(t.amount),
                account=t.account,
                category=t.category,
                category_locked=bool(getattr(t, "category_locked", False)),
                is_ovrigt=t.category == "Övrigt",
            )
            for t in rows
        ],
    )


@router.post("/ai/apply")
def ai_apply(body: FinanceAiApplyRequest, db: Session = Depends(get_db)):
    apply_result = apply_category_mapping(db, body.mapping)
    return {
        "ok": True,
        "changed": apply_result["changed"],
        "by_category": apply_result["by_category"],
        "remaining": count_uncategorized(db),
    }


@router.get("/ai/test")
def ai_test():
    from app.services.finance.ai_finance import test_connection

    cfg = get_finance_config()
    _require_ai_enabled(cfg)
    return test_connection(cfg)


def _loan_to_dict(loan) -> dict:
    return {
        "id": loan.id,
        "label": loan.label,
        "account_number": loan.account_number,
        "amount": round(loan.amount, 2),
        "typ": loan.typ,
        "notes": loan.notes,
        "updated_at": loan.updated_at.isoformat() if loan.updated_at else None,
    }


@router.get("/loans")
def loans_list(db: Session = Depends(get_db)):
    items = list_loans(db)
    total = sum_loans(db)
    return {
        "total_debt": total,
        "count": len(items),
        "items": [_loan_to_dict(l) for l in items],
    }


@router.post("/loans", response_model=FinanceLoanResponse, status_code=201)
def loans_create(body: FinanceLoanCreate, db: Session = Depends(get_db)):
    from app.models import FinanceLoan

    account = body.account_number.strip()
    if not account:
        raise HTTPException(status_code=400, detail="Kontonummer krävs.")
    if body.amount <= 0:
        raise HTTPException(status_code=400, detail="Belopp måste vara positivt.")
    existing = db.query(FinanceLoan).filter(FinanceLoan.account_number == account).first()
    if existing:
        raise HTTPException(status_code=409, detail="Lån med detta kontonummer finns redan.")
    return create_loan(db, body.model_dump())


@router.put("/loans/{loan_id}", response_model=FinanceLoanResponse)
def loans_update(loan_id: int, body: FinanceLoanUpdate, db: Session = Depends(get_db)):
    data = body.model_dump(exclude_unset=True)
    if "amount" in data and data["amount"] is not None and data["amount"] <= 0:
        raise HTTPException(status_code=400, detail="Belopp måste vara positivt.")
    updated = update_loan(db, loan_id, data)
    if not updated:
        raise HTTPException(status_code=404, detail="Lån hittades inte")
    return updated


@router.delete("/loans/{loan_id}", status_code=204)
def loans_delete(loan_id: int, db: Session = Depends(get_db)):
    if not delete_loan(db, loan_id):
        raise HTTPException(status_code=404, detail="Lån hittades inte")


@router.post("/loans/parse-text")
def loans_parse_text(body: FinanceLoanParseTextRequest):
    from app.services.finance.ai_finance import parse_loans_from_text

    cfg = get_finance_config()
    _require_ai_enabled(cfg)
    return parse_loans_from_text(body.text, cfg)


@router.post("/loans/parse-image")
async def loans_parse_image(file: UploadFile = File(...)):
    from app.services.finance.ai_finance import parse_loans_from_image

    raw = await _read_upload_limited(file)
    mime = file.content_type or "image/png"
    cfg = get_finance_config()
    return parse_loans_from_image(raw, mime, cfg)


@router.post("/loans/upsert")
def loans_upsert(body: FinanceLoanUpsertRequest, db: Session = Depends(get_db)):
    rows = [item.model_dump() for item in body.loans]
    if not rows:
        raise HTTPException(status_code=400, detail="Inga lån att spara.")
    for row in rows:
        if row["amount"] <= 0:
            raise HTTPException(status_code=400, detail="Alla belopp måste vara positiva.")
    result = upsert_loans(db, rows)
    return {
        "ok": True,
        "created": result["created"],
        "updated": result["updated"],
        "total_debt": result["total_debt"],
        "items": [_loan_to_dict(l) for l in result["items"]],
    }
