import unittest
import tempfile
from pathlib import Path

import pandas as pd

from mood_decline import build_examples, synthetic_trajectories
from pilot_analysis import analyze_pilot


class MoodDeclineTests(unittest.TestCase):
    def test_examples_are_built_from_recent_and_future_records(self):
        records = pd.DataFrame([
            {"patient_id": "p1", "date": "2025-01-01", "band": "Green"},
            {"patient_id": "p1", "date": "2025-01-02", "band": "Green"},
            {"patient_id": "p1", "date": "2025-01-03", "band": "Orange"},
        ])
        examples = build_examples(records)
        self.assertEqual(len(examples), 2)
        self.assertEqual(examples.iloc[0]["worsened"], 1)
        self.assertIn("stress_slope", examples.columns)

    def test_synthetic_source_is_explicitly_identifiable_and_grouped(self):
        records = synthetic_trajectories(patient_count=8, days=8)
        examples = build_examples(records)
        self.assertEqual(examples["patient_id"].nunique(), 8)
        self.assertTrue(examples["patient_id"].str.startswith("synthetic-").all())
        self.assertTrue(set(examples["worsened"].unique()).issubset({0, 1}))

    def test_pilot_analysis_rejects_identifiable_extra_columns(self):
        frame = pd.DataFrame({
            "model_stress_prob": [0.2, 0.8],
            "gad7_total": [2, 15],
            "model_band": ["Green", "Red"],
            "questionnaire_band": ["Green", "Orange"],
            "patient_name": ["not used", "not used"]
        })
        with tempfile.TemporaryDirectory() as temporary_directory:
            path = Path(temporary_directory) / "pilot.csv"
            frame.to_csv(path, index=False)
            with self.assertRaisesRegex(ValueError, "four approved"):
                analyze_pilot(path)


if __name__ == "__main__":
    unittest.main()
