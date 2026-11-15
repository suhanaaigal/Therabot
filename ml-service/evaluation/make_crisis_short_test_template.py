from __future__ import annotations

import argparse
import csv
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Create an empty 200-row worksheet for independent human-written crisis-test messages."
    )
    parser.add_argument(
        "--output",
        default="evaluation/crisis_short_test_template.csv",
        help="Output CSV path.",
    )
    parser.add_argument("--rows", type=int, default=200)
    args = parser.parse_args()
    if not 150 <= args.rows <= 300:
        raise ValueError("The template must contain between 150 and 300 rows.")

    categories = ["direct", "indirect", "negation", "figurative", "hinglish", "non_crisis"]
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8", newline="") as destination:
        writer = csv.DictWriter(
            destination,
            fieldnames=[
                "id", "category", "text", "reviewer_a", "reviewer_b",
                "adjudicated_label", "reviewer_notes",
            ],
        )
        writer.writeheader()
        for index in range(args.rows):
            writer.writerow({
                "id": f"CT{index + 1:03d}",
                "category": categories[index % len(categories)],
                "text": "",
                "reviewer_a": "",
                "reviewer_b": "",
                "adjudicated_label": "",
                "reviewer_notes": "",
            })
    print(f"Created {args.rows} blank rows at {output}; messages and human labels remain to be supplied.")


if __name__ == "__main__":
    main()
