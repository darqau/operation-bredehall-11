"""API för AI-assistent: analysera plan, sök bidrag."""
from typing import List

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.crud import create_task, get_tasks
from app.database import get_db
from app.schemas import TaskCreate
from app.services.ai import analyze_plan, search_grants

router = APIRouter(prefix="/api/ai", tags=["ai"])


class SuggestionItem(BaseModel):
    title: str
    category: str
    frequency: str
    reason: str | None = None


@router.post("/analyze-plan")
def post_analyze_plan(db: Session = Depends(get_db)):
    """Hämta alla uppgifter, skicka till LLM, returnera analys + förslag. Frontend kan sedan anropa POST /api/ai/add-suggestions med valda förslag."""
    tasks = get_tasks(db, view=None, year=None)
    task_dicts = [
        {
            "title": t.title,
            "category": t.category,
            "frequency": t.frequency,
            "next_deadline": str(t.next_deadline) if t.next_deadline else None,
            "reason": t.reason,
            "description": t.description,
        }
        for t in tasks
    ]
    return analyze_plan(task_dicts)


@router.post("/add-suggestions")
def post_add_suggestions(items: List[SuggestionItem], db: Session = Depends(get_db)):
    """Lägg till AI-förslag som nya uppgifter i databasen."""
    created = []
    for it in items:
        task = create_task(
            db,
            TaskCreate(
                title=it.title,
                category=it.category,
                frequency=it.frequency,
                reason=it.reason,
            ),
        )
        created.append({"id": task.id, "title": task.title})
    return {"added": len(created), "tasks": created}


@router.post("/search-grants")
def post_search_grants():
    """LLM söker/sammanställer info om svenska bidrag för husägare."""
    return search_grants()
