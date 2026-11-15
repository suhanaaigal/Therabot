from __future__ import annotations

import argparse
from pathlib import Path

import joblib
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.pipeline import make_pipeline

HOLDOUT_SUBJECT = 17
LABEL_COLUMNS = {"subject", "start", "y"}


def train_final(features_csv: Path, output_model: Path, holdout: int = HOLDOUT_SUBJECT) -> dict[str, object]:
    frame = pd.read_csv(features_csv)
    if not {"subject", "start", "y"}.issubset(frame.columns):
        raise ValueError("Feature CSV must contain subject, start, and y columns.")
    train = frame[frame["subject"] != holdout]
    test = frame[frame["subject"] == holdout]
    if train.empty or test.empty:
        raise ValueError(f"Both training subjects and held-out S{holdout} windows are required.")
    features = [column for column in frame.columns if column not in LABEL_COLUMNS]
    model = make_pipeline(
        SimpleImputer(strategy="median"),
        RandomForestClassifier(
            n_estimators=300,
            class_weight="balanced",
            random_state=0,
            n_jobs=-1,
        ),
    )
    model.fit(train[features].to_numpy(dtype=float), train["y"].to_numpy(dtype=int))
    artifact: dict[str, object] = {
        "model": model,
        "features": features,
        "holdout_subject": holdout,
        "training_subjects": sorted(int(value) for value in train["subject"].unique()),
        "label_meaning": {"0": "non-stress (WESAD labels 1, 3, 4)", "1": "stress (WESAD label 2)"},
    }
    output_model.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(artifact, output_model)
    print(f"Trained on {train['subject'].nunique()} subjects; held out S{holdout} ({len(test)} windows).")
    print(f"Saved model artifact to {output_model}")
    return artifact


def main() -> None:
    parser = argparse.ArgumentParser(description="Train the deployment RF on all subjects except S17.")
    parser.add_argument("--features", type=Path, default=Path("data/wesad_features.csv"))
    parser.add_argument("--output", type=Path, default=Path("models/wesad_rf.joblib"))
    parser.add_argument("--holdout", type=int, default=HOLDOUT_SUBJECT)
    args = parser.parse_args()
    train_final(args.features, args.output, args.holdout)


if __name__ == "__main__":
    main()
