"""
FastAPI-app för Operation Bredehall 11.
Dashboard, CRUD för uppgifter, filtrering (nästa månad/kvartal/år).
"""
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

from app.database import init_db
from app.routers import tasks as tasks_router
from app.seed.seed_tasks import seed_if_empty

# Sökväg till statiska filer (frontend)
STATIC_DIR = Path(__file__).resolve().parent / "static"
STATIC_DIR.mkdir(parents=True, exist_ok=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Vid start: skapa tabeller, seed om tom."""
    init_db()
    seed_if_empty()
    yield


app = FastAPI(
    title="Operation Bredehall 11",
    description="Smart underhållsplanerare för villan",
    lifespan=lifespan,
)

app.include_router(tasks_router.router)

if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/")
def root():
    """Dashboard om index.html finns, annars Hello World."""
    index_file = STATIC_DIR / "index.html"
    if index_file.exists():
        return FileResponse(index_file, media_type="text/html")
    return PlainTextResponse("Hello from Operation Bredehall 11 – underhållsplaneraren kör!")


@app.get("/health", response_class=PlainTextResponse)
def health():
    return "ok"
