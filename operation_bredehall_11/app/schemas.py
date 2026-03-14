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
