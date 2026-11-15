from __future__ import annotations

import argparse
import json
from pathlib import Path

from transformers import AutoModelForSequenceClassification, AutoTokenizer, DataCollatorWithPadding

from text.data import read_labeled_csv
from text.training import (
    build_dataset,
    build_trainer,
    build_training_arguments,
    multiclass_metrics,
    predictions_from_output,
    save_split_summary,
    split_frames,
)


EMOTION_LABELS = ["anxious", "sad", "angry", "positive", "neutral"]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train a grouped five-class emotion classifier.")
    parser.add_argument("--csv", required=True)
    parser.add_argument("--text-column", default="text")
    parser.add_argument("--label-column", default="label")
    parser.add_argument("--split-column", help="Optional official train/validation/test column.")
    parser.add_argument("--output-dir", default="models/emotion")
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--seed", type=int, default=42)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    frame = read_labeled_csv(args.csv, args.text_column, args.label_column)
    observed_labels = set(frame[args.label_column].astype(str).unique())
    if observed_labels != set(EMOTION_LABELS):
        raise ValueError(f"Emotion CSV must contain exactly these groups: {EMOTION_LABELS}.")
    splits = split_frames(frame, args.label_column, args.split_column, args.seed)
    mapping = {label: index for index, label in enumerate(EMOTION_LABELS)}
    tokenizer = AutoTokenizer.from_pretrained("distilbert-base-uncased")

    def dataset(partition):
        return build_dataset(
            partition,
            args.text_column,
            partition[args.label_column].map(mapping).astype(int).tolist(),
            tokenizer,
        )

    train_ds, validation_ds, test_ds = (dataset(splits[name]) for name in ("train", "validation", "test"))
    id2label = {index: label for index, label in enumerate(EMOTION_LABELS)}
    label2id = {label: index for index, label in id2label.items()}
    model = AutoModelForSequenceClassification.from_pretrained(
        "distilbert-base-uncased",
        num_labels=len(EMOTION_LABELS),
        id2label=id2label,
        label2id=label2id,
    )
    output_dir = Path(args.output_dir)
    trainer = build_trainer(
        model=model,
        args=build_training_arguments(
            output_dir=str(output_dir),
            num_train_epochs=args.epochs,
            per_device_train_batch_size=args.batch_size,
            per_device_eval_batch_size=args.batch_size,
            metric_for_best_model="macro_f1",
            seed=args.seed,
            data_seed=args.seed,
        ),
        tokenizer=tokenizer,
        data_collator=DataCollatorWithPadding(tokenizer),
        train_dataset=train_ds,
        eval_dataset=validation_ds,
        compute_metrics=lambda output: multiclass_metrics(
            output.label_ids.tolist(), predictions_from_output(output), EMOTION_LABELS
        ),
    )
    trainer.train()
    test_output = trainer.predict(test_ds, metric_key_prefix="test")
    test_metrics = multiclass_metrics(
        test_output.label_ids.tolist(), predictions_from_output(test_output), EMOTION_LABELS
    )
    output_dir.mkdir(parents=True, exist_ok=True)
    trainer.save_model(str(output_dir))
    tokenizer.save_pretrained(str(output_dir))
    (output_dir / "test-metrics.json").write_text(json.dumps({
        "task": "emotion",
        "base_model": "distilbert-base-uncased",
        "labels": EMOTION_LABELS,
        "metrics": test_metrics,
        "split_counts": {name: len(partition) for name, partition in splits.items()},
        "test_used_for_training_or_tuning": False,
    }, indent=2), encoding="utf-8")
    save_split_summary(output_dir / "split-summary.json", splits, args.seed, args.label_column)
    print(json.dumps({"output_dir": str(output_dir), "labels": EMOTION_LABELS, "test_metrics": test_metrics}, indent=2))


if __name__ == "__main__":
    main()
