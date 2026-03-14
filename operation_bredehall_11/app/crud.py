"""CRUD för uppgifter + filtrering (nästa månad, kvartal, år)."""
from datetime import date, timedelta
from typing import List, Optional

from sqlalchemy.orm import Session

from app.models import Task
from app.schemas import TaskCreate, TaskUpdate


def _start_of_next_month(d: date) -> date:
    if d.month == 12:
        return date(d.year + 1, 1, 1)
    return date(d.year, d.month + 1, 1)


def _end_of_quarter(d: date) -> date:
    q = (d.month - 1) // 3 + 1
    end_month = 3 * q
    return date(d.year, end_month, 1)  # första dagen i sista månaden i kvartalet


def get_tasks(
    db: Session,
    view: Optional[str] = None,
    year: Optional[int] = None,
) -> List[Task]:
    """Hämta uppgifter, ev. filtrerade på vy (next_month, next_quarter, this_year) eller år."""
    q = db.query(Task).order_by(Task.next_deadline.asc().nullslast(), Task.title.asc())
    today = date.today()
    use_year = year or today.year

    if view == "next_month":
        end = _start_of_next_month(today) + timedelta(days=31)
        q = q.filter(Task.next_deadline >= today).filter(Task.next_deadline <= end)
    elif view == "next_quarter":
        # ungefär 3 månader fram
        end = today + timedelta(days=92)
        q = q.filter(Task.next_deadline >= today).filter(Task.next_deadline <= end)
    elif view == "this_year":
        q = q.filter(
            Task.next_deadline >= date(use_year, 1, 1),
            Task.next_deadline <= date(use_year, 12, 31),
        )
    # view == "all" eller None: ingen extra filter

    return q.all()


def get_task(db: Session, task_id: int) -> Optional[Task]:
    return db.query(Task).filter(Task.id == task_id).first()


def create_task(db: Session, task: TaskCreate) -> Task:
    today = date.today()
    db_task = Task(
        title=task.title,
        category=task.category,
        frequency=task.frequency,
        last_done=task.last_done,
        next_deadline=task.next_deadline,
        reason=task.reason,
        description=task.description,
        created_at=today,
        updated_at=today,
    )
    db.add(db_task)
    db.commit()
    db.refresh(db_task)
    return db_task


def update_task(db: Session, task_id: int, task: TaskUpdate) -> Optional[Task]:
    db_task = get_task(db, task_id)
    if not db_task:
        return None
    data = task.model_dump(exclude_unset=True)
    data["updated_at"] = date.today()
    for k, v in data.items():
        setattr(db_task, k, v)
    db.commit()
    db.refresh(db_task)
    return db_task


def delete_task(db: Session, task_id: int) -> bool:
    db_task = get_task(db, task_id)
    if not db_task:
        return False
    db.delete(db_task)
    db.commit()
    return True
