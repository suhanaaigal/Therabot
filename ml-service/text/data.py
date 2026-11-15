from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pandas as pd
from sklearn.model_selection import train_test_split


def read_labeled_csv(path: str, text_column: str, label_column: str) -> pd.DataFrame:
    data = pd.read_csv(path)
    missing = {text_column, label_column} - set(data.columns)
    if missing:
        raise ValueError(f"CSV is missing required columns: {', '.join(sorted(missing))}")
    data = data[[text_column, label_column]].dropna().copy()
    data[text_column] = data[text_column].astype(str).str.strip()
    data = data[data[text_column].str.len() > 0].reset_index(drop=True)
    if data[label_column].nunique() < 2:
        raise ValueError("Training data must contain at least two labels.")
    if data[label_column].value_counts().min() < 3:
        raise ValueError("Every label needs at least three examples for stratified train/validation/test splits.")
    return data


def split_indices(labels: list[str], seed: int) -> dict[str, list[int]]:
    indices = list(range(len(labels)))
    train_and_test, test = train_test_split(
        indices, test_size=0.15, random_state=seed, stratify=labels
    )
    train_labels = [labels[index] for index in train_and_test]
    train, validation = train_test_split(
        train_and_test, test_size=0.1765, random_state=seed, stratify=train_labels
    )
    return {"train": train, "validation": validation, "test": test}


def save_split(path: Path, splits: dict[str, list[int]], labels: list[str], seed: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"seed": seed, "splits": splits, "labels": sorted(set(labels))}, indent=2),
        encoding="utf-8",
    )


def load_split(path: Path, expected_count: int) -> dict[str, list[int]]:
    payload: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    splits = payload["splits"]
    all_indices = [index for values in splits.values() for index in values]
    if sorted(all_indices) != list(range(expected_count)):
        raise ValueError("Saved split does not match the current CSV; regenerate the split to avoid invalid evaluation.")
    return splits
