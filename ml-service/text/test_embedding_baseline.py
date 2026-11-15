import unittest

import pandas as pd

from text.embedding_baseline import resolve_splits


class EmbeddingBaselineTests(unittest.TestCase):
    def test_preserves_official_dataset_split_membership(self):
        frame = pd.DataFrame({
            "text": ["a", "b", "c", "d", "e", "f"],
            "label": ["x", "y", "x", "y", "x", "y"],
            "split": ["train", "train", "validation", "validation", "test", "test"],
        })
        splits = resolve_splits(frame, "label", "split", 42)
        self.assertEqual(splits, {
            "train": [0, 1],
            "validation": [2, 3],
            "test": [4, 5],
        })

    def test_requires_all_official_splits_and_labels_in_training(self):
        frame = pd.DataFrame({
            "text": ["a", "b", "c"],
            "label": ["x", "y", "y"],
            "split": ["train", "validation", "test"],
        })
        with self.assertRaisesRegex(ValueError, "training split must contain every label"):
            resolve_splits(frame, "label", "split", 42)


if __name__ == "__main__":
    unittest.main()
