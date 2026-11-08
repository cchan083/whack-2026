---
# Settings for Hugging Face Spaces (ignored by GitHub, which shows them as a small table).
title: eXpand
emoji: 🗺️
colorFrom: green
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
---

# eXpand

**Find the unexplored space between research topics.**

Type any research topic. eXpand downloads up to 1500 matching papers from arXiv,
maps them by meaning, groups them into sub-topics, and finds **gaps**: pairs of
closely related sub-topics with almost no papers between them. Each gap is
checked against the wider arXiv literature, ranked by how feasible a project it
would make, and turned into a dissertation idea with real papers to start from.

- **Live app:** https://gap-finder.kindbeach-9a97b012.germanywestcentral.azurecontainerapps.io
- **How it works, demo script, pitch and judge Q&A:** [explained.md](explained.md)

## Run it locally

You need Python 3.13, Node.js 22, and a Supabase Postgres database.

```powershell
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
cd frontend; npm install; cd ..
copy .env.example .env      # then set DATABASE_URL to the Supabase "Session pooler" URI
```

| Command | What you get |
|---|---|
| `uvicorn api.main:app --reload --port 8000` | Backend, with API docs at http://localhost:8000/docs |
| `cd frontend; npm run dev` | The app at **http://localhost:5173**, reloading as you edit |
| `cd frontend; npm run build` | A built copy, which the backend then serves at http://localhost:8000 |
| `streamlit run app.py` | A simpler single-file version of the app |
| `pytest tests` | 14 tests. They need no database or network |
| `python -m pipeline.run --topic "wildfire"` | Build a map from the command line |
| `python -m pipeline.run --recluster --all` | Redo every map's topics and gaps with the current code, without downloading again |

A new topic takes 2–3 minutes to build. Only one topic is built at a time.

## Deployment (CI/CD)

On every push to `main`, `.github/workflows/build-image.yml` runs three steps:

1. **Test:** `pytest` and the frontend lint. A failure stops everything.
2. **Build:** the Docker image (React app + FastAPI), published to `ghcr.io/cchan083/whack-2026`.
3. **Deploy:** points Azure Container Apps at the new image, then checks `/api/health`.

Pull requests run only the test step.

**One-time setup for the deploy step:** in GitHub, go to **Settings → Secrets and variables → Actions** and add:
- the secret `AZURE_CREDENTIALS`, the JSON from `az ad sp create-for-rbac --name gap-finder-deploy --role contributor --scopes <resource group id> --json-auth`;
- the variables `AZURE_RESOURCE_GROUP` = `gap-finder-rg` and `AZURE_CONTAINER_APP` = `gap-finder`.

Until these are set, the deploy step is skipped.

**Azure settings:** the app runs with 1 CPU and 2 GiB of memory. `DATABASE_URL` is stored as a secret.
- **Exactly one replica:** keep max replicas at 1. Build progress is kept in memory, so it must stay in one process.
- **Sleeps when idle:** min replicas is 0, so the app turns off when unused and takes about 30 seconds to wake.

**Other hosting** (optional, off by default):
- `deploy-huggingface.yml` pushes to a Hugging Face Space. Turn it on with the variable `HF_SPACE` and the secret `HF_TOKEN`.
- `deploy-pages.yml` publishes only the frontend to GitHub Pages. Turn it on with the variable `API_URL`.

## Code map

| Path | Job |
|---|---|
| `pipeline/run.py` | Runs every step for a typed topic, one build at a time (Postgres lock) |
| `pipeline/ingest.py` | Searches arXiv and saves the papers |
| `pipeline/embed_cluster.py` | Embeddings (MiniLM), 2D map and 5D clustering (UMAP), topics (HDBSCAN) |
| `pipeline/gaps.py` | Finds and scores gaps between neighbouring topics |
| `pipeline/validation.py` | Re-ranks gaps: method × problem, arXiv literature count, funding relevance |
| `llm.py` | Topic names (class-based TF-IDF) and proposals (templates). No AI API |
| `db.py` | Database tables: paper, cluster, gap, literature count cache |
| `api/main.py` | FastAPI backend. Serves the built frontend too |
| `frontend/` | React + Plotly app |
| `tests/` | Gap geometry and validation tests |
