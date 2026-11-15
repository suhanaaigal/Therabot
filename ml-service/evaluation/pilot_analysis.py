from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd
from scipy.stats import spearmanr
from sklearn.metrics import cohen_kappa_score


def analyze_pilot(csv_path: Path) -> dict[str, float | int | str | None]:
    frame = pd.read_csv(csv_path)
    required = {"model_stress_prob", "gad7_total", "model_band", "questionnaire_band"}
    if not required.issubset(frame.columns):
        raise ValueError(f"Pilot file must contain columns: {', '.join(sorted(required))}")
    if set(frame.columns) != required:
        raise ValueError("Pilot file must contain only the four approved, de-identified analysis columns.")
    frame = frame.dropna(subset=list(required))
    if frame.empty:
        raise ValueError("No complete pilot records are available.")
    if not frame["model_stress_prob"].between(0, 1).all():
        raise ValueError("model_stress_prob values must be between 0 and 1.")
    if not frame["gad7_total"].between(0, 21).all():
        raise ValueError("gad7_total values must be between 0 and 21.")
    allowed_bands = {"Green", "Yellow", "Orange", "Red"}
    if not set(frame["model_band"]).issubset(allowed_bands) or not set(frame["questionnaire_band"]).issubset(allowed_bands):
        raise ValueError(f"Band values must be from {sorted(allowed_bands)}.")
    if frame["model_stress_prob"].nunique() < 2 or frame["gad7_total"].nunique() < 2:
        raise ValueError("Pilot correlation is undefined when either measure is constant.")
    result = spearmanr(frame["model_stress_prob"], frame["gad7_total"])
    kappa = cohen_kappa_score(frame["model_band"], frame["questionnaire_band"], weights="quadratic")
    if pd.isna(kappa):
        raise ValueError("Quadratic weighted kappa is undefined for the supplied band data.")
    return {
        "n": int(len(frame)),
        "spearman_rho": float(result.statistic),
        "spearman_p": float(result.pvalue),
        "quadratic_weighted_kappa": float(kappa),
        "interpretation": "Exploratory consented pilot only; correlation with GAD-7 is not diagnostic validation."
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Analyze only consented, de-identified pilot summaries.")
    parser.add_argument("csv", type=Path)
    args = parser.parse_args()
    result = analyze_pilot(args.csv)
    if result["n"] < 20:
        print(f"Warning: only {result['n']} complete records; the suggested pilot size is 20–30.")
    print(result)


if __name__ == "__main__":
    main()
