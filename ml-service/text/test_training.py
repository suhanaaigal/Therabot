import tempfile
import unittest
from pathlib import Path

import pandas as pd

from text.training import binary_metrics, save_split_summary, split_frames
from text.metrics import choose_high_recall_threshold


class TextTrainingTests(unittest.TestCase):
    def test_seeded_stratified_splits_are_disjoint_and_reproducible(self):
        frame = pd.DataFrame({
            "text": [f"example {index}" for index in range(100)],
            "label": ["stress" if index % 2 else "not_stress" for index in range(100)],
        })
        first = split_frames(frame, "label", seed=17)
        second = split_frames(frame, "label", seed=17)
        self.assertEqual({name: list(partition.text) for name, partition in first.items()},
                         {name: list(partition.text) for name, partition in second.items()})
        membership = [set(partition.text) for partition in first.values()]
        self.assertFalse(membership[0] & membership[1])
        self.assertFalse(membership[0] & membership[2])
        self.assertFalse(membership[1] & membership[2])

    def test_official_splits_are_preserved_and_test_summary_is_marked_untouched(self):
        frame = pd.DataFrame({
            "text": ["a", "b", "c"],
            "label": ["x", "x", "x"],
            "split": ["train", "validation", "test"],
        })
        splits = split_frames(frame, "label", "split")
        self.assertEqual({name: partition.text.tolist() for name, partition in splits.items()},
                         {"train": ["a"], "validation": ["b"], "test": ["c"]})
        with tempfile.TemporaryDirectory() as temporary_directory:
            summary_path = Path(temporary_directory) / "split-summary.json"
            save_split_summary(summary_path, splits, seed=17, label_column="label")
            self.assertIn('"test_used_for_training_or_tuning": false', summary_path.read_text(encoding="utf-8"))

    def test_binary_metrics_return_confusion_matrix_in_nonpositive_positive_order(self):
        metrics = binary_metrics([0, 0, 1, 1], [0, 1, 0, 1])
        self.assertEqual(metrics["confusion_matrix"], [[1, 1], [1, 1]])
        self.assertEqual(metrics["confusion_matrix_labels"], ["not_positive", "positive"])

    def test_crisis_threshold_selection_meets_validation_recall_target(self):
        threshold, metrics = choose_high_recall_threshold(
            [1, 1, 1, 0, 0, 0],
            [0.9, 0.6, 0.4, 0.7, 0.2, 0.1],
            positive_label=1,
            target_recall=0.9,
        )
        self.assertAlmostEqual(threshold, 0.4)
        self.assertGreaterEqual(metrics["recall"], 0.9)
        self.assertEqual(metrics["precision"], 0.75)


if __name__ == "__main__":
    unittest.main()
