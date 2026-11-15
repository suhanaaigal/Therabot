const { spawn } = require('node:child_process');
const path = require('node:path');
const express = require('express');
const { demoPatients } = require('../demoStore');
const { signPatientSession } = require('../patientSession');
const { createRateLimiter } = require('../middleware/rateLimit');

const projectRoot = path.resolve(__dirname, '../..');

const runScript = scriptPath => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [scriptPath], {
    cwd: projectRoot,
    env: {
      ...process.env,
      ML_URL: 'http://127.0.0.1:8000',
      AI_PROVIDER_TIMEOUT_MS: '90000',
      SAFETY_TEST_TOKEN: process.env.LOCAL_EVAL_TOKEN,
      SAFETY_TEST_CONFIRM: 'dedicated-non-production-test-account',
      SAFETY_TEST_BASE_URL: process.env.LOCAL_EVAL_BASE_URL,
      RAG_TEST_TOKEN: process.env.LOCAL_EVAL_TOKEN,
      RAG_TEST_CONFIRM: 'dedicated-non-production-test-account',
      RAG_TEST_BASE_URL: process.env.LOCAL_EVAL_BASE_URL
    },
    stdio: 'inherit'
  });
  child.once('error', reject);
  child.once('exit', (code, signal) => {
    if (code === 0) resolve();
    else reject(new Error(`${path.basename(scriptPath)} exited with ${signal || `code ${code}`}.`));
  });
});

async function main() {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run evaluations when NODE_ENV=production.');
  }
  if (process.env.RUN_LOCAL_CHAT_EVALUATIONS !== 'approved') {
    throw new Error('Set RUN_LOCAL_CHAT_EVALUATIONS=approved after confirming provider usage and cost.');
  }
  if ((process.env.AI_PROVIDER || 'openai').toLowerCase() !== 'ollama' &&
      !process.env.OPENAI_API_KEY) {
    throw new Error('The configured hosted AI provider has no API key; no requests were sent.');
  }
  process.env.ML_URL = 'http://127.0.0.1:8000';
  process.env.AI_PROVIDER_TIMEOUT_MS = '90000';
  const mlHealth = await fetch('http://127.0.0.1:8000/health').catch(() => null);
  if (!mlHealth?.ok) throw new Error('Local ML service is not available at http://127.0.0.1:8000.');
  const health = await mlHealth.json();
  if (!health.capabilities?.coping_retrieval) {
    throw new Error('Optional coping retrieval is unavailable in the local ML service.');
  }

  const patientId = `local-eval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  demoPatients.set(patientId, { _id: patientId, fullName: 'Dedicated Local Evaluation Account' });
  process.env.LOCAL_EVAL_TOKEN = signPatientSession(patientId);
  const app = express();
  app.set('trust proxy', false);
  app.use(express.json({ limit: '16kb' }));
  app.use('/api/ai', createRateLimiter({ windowMs: 60_000, max: 20 }));
  app.use('/api/ai', require('../routes/ai'));
  const server = app.listen(0, '127.0.0.1');

  try {
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    process.env.LOCAL_EVAL_BASE_URL = `http://127.0.0.1:${server.address().port}`;
    console.log(`Using isolated local evaluation account ${patientId}; generated conversations are kept out of MongoDB.`);
    console.log(`Configured provider: ${(process.env.AI_PROVIDER || 'openai').toLowerCase()}.`);
    await runScript(path.join(__dirname, 'run_safety_suite.js'));
    await runScript(path.join(__dirname, 'run_rag_comparison.js'));
  } finally {
    demoPatients.delete(patientId);
    await new Promise(resolve => server.close(resolve));
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { main };
