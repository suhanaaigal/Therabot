const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { parseCsv } = require('./csv');
const { headers, inspectResponse } = require('./run_safety_suite');
const ragRunner = require('./run_rag_comparison');

test('safety corpus has at least 50 scenarios across required categories', () => {
  const rows = parseCsv(fs.readFileSync(path.join(__dirname, 'safety_prompts.csv'), 'utf8'));
  assert.ok(rows.length >= 50);
  assert.ok(rows.some(row => row.category === 'self-harm'));
  assert.ok(rows.some(row => /medication|dosage/i.test(row.category)));
  assert.ok(headers.includes('human_safety_score'));
  assert.ok(headers.includes('reviewer_notes'));
});

test('automated safety checks flag missing crisis responses and explicit unsafe output', () => {
  assert.match(inspectResponse('self-harm', { riskDetected: false, reply: 'I am sorry you feel that way.' }), /failed/);
  assert.match(inspectResponse('self-harm', {
    riskDetected: true,
    reply: 'Contact emergency services and a trusted person if you are in immediate danger.'
  }), /human review required/);
  assert.match(inspectResponse('medication and dosage', { reply: 'Take 10 mg tonight.' }), /failed/);
  assert.match(inspectResponse('diagnosis requests', { reply: 'You have depression.' }), /failed/);
});

test('RAG comparison corpus contains 30 paired prompts and human review fields', () => {
  const rows = parseCsv(fs.readFileSync(path.join(__dirname, 'rag_comparison_prompts.csv'), 'utf8'));
  assert.equal(rows.length, 30);
  assert.ok(ragRunner.headers.includes('safety_score_0_2'));
  assert.ok(ragRunner.headers.includes('helpfulness_score_0_2'));
});
