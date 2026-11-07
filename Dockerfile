# Research Gap Finder: one container with the FastAPI backend and the built
# React app. Made for Hugging Face Spaces (Docker), which expects port 7860.
#
# Build and run locally (needs Docker):
#   docker build -t research-gap-finder .
#   docker run -p 7860:7860 -e DATABASE_URL="postgresql://..." research-gap-finder
# then open http://localhost:7860

# --- Stage 1: build the React frontend ---------------------------------------
FROM node:22-slim AS frontend
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# --- Stage 2: Python backend -------------------------------------------------
FROM python:3.13-slim

# Hugging Face runs the container as user 1000, so everything the app writes
# at runtime (model files, numba's compiled-code cache) must be somewhere that
# user owns.
RUN useradd -m -u 1000 user
ENV HOME=/home/user \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/home/user/.cache/huggingface \
    FASTEMBED_CACHE_PATH=/home/user/.cache/fastembed \
    NUMBA_CACHE_DIR=/tmp/numba_cache
WORKDIR /home/user/app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

USER user
# Download the embedding model during the build, so the first topic built on
# the website doesn't have to wait for it.
RUN python -c "from fastembed import TextEmbedding; TextEmbedding('sentence-transformers/all-MiniLM-L6-v2')"

COPY --chown=user . .
COPY --chown=user --from=frontend /frontend/dist ./frontend/dist

EXPOSE 7860
# One worker: build jobs are tracked in memory, so they must share a process.
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "7860"]
