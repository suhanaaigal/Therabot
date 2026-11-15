const assert = require('node:assert/strict');
const { test } = require('node:test');
const { encodeCsv, parseCsv } = require('./csv');

test('CSV evaluation helpers round-trip quoted commas, quotes, and newlines', () => {
  const rows = [
    { prompt: 'A, B', reply: 'He said "hello".\nThen left.' },
    { prompt: 'plain', reply: '' }
  ];
  assert.deepEqual(parseCsv(encodeCsv(['prompt', 'reply'], rows)), rows);
});

test('CSV parser rejects unterminated quoted fields', () => {
  assert.throws(() => parseCsv('prompt,reply\none,"unfinished'), /unterminated quoted field/);
});
