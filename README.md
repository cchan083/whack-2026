# Research Gap Finder

Map any research field from arXiv, group its papers into topics, and find the
gaps between related topics that few papers connect: dissertation ideas for students.

## Setup (once)

1. Python: `python -m venv .venv`, then `.venv\Scripts\activate` and `pip install -r requirements.txt`
2. Node.js LTS (for the React frontend): then `cd frontend` and `npm install`
3. `.env` in the project folder with `DATABASE_URL=` set to the Supabase **Session pooler** URI
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

Both let you type any topic and build its map (about a minute per 600 papers).

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
| `pipeline/run.py` | Run all steps for any typed topic |
| `llm.py` | Topic labels and gap proposals (keywords + templates, no AI API needed) |
| `api/main.py` | FastAPI backend for the React app |
| `frontend/` | React + CSS frontend (Vite) |
| `app.py` | Streamlit frontend |
