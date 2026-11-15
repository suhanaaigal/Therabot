from __future__ import annotations

import argparse
import json
from pathlib import Path

import joblib
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline

from text.data import read_labeled_csv, save_split, split_indices
from text.metrics import classification_metrics


def main() -> None:
    parser = argparse.ArgumentParser(description="Train and test the TF-IDF/logistic-regression stress baseline.")
    parser.add_argument("--input", required=True, help="Local CSV with text and label columns.")
    parser.add_argument("--text-column", default="text")
    parser.add_argument("--label-column", default="label")
    parser.add_argument("--positive-label", required=True, help="Exact label value meaning stress.")
    parser.add_argument("--output-dir", default="outputs/stress-baseline")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    data = read_labeled_csv(args.input, args.text_column, args.label_column)
    labels = data[args.label_column].astype(str).tolist()
    if args.positive_label not in labels:
        raise ValueError("The configured positive label is not present in the input CSV.")
    splits = split_indices(labels, args.seed)
    output_dir = Path(args.output_dir)
    save_split(output_dir / "split.json", splits, labels, args.seed)
    train_texts = data.iloc[splits["train"]][args.text_column].tolist()
    train_labels = [labels[index] for index in splits["train"]]
    test_texts = data.iloc[splits["test"]][args.text_column].tolist()
    test_labels = [labels[index] for index in splits["test"]]

    classifier = make_pipeline(
        TfidfVectorizer(ngram_range=(1, 2), min_df=2, sublinear_tf=True),
        LogisticRegression(max_iter=1000, class_weight="balanced", random_state=args.seed),
    )
    classifier.fit(train_texts, train_labels)
    predictions = classifier.predict(test_texts).tolist()
    positive_id = list(classifier.classes_).index(args.positive_label)
    metrics = classification_metrics(
        [int(label == args.positive_label) for label in test_labels],
        [int(label == args.positive_label) for label in predictions],
        positive_label=1,
    )
    output_dir.mkdir(parents=True, exist_ok=True)
    joblib.dump(classifier, output_dir / "baseline.joblib")
    (output_dir / "test-metrics.json").write_text(json.dumps({
        "task": "stress",
        "split": "untouched test split",
        "labels": list(classifier.classes_),
        "positive_label": args.positive_label,
        "positive_class_id": positive_id,
        "metrics": metrics,
    }, indent=2), encoding="utf-8")
    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()
