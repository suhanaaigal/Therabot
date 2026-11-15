from __future__ import annotations

import argparse

from datasets import load_dataset
import pandas as pd


GROUPS = {
    "anxious": {"nervousness", "fear"},
    "sad": {"sadness", "grief", "disappointment", "remorse"},
    "angry": {"anger", "annoyance", "disgust"},
    "positive": {"joy", "optimism", "gratitude", "love", "excitement", "relief", "admiration", "amusement", "pride"},
    "neutral": {"neutral"},
}


def main() -> None:
    parser = argparse.ArgumentParser(description="Create a single-label five-group GoEmotions CSV.")
    parser.add_argument("--output", default="data/goemotions-groups.csv")
    parser.add_argument("--config", default="simplified")
    args = parser.parse_args()

    dataset = load_dataset("google-research-datasets/go_emotions", args.config)
    rows: list[dict[str, str]] = []
    for split_name, split in dataset.items():
        names = split.features["labels"].feature.names
        for item in split:
            labels = {names[index] for index in item["labels"]}
            matching_groups = [group for group, members in GROUPS.items() if labels & members]
            if len(matching_groups) == 1 and (matching_groups[0] != "neutral" or labels == {"neutral"}):
                rows.append({"text": item["text"], "label": matching_groups[0], "split": split_name})

    output = pd.DataFrame(rows).drop_duplicates(subset=["text", "label", "split"])
    output.to_csv(args.output, index=False)
    print(f"Wrote {len(output)} single-group examples to {args.output}. Raw text should remain local and private.")


if __name__ == "__main__":
    main()
