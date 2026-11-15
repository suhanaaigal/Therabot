from __future__ import annotations

from contextlib import asynccontextmanager
import logging
import importlib.util
from typing import Any
from pathlib import Path

import joblib
import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

SERVICE_DIR = Path(__file__).resolve().parent
MODEL_DIR = SERVICE_DIR / "models"

def load_text_pipeline(model_name: str):
    model_path = MODEL_DIR / model_name
    if model_path.is_dir():
        from transformers import pipeline
        return pipeline("text-classification", model=str(model_path), top_k=None)
    baseline_path = MODEL_DIR / f"{model_name}_minilm" / "baseline.joblib"
    if baseline_path.is_file():
        return joblib.load(baseline_path)
    return None


stress_clf = load_text_pipeline("stress")
emotion_clf = load_text_pipeline("emotion")
crisis_clf = load_text_pipeline("crisis")
_embedding_model: Any = None
wesad_path = MODEL_DIR / "wesad_rf.joblib"
wesad_artifact = joblib.load(wesad_path) if wesad_path.is_file() else None
CRISIS_THRESHOLD = float(
    getattr(getattr(getattr(crisis_clf, "model", None), "config", None), "crisis_threshold", 0.35)
)

EMOTION_LABEL_MAP = {
    "LABEL_0": "anxious",
    "LABEL_1": "sad",
    "LABEL_2": "angry",
    "LABEL_3": "positive",
    "LABEL_4": "neutral",
    "anxious": "anxious",
    "sad": "sad",
    "angry": "angry",
    "positive": "positive",
    "neutral": "neutral",
}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    baseline = next((model for model in (stress_clf, emotion_clf) if isinstance(model, dict)), None)
    if baseline is not None:
        try:
            get_embedding_model(baseline).encode(
                ["Therabot text model startup check."],
                convert_to_numpy=True,
                normalize_embeddings=True,
                show_progress_bar=False,
            )
        except HTTPException as error:
            logging.error("MiniLM models are unavailable after startup warm-up: %s", error.detail)
    yield


app = FastAPI(title="Therabot ML service", version="0.2.0", lifespan=lifespan)


class TextIn(BaseModel):
    text: str


class CopingQuery(BaseModel):
    query: str = Field(min_length=1, max_length=2000)
    limit: int = Field(default=3, ge=1, le=3)


class StressWindow(BaseModel):
    features: dict[str, float | None] = Field(min_length=1)


def prob(clf: Any, text: str, label: str) -> float:
    candidates = text_candidates(clf, text)
    for item in candidates:
        if item.get("label") == label:
            return float(item.get("score", 0.0))
    return 0.0


def text_candidates(clf: Any, text: str) -> list[dict[str, Any]]:
    if isinstance(clf, dict):
        classifier = clf.get("classifier")
        if classifier is None:
            raise HTTPException(status_code=503, detail="A text classifier artifact is invalid.")
        encoder = get_embedding_model(clf)
        try:
            vector = encoder.encode(
                [text[:2000]],
                convert_to_numpy=True,
                normalize_embeddings=True,
                show_progress_bar=False,
            )
            scores = classifier.predict_proba(vector)[0]
            return [
                {"label": str(label), "score": float(score)}
                for label, score in zip(classifier.classes_, scores)
            ]
        except (AttributeError, KeyError, ValueError, RuntimeError) as error:
            logging.error("MiniLM text classification failed: %s", error)
            raise HTTPException(status_code=503, detail="MiniLM text classification is unavailable.") from error
    return clf(text[:2000])[0]


def get_embedding_model(artifact: dict[str, Any]):
    global _embedding_model
    if _embedding_model is None:
        try:
            from sentence_transformers import SentenceTransformer
            _embedding_model = SentenceTransformer(artifact["encoder"], device="cpu")
        except (ImportError, KeyError, OSError, ValueError, RuntimeError) as error:
            logging.error("MiniLM text encoder could not be loaded: %s", error)
            raise HTTPException(status_code=503, detail="The MiniLM text encoder is unavailable.") from error
    return _embedding_model


def explain_top_words(clf: Any, text: str, label: str, k: int = 5) -> list[str]:
    words = text.split()
    if not words:
        return []
    if not isinstance(clf, dict):
        return top_words(text, lambda value: prob(clf, value, label), k)

    classifier = clf.get("classifier")
    if classifier is None:
        raise HTTPException(status_code=503, detail="A text classifier artifact is invalid.")
    reduced_texts = [
        " ".join(words[:index] + words[index + 1:])
        for index in range(len(words))
    ]
    try:
        vectors = get_embedding_model(clf).encode(
            [text[:2000], *(value[:2000] for value in reduced_texts)],
            batch_size=32,
            convert_to_numpy=True,
            normalize_embeddings=True,
            show_progress_bar=False,
        )
        class_index = list(classifier.classes_).index(label)
        probabilities = classifier.predict_proba(vectors)[:, class_index]
    except (AttributeError, ValueError, RuntimeError) as error:
        logging.error("MiniLM word-occlusion explanation failed: %s", error)
        raise HTTPException(status_code=503, detail="MiniLM word explanations are unavailable.") from error

    scored = [
        (word, float(probabilities[0] - probabilities[index + 1]))
        for index, word in enumerate(words)
        if probabilities[0] - probabilities[index + 1] > 0
    ]
    scored.sort(key=lambda item: item[1], reverse=True)
    return [word for word, _ in scored[:k]]


def positive_label(candidates, names: tuple[str, ...]) -> str | None:
    labels = {item.get("label") for item in candidates}
    return next((name for name in names if name in labels), None)


def top_words(text: str, prob_fn, k: int = 5):
    words = text.split()
    if not words:
        return []
    base = prob_fn(text)
    scored = []
    for index, word in enumerate(words):
        reduced = ' '.join(words[:index] + words[index + 1:])
        score = base - prob_fn(reduced)
        if score > 0:
            scored.append((word, score))
    scored.sort(key=lambda item: item[1], reverse=True)
    return [word for word, _ in scored[:k]]


@app.post("/analyze-text")
def analyze(inp: TextIn):
    text = (inp.text or '').strip()
    if not text:
        return {
            'stress_prob': 0.0,
            'emotion': 'neutral',
            'emotion_prob': 0.0,
            'crisis_prob': None if crisis_clf is None else 0.0,
            'crisis_flag': False,
            'crisis_available': crisis_clf is not None,
            'top_words': [],
        }
    if stress_clf is None or emotion_clf is None:
        raise HTTPException(status_code=503, detail="Stress and emotion classifiers are not installed.")

    stress_candidates = text_candidates(stress_clf, text)
    stress_label = positive_label(stress_candidates, ("stress", "LABEL_1"))
    if stress_label is None:
        raise HTTPException(status_code=503, detail="The stress model is missing its positive-class label.")
    stress = prob(stress_clf, text, stress_label)
    emotion = max(text_candidates(emotion_clf, text), key=lambda item: item['score'])
    emotion_label = EMOTION_LABEL_MAP.get(emotion['label'])
    if emotion_label is None:
        raise HTTPException(status_code=503, detail="The emotion model returned an unknown group label.")
    crisis = None
    if crisis_clf is not None:
        crisis_candidates = text_candidates(crisis_clf, text)
        crisis_label = positive_label(crisis_candidates, ("crisis", "LABEL_1"))
        if crisis_label is None:
            raise HTTPException(status_code=503, detail="The crisis model is missing its positive-class label.")
        crisis = prob(crisis_clf, text, crisis_label)
    return {
        'stress_prob': stress,
        'emotion': emotion_label,
        'emotion_prob': float(emotion['score']),
        'crisis_prob': crisis,
        'crisis_flag': crisis is not None and crisis >= CRISIS_THRESHOLD,
        'crisis_available': crisis is not None,
        'stress_model': stress_clf.get("method", "MiniLM embeddings + Logistic Regression") if isinstance(stress_clf, dict) else "fine-tuned text classifier",
        'emotion_model': emotion_clf.get("method", "MiniLM embeddings + Logistic Regression") if isinstance(emotion_clf, dict) else "fine-tuned text classifier",
        'top_words': explain_top_words(stress_clf, text, stress_label),
    }


@app.post("/retrieve-coping")
def retrieve_coping(query: CopingQuery):
    if importlib.util.find_spec("sentence_transformers") is None:
        raise HTTPException(status_code=503, detail="Optional coping retrieval dependencies are not installed.")
    try:
        from rag_service import retrieve
        return {"snippets": retrieve(query.query, query.limit), "model": "all-MiniLM-L6-v2"}
    except (RuntimeError, ValueError, OSError) as error:
        logging.error("Coping retrieval is unavailable: %s", error)
        raise HTTPException(status_code=503, detail="Coping retrieval is unavailable.") from error


@app.post("/predict-stress")
def predict_stress(window: StressWindow):
    if wesad_artifact is None:
        raise HTTPException(status_code=503, detail="The trained WESAD model is not installed.")
    model = wesad_artifact.get("model")
    features = wesad_artifact.get("features")
    if model is None or not isinstance(features, list) or not features:
        logging.error("WESAD model artifact is missing its model or feature list.")
        raise HTTPException(status_code=503, detail="The WESAD model artifact is invalid.")

    values = []
    for feature in features:
        value = window.features.get(feature)
        if value is not None and not np.isfinite(value):
            raise HTTPException(status_code=422, detail=f"Feature {feature} must be finite or null.")
        values.append(np.nan if value is None else float(value))

    try:
        probabilities = model.predict_proba(np.asarray([values], dtype=float))[0]
        classes = list(model.classes_)
        stress_index = classes.index(1)
    except (AttributeError, ValueError, IndexError) as error:
        logging.error("WESAD model prediction failed: %s", error)
        raise HTTPException(status_code=503, detail="The WESAD model could not produce a prediction.") from error
    return {
        "stress_prob": float(probabilities[stress_index]),
        "model": "wesad-rf",
        "holdout_subject": wesad_artifact.get("holdout_subject", 17),
    }


@app.get("/health")
def health():
    def available(model):
        return model is not None and (not isinstance(model, dict) or _embedding_model is not None)

    return {
        "status": "ok",
        "capabilities": {
            "text_analysis": all(available(model) for model in (stress_clf, emotion_clf, crisis_clf)),
            "stress_emotion_analysis": available(stress_clf) and available(emotion_clf),
            "crisis_text_model": available(crisis_clf),
            "wesad_stress": wesad_artifact is not None,
            "coping_retrieval": importlib.util.find_spec("sentence_transformers") is not None,
        },
    }

