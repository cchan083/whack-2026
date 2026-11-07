"""Database connection and table definitions.

Run `python db.py` to create the tables (safe to run more than once).
"""

import os
from datetime import date
from typing import Optional

from dotenv import load_dotenv
from pgvector.sqlalchemy import Vector
from sqlalchemy import Column, Index, Text, text
from sqlmodel import Field, SQLModel, create_engine

load_dotenv()  # reads DATABASE_URL from the .env file

DATABASE_URL = os.environ["DATABASE_URL"]
# The URL may start with "postgres://", "postgresql://" or "postgresql+psycopg://".
# We always use the psycopg2 driver (from requirements.txt), so set that explicitly.
_scheme, _rest = DATABASE_URL.split("://", 1)
DATABASE_URL = "postgresql+psycopg2://" + _rest

# pool_pre_ping checks a connection is still alive before using it,
# because Supabase closes connections that sit idle.
# executemany_mode sends many-row UPDATEs in a few round trips instead of one
# per row, which is much faster over the network.
engine = create_engine(DATABASE_URL, pool_pre_ping=True, executemany_mode="values_plus_batch")

EMBEDDING_DIMS = 384  # size of all-MiniLM-L6-v2 vectors


class Paper(SQLModel, table=True):
    # The same arXiv paper can belong to several fields (topics), so it is only
    # a duplicate if both arxiv_id AND field match.
    __table_args__ = (Index("uq_paper_arxiv_field", "arxiv_id", "field", unique=True),)

    id: Optional[int] = Field(default=None, primary_key=True)
    arxiv_id: str = Field(index=True)  # e.g. "2301.01234" (no version suffix)
    title: str
    abstract: str = Field(sa_column=Column(Text, nullable=False))
    published: date
    field: str = Field(index=True)  # our own label for the dataset, e.g. "ml-climate"

    # Filled in later by the embed/cluster step.
    x: Optional[float] = None  # 2D map position from UMAP
    y: Optional[float] = None
    cluster_id: Optional[int] = Field(default=None, index=True)  # refers to Cluster.id
    embedding: Optional[list[float]] = Field(
        default=None, sa_column=Column(Vector(EMBEDDING_DIMS), nullable=True)
    )


class Cluster(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    field: str = Field(index=True)
    label: Optional[str] = None  # short human-readable name, written by the LLM
    size: int  # number of papers in the cluster
    centroid_x: float  # centre of the cluster on the 2D map
    centroid_y: float


class Gap(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    field: str = Field(index=True)
    cluster_a: int  # Cluster.id of one side of the gap
    cluster_b: int  # Cluster.id of the other side
    score: float  # higher = more promising gap
    x: float  # where the gap sits on the 2D map
    y: float
    proposal: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))


def init_db() -> None:
    """Create any missing tables and bring older tables up to date. Data is kept.
    Safe to run any number of times."""
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    SQLModel.metadata.create_all(engine)
    with engine.begin() as conn:
        _upgrade_existing_tables(conn)


def _upgrade_existing_tables(conn) -> None:
    """create_all() never changes tables that already exist, so changes to
    existing tables go here. Each step checks first, so re-running does nothing."""
    # Nov 2026: arxiv_id used to be unique across all fields. Now a paper can
    # be in several fields, so make the old index non-unique...
    old_unique_index = conn.execute(text(
        "SELECT 1 FROM pg_indexes WHERE indexname = 'ix_paper_arxiv_id' AND indexdef LIKE 'CREATE UNIQUE%'"
    )).first()
    if old_unique_index:
        conn.execute(text("DROP INDEX ix_paper_arxiv_id"))
        conn.execute(text("CREATE INDEX ix_paper_arxiv_id ON paper (arxiv_id)"))
    # ...and make (arxiv_id, field) unique instead.
    conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_paper_arxiv_field ON paper (arxiv_id, field)"))


if __name__ == "__main__":
    init_db()
    print("Tables ready.")
