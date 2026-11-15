from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from transformers import AutoModelForSequenceClassification, AutoTokenizer, DataCollatorWithPadding

from text.data import read_labeled_csv
from text.training import (
    binary_metrics,
    build_dataset,
    build_trainer,
    build_training_arguments,
    predictions_from_output,
    save_split_summary,
    split_frames,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fine-tune DistilBERT for stress classification.")
    parser.add_argument("--csv", required=True, help="Local CSV containing text and label columns.")
    parser.add_argument("--text-column", default="text")
    parser.add_argument("--label-column", default="label")
    parser.add_argument("--split-column", help="Optional official train/validation/test column.")
    parser.add_argument("--positive-label", default="stress")
    parser.add_argument("--output-dir", default="models/stress")
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--lr", type=float, default=2e-5)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--seed", type=int, default=42)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    frame = read_labeled_csv(args.csv, args.text_column, args.label_column)
    frame[args.label_column] = frame[args.label_column].astype(str)
    frame = frame[frame[args.label_column].isin({args.positive_label, "not_stress"})].copy()
    if set(frame[args.label_column].unique()) != {args.positive_label, "not_stress"}:
        raise ValueError("Stress CSV must contain both positive and not_stress labels.")
    splits = split_frames(frame, args.label_column, args.split_column, args.seed)
    labels = {"not_stress": 0, args.positive_label: 1}
    tokenizer = AutoTokenizer.from_pretrained("distilbert-base-uncased")

    def dataset(partition):
        return build_dataset(
            partition,
            args.text_column,
            partition[args.label_column].map(labels).astype(int).tolist(),
            tokenizer,
        )

    train_ds, validation_ds, test_ds = (dataset(splits[name]) for name in ("train", "validation", "test"))
    model = AutoModelForSequenceClassification.from_pretrained(
        "distilbert-base-uncased",
        num_labels=2,
        id2label={0: "not_stress", 1: "stress"},
        label2id={"not_stress": 0, "stress": 1},
    )
    output_dir = Path(args.output_dir)
    trainer = build_trainer(
        model=model,
        args=build_training_arguments(
            output_dir=str(output_dir),
            num_train_epochs=args.epochs,
            learning_rate=args.lr,
            per_device_train_batch_size=args.batch_size,
            per_device_eval_batch_size=args.batch_size,
            metric_for_best_model="f1",
            seed=args.seed,
            data_seed=args.seed,
        ),
        tokenizer=tokenizer,
        data_collator=DataCollatorWithPadding(tokenizer),
        train_dataset=train_ds,
        eval_dataset=validation_ds,
        compute_metrics=lambda output: binary_metrics(
            output.label_ids.tolist(), predictions_from_output(output)
        ),
    )
    trainer.train()
    test_output = trainer.predict(test_ds, metric_key_prefix="test")
    test_metrics = binary_metrics(test_output.label_ids.tolist(), predictions_from_output(test_output))
    output_dir.mkdir(parents=True, exist_ok=True)
    trainer.save_model(str(output_dir))
    tokenizer.save_pretrained(str(output_dir))
    (output_dir / "test-metrics.json").write_text(json.dumps({
        "task": "stress",
        "base_model": "distilbert-base-uncased",
        "positive_label": args.positive_label,
        "metrics": test_metrics,
        "split_counts": {name: len(partition) for name, partition in splits.items()},
        "test_used_for_training_or_tuning": False,
    }, indent=2), encoding="utf-8")
    save_split_summary(output_dir / "split-summary.json", splits, args.seed, args.label_column)
    print(json.dumps({"output_dir": str(output_dir), "test_metrics": test_metrics}, indent=2))


if __name__ == "__main__":
    main()
