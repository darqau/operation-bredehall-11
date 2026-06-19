"""Pydantic-schemas för API (request/response)."""
from datetime import date, datetime
from typing import List, Optional

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


class TaskCompleteRequest(BaseModel):
    completed_by: str = ""
    note: Optional[str] = None
    completed_at: Optional[date] = None


class TaskCompletionResponse(BaseModel):
    id: int
    task_id: Optional[int] = None
    task_title: str
    category: Optional[str] = None
    completed_by: str
    note: Optional[str] = None
    completed_at: datetime

    model_config = ConfigDict(from_attributes=True)


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
    account_numbers: Optional[dict] = None
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
    transactions_skipped: int = 0
    processed: list
    errors: list
    internal_transfers: int = 0


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


class FinanceCategoryUpdate(BaseModel):
    category: str


class FinanceAiApplyRequest(BaseModel):
    mapping: dict


class FinanceLoanBase(BaseModel):
    label: str = "Bolån"
    account_number: str
    amount: float
    typ: str = "bolån"
    notes: Optional[str] = None


class FinanceLoanCreate(FinanceLoanBase):
    pass


class FinanceLoanUpdate(BaseModel):
    label: Optional[str] = None
    account_number: Optional[str] = None
    amount: Optional[float] = None
    typ: Optional[str] = None
    notes: Optional[str] = None


class FinanceLoanResponse(FinanceLoanBase):
    id: int
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class FinanceLoanParseTextRequest(BaseModel):
    text: str


class FinanceLoanUpsertItem(BaseModel):
    label: str = "Bolån"
    account_number: str
    amount: float
    typ: str = "bolån"
    notes: Optional[str] = None


class FinanceLoanUpsertRequest(BaseModel):
    loans: List["FinanceLoanUpsertItem"]
