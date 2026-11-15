import unittest

import numpy as np
import pandas as pd

from crisis_short_test import load_reviewed_set, score_reviewed_set


class FakeEncoder:
    def encode(self, texts, **_kwargs):
        return np.asarray([[float(len(text)), 1.0] for text in texts])


class FakeClassifier:
    classes_ = np.asarray([0, 1])

    def predict_proba(self, vectors):
        scores = np.asarray(vectors)[:, 0]
        positive = np.clip(scores / max(scores.max(), 1), 0, 1)
        return np.column_stack((1 - positive, positive))


class CrisisShortTestTests(unittest.TestCase):
    def _frame(self, count=150):
        categories = ["direct", "indirect", "negation", "figurative", "hinglish", "non_crisis"]
        rows = []
        for index in range(count):
            rows.append({
                "id": f"CT{index + 1:03d}",
                "category": categories[index % len(categories)],
                "text": f"Independent neutral test message number {index}",
                "reviewer_a": "crisis" if index % 2 else "non_crisis",
                "reviewer_b": "crisis" if index % 2 else "non_crisis",
                "adjudicated_label": "crisis" if index % 2 else "non_crisis",
            })
        return pd.DataFrame(rows)

    def test_requires_full_double_reviewed_human_test_set(self):
        frame = self._frame(149)
        with self.assertRaisesRegex(ValueError, "150 to 300"):
            load_reviewed_set_from_frame(frame)

    def test_scores_kappa_and_short_text_metrics_without_exporting_text(self):
        frame = load_reviewed_set_from_frame(self._frame())
        artifact = {
            "task": "crisis",
            "method": "test fixture",
            "threshold": 0.5,
            "classifier": FakeClassifier(),
            "proxy_text_fingerprints": [],
        }
        result = score_reviewed_set(frame, artifact, FakeEncoder())
        self.assertEqual(result["dataset_rows"], 150)
        self.assertEqual(result["reviewer_agreement"]["cohen_kappa"], 1.0)
        self.assertIn("f1", result["human_authored_short_text_test_metrics"])
        self.assertNotIn("text", result)

    def test_rejects_overlap_with_proxy_corpus(self):
        frame = load_reviewed_set_from_frame(self._frame())
        artifact = {
            "method": "test fixture",
            "threshold": 0.5,
            "classifier": FakeClassifier(),
            "proxy_text_fingerprints": [frame.iloc[0]["text_fingerprint"]],
        }
        with self.assertRaisesRegex(ValueError, "overlaps"):
            score_reviewed_set(frame, artifact, FakeEncoder())


def load_reviewed_set_from_frame(frame):
    import tempfile
    from pathlib import Path

    with tempfile.TemporaryDirectory() as temporary_directory:
        path = Path(temporary_directory) / "review.csv"
        frame.to_csv(path, index=False)
        return load_reviewed_set(path)


if __name__ == "__main__":
    unittest.main()
