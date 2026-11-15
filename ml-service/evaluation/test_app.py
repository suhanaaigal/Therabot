import sys
import types
import unittest
from unittest.mock import patch

import numpy as np
from fastapi import HTTPException

import app


class MlServiceAppTests(unittest.TestCase):
    def test_empty_text_returns_empty_analysis_even_when_models_are_missing(self):
        with patch.object(app, "stress_clf", None), patch.object(app, "emotion_clf", None), patch.object(app, "crisis_clf", None):
            result = app.analyze(app.TextIn(text="   "))
        self.assertEqual(result["emotion"], "neutral")
        self.assertFalse(result["crisis_flag"])
        self.assertFalse(result["crisis_available"])
        self.assertEqual(result["top_words"], [])

    def test_pipeline_class_labels_use_named_stress_emotion_and_crisis_groups(self):
        class FakeClassifier:
            def __init__(self, outputs):
                self.outputs = outputs

            def __call__(self, _text):
                return [self.outputs]

        with patch.object(app, "stress_clf", FakeClassifier([
            {"label": "not_stress", "score": 0.2},
            {"label": "stress", "score": 0.8},
        ])), patch.object(app, "emotion_clf", FakeClassifier([
            {"label": label, "score": float(label == "anxious")}
            for label in ["anxious", "sad", "angry", "positive", "neutral"]
        ])), patch.object(app, "crisis_clf", FakeClassifier([
            {"label": "non_crisis", "score": 0.8},
            {"label": "crisis", "score": 0.2},
        ])):
            result = app.analyze(app.TextIn(text="A short message"))
        self.assertEqual(result["stress_prob"], 0.8)
        self.assertEqual(result["emotion"], "anxious")
        self.assertEqual(result["crisis_prob"], 0.2)
        self.assertTrue(result["crisis_available"])

    def test_stress_and_emotion_work_without_claiming_a_missing_crisis_model(self):
        class FakeClassifier:
            def __init__(self, outputs):
                self.outputs = outputs

            def __call__(self, _text):
                return [self.outputs]

        with patch.object(app, "stress_clf", FakeClassifier([
            {"label": "not_stress", "score": 0.3},
            {"label": "stress", "score": 0.7},
        ])), patch.object(app, "emotion_clf", FakeClassifier([
            {"label": "anxious", "score": 0.8},
            {"label": "sad", "score": 0.2},
        ])), patch.object(app, "crisis_clf", None):
            result = app.analyze(app.TextIn(text="A short message"))
        self.assertEqual(result["stress_prob"], 0.7)
        self.assertEqual(result["emotion"], "anxious")
        self.assertIsNone(result["crisis_prob"])
        self.assertFalse(result["crisis_flag"])
        self.assertFalse(result["crisis_available"])

    def test_minilm_artifacts_use_the_shared_encoder_and_named_group_labels(self):
        class FakeEncoder:
            def encode(self, texts, **_kwargs):
                return [[1.0, 0.0] for _ in texts]

        class FakeLogisticRegression:
            def __init__(self, classes, scores):
                self.classes_ = classes
                self.scores = scores

            def predict_proba(self, _vectors):
                return np.asarray([self.scores for _ in _vectors])

        stress = {
            "method": "MiniLM embeddings + Logistic Regression",
            "encoder": "cached-test-encoder",
            "classifier": FakeLogisticRegression(["not_stress", "stress"], [0.2, 0.8]),
        }
        emotion = {
            "method": "MiniLM embeddings + Logistic Regression",
            "encoder": "cached-test-encoder",
            "classifier": FakeLogisticRegression(["anxious", "sad"], [0.75, 0.25]),
        }
        with patch.object(app, "stress_clf", stress), patch.object(app, "emotion_clf", emotion), \
                patch.object(app, "crisis_clf", None), patch.object(app, "_embedding_model", FakeEncoder()):
            result = app.analyze(app.TextIn(text="A short message"))
        self.assertEqual(result["stress_prob"], 0.8)
        self.assertEqual(result["emotion"], "anxious")
        self.assertEqual(result["stress_model"], "MiniLM embeddings + Logistic Regression")
        self.assertFalse(result["crisis_available"])

    def test_optional_retrieval_returns_explicit_unavailable_without_dependency(self):
        with patch.object(app.importlib.util, "find_spec", return_value=None):
            with self.assertRaises(HTTPException) as raised:
                app.retrieve_coping(app.CopingQuery(query="I feel stressed"))
        self.assertEqual(raised.exception.status_code, 503)

    def test_retrieval_endpoint_delegates_to_optional_local_service(self):
        retrieval_module = types.ModuleType("rag_service")
        retrieval_module.retrieve = lambda query, limit: [{"id": "test", "text": query, "similarity": 0.9}]
        with patch.object(app.importlib.util, "find_spec", return_value=object()), patch.dict(sys.modules, {"rag_service": retrieval_module}):
            result = app.retrieve_coping(app.CopingQuery(query="A difficult day"))
        self.assertEqual(result["model"], "all-MiniLM-L6-v2")
        self.assertEqual(result["snippets"][0]["id"], "test")

    def test_retrieval_failures_are_reported_as_unavailable(self):
        retrieval_module = types.ModuleType("rag_service")
        retrieval_module.retrieve = lambda _query, _limit: (_ for _ in ()).throw(RuntimeError("model unavailable"))
        with patch.object(app.importlib.util, "find_spec", return_value=object()), patch.dict(sys.modules, {"rag_service": retrieval_module}):
            with self.assertRaises(HTTPException) as raised:
                app.retrieve_coping(app.CopingQuery(query="A difficult day"))
        self.assertEqual(raised.exception.status_code, 503)


if __name__ == "__main__":
    unittest.main()
