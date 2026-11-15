from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import joblib
import pandas as pd
from sklearn.metrics import cohen_kappa_score
from sklearn.metrics import precision_recall_fscore_support, confusion_matrix
from sentence_transformers import SentenceTransformer

from text.train_crisis_proxy import LABEL_TO_ID, text_fingerprint

REQUIRED_CATEGORIES = {
    "direct",
    "indirect",
    "negation",
    "figurative",
    "hinglish",
    "non_crisis",
}


def load_reviewed_set(path: Path) -> pd.DataFrame:
    frame = pd.read_csv(path, keep_default_na=False)
    required = {
        "id", "category", "text", "reviewer_a", "reviewer_b", "adjudicated_label"
    }
    missing = required - set(frame.columns)
    if missing:
        raise ValueError(f"Short-text test CSV is missing columns: {', '.join(sorted(missing))}")
    if not 150 <= len(frame) <= 300:
        raise ValueError("The independent short-text test set must contain 150 to 300 rows.")
    if frame["id"].duplicated().any():
        raise ValueError("Short-text test IDs must be unique.")
    for column in required - {"id"}:
        frame[column] = frame[column].astype(str).str.strip()
    if any((frame[column] == "").any() for column in required - {"id"}):
        raise ValueError("Every test message must be double-labelled and adjudicated before evaluation.")
    for column in ("reviewer_a", "reviewer_b", "adjudicated_label"):
        invalid = set(frame[column]) - set(LABEL_TO_ID)
        if invalid:
            raise ValueError(f"{column} labels must be crisis or non_crisis.")
    categories = {category.casefold() for category in frame["category"]}
    missing_categories = REQUIRED_CATEGORIES - categories
    if missing_categories:
        raise ValueError(
            f"Test set is missing required categories: {', '.join(sorted(missing_categories))}"
        )
    labels = set(frame["adjudicated_label"])
    if labels != set(LABEL_TO_ID):
        raise ValueError("The adjudicated test set must include both crisis and non_crisis labels.")
    non_crisis_count = int((frame["adjudicated_label"] == "non_crisis").sum())
    if non_crisis_count < int(len(frame) * 0.30):
        raise ValueError("At least 30% of the independent test set must be non_crisis examples.")
    normalized_text = frame["text"].map(lambda value: " ".join(value.casefold().split()))
    if normalized_text.duplicated().any():
        raise ValueError("Short-text test messages must be unique.")
    frame["text_fingerprint"] = frame["text"].map(text_fingerprint)
    return frame


def score_reviewed_set(
    frame: pd.DataFrame,
    artifact: dict,
    encoder: SentenceTransformer | None,
) -> dict[str, object]:
    overlap = set(frame["text_fingerprint"]) & set(artifact.get("proxy_text_fingerprints", []))
    if overlap:
        raise ValueError("The independent test set overlaps the proxy training dataset.")
    labels_a = [LABEL_TO_ID[label] for label in frame["reviewer_a"]]
    labels_b = [LABEL_TO_ID[label] for label in frame["reviewer_b"]]
    consensus_labels = [LABEL_TO_ID[label] for label in frame["adjudicated_label"]]
    kappa = cohen_kappa_score(labels_a, labels_b)
    classifier = artifact["classifier"]
    if encoder is None:
        model_inputs = frame["text"].tolist()
    else:
        model_inputs = encoder.encode(
            frame["text"].tolist(),
            batch_size=32,
            convert_to_numpy=True,
            normalize_embeddings=True,
            show_progress_bar=True,
        )
    classes = list(classifier.classes_)
    positive_index = classes.index(LABEL_TO_ID["crisis"])
    probabilities = classifier.predict_proba(model_inputs)[:, positive_index]
    predictions = (probabilities >= float(artifact["threshold"])).astype(int)
    precision, recall, f1, _ = precision_recall_fscore_support(
        consensus_labels, predictions, average="binary", zero_division=0
    )
    counts = confusion_matrix(consensus_labels, predictions, labels=[0, 1]).tolist()
    category_metrics = {}
    for category in sorted(set(frame["category"].str.casefold())):
        indices = [
            index for index, value in enumerate(frame["category"].str.casefold())
            if value == category
        ]
        category_precision, category_recall, category_f1, _ = precision_recall_fscore_support(
            [consensus_labels[index] for index in indices],
            predictions[indices],
            average="binary",
            zero_division=0,
        )
        category_metrics[category] = {
            "precision": float(category_precision),
            "recall": float(category_recall),
            "f1": float(category_f1),
            "support": len(indices),
        }
    return {
        "dataset_rows": len(frame),
        "reviewer_agreement": {
            "cohen_kappa": None if pd.isna(kappa) else float(kappa),
            "exact_agreement_count": sum(a == b for a, b in zip(labels_a, labels_b)),
            "disagreement_count": sum(a != b for a, b in zip(labels_a, labels_b)),
            "adjudicated_label_source": "human consensus; required on every row",
        },
        "classifier": {
            "method": artifact["method"],
            "threshold": float(artifact["threshold"]),
            "threshold_selected_on": "proxy-labelled validation split only",
        },
        "human_authored_short_text_test_metrics": {
            "precision": float(precision),
            "recall": float(recall),
            "f1": float(f1),
            "confusion_matrix": counts,
            "confusion_matrix_labels": ["non_crisis", "crisis"],
            "per_category": category_metrics,
        },
        "limitations": (
            "Small human-authored test set; results are exploratory and do not establish clinical "
            "safety or diagnostic performance. Proxy training labels and short check-in language "
            "differ in source and domain."
        ),
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Evaluate the frozen proxy crisis classifier on a double-reviewed short-text set."
    )
    parser.add_argument("--csv", required=True, help="Completed independent reviewer CSV.")
    parser.add_argument(
        "--model",
        default="outputs/crisis-proxy-minilm/model.joblib",
        help="Research-only model artifact from train_crisis_proxy.",
    )
    parser.add_argument("--output", help="Optional JSON output path; no raw messages are exported.")
    args = parser.parse_args()

    frame = load_reviewed_set(Path(args.csv))
    artifact_path = Path(args.model)
    artifact = joblib.load(artifact_path)
    if artifact.get("task") != "crisis" or "threshold" not in artifact:
        raise ValueError("Model artifact is not a threshold-calibrated crisis classifier.")
    encoder = (
        SentenceTransformer(artifact["encoder"], device="cpu", local_files_only=True)
        if artifact.get("encoder")
        else None
    )
    report = score_reviewed_set(frame, artifact, encoder)
    report["input_sha256"] = hashlib.sha256(Path(args.csv).read_bytes()).hexdigest()
    output_path = Path(args.output) if args.output else Path(args.csv).with_suffix(".metrics.json")
    output_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(output_path), **report}, indent=2))


if __name__ == "__main__":
    main()
