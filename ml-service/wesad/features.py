from __future__ import annotations

import argparse
import json
import pickle
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from scipy.signal import butter, find_peaks, filtfilt

SUBJECTS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17]
WIN_SECONDS = 60
STEP_SECONDS = 30
LABEL_RATE = 700
WRIST_RATES = {"BVP": 64, "EDA": 4, "TEMP": 4, "ACC": 32}
FEATURE_COLUMNS = [
    "hr",
    "sdnn",
    "rmssd",
    "eda_mean",
    "eda_std",
    "eda_slope",
    "eda_peaks",
    "temp_mean",
    "temp_slope",
    "acc_mean",
    "acc_std",
]


def load_subject(data_dir: Path, subject: int) -> dict[str, Any]:
    path = data_dir / f"S{subject}" / f"S{subject}.pkl"
    if not path.is_file():
        raise FileNotFoundError(f"Missing WESAD subject file: {path}")
    # WESAD uses pickle files; only load files obtained from the official dataset.
    with path.open("rb") as source:
        return pickle.load(source, encoding="latin1")


def _finite_signal(values: np.ndarray) -> np.ndarray:
    signal = np.asarray(values, dtype=float).reshape(-1)
    if signal.size == 0 or not np.isfinite(signal).all():
        raise ValueError("A wrist signal is empty or contains non-finite values.")
    return signal


def bvp_features(values: np.ndarray) -> dict[str, float]:
    bvp = _finite_signal(values)
    if bvp.size < 10 * WRIST_RATES["BVP"]:
        return {"hr": np.nan, "sdnn": np.nan, "rmssd": np.nan}

    b, a = butter(3, [0.5, 8], btype="bandpass", fs=WRIST_RATES["BVP"])
    filtered = filtfilt(b, a, bvp)
    peaks, _ = find_peaks(
        filtered,
        distance=int(WRIST_RATES["BVP"] * 0.33),
        prominence=0.5 * float(np.std(filtered)),
    )
    ibi = np.diff(peaks) / WRIST_RATES["BVP"]
    if ibi.size < 5:
        return {"hr": np.nan, "sdnn": np.nan, "rmssd": np.nan}

    return {
        "hr": float(60 / np.mean(ibi)),
        "sdnn": float(np.std(ibi)),
        "rmssd": float(np.sqrt(np.mean(np.diff(ibi) ** 2))),
    }


def _slope(values: np.ndarray, sample_rate: int) -> float:
    signal = _finite_signal(values)
    if signal.size < 2:
        return np.nan
    seconds = np.arange(signal.size, dtype=float) / sample_rate
    return float(np.polyfit(seconds, signal, 1)[0])


def window_features(bvp: np.ndarray, eda: np.ndarray, temp: np.ndarray, acc: np.ndarray) -> dict[str, float]:
    eda_signal = _finite_signal(eda)
    temp_signal = _finite_signal(temp)
    acceleration = np.asarray(acc, dtype=float)
    if acceleration.ndim != 2 or acceleration.shape[1] != 3 or not np.isfinite(acceleration).all():
        raise ValueError("Wrist ACC must be a finite samples-by-3 array.")

    magnitude = np.sqrt(np.square(acceleration).sum(axis=1))
    return {
        **bvp_features(bvp),
        "eda_mean": float(eda_signal.mean()),
        "eda_std": float(eda_signal.std()),
        "eda_slope": _slope(eda_signal, WRIST_RATES["EDA"]),
        "eda_peaks": float(len(find_peaks(eda_signal, prominence=0.01)[0])),
        "temp_mean": float(temp_signal.mean()),
        "temp_slope": _slope(temp_signal, WRIST_RATES["TEMP"]),
        "acc_mean": float(magnitude.mean()),
        "acc_std": float(magnitude.std()),
    }


def subject_rows(data_dir: Path, subject: int) -> list[dict[str, float | int]]:
    data = load_subject(data_dir, subject)
    wrist = data["signal"]["wrist"]
    bvp = _finite_signal(wrist["BVP"])
    eda = _finite_signal(wrist["EDA"])
    temp = _finite_signal(wrist["TEMP"])
    acc = np.asarray(wrist["ACC"], dtype=float)
    labels = np.asarray(data["label"]).reshape(-1)
    if acc.ndim != 2 or acc.shape[1] != 3 or not np.isfinite(acc).all():
        raise ValueError(f"S{subject} wrist ACC must have three finite axes.")

    available_seconds = min(
        labels.size / LABEL_RATE,
        bvp.size / WRIST_RATES["BVP"],
        eda.size / WRIST_RATES["EDA"],
        temp.size / WRIST_RATES["TEMP"],
        acc.shape[0] / WRIST_RATES["ACC"],
    )
    rows: list[dict[str, float | int]] = []
    start = 0
    while start + WIN_SECONDS <= available_seconds:
        end = start + WIN_SECONDS
        label_window = labels[start * LABEL_RATE : end * LABEL_RATE]
        values, counts = np.unique(label_window, return_counts=True)
        majority_index = int(np.argmax(counts))
        majority_label = int(values[majority_index])
        purity = counts[majority_index] / label_window.size
        if majority_label in (1, 2, 3, 4) and purity >= 0.8:
            row = window_features(
                bvp[start * WRIST_RATES["BVP"] : end * WRIST_RATES["BVP"]],
                eda[start * WRIST_RATES["EDA"] : end * WRIST_RATES["EDA"]],
                temp[start * WRIST_RATES["TEMP"] : end * WRIST_RATES["TEMP"]],
                acc[start * WRIST_RATES["ACC"] : end * WRIST_RATES["ACC"]],
            )
            row.update(subject=subject, start=start, y=int(majority_label == 2))
            rows.append(row)
        start += STEP_SECONDS
    return rows


def build_dataset(
    data_dir: Path,
    output_csv: Path,
    replay_path: Path | None = None,
    subjects: list[int] | None = None,
) -> pd.DataFrame:
    selected_subjects = subjects or SUBJECTS
    rows = [row for subject in selected_subjects for row in subject_rows(data_dir, subject)]
    if not rows:
        raise ValueError("No valid WESAD windows were extracted.")
    frame = pd.DataFrame(rows, columns=["subject", "start", *FEATURE_COLUMNS, "y"])
    output_csv.parent.mkdir(parents=True, exist_ok=True)
    frame.to_csv(output_csv, index=False)

    if replay_path is not None:
        replay_rows = frame[frame["subject"] == 17]
        if replay_rows.empty:
            raise ValueError("S17 has no valid windows; cannot create its replay file.")
        replay_path.parent.mkdir(parents=True, exist_ok=True)
        windows = [
            {
                feature: None if pd.isna(value) else float(value)
                for feature, value in row.items()
            }
            for row in replay_rows[FEATURE_COLUMNS].to_dict(orient="records")
        ]
        replay_path.write_text(json.dumps(windows, allow_nan=False), encoding="utf-8")
    return frame


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract wrist-only WESAD stress features.")
    parser.add_argument("--data-dir", type=Path, default=Path("data/WESAD"))
    parser.add_argument("--output", type=Path, default=Path("data/wesad_features.csv"))
    parser.add_argument("--replay", type=Path, default=Path("replay_S17.json"))
    args = parser.parse_args()
    frame = build_dataset(args.data_dir, args.output, args.replay)
    print(f"Saved {len(frame)} wrist windows across {frame['subject'].nunique()} subjects to {args.output}")
    print(f"Saved held-out-demo source features to {args.replay}")


if __name__ == "__main__":
    main()
