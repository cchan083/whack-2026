"""Database connection and table definitions.

Run `python db.py` to create the tables (safe to run more than once).
"""

import os
from datetime import date
from typing import Optional

from dotenv import load_dotenv
from pgvector.sqlalchemy import Vector
from sqlalchemy import Column, Text, text
from sqlmodel import Field, SQLModel, create_engine

load_dotenv()  # reads DATABASE_URL from the .env file

DATABASE_URL = os.environ["DATABASE_URL"]
# The URL may start with "postgres://", "postgresql://" or "postgresql+psycopg://".
# We always use the psycopg2 driver (from requirements.txt), so set that explicitly.
_scheme, _rest = DATABASE_URL.split("://", 1)
DATABASE_URL = "postgresql+psycopg2://" + _rest

# pool_pre_ping checks a connection is still alive before using it,
# because Supabase closes connections that sit idle.
engine = create_engine(DATABASE_URL, pool_pre_ping=True)

EMBEDDING_DIMS = 384  # size of all-MiniLM-L6-v2 vectors


class Paper(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    arxiv_id: str = Field(unique=True, index=True)  # e.g. "2301.01234" (no version suffix)
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
    """Create any tables that don't exist yet. Existing tables and data are left alone."""
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    SQLModel.metadata.create_all(engine)


if __name__ == "__main__":
    init_db()
    print("Tables ready.")
