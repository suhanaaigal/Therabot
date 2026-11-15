from __future__ import annotations

import inspect
from typing import Any

from datasets import Dataset
from sklearn.metrics import accuracy_score, confusion_matrix, precision_recall_fscore_support
from transformers import Trainer, TrainingArguments

from text.data import split_indices


def split_frames(frame, label_column: str, split_column: str | None = None, seed: int = 42):
    if split_column and split_column in frame.columns:
        normalized = frame[split_column].astype(str).str.lower().replace({"val": "validation", "dev": "validation"})
        unknown = set(normalized) - {"train", "validation", "test"}
        if unknown:
            raise ValueError(f"Unexpected data split names: {sorted(unknown)}")
        partitions = {
            name: frame.loc[normalized == name].drop(columns=[split_column]).reset_index(drop=True)
            for name in ("train", "validation", "test")
        }
        if any(partition.empty for partition in partitions.values()):
            raise ValueError("An explicit split column must include train, validation, and test records.")
        return partitions

    labels = frame[label_column].astype(str).tolist()
    indices = split_indices(labels, seed)
    split_frame = {
        name: frame.iloc[values].reset_index(drop=True)
        for name, values in indices.items()
    }
    return split_frame


def save_split_summary(path, splits, seed: int, label_column: str) -> None:
    payload: dict[str, Any] = {
        "seed": seed,
        "split_counts": {name: len(frame) for name, frame in splits.items()},
        "label_counts": {
            name: frame[label_column].astype(str).value_counts().to_dict()
            for name, frame in splits.items()
        },
        "test_used_for_training_or_tuning": False,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    import json
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def build_dataset(frame, text_column: str, labels: list[int], tokenizer):
    dataset = Dataset.from_dict({
        "text": frame[text_column].astype(str).tolist(),
        "label": labels,
    })

    def encode(batch):
        return tokenizer(batch["text"], truncation=True, max_length=256)

    return dataset.map(encode, batched=True, remove_columns=["text"])


def build_training_arguments(**kwargs):
    parameters = inspect.signature(TrainingArguments).parameters
    evaluation_key = "eval_strategy" if "eval_strategy" in parameters else "evaluation_strategy"
    values = {
        "output_dir": kwargs.pop("output_dir"),
        "num_train_epochs": kwargs.pop("num_train_epochs", 3),
        "learning_rate": kwargs.pop("learning_rate", 2e-5),
        "per_device_train_batch_size": kwargs.pop("per_device_train_batch_size", 8),
        "per_device_eval_batch_size": kwargs.pop("per_device_eval_batch_size", 8),
        "save_strategy": "epoch",
        "load_best_model_at_end": True,
        "metric_for_best_model": kwargs.pop("metric_for_best_model", "f1"),
        "report_to": [],
        evaluation_key: "epoch",
        **kwargs,
    }
    return TrainingArguments(**values)


def build_trainer(*, model, args, tokenizer, data_collator, train_dataset, eval_dataset, compute_metrics):
    parameters = inspect.signature(Trainer.__init__).parameters
    processing_argument = "processing_class" if "processing_class" in parameters else "tokenizer"
    return Trainer(
        model=model,
        args=args,
        data_collator=data_collator,
        train_dataset=train_dataset,
        eval_dataset=eval_dataset,
        compute_metrics=compute_metrics,
        **{processing_argument: tokenizer},
    )


def binary_metrics(truth, predicted) -> dict[str, Any]:
    precision, recall, f1, _ = precision_recall_fscore_support(
        truth, predicted, average="binary", zero_division=0
    )
    return {
        "accuracy": float(accuracy_score(truth, predicted)),
        "precision": float(precision),
        "recall": float(recall),
        "f1": float(f1),
        "confusion_matrix": confusion_matrix(truth, predicted, labels=[0, 1]).tolist(),
        "confusion_matrix_labels": ["not_positive", "positive"],
    }


def multiclass_metrics(truth, predicted, label_names: list[str]) -> dict[str, Any]:
    precision, recall, f1, _ = precision_recall_fscore_support(
        truth, predicted, average="macro", zero_division=0
    )
    return {
        "accuracy": float(accuracy_score(truth, predicted)),
        "macro_precision": float(precision),
        "macro_recall": float(recall),
        "macro_f1": float(f1),
        "confusion_matrix": confusion_matrix(truth, predicted, labels=list(range(len(label_names)))).tolist(),
        "confusion_matrix_labels": label_names,
    }


def predictions_from_output(output):
    return np.argmax(output.predictions, axis=1).tolist()
