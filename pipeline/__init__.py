"""Data pipeline: ingest papers -> embed and cluster -> find gaps.

pipeline.run ties the steps together for any topic.

Each step takes an optional `progress` function, called as
progress(message, fraction) where fraction is 0..1 (or None if unknown).
The frontends use it for progress bars; on the command line it just prints.
"""


def console_progress(message: str, fraction: float | None = None) -> None:
    """Default progress reporter for command-line runs."""
    print(message)
