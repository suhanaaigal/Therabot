from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sentence_transformers import SentenceTransformer
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split
from sklearn.pipeline import make_pipeline

from text.metrics import choose_high_recall_threshold, classification_metrics
from text.training import split_frames

ENCODER_NAME = "sentence-transformers/all-MiniLM-L6-v2"
MAX_SEQUENCE_LENGTH = 128
LABEL_TO_ID = {"non_crisis": 0, "crisis": 1}


def text_fingerprint(text: str) -> str:
    normalized = " ".join(str(text).casefold().split())
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def encode_partition(encoder: SentenceTransformer, texts: list[str], batch_size: int) -> np.ndarray:
    return encoder.encode(
        texts,
        batch_size=batch_size,
        convert_to_numpy=True,
        normalize_embeddings=True,
        show_progress_bar=True,
    )


def run_training(args: argparse.Namespace) -> dict[str, object]:
    frame = pd.read_csv(args.csv, usecols=["text", "label", "split"])
    frame = frame.dropna(subset=["text", "label", "split"]).copy()
    frame["text"] = frame["text"].astype(str).str.strip()
    frame["label"] = frame["label"].astype(str)
    frame = frame[frame["text"].str.len() > 0].reset_index(drop=True)
    if frame["label"].nunique() < 2 or frame["label"].value_counts().min() < 3:
        raise ValueError("Training data must contain at least three examples from each of two labels.")
    if set(frame["label"].unique()) != set(LABEL_TO_ID):
        raise ValueError("Training labels must be exactly crisis and non_crisis.")
    splits = split_frames(frame, "label", "split", args.seed)
    full_train_count = len(splits["train"])
    if args.max_train_samples and full_train_count > args.max_train_samples:
        splits["train"], _ = train_test_split(
            splits["train"],
            train_size=args.max_train_samples,
            random_state=args.seed,
            stratify=splits["train"]["label"],
        )
        splits["train"] = splits["train"].reset_index(drop=True)
    full_validation_count = len(splits["validation"])
    full_test_count = len(splits["test"])
    for split_name in ("validation", "test"):
        if args.max_eval_samples and len(splits[split_name]) > args.max_eval_samples:
            splits[split_name], _ = train_test_split(
                splits[split_name],
                train_size=args.max_eval_samples,
                random_state=args.seed,
                stratify=splits[split_name]["label"],
            )
            splits[split_name] = splits[split_name].reset_index(drop=True)
    texts = {
        name: partition["text"].astype(str).tolist()
        for name, partition in splits.items()
    }
    labels = {
        name: partition["label"].map(LABEL_TO_ID).astype(int).tolist()
        for name, partition in splits.items()
    }
    encoder = None
    if args.method == "tfidf":
        classifier = make_pipeline(
            TfidfVectorizer(
                ngram_range=(1, 2),
                min_df=3,
                max_features=args.max_features,
                sublinear_tf=True,
                dtype=np.float32,
            ),
            LogisticRegression(
                max_iter=100,
                class_weight="balanced",
                random_state=args.seed,
                solver="liblinear",
            ),
        )
        classifier.fit(texts["train"], labels["train"])
        val_inputs = texts["validation"]
        test_inputs = texts["test"]
        method = "TF-IDF word unigrams/bigrams + Logistic Regression"
    else:
        encoder = SentenceTransformer(ENCODER_NAME, device="cpu", local_files_only=True)
        encoder.max_seq_length = MAX_SEQUENCE_LENGTH
        vectors = {
            name: encode_partition(encoder, texts[name], args.batch_size)
            for name in ("train", "validation", "test")
        }
        classifier = LogisticRegression(
            max_iter=2000,
            class_weight="balanced",
            random_state=args.seed,
        )
        classifier.fit(vectors["train"], labels["train"])
        val_inputs = vectors["validation"]
        test_inputs = vectors["test"]
        method = "MiniLM embeddings + Logistic Regression"

    positive_index = list(classifier.classes_).index(LABEL_TO_ID["crisis"])
    validation_probabilities = classifier.predict_proba(val_inputs)[:, positive_index]
    threshold, validation_metrics = choose_high_recall_threshold(
        labels["validation"],
        validation_probabilities.tolist(),
        positive_label=1,
        target_recall=0.90,
    )

    test_probabilities = classifier.predict_proba(test_inputs)[:, positive_index]
    test_predictions = (test_probabilities >= threshold).astype(int).tolist()
    test_metrics = classification_metrics(labels["test"], test_predictions, positive_label=1)
    source_metadata_path = Path(args.csv).with_suffix(".metadata.json")
    source_metadata = (
        json.loads(source_metadata_path.read_text(encoding="utf-8"))
        if source_metadata_path.is_file()
        else {}
    )
    train_fingerprints = sorted({
        text_fingerprint(text)
        for partition in splits.values()
        for text in partition["text"].astype(str)
    })
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    joblib.dump({
        "task": "crisis",
        "method": method,
        "encoder": ENCODER_NAME if encoder is not None else None,
        "classifier": classifier,
        "labels": ["non_crisis", "crisis"],
        "positive_label": "crisis",
        "threshold": threshold,
        "label_provenance": "Proxy-labelled dataset; not clinician-reviewed.",
        "proxy_text_fingerprints": train_fingerprints,
    }, output_dir / "model.joblib")

    report = {
        "task": "crisis",
        "method": method,
        "status": "research-only; not enabled for application inference",
        "dataset_source": source_metadata,
        "label_limitation": (
            "Dataset labels are proxies, their source description does not establish clinical "
            "ground truth, and they are not clinician-reviewed."
        ),
        "threshold_target": "At least 0.90 crisis recall on validation split.",
        "validation_threshold": float(threshold),
        "validation_metrics_at_threshold": validation_metrics,
        "proxy_test_metrics_at_validation_threshold": test_metrics,
        "split_counts": {name: len(partition) for name, partition in splits.items()},
        "full_training_split_count": full_train_count,
        "training_split_sampled": len(splits["train"]) < full_train_count,
        "full_validation_split_count": full_validation_count,
        "full_test_split_count": full_test_count,
        "evaluation_splits_sampled": (
            len(splits["validation"]) < full_validation_count
            or len(splits["test"]) < full_test_count
        ),
        "short_text_test_set_used_for_training_or_tuning": False,
        "short_text_test_set_evaluation": "pending independent human-authored and double-reviewed set",
    }
    (output_dir / "proxy-test-metrics.json").write_text(
        json.dumps(report, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, indent=2))
    return report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Train a research-only proxy crisis model; do not deploy before short-text validation."
    )
    parser.add_argument("--csv", required=True, help="Prepared CSV containing text, label, and split.")
    parser.add_argument("--output-dir", default="outputs/crisis-proxy-minilm")
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--method", choices=("minilm", "tfidf"), default="minilm")
    parser.add_argument("--max-features", type=int, default=100000)
    parser.add_argument(
        "--max-train-samples",
        type=int,
        default=10000,
        help="Stratified training subset size. Use 0 for the full training split.",
    )
    parser.add_argument(
        "--max-eval-samples",
        type=int,
        default=5000,
        help="Stratified sample size per validation/test split. Use 0 for full splits.",
    )
    parser.add_argument("--seed", type=int, default=42)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.batch_size < 1:
        raise ValueError("Batch size must be at least one.")
    if args.max_train_samples < 0:
        raise ValueError("Maximum training sample count cannot be negative.")
    if args.max_eval_samples < 0:
        raise ValueError("Maximum evaluation sample count cannot be negative.")
    run_training(args)


if __name__ == "__main__":
    main()
