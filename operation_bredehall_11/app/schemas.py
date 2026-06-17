"""Pydantic-schemas för API (request/response)."""
from datetime import date
from typing import Optional

from pydantic import BaseModel, ConfigDict


class TaskBase(BaseModel):
    title: str
    category: str
    frequency: str
    last_done: Optional[date] = None
    next_deadline: Optional[date] = None
    reason: Optional[str] = None
    description: Optional[str] = None


class TaskCreate(TaskBase):
    pass


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    category: Optional[str] = None
    frequency: Optional[str] = None
    last_done: Optional[date] = None
    next_deadline: Optional[date] = None
    reason: Optional[str] = None
    description: Optional[str] = None


class TaskResponse(TaskBase):
    id: int
    created_at: Optional[date] = None
    updated_at: Optional[date] = None

    model_config = ConfigDict(from_attributes=True)


class TaskStats(BaseModel):
    total: int
    overdue: int
    due_this_week: int
    due_this_month: int
    completed: int


class FinanceTransactionResponse(BaseModel):
    id: int
    txn_date: date
    amount: float
    description: str
    balance: Optional[float] = None
    account: str
    typ: str
    category: str
    currency: str
    source_file: Optional[str] = None
    is_manual: bool

    model_config = ConfigDict(from_attributes=True)


class FinanceManualCreate(BaseModel):
    txn_date: date
    amount: float
    description: str = ""
    account: str
    balance: Optional[float] = None
    category: Optional[str] = None
    currency: str = "SEK"


class FinanceConfigUpdate(BaseModel):
    storage_mode: Optional[str] = None
    folder_map: Optional[dict] = None
    archive_folder_id: Optional[str] = None
    gdrive_credentials_path: Optional[str] = None
    own_accounts_regex: Optional[str] = None
    csv_delimiter: Optional[str] = None
    ai_enabled: Optional[bool] = None
    ai_base_url: Optional[str] = None
    ai_api_key: Optional[str] = None
    ai_model: Optional[str] = None


class FinanceProcessResult(BaseModel):
    ok: bool
    mode: str
    files_processed: int
    transactions_added: int
    processed: list
    errors: list


class FinanceFolderCreate(BaseModel):
    name: str
    drive_folder_id: str = ""


class FinanceUploadResult(BaseModel):
    ok: bool
    account: str
    filename: str
    auto_detected: bool
    detection: Optional[dict] = None
    process: Optional[FinanceProcessResult] = None
