"""
FastAPI-app för Operation Bredehall 11.
Steg 1: Hello World + initiering av databas.
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import PlainTextResponse

from app.database import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Vid start: skapa tabeller om de inte finns."""
    init_db()
    yield
    # Vid shutdown kan ev. städning göras här


app = FastAPI(
    title="Operation Bredehall 11",
    description="Smart underhållsplanerare för villan",
    lifespan=lifespan,
)


@app.get("/", response_class=PlainTextResponse)
def root():
    """Hello World – bekräftar att add-on körs."""
    return "Hello from Operation Bredehall 11 – underhållsplaneraren kör!"


@app.get("/health", response_class=PlainTextResponse)
def health():
    """Enkel health check för HA/load balancers."""
    return "ok"
