from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sentence_transformers import SentenceTransformer
from sklearn.linear_model import LogisticRegression

from text.data import read_labeled_csv, save_split, split_indices
from text.metrics import classification_metrics

ENCODER_NAME = "sentence-transformers/all-MiniLM-L6-v2"


def resolve_splits(
    frame: pd.DataFrame, label_column: str, split_column: str | None, seed: int
) -> dict[str, list[int]]:
    labels = frame[label_column].astype(str).tolist()
    if not split_column:
        return split_indices(labels, seed)

    required = {"train", "validation", "test"}
    if split_column not in frame.columns:
        raise ValueError(f"CSV is missing split column: {split_column}")
    values = set(frame[split_column].dropna().astype(str))
    if not required.issubset(values):
        raise ValueError("The official split column must include train, validation, and test.")

    splits = {
        name: frame.index[frame[split_column].astype(str) == name].tolist()
        for name in sorted(required)
    }
    training_labels = {labels[index] for index in splits["train"]}
    if training_labels != set(labels):
        raise ValueError("The training split must contain every label.")
    if any(not splits[name] for name in required):
        raise ValueError("Every official split must contain at least one example.")
    return splits


def train(args: argparse.Namespace) -> dict[str, object]:
    if args.split_column:
        frame = pd.read_csv(args.input)
        required_columns = {args.text_column, args.label_column, args.split_column}
        missing = required_columns - set(frame.columns)
        if missing:
            raise ValueError(f"CSV is missing required columns: {', '.join(sorted(missing))}")
        frame = frame[[args.text_column, args.label_column, args.split_column]].dropna().copy()
        frame[args.text_column] = frame[args.text_column].astype(str).str.strip()
        frame[args.label_column] = frame[args.label_column].astype(str)
        frame[args.split_column] = frame[args.split_column].astype(str)
        frame = frame[frame[args.text_column].str.len() > 0].reset_index(drop=True)
        if frame[args.label_column].nunique() < 2:
            raise ValueError("Training data must contain at least two labels.")
    else:
        frame = read_labeled_csv(args.input, args.text_column, args.label_column)

    frame[args.label_column] = frame[args.label_column].astype(str)
    labels = sorted(frame[args.label_column].unique())
    splits = resolve_splits(frame, args.label_column, args.split_column, args.seed)
    output_dir = Path(args.output_dir)
    save_split(output_dir / "split.json", splits, frame[args.label_column].tolist(), args.seed)

    encoder = SentenceTransformer(ENCODER_NAME, device="cpu", local_files_only=True)

    def encode(indices: list[int]) -> np.ndarray:
        texts = frame.iloc[indices][args.text_column].astype(str).tolist()
        return encoder.encode(
            texts,
            batch_size=args.batch_size,
            convert_to_numpy=True,
            normalize_embeddings=True,
            show_progress_bar=True,
        )

    train_vectors = encode(splits["train"])
    test_vectors = encode(splits["test"])
    train_labels = frame.iloc[splits["train"]][args.label_column].astype(str).tolist()
    test_labels = frame.iloc[splits["test"]][args.label_column].astype(str).tolist()

    classifier = LogisticRegression(
        max_iter=2000,
        class_weight="balanced",
        random_state=args.seed,
    )
    classifier.fit(train_vectors, train_labels)
    predicted_labels = classifier.predict(test_vectors).tolist()
    class_ids = {label: index for index, label in enumerate(labels)}
    positive_id = class_ids.get(args.positive_label) if args.positive_label else None
    metrics = classification_metrics(
        [class_ids[label] for label in test_labels],
        [class_ids[label] for label in predicted_labels],
        positive_label=positive_id,
    )
    confusion = np.asarray(metrics["confusion_matrix"], dtype=int)
    class_metrics = {}
    for index, label in enumerate(labels):
        true_positive = int(confusion[index, index])
        predicted_count = int(confusion[:, index].sum())
        support = int(confusion[index, :].sum())
        precision = true_positive / predicted_count if predicted_count else 0.0
        recall = true_positive / support if support else 0.0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        class_metrics[label] = {
            "precision": precision,
            "recall": recall,
            "f1": f1,
            "support": support,
        }
    metrics["per_class"] = class_metrics

    output_dir.mkdir(parents=True, exist_ok=True)
    joblib.dump({
        "task": args.task,
        "method": "MiniLM embeddings + Logistic Regression",
        "encoder": ENCODER_NAME,
        "classifier": classifier,
        "labels": labels,
    }, output_dir / "baseline.joblib")
    (output_dir / "test-metrics.json").write_text(json.dumps({
        "task": args.task,
        "method": "MiniLM embeddings + Logistic Regression",
        "encoder": ENCODER_NAME,
        "split": "official" if args.split_column else "deterministic stratified 70/15/15",
        "split_counts": {name: len(indices) for name, indices in splits.items()},
        "class_id_to_label": {str(index): label for label, index in class_ids.items()},
        "test_metrics": metrics,
        "test_used_for_training_or_tuning": False,
        "input_sha256": hashlib.sha256(Path(args.input).read_bytes()).hexdigest(),
    }, indent=2), encoding="utf-8")
    return metrics


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Train a CPU-friendly MiniLM-embedding/logistic-regression baseline."
    )
    parser.add_argument("--input", required=True, help="Local CSV with text and label columns.")
    parser.add_argument("--task", required=True, choices=("stress", "emotion"))
    parser.add_argument("--text-column", default="text")
    parser.add_argument("--label-column", default="label")
    parser.add_argument("--split-column")
    parser.add_argument("--positive-label")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--seed", type=int, default=42)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.batch_size < 1:
        raise ValueError("Batch size must be at least one.")
    print(json.dumps(train(args), indent=2))


if __name__ == "__main__":
    main()
