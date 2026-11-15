const fs = require('node:fs/promises');
const path = require('node:path');
const { parseCsv } = require('./csv');

const numericScore = (row, key, required = true) => {
  const raw = row[key];
  if ((raw === '' || raw === undefined) && !required) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 2) {
    throw new Error(`${row.id} has an invalid ${key}; scores must be 0, 1, or 2.`);
  }
  return value;
};

const mean = values => values.length
  ? values.reduce((total, value) => total + value, 0) / values.length
  : null;

const summarizeSafety = rows => {
  const categories = {};
  for (const row of rows) {
    const safety = numericScore(row, 'human_safety_score');
    const helpfulness = numericScore(row, 'human_helpfulness_score');
    const result = categories[row.category] || {
      prompts: 0,
      safetyScore0: 0,
      safetyScore1: 0,
      safetyScore2: 0,
      helpfulnessMean: null,
      _helpfulness: []
    };
    result.prompts += 1;
    result[`safetyScore${safety}`] += 1;
    result._helpfulness.push(helpfulness);
    result.helpfulnessMean = mean(result._helpfulness);
    categories[row.category] = result;
  }
  for (const category of Object.values(categories)) delete category._helpfulness;
  return {
    type: 'safety-suite-human-review',
    totalReviewed: rows.length,
    safetyScore0: rows.filter(row => Number(row.human_safety_score) === 0).length,
    helpfulnessMean: mean(rows.map(row => Number(row.human_helpfulness_score))),
    categories,
    interpretation: 'Human-scored test prompts only; not clinical safety validation.'
  };
};

const summarizeRag = rows => {
  const paired = new Map();
  for (const row of rows) {
    const entry = paired.get(row.id) || {};
    if (entry[row.mode]) throw new Error(`${row.id} has duplicate ${row.mode} rows.`);
    entry[row.mode] = row;
    paired.set(row.id, entry);
  }
  const differences = { helpfulness: [], safety: [], relevance: [] };
  for (const [id, pair] of paired) {
    if (!pair['without-rag'] || !pair['with-rag']) {
      throw new Error(`${id} is missing one member of its without/with RAG response pair.`);
    }
    if (String(pair['without-rag'].http_status) !== '200' ||
        String(pair['with-rag'].http_status) !== '200') {
      throw new Error(`${id} contains an unsuccessful response and cannot be scored.`);
    }
    if (String(pair['without-rag'].grounding_used).toLowerCase() !== 'false' ||
        String(pair['with-rag'].grounding_used).toLowerCase() !== 'true') {
      throw new Error(`${id} did not produce the requested without/with RAG comparison.`);
    }
    for (const [metric, key] of Object.entries({
      helpfulness: 'helpfulness_score_0_2',
      safety: 'safety_score_0_2',
      relevance: 'relevance_score_0_2'
    })) {
      differences[metric].push(
        numericScore(pair['with-rag'], key) - numericScore(pair['without-rag'], key)
      );
    }
  }
  return {
    type: 'paired-rag-human-review',
    prompts: paired.size,
    meanScoreDifferenceWithMinusWithout: Object.fromEntries(
      Object.entries(differences).map(([metric, values]) => [metric, mean(values)])
    ),
    safetyRegressions: differences.safety.filter(value => value < 0).length,
    helpfulnessImproved: differences.helpfulness.filter(value => value > 0).length,
    helpfulnessUnchanged: differences.helpfulness.filter(value => value === 0).length,
    helpfulnessReduced: differences.helpfulness.filter(value => value < 0).length,
    interpretation: 'Descriptive paired reviewer scores only; no statistical or clinical efficacy claim.'
  };
};

async function main() {
  const [inputPath, kind] = process.argv.slice(2);
  if (!inputPath || !['safety', 'rag'].includes(kind)) {
    throw new Error('Usage: node backend/evaluation/summarize_review.js <reviewed.csv> <safety|rag>');
  }
  const rows = parseCsv(await fs.readFile(inputPath, 'utf8'));
  if (!rows.length) throw new Error('The review CSV has no scored rows.');
  const summary = kind === 'safety' ? summarizeSafety(rows) : summarizeRag(rows);
  const outputPath = `${path.resolve(inputPath)}.summary.json`;
  await fs.writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ output: outputPath, ...summary }, null, 2));
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { summarizeSafety, summarizeRag };
