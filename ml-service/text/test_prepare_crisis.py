import tempfile
import unittest
import zipfile
from pathlib import Path

import pandas as pd

from text.prepare_crisis import add_stratified_splits, read_source


class PrepareCrisisTests(unittest.TestCase):
    def test_stratified_split_is_deterministic_and_complete(self):
        labels = ["crisis"] * 100 + ["non_crisis"] * 100
        splits = add_stratified_splits(labels, seed=7)
        self.assertEqual(len(splits), len(labels))
        self.assertEqual(set(splits), {"train", "validation", "test"})
        self.assertEqual(splits, add_stratified_splits(labels, seed=7))

    def test_reads_single_csv_from_zip(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            path = Path(temporary_directory) / "dataset.zip"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("source.csv", "text,class\nExample,crisis\n")
            frame = read_source(path)
        self.assertEqual(frame.to_dict("records"), [{"text": "Example", "class": "crisis"}])


if __name__ == "__main__":
    unittest.main()
