from __future__ import annotations

import argparse
import json
from pathlib import Path

from scipy.special import softmax
from transformers import AutoModelForSequenceClassification, AutoTokenizer, DataCollatorWithPadding

from text.data import read_labeled_csv
from text.metrics import choose_high_recall_threshold
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
    parser = argparse.ArgumentParser(description="Train a crisis-related text classifier.")
    parser.add_argument("--csv", required=True)
    parser.add_argument("--text-column", default="text")
    parser.add_argument("--label-column", default="label")
    parser.add_argument("--split-column", help="Optional official train/validation/test column.")
    parser.add_argument("--output-dir", default="models/crisis")
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--seed", type=int, default=42)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    frame = read_labeled_csv(args.csv, args.text_column, args.label_column)
    frame[args.label_column] = frame[args.label_column].astype(str)
    allowed_labels = {"crisis", "non_crisis"}
    frame = frame[frame[args.label_column].isin(allowed_labels)].copy()
    if set(frame[args.label_column].unique()) != allowed_labels:
        raise ValueError(f"Crisis CSV must contain both labels: {sorted(allowed_labels)}.")
    splits = split_frames(frame, args.label_column, args.split_column, args.seed)
    label_mapping = {"non_crisis": 0, "crisis": 1}
    tokenizer = AutoTokenizer.from_pretrained("distilbert-base-uncased")

    def dataset(partition):
        return build_dataset(
            partition,
            args.text_column,
            partition[args.label_column].map(label_mapping).astype(int).tolist(),
            tokenizer,
        )

    train_ds, validation_ds, test_ds = (dataset(splits[name]) for name in ("train", "validation", "test"))
    model = AutoModelForSequenceClassification.from_pretrained(
        "distilbert-base-uncased",
        num_labels=2,
        id2label={0: "non_crisis", 1: "crisis"},
        label2id=label_mapping,
    )
    output_dir = Path(args.output_dir)
    trainer = build_trainer(
        model=model,
        args=build_training_arguments(
            output_dir=str(output_dir),
            num_train_epochs=args.epochs,
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
    validation_output = trainer.predict(validation_ds, metric_key_prefix="validation_threshold")
    validation_probabilities = softmax(validation_output.predictions, axis=1)[:, 1]
    threshold, threshold_metrics = choose_high_recall_threshold(
        validation_output.label_ids.tolist(),
        validation_probabilities.tolist(),
        positive_label=1,
        target_recall=0.90,
    )
    trainer.model.config.crisis_threshold = threshold
    test_output = trainer.predict(test_ds, metric_key_prefix="test")
    test_metrics = binary_metrics(test_output.label_ids.tolist(), predictions_from_output(test_output))
    output_dir.mkdir(parents=True, exist_ok=True)
    trainer.save_model(str(output_dir))
    tokenizer.save_pretrained(str(output_dir))
    (output_dir / "test-metrics.json").write_text(json.dumps({
        "task": "crisis",
        "base_model": "distilbert-base-uncased",
        "positive_label": "crisis",
        "metrics": test_metrics,
        "validation_threshold": threshold,
        "validation_threshold_metrics": threshold_metrics,
        "split_counts": {name: len(partition) for name, partition in splits.items()},
        "test_used_for_training_or_tuning": False,
        "label_limitations": "Labels sourced from online communities are noisy proxies and do not establish clinical risk.",
    }, indent=2), encoding="utf-8")
    save_split_summary(output_dir / "split-summary.json", splits, args.seed, args.label_column)
    print(json.dumps({"output_dir": str(output_dir), "test_metrics": test_metrics}, indent=2))


if __name__ == "__main__":
    main()
