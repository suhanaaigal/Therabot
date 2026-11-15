import unittest
import tempfile
from pathlib import Path

import pandas as pd

from fusion_sensitivity import band_for, sensitivity_table, write_svg


class FusionSensitivityTests(unittest.TestCase):
    def test_band_boundaries(self):
        self.assertEqual(band_for(0.34), "Green")
        self.assertEqual(band_for(0.35), "Yellow")
        self.assertEqual(band_for(0.55), "Orange")
        self.assertEqual(band_for(0.75), "Red")
        with self.assertRaises(ValueError):
            band_for(float("nan"))

    def test_weight_variation_reports_band_counts_and_changes(self):
        frame = pd.DataFrame({
            "text_stress_prob": [0.8, 0.1],
            "physiology_stress_prob": [0.1, 0.8],
        })
        result = sensitivity_table(frame, [0.0, 0.6, 1.0])
        self.assertEqual(len(result), 12)
        default = result[result.text_weight == 0.6]
        self.assertTrue((default["changed_from_0.6_0.4"] == 0).all())
        self.assertTrue(result[result.text_weight == 0.0]["changed_from_0.6_0.4"].iloc[0] > 0)
        with tempfile.TemporaryDirectory() as temporary_directory:
            target = Path(temporary_directory) / "sensitivity.svg"
            write_svg(result, target)
            self.assertIn('width="760"', target.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
