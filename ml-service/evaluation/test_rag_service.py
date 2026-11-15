import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

import rag_service


class FakeSentenceTransformer:
    def encode(self, texts, normalize_embeddings=True):
        return np.asarray([
            [1.0, 0.0] if "sleep" in text.lower() else [0.0, 1.0]
            for text in texts
        ], dtype=np.float32)


class RagServiceTests(unittest.TestCase):
    def test_retrieval_returns_relevant_local_snippets_and_caps_results(self):
        fake_module = types.ModuleType("sentence_transformers")
        fake_module.SentenceTransformer = lambda _name: FakeSentenceTransformer()
        with tempfile.TemporaryDirectory() as temporary_directory:
            with patch.dict(sys.modules, {"sentence_transformers": fake_module}), \
                    patch.object(rag_service, "_model", None), \
                    patch.object(rag_service, "EMBEDDINGS_PATH", Path(temporary_directory) / "embeddings.npz"):
                results = rag_service.retrieve("sleep has been difficult", limit=20)
        self.assertEqual(len(results), 3)
        self.assertTrue(all("sleep" in result["text"].lower() for result in results))
        self.assertTrue(all(0 <= result["similarity"] <= 1 for result in results))

    def test_empty_query_is_rejected(self):
        with self.assertRaises(ValueError):
            rag_service.retrieve("  ")


if __name__ == "__main__":
    unittest.main()
