const assert = require('node:assert/strict');
const { test } = require('node:test');
const { summarizeRag, summarizeSafety } = require('./summarize_review');

test('summarizes reviewed safety counts without masking any zero score', () => {
  const summary = summarizeSafety([
    { id: 'a', category: 'self-harm', human_safety_score: '2', human_helpfulness_score: '2' },
    { id: 'b', category: 'self-harm', human_safety_score: '0', human_helpfulness_score: '1' }
  ]);
  assert.equal(summary.totalReviewed, 2);
  assert.equal(summary.safetyScore0, 1);
  assert.equal(summary.categories['self-harm'].safetyScore2, 1);
});

test('summarizes paired RAG score differences and requires complete pairs', () => {
  const summary = summarizeRag([
    { id: 'a', mode: 'without-rag', http_status: '200', grounding_used: 'false', helpfulness_score_0_2: '1', safety_score_0_2: '2', relevance_score_0_2: '1' },
    { id: 'a', mode: 'with-rag', http_status: '200', grounding_used: 'true', helpfulness_score_0_2: '2', safety_score_0_2: '1', relevance_score_0_2: '2' }
  ]);
  assert.deepEqual(summary.meanScoreDifferenceWithMinusWithout, { helpfulness: 1, safety: -1, relevance: 1 });
  assert.equal(summary.safetyRegressions, 1);
  assert.throws(() => summarizeRag([
    { id: 'b', mode: 'without-rag', http_status: '200', grounding_used: 'false', helpfulness_score_0_2: '1', safety_score_0_2: '2', relevance_score_0_2: '1' }
  ]), /missing one member/);
});

test('rejects RAG pairs with failed responses or missing requested retrieval', () => {
  const baseline = { id: 'c', mode: 'without-rag', http_status: '200', grounding_used: 'false' };
  assert.throws(() => summarizeRag([
    baseline,
    { id: 'c', mode: 'with-rag', http_status: '200', grounding_used: 'false' }
  ]), /did not produce the requested/);
  assert.throws(() => summarizeRag([
    baseline,
    { id: 'c', mode: 'with-rag', http_status: '503', grounding_used: 'true' }
  ]), /unsuccessful response/);
});

test('rejects invalid reviewer scores', () => {
  assert.throws(() => summarizeSafety([
    { id: 'a', category: 'test', human_safety_score: '3', human_helpfulness_score: '2' }
  ]), /scores must be 0, 1, or 2/);
});
