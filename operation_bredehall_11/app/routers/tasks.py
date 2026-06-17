"""API för uppgifter: CRUD + filtrering (nästa månad, kvartal, år)."""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.crud import create_task, delete_task, get_task, get_task_stats, get_tasks, mark_task_complete, update_task
from app.database import get_db
from app.schemas import TaskCreate, TaskResponse, TaskStats, TaskUpdate

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


@router.get("/stats/summary", response_model=TaskStats)
def task_stats(db: Session = Depends(get_db)):
    return get_task_stats(db)


@router.get("", response_model=List[TaskResponse])
def list_tasks(
    view: Optional[str] = None,
    year: Optional[int] = None,
    category: Optional[str] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Lista uppgifter. view: next_month | next_quarter | this_year | overdue | all."""
    v = view.strip() if view else None
    if v == "":
        v = None
    return get_tasks(db, view=v, year=year, category=category, search=search)


@router.get("/{task_id}", response_model=TaskResponse)
def read_task(task_id: int, db: Session = Depends(get_db)):
    task = get_task(db, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Uppgift hittades inte")
    return task


@router.post("", response_model=TaskResponse, status_code=201)
def create_task_endpoint(task: TaskCreate, db: Session = Depends(get_db)):
    return create_task(db, task)


@router.put("/{task_id}", response_model=TaskResponse)
def update_task_endpoint(task_id: int, task: TaskUpdate, db: Session = Depends(get_db)):
    updated = update_task(db, task_id, task)
    if not updated:
        raise HTTPException(status_code=404, detail="Uppgift hittades inte")
    return updated


@router.post("/{task_id}/complete", response_model=TaskResponse)
def complete_task(task_id: int, db: Session = Depends(get_db)):
    updated = mark_task_complete(db, task_id)
    if not updated:
        raise HTTPException(status_code=404, detail="Uppgift hittades inte")
    return updated


@router.delete("/{task_id}", status_code=204)
def delete_task_endpoint(task_id: int, db: Session = Depends(get_db)):
    if not delete_task(db, task_id):
        raise HTTPException(status_code=404, detail="Uppgift hittades inte")
