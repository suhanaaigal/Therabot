const assert = require('node:assert/strict');
const { test } = require('node:test');
const express = require('express');
const { analyzeTextWithMl, detectCrisisRegex } = require('./textAnalysis');

test('recognizes common misspellings of suicidal language', () => {
  assert.equal(detectCrisisRegex("I'm sucidal"), true);
  assert.equal(detectCrisisRegex('I am suicidal'), true);
});

test('accepts stress and emotion inference while reporting missing crisis model', async () => {
  const previousUrl = process.env.ML_URL;
  const server = express().use(express.json()).post('/analyze-text', (_req, res) => {
    res.json({
      stress_prob: 0.72,
      emotion: 'anxious',
      emotion_prob: 0.81,
      crisis_prob: null,
      crisis_flag: false,
      crisis_available: false,
      stress_model: 'MiniLM embeddings + Logistic Regression',
      emotion_model: 'MiniLM embeddings + Logistic Regression',
      top_words: ['deadline']
    });
  }).listen(0);

  try {
    await new Promise(resolve => server.once('listening', resolve));
    process.env.ML_URL = `http://127.0.0.1:${server.address().port}`;
    const result = await analyzeTextWithMl('I feel worried about a deadline.');
    assert.equal(result.status, 'available');
    assert.equal(result.stressProb, 0.72);
    assert.equal(result.crisisProb, null);
    assert.equal(result.crisisAvailable, false);
    assert.equal(result.stressModel, 'MiniLM embeddings + Logistic Regression');
  } finally {
    if (previousUrl === undefined) delete process.env.ML_URL;
    else process.env.ML_URL = previousUrl;
    await new Promise(resolve => server.close(resolve));
  }
});
