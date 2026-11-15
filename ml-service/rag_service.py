from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import numpy as np

SERVICE_DIR = Path(__file__).resolve().parent
SNIPPETS_PATH = SERVICE_DIR / "resources" / "coping_snippets.json"
EMBEDDINGS_PATH = SERVICE_DIR / "models" / "coping_embeddings.npz"
MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
_model: Any = None


def _load_model():
    global _model
    if _model is None:
        try:
            from sentence_transformers import SentenceTransformer
        except ImportError as error:
            raise RuntimeError("Optional sentence-transformers dependency is not installed.") from error
        try:
            _model = SentenceTransformer(MODEL_NAME)
        except (OSError, ValueError, RuntimeError) as error:
            raise RuntimeError("The optional sentence-transformer model could not be loaded.") from error
    return _model


def _corpus():
    snippets = json.loads(SNIPPETS_PATH.read_text(encoding="utf-8"))
    if not isinstance(snippets, list) or not snippets:
        raise ValueError("Coping guidance corpus is empty or invalid.")
    digest = hashlib.sha256(json.dumps(snippets, sort_keys=True).encode()).hexdigest()
    return snippets, digest


def _embeddings(snippets, digest):
    if EMBEDDINGS_PATH.is_file():
        try:
            cached = np.load(EMBEDDINGS_PATH, allow_pickle=False)
            if str(cached["digest"].item()) == digest and cached["vectors"].shape[0] == len(snippets):
                return cached["vectors"]
        except (OSError, ValueError, KeyError):
            pass
    model = _load_model()
    vectors = np.asarray(model.encode([item["text"] for item in snippets], normalize_embeddings=True), dtype=np.float32)
    EMBEDDINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(EMBEDDINGS_PATH, digest=np.asarray(digest), vectors=vectors)
    return vectors


def retrieve(query: str, limit: int = 3) -> list[dict[str, str]]:
    text = str(query or "").strip()
    if not text:
        raise ValueError("A non-empty query is required.")
    snippets, digest = _corpus()
    model = _load_model()
    vectors = _embeddings(snippets, digest)
    query_vector = np.asarray(model.encode([text[:2000]], normalize_embeddings=True), dtype=np.float32)[0]
    similarities = vectors @ query_vector
    top_indices = np.argsort(similarities)[::-1][:max(1, min(int(limit), 3))]
    return [
        {
            "id": snippets[int(index)]["id"],
            "topic": snippets[int(index)]["topic"],
            "text": snippets[int(index)]["text"],
            "similarity": float(similarities[index]),
        }
        for index in top_indices
    ]
