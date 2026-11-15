from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd
from datasets import load_dataset


DATASET_URL = "https://huggingface.co/datasets/asmaab/dreaddit_train/resolve/main/dreaddit_train.csv"


def main() -> None:
    parser = argparse.ArgumentParser(description="Prepare the public Dreaddit CSV locally for stress training.")
    parser.add_argument("--input", type=Path, help="Optional downloaded Dreaddit CSV; otherwise download the public file.")
    parser.add_argument("--output", type=Path, default=Path("data/dreaddit_stress.csv"))
    parser.add_argument("--text-column", default="post")
    parser.add_argument("--label-column", default="label")
    parser.add_argument("--positive-label", default="yes")
    parser.add_argument("--negative-label", default="no")
    args = parser.parse_args()

    if args.input:
        frame = pd.read_csv(args.input)
    else:
        dataset = load_dataset("csv", data_files={"train": DATASET_URL}, split="train")
        frame = dataset.to_pandas()
    required = {args.text_column, args.label_column}
    if not required.issubset(frame.columns):
        raise ValueError(f"Dreaddit file must contain columns {sorted(required)}.")
    cleaned = frame[[args.text_column, args.label_column]].dropna().copy()
    cleaned[args.text_column] = cleaned[args.text_column].astype(str).str.strip()
    cleaned[args.label_column] = cleaned[args.label_column].astype(str).str.strip().str.lower()
    cleaned = cleaned[cleaned[args.text_column].str.len() > 0]
    labels = {
        str(args.positive_label).lower(): "stress",
        str(args.negative_label).lower(): "not_stress",
    }
    cleaned = cleaned[cleaned[args.label_column].isin(labels)].rename(columns={args.text_column: "text"})
    cleaned["label"] = cleaned.pop(args.label_column).map(labels)
    cleaned = cleaned[["text", "label"]].drop_duplicates().reset_index(drop=True)
    if set(cleaned["label"].unique()) != {"stress", "not_stress"}:
        raise ValueError("Both positive and negative stress labels must be present.")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    cleaned.to_csv(args.output, index=False)
    metadata = {
        "dataset": "Dreaddit",
        "source": DATASET_URL if not args.input else str(args.input),
        "rows": len(cleaned),
        "label_counts": cleaned["label"].value_counts().to_dict(),
        "raw_text_storage": str(args.output),
        "warning": "Sensitive Reddit-derived text. Keep local, do not publish raw posts, and describe source labels as noisy.",
    }
    args.output.with_suffix(".metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    print(json.dumps({key: value for key, value in metadata.items() if key != "raw_text_storage"}, indent=2))


if __name__ == "__main__":
    main()
