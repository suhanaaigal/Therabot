const assert = require('node:assert/strict');
const { test } = require('node:test');
const { fuse, ruleBand, textRuleBand, toBand } = require('./fuse');

test('risk probability boundaries are deterministic', () => {
  assert.equal(toBand(0.34), 'Green');
  assert.equal(toBand(0.35), 'Yellow');
  assert.equal(toBand(0.55), 'Orange');
  assert.equal(toBand(0.75), 'Red');
  assert.throws(() => toBand(1.1), RangeError);
});

test('crisis signal overrides model, ratings and physiology', () => {
  assert.equal(fuse({ status: 'available', stressProb: 0.1, emotion: 'neutral', crisisFlag: true }, 0.1).band, 'Red');
});

test('text and recent wearable probabilities use the documented 0.6/0.4 fusion', () => {
  const result = fuse(
    { status: 'available', stressProb: 0.5, emotion: 'sad', topWords: ['work'], crisisFlag: false },
    0.75
  );
  assert.ok(Math.abs(result.probability - 0.6) < Number.EPSILON);
  assert.equal(result.band, 'Orange');
  assert.equal(result.source, 'text+wearable');
  assert.ok(result.reasons.some(reason => reason.includes('work')));
});

test('screening scores elevate a model estimate to at least Orange', () => {
  const result = fuse(
    { status: 'available', stressProb: 0.1, emotion: 'neutral', crisisFlag: false },
    null,
    {},
    { phq9: 15 }
  );
  assert.equal(result.band, 'Orange');
});

test('rules remain available when ML is down', () => {
  assert.equal(ruleBand({ sleepHours: 3 }), 'Red');
  assert.equal(fuse(null, null, { selfMood: 5, selfAnxiety: 5 }).band, 'Yellow');
});

test('written check-in cues affect the transparent fallback band', () => {
  const result = fuse(null, null, { text: 'I feel overwhelmed and exhausted today.' });
  assert.equal(textRuleBand('I feel overwhelmed and exhausted today.').band, 'Orange');
  assert.equal(result.band, 'Orange');
  assert.equal(result.source, 'rules+text');
});
