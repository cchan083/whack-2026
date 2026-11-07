---
# Settings for Hugging Face Spaces (ignored by GitHub, which shows them as a small table).
title: Research Gap Finder
emoji: 🗺️
colorFrom: green
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
---

# Research Gap Finder

Map any research field from arXiv, group its papers into topics, and find the
gaps between related topics that few papers connect: dissertation ideas for students.

## Setup (once)

1. Python 3.13: `python -m venv .venv`, then `.venv\Scripts\activate` and `pip install -r requirements.txt`
2. Node.js LTS (for the React frontend): then `cd frontend` and `npm install`
3. Copy `.env.example` to `.env` and set `DATABASE_URL` to the Supabase **Session pooler** URI
   (host ends in `pooler.supabase.com`; the direct connection needs IPv6).

## Run the app

**React + FastAPI (main app):**

```
uvicorn api.main:app --reload --port 8000     # backend, API docs at http://localhost:8000/docs
cd frontend; npm run dev                       # frontend at http://localhost:5173
```

For a demo, build the frontend once (`npm run build` in `frontend/`) and run only
the backend: it then serves the app at http://localhost:8000.

**Streamlit (quick alternative):** `streamlit run app.py`

Both let you type any topic and build its map (about 2 minutes for 600 papers).

## Deploy to Hugging Face Spaces (Docker)

The `Dockerfile` builds one container with the backend and the React app, on port 7860.

1. On huggingface.co: **New Space** → SDK **Docker** → **Blank** → hardware **CPU basic (free)**.
2. In the Space: **Settings → Variables and secrets → New secret**: `DATABASE_URL` = the Session pooler URI.
3. Get the code onto the Space, either:
   - **Automatically (recommended):** in GitHub → **Settings → Secrets and variables → Actions**, add
     variable `HF_SPACE` = `your-hf-username/your-space-name` and secret `HF_TOKEN` = a Hugging Face
     access token with *write* permission. Every push to `main` then deploys
     (`.github/workflows/deploy-huggingface.yml`).
   - **Manually:** `git remote add hf https://huggingface.co/spaces/your-hf-username/your-space-name`
     then `git push hf main` (use the access token as the password).
4. The first build takes about 5–10 minutes. The app is then at
   `https://your-hf-username-your-space-name.hf.space` (API docs at `/docs`).

Free Spaces sleep after about 48 hours without visitors and take about 30 seconds to wake.
Build jobs are tracked in memory, so a restart forgets builds in progress (finished maps are safe in the database).

**Frontend hosted elsewhere (e.g. GitHub Pages):** build it with `VITE_API_URL` set to the Space
address and `VITE_BASE=/whack-2026/` (see `frontend/.env.example`). The backend already allows
requests from `https://cchan083.github.io`; change the list with the `ALLOWED_ORIGINS` variable.

## Pipeline from the command line

```
python -m pipeline.run --topic "wildfire" --max 600        # everything for one topic
python -m pipeline.ingest --field ml-climate --query "cat:cs.LG AND abs:climate" --max 3000
python -m pipeline.embed_cluster --field ml-climate
python -m pipeline.gaps --field ml-climate
```

## Code map

| Path | Job |
|---|---|
| `db.py` | Database connection and tables (Paper, Cluster, Gap) |
| `pipeline/ingest.py` | Download papers from arXiv |
| `pipeline/embed_cluster.py` | Embeddings, 2D map (UMAP), topics (HDBSCAN) |
| `pipeline/gaps.py` | Score gaps between neighbouring topics |
| `pipeline/validation.py` | Re-rank gaps: method + problem pairing, literature "Goldilocks zone" (arXiv counts), funding relevance |
| `tests/` | Tests for the validation layer: `python -m tests.test_validation` |
| `pipeline/run.py` | Run all steps for any typed topic |
| `llm.py` | Topic labels and gap proposals (keywords + templates, no AI API needed) |
| `api/main.py` | FastAPI backend for the React app |
| `frontend/` | React + CSS frontend (Vite) |
| `app.py` | Streamlit frontend |
| `Dockerfile`, `.github/workflows/` | Hosting on Hugging Face Spaces |
