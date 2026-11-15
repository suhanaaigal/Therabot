from __future__ import annotations

import pickle
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from wesad.features import bvp_features, build_dataset, subject_rows


class WesadFeatureTests(unittest.TestCase):
    def test_bvp_features_estimate_heart_rate_from_synthetic_signal(self):
        sample_rate = 64
        seconds = np.arange(sample_rate * 60) / sample_rate
        signal = np.sin(2 * np.pi * 1.2 * seconds)

        features = bvp_features(signal)

        self.assertAlmostEqual(features["hr"], 72, delta=3)
        self.assertTrue(np.isfinite(features["sdnn"]))
        self.assertTrue(np.isfinite(features["rmssd"]))

    def test_subject_windows_use_only_clean_majority_labels(self):
        sample_rate_seconds = 120
        seconds = np.arange(64 * sample_rate_seconds) / 64
        wrist = {
            "BVP": np.sin(2 * np.pi * 1.2 * seconds),
            "EDA": np.ones(4 * sample_rate_seconds),
            "TEMP": np.full(4 * sample_rate_seconds, 32.0),
            "ACC": np.ones((32 * sample_rate_seconds, 3)),
        }
        payload = {
            "signal": {"wrist": wrist},
            "label": np.concatenate([
                np.ones(60 * 700, dtype=int),
                np.full(60 * 700, 2, dtype=int),
            ]),
        }

        with tempfile.TemporaryDirectory() as temporary_directory:
            subject_directory = Path(temporary_directory) / "S2"
            subject_directory.mkdir()
            with (subject_directory / "S2.pkl").open("wb") as target:
                pickle.dump(payload, target)

            rows = subject_rows(Path(temporary_directory), 2)

        self.assertEqual([(row["start"], row["y"]) for row in rows], [(0, 0), (60, 1)])
        self.assertEqual(rows[0]["subject"], 2)

    def test_s17_replay_serializes_missing_features_as_json_null(self):
        wrist = {
            "BVP": np.zeros(64 * 60),
            "EDA": np.ones(4 * 60),
            "TEMP": np.full(4 * 60, 32.0),
            "ACC": np.ones((32 * 60, 3)),
        }
        payload = {
            "signal": {"wrist": wrist},
            "label": np.ones(60 * 700, dtype=int),
        }

        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            subject_directory = root / "S17"
            subject_directory.mkdir()
            with (subject_directory / "S17.pkl").open("wb") as target:
                pickle.dump(payload, target)
            replay_path = root / "replay_S17.json"
            build_dataset(root, root / "features.csv", replay_path, subjects=[17])

            replay = json.loads(replay_path.read_text(encoding="utf-8"))

        self.assertIsNone(replay[0]["hr"])


if __name__ == "__main__":
    unittest.main()
