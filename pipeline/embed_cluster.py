"""TODO: Embed and cluster the papers for one field.

- Embed each paper's title + abstract with fastembed (all-MiniLM-L6-v2, 384 dims)
  and store it in Paper.embedding.
- Reduce the embeddings to 2D with UMAP and store Paper.x / Paper.y.
- Group papers with sklearn.cluster.HDBSCAN, set Paper.cluster_id, and write one
  Cluster row per group (size and 2D centroid).
"""
