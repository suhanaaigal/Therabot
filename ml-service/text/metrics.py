from __future__ import annotations

from typing import Any

import numpy as np
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    precision_recall_fscore_support,
)


def classification_metrics(
    truth: list[int], predicted: list[int], positive_label: int | None = None
) -> dict[str, Any]:
    labels = sorted(set(truth) | set(predicted))
    average = "binary" if positive_label is not None else "macro"
    precision, recall, f1, _ = precision_recall_fscore_support(
        truth,
        predicted,
        labels=[positive_label] if positive_label is not None else labels,
        average=average,
        zero_division=0,
    )
    return {
        "accuracy": float(accuracy_score(truth, predicted)),
        "precision": float(precision),
        "recall": float(recall),
        "f1": float(f1),
        "confusion_matrix": confusion_matrix(truth, predicted, labels=labels).tolist(),
        "confusion_matrix_labels": labels,
    }


def choose_high_recall_threshold(
    truth: list[int], probabilities: list[float], positive_label: int, target_recall: float = 0.90
) -> tuple[float, dict[str, Any]]:
    scores = np.asarray(probabilities, dtype=float)
    truth_array = np.asarray(truth, dtype=int)
    candidates = np.unique(np.concatenate(([0.0], scores, [1.0])))
    eligible: list[tuple[float, float, dict[str, Any]]] = []

    for threshold in candidates:
        predicted = (scores >= threshold).astype(int).tolist()
        metrics = classification_metrics(truth, predicted, positive_label)
        if metrics["recall"] >= target_recall:
            eligible.append((metrics["precision"], float(threshold), metrics))

    if not eligible:
        raise ValueError(f"No validation threshold reaches the requested recall of {target_recall:.2f}.")
    _, threshold, metrics = max(eligible, key=lambda item: (item[0], item[1]))
    metrics["target_recall"] = target_recall
    return threshold, metrics
