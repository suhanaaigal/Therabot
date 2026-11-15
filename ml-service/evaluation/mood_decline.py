from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import f1_score, precision_score, recall_score
from sklearn.model_selection import GroupShuffleSplit
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

BAND_RISK = {"Green": 0.15, "Yellow": 0.45, "Orange": 0.65, "Red": 0.85}
FEATURE_COLUMNS = [
    "stress_mean",
    "stress_slope",
    "stress_variance",
    "stress_minimum",
    "orange_red_count",
    "days_since_previous_checkin",
]


def _risk_values(group: pd.DataFrame) -> np.ndarray:
    band_values = group["band"].map(BAND_RISK).to_numpy(dtype=float)
    if "stress_probability" in group:
        measured = pd.to_numeric(group["stress_probability"], errors="coerce").to_numpy(dtype=float)
        band_values = np.where(np.isfinite(measured), measured, band_values)
    return band_values


def build_examples(records: pd.DataFrame, horizon_days: int = 3, window_size: int = 7) -> pd.DataFrame:
    required = {"patient_id", "date", "band"}
    if not required.issubset(records.columns):
        raise ValueError(f"Input must contain {sorted(required)}.")
    if records.empty or records["patient_id"].isna().any():
        raise ValueError("Input must contain at least one identified patient sequence.")

    frame = records.copy()
    frame["date"] = pd.to_datetime(frame["date"], errors="coerce", utc=True)
    frame = frame.dropna(subset=["date", "band"]).sort_values(["patient_id", "date"])
    examples: list[dict[str, float | int | str]] = []
    for patient_id, group in frame.groupby("patient_id", sort=False):
        group = group.reset_index(drop=True)
        risks = _risk_values(group)
        timestamps = group["date"].astype("int64").to_numpy() / 1e9
        for index in range(len(group) - 1):
            history_start = max(0, index - window_size + 1)
            history = risks[history_start:index + 1]
            future_end = timestamps[index] + horizon_days * 24 * 60 * 60
            future = risks[(timestamps > timestamps[index]) & (timestamps <= future_end)]
            if not history.size or not future.size:
                continue
            previous_gap_days = (
                (timestamps[index] - timestamps[index - 1]) / (24 * 60 * 60)
                if index > 0 else float(horizon_days)
            )
            examples.append({
                "patient_id": str(patient_id),
                "date": group.loc[index, "date"].isoformat(),
                "stress_mean": float(history.mean()),
                "stress_slope": float(np.polyfit(np.arange(history.size), history, 1)[0]) if history.size > 1 else 0.0,
                "stress_variance": float(history.var()),
                "stress_minimum": float(history.min()),
                "orange_red_count": int(np.sum(history >= BAND_RISK["Orange"])),
                "days_since_previous_checkin": float(max(0.0, previous_gap_days)),
                "worsened": int(float(future.max()) > float(history.mean())),
            })
    return pd.DataFrame(examples, columns=["patient_id", "date", *FEATURE_COLUMNS, "worsened"])


def evaluate(examples: pd.DataFrame, output_path: Path) -> pd.DataFrame:
    if examples["patient_id"].nunique() < 4:
        raise ValueError("At least four distinct patients are required for grouped train/test evaluation.")
    x = examples[FEATURE_COLUMNS].to_numpy(dtype=float)
    y = examples["worsened"].to_numpy(dtype=int)
    groups = examples["patient_id"].to_numpy()
    train_indices, test_indices = next(
        GroupShuffleSplit(n_splits=1, test_size=0.25, random_state=17).split(x, y, groups)
    )
    train_patients = set(groups[train_indices])
    test_patients = set(groups[test_indices])
    if train_patients & test_patients:
        raise RuntimeError("Patient leakage detected between train and test splits.")
    if np.unique(y[train_indices]).size < 2:
        raise ValueError("Training split contains one outcome class; collect more trajectories.")

    models = {
        "logistic_regression": make_pipeline(StandardScaler(), LogisticRegression(class_weight="balanced", max_iter=1000, random_state=17)),
        "gradient_boosting": GradientBoostingClassifier(random_state=17),
    }
    predictions: dict[str, np.ndarray] = {
        "predict_no_change": np.zeros(test_indices.size, dtype=int),
        "old_threshold_rule": (x[test_indices, FEATURE_COLUMNS.index("stress_mean")] >= 0.55).astype(int),
    }
    for name, model in models.items():
        model.fit(x[train_indices], y[train_indices])
        predictions[name] = model.predict(x[test_indices])

    test_y = y[test_indices]
    rows = [
        {
            "model": name,
            "precision": precision_score(test_y, predicted, zero_division=0),
            "recall": recall_score(test_y, predicted, zero_division=0),
            "f1": f1_score(test_y, predicted, zero_division=0),
            "train_patients": len(train_patients),
            "test_patients": len(test_patients),
            "test_examples": int(test_indices.size),
        }
        for name, predicted in predictions.items()
    ]
    results = pd.DataFrame(rows)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    results.to_csv(output_path, index=False)
    return results


def synthetic_trajectories(patient_count: int = 32, days: int = 18, seed: int = 17) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    rows: list[dict[str, object]] = []
    start = pd.Timestamp("2025-01-01", tz="UTC")
    for patient_index in range(patient_count):
        baseline = rng.uniform(0.1, 0.7)
        direction = rng.choice([-1, 1])
        for day in range(days):
            stress = float(np.clip(baseline + direction * day * rng.uniform(0.005, 0.025) + rng.normal(0, 0.08), 0, 1))
            band = "Green" if stress < 0.35 else "Yellow" if stress < 0.55 else "Orange" if stress < 0.75 else "Red"
            rows.append({
                "patient_id": f"synthetic-{patient_index:03d}",
                "date": start + pd.Timedelta(days=day),
                "band": band,
                "stress_probability": stress,
            })
    return pd.DataFrame(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate short-horizon mood decline with patient-grouped splits.")
    parser.add_argument("--input", type=Path)
    parser.add_argument("--output", type=Path, default=Path("outputs/mood_decline_metrics.csv"))
    parser.add_argument("--synthetic", action="store_true", help="Use synthetic trajectories; results are not real-world evidence.")
    args = parser.parse_args()
    if args.synthetic == (args.input is not None):
        parser.error("Provide either --input with anonymized real records or --synthetic, but not both.")
    source = "synthetic demo only" if args.synthetic else "user-provided anonymized pilot data"
    records = synthetic_trajectories() if args.synthetic else pd.read_csv(args.input)
    examples = build_examples(records)
    results = evaluate(examples, args.output)
    metadata = args.output.with_suffix(".json")
    metadata.write_text(json.dumps({
        "data_source": source,
        "examples": len(examples),
        "patients": int(examples["patient_id"].nunique()),
        "interpretation": "Synthetic results demonstrate the method only; they are not real-world performance evidence." if args.synthetic else "Exploratory pilot evaluation; not proof of clinical benefit."
    }, indent=2), encoding="utf-8")
    print(f"Data source: {source}")
    print(results.to_string(index=False))


if __name__ == "__main__":
    main()
