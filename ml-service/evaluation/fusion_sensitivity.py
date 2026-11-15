from __future__ import annotations

import argparse
import html
import math
from pathlib import Path

import pandas as pd


BANDS = [("Green", "#65a30d"), ("Yellow", "#eab308"), ("Orange", "#f97316"), ("Red", "#dc2626")]


def band_for(probability: float) -> str:
    if not math.isfinite(probability) or not 0 <= probability <= 1:
        raise ValueError("Stress probability must be finite and in [0, 1].")
    if probability < 0.35:
        return "Green"
    if probability < 0.55:
        return "Yellow"
    if probability < 0.75:
        return "Orange"
    return "Red"


def sensitivity_table(frame: pd.DataFrame, weights: list[float]) -> pd.DataFrame:
    required = {"text_stress_prob", "physiology_stress_prob"}
    if not required.issubset(frame.columns):
        raise ValueError(f"Input must contain {sorted(required)}.")
    if not weights:
        raise ValueError("Provide at least one text fusion weight.")
    paired = frame.dropna(subset=list(required)).copy()
    if paired.empty:
        raise ValueError("No paired text and physiology probabilities are available.")
    if ((paired[list(required)] < 0) | (paired[list(required)] > 1)).any().any():
        raise ValueError("Stress probabilities must be in [0, 1].")
    rows = []
    for text_weight in weights:
        if not 0 <= text_weight <= 1:
            raise ValueError("Fusion weights must be in [0, 1].")
        probabilities = text_weight * paired["text_stress_prob"] + (1 - text_weight) * paired["physiology_stress_prob"]
        bands = probabilities.map(band_for)
        for band, _ in BANDS:
            rows.append({
                "text_weight": text_weight,
                "physiology_weight": 1 - text_weight,
                "band": band,
                "count": int((bands == band).sum()),
                "changed_from_0.6_0.4": None,
            })
    base = (0.6 * paired["text_stress_prob"] + 0.4 * paired["physiology_stress_prob"]).map(band_for)
    for row in rows:
        weight = row["text_weight"]
        current = (weight * paired["text_stress_prob"] + (1 - weight) * paired["physiology_stress_prob"]).map(band_for)
        row["changed_from_0.6_0.4"] = int((current.to_numpy() != base.to_numpy()).sum())
    return pd.DataFrame(rows)


def write_svg(summary: pd.DataFrame, path: Path) -> None:
    weights = sorted(summary["text_weight"].unique())
    width, row_height, left, top = 760, 42, 190, 45
    plot_width = 500
    height = top + row_height * len(weights) + 60
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
        '<rect width="100%" height="100%" fill="white"/>',
        '<text x="20" y="25" font-family="sans-serif" font-size="16">Sensitivity of risk bands to text/physiology fusion weights</text>',
    ]
    for index, weight in enumerate(weights):
        y = top + index * row_height
        parts.append(f'<text x="15" y="{y + 20}" font-family="sans-serif" font-size="12">{weight:.1f} text / {1-weight:.1f} physiology</text>')
        current_x = left
        row = summary[summary["text_weight"] == weight].set_index("band")
        total_count = max(1, int(row["count"].sum()))
        for band, color in BANDS:
            count = int(row.loc[band, "count"])
            bar_width = count / total_count * plot_width
            parts.append(f'<rect x="{current_x}" y="{y}" width="{bar_width:.2f}" height="22" fill="{color}"/>')
            if count:
                parts.append(f'<text x="{current_x + bar_width / 2:.2f}" y="{y + 16}" text-anchor="middle" fill="white" font-family="sans-serif" font-size="11">{count}</text>')
            current_x += bar_width
    legend_y = height - 20
    for index, (band, color) in enumerate(BANDS):
        x = left + index * 120
        parts.append(f'<rect x="{x}" y="{legend_y - 12}" width="12" height="12" fill="{color}"/>')
        parts.append(f'<text x="{x + 18}" y="{legend_y - 2}" font-family="sans-serif" font-size="12">{html.escape(band)}</text>')
    parts.append("</svg>")
    path.write_text("\n".join(parts), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate a paired-data fusion-weight sensitivity table and SVG.")
    parser.add_argument("input", type=Path, help="CSV with text_stress_prob and physiology_stress_prob columns.")
    parser.add_argument("--output-dir", type=Path, default=Path("outputs/fusion-sensitivity"))
    args = parser.parse_args()
    summary = sensitivity_table(pd.read_csv(args.input), [0.4, 0.5, 0.6, 0.7, 0.8])
    args.output_dir.mkdir(parents=True, exist_ok=True)
    summary.to_csv(args.output_dir / "fusion_sensitivity.csv", index=False)
    write_svg(summary, args.output_dir / "fusion_sensitivity.svg")
    print(summary.to_string(index=False))
    print("Sensitivity uses only paired input rows; thresholds and weights are prototype design choices.")


if __name__ == "__main__":
    main()
