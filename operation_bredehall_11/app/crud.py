"""CRUD för uppgifter + filtrering (nästa månad, kvartal, år)."""
from datetime import date, datetime, timedelta
from typing import List, Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models import Task, TaskCompletion
from app.schemas import TaskCreate, TaskStats, TaskUpdate


def _start_of_next_month(d: date) -> date:
    if d.month == 12:
        return date(d.year + 1, 1, 1)
    return date(d.year, d.month + 1, 1)


def _end_of_month(d: date) -> date:
    if d.month == 12:
        return date(d.year, 12, 31)
    nxt = _start_of_next_month(d)
    return nxt - timedelta(days=1)


def _end_of_quarter(d: date) -> date:
    q = (d.month - 1) // 3 + 1
    end_month = 3 * q
    if end_month == 12:
        return date(d.year, 12, 31)
    return _end_of_month(date(d.year, end_month, 1))


def _add_months(d: date, months: int) -> date:
    month = d.month - 1 + months
    year = d.year + month // 12
    month = month % 12 + 1
    day = min(d.day, _end_of_month(date(year, month, 1)).day)
    return date(year, month, day)


def compute_next_deadline(frequency: str, from_date: Optional[date] = None) -> Optional[date]:
    base = from_date or date.today()
    mapping = {
        "Månatlig": lambda: _add_months(base, 1),
        "Kvartalsvis": lambda: _add_months(base, 3),
        "Varannan termin": lambda: _add_months(base, 6),
        "Årlig": lambda: date(base.year + 1, base.month, min(base.day, 28)),
        "Vart 2:a år": lambda: date(base.year + 2, base.month, min(base.day, 28)),
        "Vart 3:e år": lambda: date(base.year + 3, base.month, min(base.day, 28)),
        "Vart 5:e år": lambda: date(base.year + 5, base.month, min(base.day, 28)),
        "En gång": lambda: None,
        "Vid behov": lambda: None,
    }
    fn = mapping.get(frequency)
    return fn() if fn else None


def get_tasks(
    db: Session,
    view: Optional[str] = None,
    year: Optional[int] = None,
    category: Optional[str] = None,
    search: Optional[str] = None,
) -> List[Task]:
    """Hämta uppgifter, ev. filtrerade på vy, år, kategori eller söktext."""
    q = db.query(Task).order_by(Task.next_deadline.asc().nullslast(), Task.title.asc())
    today = date.today()
    use_year = year or today.year

    if view == "next_month":
        start = _start_of_next_month(today)
        end = _end_of_month(start)
        q = q.filter(Task.next_deadline >= today, Task.next_deadline <= end)
    elif view == "next_quarter":
        end = _end_of_quarter(today)
        q = q.filter(Task.next_deadline >= today, Task.next_deadline <= end)
    elif view == "this_year":
        q = q.filter(
            Task.next_deadline >= date(use_year, 1, 1),
            Task.next_deadline <= date(use_year, 12, 31),
        )
    elif view == "overdue":
        q = q.filter(Task.next_deadline.isnot(None), Task.next_deadline < today)

    if category:
        q = q.filter(Task.category == category)
    if search:
        term = f"%{search.strip()}%"
        q = q.filter(Task.title.ilike(term))

    return q.all()


def get_task_stats(db: Session) -> TaskStats:
    today = date.today()
    week_end = today + timedelta(days=7)
    month_end = _end_of_month(today)
    all_tasks = db.query(Task).all()
    overdue = sum(1 for t in all_tasks if t.next_deadline and t.next_deadline < today)
    due_week = sum(
        1 for t in all_tasks if t.next_deadline and today <= t.next_deadline <= week_end
    )
    due_month = sum(
        1 for t in all_tasks if t.next_deadline and today <= t.next_deadline <= month_end
    )
    completed = sum(1 for t in all_tasks if t.last_done is not None)
    return TaskStats(
        total=len(all_tasks),
        overdue=overdue,
        due_this_week=due_week,
        due_this_month=due_month,
        completed=completed,
    )


def mark_task_complete(
    db: Session,
    task_id: int,
    completed_by: str = "",
    note: Optional[str] = None,
    completed_on: Optional[date] = None,
) -> Optional[Task]:
    db_task = get_task(db, task_id)
    if not db_task:
        return None
    done_date = completed_on or date.today()
    db_task.last_done = done_date
    db_task.next_deadline = compute_next_deadline(db_task.frequency, done_date)
    db_task.updated_at = date.today()

    log = TaskCompletion(
        task_id=db_task.id,
        task_title=db_task.title,
        category=db_task.category,
        completed_by=(completed_by or "").strip() or "Okänd",
        note=(note or "").strip() or None,
        completed_at=datetime.combine(done_date, datetime.utcnow().time()),
    )
    db.add(log)
    db.commit()
    db.refresh(db_task)
    return db_task


def list_completions(
    db: Session,
    search: Optional[str] = None,
    limit: int = 200,
) -> List[TaskCompletion]:
    q = db.query(TaskCompletion).order_by(TaskCompletion.completed_at.desc())
    if search:
        term = f"%{search.strip()}%"
        q = q.filter(
            or_(
                TaskCompletion.task_title.ilike(term),
                TaskCompletion.completed_by.ilike(term),
                TaskCompletion.note.ilike(term),
            )
        )
    return q.limit(limit).all()


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
