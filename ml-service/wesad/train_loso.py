from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.base import clone
from sklearn.impute import SimpleImputer
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score, precision_score, recall_score
from sklearn.model_selection import LeaveOneGroupOut
from sklearn.pipeline import make_pipeline
from xgboost import XGBClassifier

LABEL_COLUMNS = {"subject", "start", "y"}


def _models() -> dict[str, object]:
    return {
        "random_forest": make_pipeline(
            SimpleImputer(strategy="median"),
            RandomForestClassifier(
                n_estimators=300,
                class_weight="balanced",
                random_state=0,
                n_jobs=-1,
            ),
        ),
        "xgboost": make_pipeline(
            SimpleImputer(strategy="median"),
            XGBClassifier(
                n_estimators=300,
                max_depth=4,
                learning_rate=0.05,
                subsample=0.8,
                colsample_bytree=0.8,
                reg_lambda=1,
                objective="binary:logistic",
                eval_metric="logloss",
                random_state=0,
                n_jobs=-1,
            ),
        ),
    }


def evaluate(features_csv: Path, output_dir: Path) -> tuple[pd.DataFrame, pd.DataFrame]:
    frame = pd.read_csv(features_csv)
    required = LABEL_COLUMNS | {"subject"}
    if not required.issubset(frame.columns) or frame.empty:
        raise ValueError("Feature CSV must contain subject, start, y, and at least one feature row.")
    if frame["y"].isna().any() or frame["subject"].isna().any() or frame["subject"].nunique() < 2 or not set(frame["y"].unique()).issubset({0, 1}):
        raise ValueError("LOSO evaluation requires multiple subjects and binary labels 0/1.")

    feature_columns = [column for column in frame.columns if column not in LABEL_COLUMNS]
    if not feature_columns:
        raise ValueError("No feature columns found.")
    x = frame[feature_columns].to_numpy(dtype=float)
    y = frame["y"].to_numpy(dtype=int)
    groups = frame["subject"].to_numpy()
    logo = LeaveOneGroupOut()
    subject_rows: list[dict[str, float | int | str]] = []
    importance_rows: list[dict[str, float | str]] = []

    for model_name, model_template in _models().items():
        for train_indices, test_indices in logo.split(x, y, groups):
            model = clone(model_template)
            model.fit(x[train_indices], y[train_indices])
            predictions = model.predict(x[test_indices])
            actual = y[test_indices]
            subject = str(groups[test_indices][0])
            subject_rows.append({
                "model": model_name,
                "subject": subject,
                "accuracy": accuracy_score(actual, predictions),
                "precision": precision_score(actual, predictions, zero_division=0),
                "recall": recall_score(actual, predictions, zero_division=0),
                "f1": f1_score(actual, predictions, zero_division=0),
                "tn": int(confusion_matrix(actual, predictions, labels=[0, 1])[0, 0]),
                "fp": int(confusion_matrix(actual, predictions, labels=[0, 1])[0, 1]),
                "fn": int(confusion_matrix(actual, predictions, labels=[0, 1])[1, 0]),
                "tp": int(confusion_matrix(actual, predictions, labels=[0, 1])[1, 1]),
            })
            classifier = model[-1]
            if hasattr(classifier, "feature_importances_"):
                importance_rows.extend(
                    {"model": model_name, "feature": feature, "importance": float(value)}
                    for feature, value in zip(feature_columns, classifier.feature_importances_)
                )

    # The majority baseline predicts only the most common label in each training fold.
    for train_indices, test_indices in logo.split(x, y, groups):
        majority = int(np.bincount(y[train_indices], minlength=2).argmax())
        actual = y[test_indices]
        predictions = np.full(actual.shape, majority, dtype=int)
        subject_rows.append({
            "model": "majority_baseline",
            "subject": str(groups[test_indices][0]),
            "accuracy": accuracy_score(actual, predictions),
            "precision": precision_score(actual, predictions, zero_division=0),
            "recall": recall_score(actual, predictions, zero_division=0),
            "f1": f1_score(actual, predictions, zero_division=0),
            "tn": int(confusion_matrix(actual, predictions, labels=[0, 1])[0, 0]),
            "fp": int(confusion_matrix(actual, predictions, labels=[0, 1])[0, 1]),
            "fn": int(confusion_matrix(actual, predictions, labels=[0, 1])[1, 0]),
            "tp": int(confusion_matrix(actual, predictions, labels=[0, 1])[1, 1]),
        })

    results = pd.DataFrame(subject_rows)
    output_dir.mkdir(parents=True, exist_ok=True)
    results.to_csv(output_dir / "wesad_loso_per_subject.csv", index=False)
    importance = pd.DataFrame(importance_rows)
    if not importance.empty:
        importance.groupby(["model", "feature"], as_index=False)["importance"].mean().to_csv(
            output_dir / "wesad_loso_feature_importance.csv", index=False
        )
    summary = results.groupby("model")[["accuracy", "precision", "recall", "f1"]].agg(["mean", "std"])
    summary.to_csv(output_dir / "wesad_loso_summary.csv")
    return results, summary


def main() -> None:
    parser = argparse.ArgumentParser(description="Compare wrist-only WESAD models with subject-independent LOSO.")
    parser.add_argument("--features", type=Path, default=Path("data/wesad_features.csv"))
    parser.add_argument("--output-dir", type=Path, default=Path("outputs/wesad"))
    args = parser.parse_args()
    results, summary = evaluate(args.features, args.output_dir)
    print("Per-subject results (no random window split):")
    print(results.to_string(index=False))
    print("\nMean and standard deviation across held-out subjects:")
    print(summary)


if __name__ == "__main__":
    main()
