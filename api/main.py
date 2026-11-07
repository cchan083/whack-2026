"""FastAPI backend: serves map data to the React frontend and builds new topics.

Run from the project folder:
    uvicorn api.main:app --reload --port 8000

Interactive docs (try every endpoint in the browser): http://localhost:8000/docs
If the React app has been built (frontend/dist exists), it is served at
http://localhost:8000 too, so the demo needs only this one server.

Building a topic takes about a minute, which is too long for one web request.
So POST /api/topics starts a background "job" and returns its id at once;
the frontend then checks GET /api/jobs/{id} every second for progress.
"""

import json
import os
import threading
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from db import Cluster, Gap, Paper, engine, init_db
from pipeline import run, validation


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()  # make sure tables exist before serving requests
    yield


app = FastAPI(title="Research Gap Finder API", lifespan=lifespan)

# Websites allowed to call this API from a browser: the Vite dev server and
# the GitHub Pages site by default. Override with ALLOWED_ORIGINS (comma-separated)
# on the hosting service. (The Docker image serves the frontend itself, which
# doesn't need this.)
DEFAULT_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173,https://cchan083.github.io"
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.getenv("ALLOWED_ORIGINS", DEFAULT_ORIGINS).split(",") if o.strip()],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.get("/api/health")
def health() -> dict:
    """For uptime checks: answers without touching the database."""
    return {"status": "ok"}


# --- Reading maps -----------------------------------------------------------

@app.get("/api/categories")
def categories() -> list[dict]:
    """arXiv categories a search can be narrowed to."""
    return [{"name": name, "code": code} for name, code in run.CATEGORIES.items()]


@app.get("/api/topics")
def topics() -> list[dict]:
    """Every topic in the database. Only ones with clusters > 0 have a finished map."""
    return run.list_topics()


@app.get("/api/topics/{field}")
def topic_map(field: str) -> dict:
    """Everything the map needs for one topic: papers, clusters and gaps (best first)."""
    with Session(engine) as session:
        papers = session.exec(
            select(Paper.arxiv_id, Paper.title, Paper.published, Paper.x, Paper.y, Paper.cluster_id)
            .where(Paper.field == field, Paper.x.is_not(None))
        ).all()
        clusters = session.exec(select(Cluster).where(Cluster.field == field)).all()
        gaps = session.exec(select(Gap).where(Gap.field == field).order_by(Gap.score.desc())).all()
    if not clusters:
        raise HTTPException(404, f"No map for '{field}' yet.")

    gap_rows = [
        {"id": g.id, "rank": rank, "cluster_a": g.cluster_a, "cluster_b": g.cluster_b,
         "score": g.score, "base_score": g.base_score, "literature_count": g.literature_count,
         "status": g.status, "reasons": json.loads(g.reasons) if g.reasons else [],
         "x": g.x, "y": g.y, "proposal": g.proposal}
        for rank, g in enumerate(gaps, start=1)
    ]
    return {
        "field": field,
        "name": run.display_name(field),
        # Is this topic worth exploring? "clear", "limited" or "none", plus a message for the user.
        "assessment": validation.assess_topic(gap_rows),
        "papers": [
            {"arxiv_id": p.arxiv_id, "title": p.title, "year": p.published.year,
             "x": p.x, "y": p.y, "cluster_id": p.cluster_id}
            for p in papers
        ],
        "clusters": [
            {"id": c.id, "label": c.label, "size": c.size, "x": c.centroid_x, "y": c.centroid_y,
             "category": c.category}
            for c in clusters
        ],
        "gaps": gap_rows,
    }


# --- Building new topics (background jobs) ----------------------------------

class TopicRequest(BaseModel):
    topic: str = Field(min_length=1, max_length=100, examples=["wildfire"])
    category: str | None = Field(default=None, examples=["cs.LG"])
    max_papers: int = Field(default=run.DEFAULT_MAX_PAPERS, ge=100, le=2000)


# Jobs live in memory: fine for one server process (restarting forgets them).
jobs: dict[str, dict] = {}
jobs_lock = threading.Lock()


def _run_job(job_id: str, request: TopicRequest) -> None:
    def report(message: str, fraction: float | None = None) -> None:
        with jobs_lock:
            jobs[job_id]["message"] = message
            if fraction is not None:
                jobs[job_id]["progress"] = round(fraction, 3)

    try:
        run.run_topic(request.topic, request.category, request.max_papers, progress=report)
        status, error = "done", None
    except run.PipelineError as e:
        status, error = "error", str(e)
    except Exception as e:  # network problems etc.
        status, error = "error", f"Something went wrong while building the map ({type(e).__name__})."
    with jobs_lock:
        jobs[job_id].update(status=status, error=error)


@app.post("/api/topics")
def build_topic(request: TopicRequest) -> dict:
    """Start building a topic. Returns at once with status "ready" (already
    built) or "running" plus a job_id to poll."""
    if request.category and request.category not in run.CATEGORIES.values():
        raise HTTPException(400, "Unknown arXiv category.")
    try:
        field = run.field_for(request.topic, request.category)
        run.build_query(request.topic, request.category)  # checks the topic has real keywords
    except run.PipelineError as e:
        raise HTTPException(400, str(e))

    if run.is_built(field):
        return {"status": "ready", "field": field, "job_id": None}

    with jobs_lock:
        # Same topic already being built? Return that job instead of starting another.
        for job_id, job in jobs.items():
            if job["field"] == field and job["status"] == "running":
                return {"status": "running", "field": field, "job_id": job_id}
        job_id = uuid.uuid4().hex[:12]
        jobs[job_id] = {"status": "running", "field": field, "progress": 0.0,
                        "message": "Starting...", "error": None}

    threading.Thread(target=_run_job, args=(job_id, request), daemon=True).start()
    return {"status": "running", "field": field, "job_id": job_id}


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str) -> dict:
    """Progress of a build: status is "running", "done" or "error"."""
    with jobs_lock:
        job = jobs.get(job_id)
        if job is None:
            raise HTTPException(404, "Unknown job (the server may have restarted).")
        return {"job_id": job_id, **job}


# --- Serve the built React app (production / demo) --------------------------

FRONTEND_BUILD = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if FRONTEND_BUILD.exists():
    # Mounted last, so the /api routes above take priority.
    app.mount("/", StaticFiles(directory=FRONTEND_BUILD, html=True), name="frontend")
