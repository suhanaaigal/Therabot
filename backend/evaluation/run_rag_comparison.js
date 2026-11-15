const fs = require('node:fs/promises');
const path = require('node:path');
const { encodeCsv, parseCsv } = require('./csv');

const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
const headers = [
  'id', 'mode', 'prompt', 'http_status', 'reply', 'provider', 'grounding_used',
  'helpfulness_score_0_2', 'safety_score_0_2', 'relevance_score_0_2', 'reviewer_notes'
];
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function main() {
  const token = process.env.RAG_TEST_TOKEN;
  const confirmation = process.env.RAG_TEST_CONFIRM;
  const baseUrl = process.env.RAG_TEST_BASE_URL || 'http://127.0.0.1:5000';
  const interval = Number(process.env.RAG_TEST_INTERVAL_MS || 3200);
  if (!token || confirmation !== 'dedicated-non-production-test-account') {
    throw new Error('Set RAG_TEST_TOKEN and RAG_TEST_CONFIRM=dedicated-non-production-test-account.');
  }
  const url = new URL(baseUrl);
  if (!localHosts.has(url.hostname) || interval < 3100 || !Number.isFinite(interval)) {
    throw new Error('RAG comparison runs are restricted to a local backend and at least 3.1 seconds between requests.');
  }
  const prompts = parseCsv(await fs.readFile(path.join(__dirname, 'rag_comparison_prompts.csv'), 'utf8'));
  if (prompts.length !== 30) throw new Error(`Expected 30 comparison prompts; found ${prompts.length}.`);

  const results = [];
  let requestIndex = 0;
  for (const prompt of prompts) {
    for (const mode of ['without-rag', 'with-rag']) {
      if (requestIndex) await pause(interval);
      requestIndex += 1;
      let status = 0;
      let data = {};
      try {
        const response = await fetch(new URL('/api/ai/chat', url), {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: prompt.prompt,
            history: [],
            useGrounding: mode === 'with-rag'
          })
        });
        status = response.status;
        data = await response.json().catch(() => ({}));
      } catch (error) {
        data = { error: error.message };
      }
      results.push({
        id: prompt.id,
        mode,
        prompt: prompt.prompt,
        http_status: status,
        reply: data.reply || data.error || '',
        provider: data.provider || '',
        grounding_used: data.groundingUsed === true,
        helpfulness_score_0_2: '',
        safety_score_0_2: '',
        relevance_score_0_2: '',
        reviewer_notes: ''
      });
      process.stdout.write(`${requestIndex}/60 ${prompt.id} ${mode}: HTTP ${status}, groundingUsed=${data.groundingUsed === true}\n`);
    }
  }

  const outputDir = path.join(__dirname, '.generated-results');
  await fs.mkdir(outputDir, { recursive: true });
  const output = path.join(outputDir, `rag-comparison-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`);
  await fs.writeFile(output, encodeCsv(headers, results), 'utf8');
  const failed = results.filter(result =>
    result.http_status !== 200 || (result.mode === 'with-rag' && !result.grounding_used)
  ).length;
  const completePairs = prompts.filter(prompt => {
    const pair = results.filter(result => result.id === prompt.id);
    return pair.length === 2 &&
      pair.every(result => result.http_status === 200) &&
      pair.find(result => result.mode === 'without-rag')?.grounding_used === false &&
      pair.find(result => result.mode === 'with-rag')?.grounding_used === true;
  }).length;
  console.log(`Saved paired responses for human review: ${output}`);
  console.log(`Complete pairs with requested retrieval used: ${completePairs}/30 (review rows individually; failures are not ready for scoring).`);
  console.log('This scaffold records paired outputs; review and score responses before claiming RAG improves safety or helpfulness.');
  if (failed) process.exitCode = 1;
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { headers };
