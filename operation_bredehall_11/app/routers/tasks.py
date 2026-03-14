"""API för uppgifter: CRUD + filtrering (nästa månad, kvartal, år)."""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.crud import create_task, delete_task, get_task, get_tasks, update_task
from app.database import get_db
from app.schemas import TaskCreate, TaskResponse, TaskUpdate

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


@router.get("", response_model=List[TaskResponse])
def list_tasks(
    view: Optional[str] = None,
    year: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """Lista uppgifter. view: next_month | next_quarter | this_year | all. year för this_year (default: innevarande år)."""
    return get_tasks(db, view=view, year=year)


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


@router.delete("/{task_id}", status_code=204)
def delete_task_endpoint(task_id: int, db: Session = Depends(get_db)):
    if not delete_task(db, task_id):
        raise HTTPException(status_code=404, detail="Uppgift hittades inte")
