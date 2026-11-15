from __future__ import annotations

import argparse
import hashlib
import io
import json
import zipfile
from pathlib import Path

import pandas as pd
from sklearn.model_selection import train_test_split


def read_source(path: Path) -> pd.DataFrame:
    if path.suffix.lower() != ".zip":
        return pd.read_csv(path)
    with zipfile.ZipFile(path) as archive:
        csv_files = [name for name in archive.namelist() if name.lower().endswith(".csv")]
        if len(csv_files) != 1:
            raise ValueError("The input ZIP must contain exactly one CSV file.")
        with archive.open(csv_files[0]) as source:
            return pd.read_csv(io.TextIOWrapper(source, encoding="utf-8-sig"))


def add_stratified_splits(labels: list[str], seed: int) -> list[str]:
    indices = list(range(len(labels)))
    train_and_test, test = train_test_split(
        indices, test_size=0.15, random_state=seed, stratify=labels
    )
    train_labels = [labels[index] for index in train_and_test]
    train, validation = train_test_split(
        train_and_test, test_size=0.1765, random_state=seed, stratify=train_labels
    )
    split_names = [""] * len(labels)
    for name, split in (("train", train), ("validation", validation), ("test", test)):
        for index in split:
            split_names[index] = name
    return split_names


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Prepare a proxy-labelled crisis CSV and stratified train/validation/test split."
    )
    parser.add_argument("--input", required=True, help="Local CSV or ZIP containing one source CSV.")
    parser.add_argument('--text-column', default='text')
    parser.add_argument('--label-column', default='class')
    parser.add_argument('--positive-label', default='crisis')
    parser.add_argument('--negative-label', default='non_crisis')
    parser.add_argument('--source-name', default='Unspecified source')
    parser.add_argument('--source-url', default='')
    parser.add_argument('--source-license', default='Unverified')
    parser.add_argument('--seed', type=int, default=42)
    parser.add_argument('--output', default='data/crisis_proxy.csv')
    args = parser.parse_args()

    input_path = Path(args.input)
    frame = read_source(input_path)
    required = {args.text_column, args.label_column}
    missing = required - set(frame.columns)
    if missing:
        raise ValueError(f"CSV is missing required columns: {', '.join(sorted(missing))}")
    frame = frame[[args.text_column, args.label_column]].dropna().copy()
    frame[args.text_column] = frame[args.text_column].astype(str).str.strip()
    frame = frame[frame[args.text_column].str.len() > 0].reset_index(drop=True)
    frame[args.label_column] = frame[args.label_column].astype(str).str.strip()
    rename_map = {args.text_column: 'text', args.label_column: 'label'}
    cleaned = frame.rename(columns=rename_map)
    label_mapping = {
        str(args.positive_label): 'crisis',
        str(args.negative_label): 'non_crisis',
    }
    cleaned = cleaned[cleaned['label'].isin(label_mapping)].copy()
    if set(cleaned['label'].unique()) != set(label_mapping):
        raise ValueError('The selected source labels must include both positive and negative examples.')
    cleaned['label'] = cleaned['label'].map(label_mapping)
    cleaned = cleaned.drop_duplicates(subset="text").reset_index(drop=True)
    cleaned["split"] = add_stratified_splits(cleaned["label"].tolist(), args.seed)
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    cleaned.to_csv(output_path, index=False)
    split_counts = cleaned["split"].value_counts().to_dict()
    label_counts = {
        split: cleaned.loc[cleaned["split"] == split, "label"].value_counts().to_dict()
        for split in ("train", "validation", "test")
    }
    metadata = {
        "source_name": args.source_name,
        "source_url": args.source_url,
        "source_license": args.source_license,
        "source_file_sha256": hashlib.sha256(input_path.read_bytes()).hexdigest(),
        "source_label_column": args.label_column,
        "source_label_mapping": {
            str(args.positive_label): "crisis",
            str(args.negative_label): "non_crisis",
        },
        "label_provenance": "Proxy labels supplied by the dataset; not clinician-reviewed.",
        "seed": args.seed,
        "rows_after_deduplication": len(cleaned),
        "split_counts": split_counts,
        "label_counts": label_counts,
        "short_text_test_set_used_for_training_or_tuning": False,
    }
    output_path.with_suffix(".metadata.json").write_text(
        json.dumps(metadata, indent=2), encoding="utf-8"
    )
    print(json.dumps(metadata, indent=2))


if __name__ == '__main__':
    main()
