const assert = require('node:assert/strict');
const { test } = require('node:test');
const { scoreQuestionnaire } = require('./questionnaireScoring');

test('PHQ-9 score bands use the configured cutoffs', () => {
  assert.equal(scoreQuestionnaire('PHQ-9', [0, 0, 0, 0, 0, 0, 0, 0, 0]).band, 'minimal');
  assert.equal(scoreQuestionnaire('PHQ-9', [1, 1, 1, 1, 1, 0, 0, 0, 0]).band, 'mild');
  assert.equal(scoreQuestionnaire('PHQ-9', [2, 2, 2, 2, 2, 2, 2, 1, 0]).band, 'moderately severe');
  assert.equal(scoreQuestionnaire('PHQ-9', [2, 2, 2, 2, 2, 2, 2, 2, 1]).band, 'moderately severe');
  assert.equal(scoreQuestionnaire('PHQ-9', [3, 3, 3, 3, 3, 3, 3, 3, 3]).band, 'severe');
});

test('a positive PHQ-9 item 9 sets the crisis flag', () => {
  assert.equal(scoreQuestionnaire('PHQ-9', [0, 0, 0, 0, 0, 0, 0, 0, 1]).crisisFlag, true);
  assert.equal(scoreQuestionnaire('PHQ-9', Array(9).fill(0)).crisisFlag, false);
});

test('GAD-7 scoring and input validation are explicit', () => {
  assert.equal(scoreQuestionnaire('GAD-7', [2, 2, 2, 2, 2, 0, 0]).band, 'moderate');
  assert.throws(() => scoreQuestionnaire('GAD-7', [0, 4, 0, 0, 0, 0, 0]), TypeError);
});
