# Therabot

Therabot is a mental-wellbeing support prototype with patient and clinician experiences. It combines patient-written check-ins, optional self-ratings, screening questionnaires, an AI chat companion, simulated wearable data, appointment/consultation flows, and clinician-facing review tools. Its models and scores are **not diagnoses, treatment recommendations, or validated clinical decisions**.

## What is in this repository

| Area | Main implementation |
|---|---|
| Web client | React and Vite in [`frontend/`](./frontend/) |
| API, accounts, and real-time chat/calls | Node.js, Express, Socket.IO, and Mongoose in [`backend/`](./backend/) |
| Text ML, WESAD physiology, evaluation, and optional retrieval | Python, FastAPI, scikit-learn, Transformers, and PyTorch in [`ml-service/`](./ml-service/) |
| Deployment notes | [`DEPLOY.md`](./DEPLOY.md) |
| Continuous integration | [`.github/workflows/ci.yml`](./.github/workflows/ci.yml) |

## Main data flow and algorithms

### Patient check-ins and risk banding

1. A patient can submit a short narrative and optional mood, anxiety, and sleep ratings. The ratings are supporting context, not a substitute for the narrative.
2. When trained text models are available, the ML service estimates stress, one of five simplified emotion groups, a crisis probability, and words that most increased the stress probability under word-occlusion analysis. Emotion and stress estimates are descriptive signals, not diagnoses.
3. A deterministic fusion function combines text stress and a recent physiological stress probability using `0.6 × text + 0.4 × physiology`. It maps the result to prototype bands: Green below 0.35, Yellow from 0.35, Orange from 0.55, and Red from 0.75. If physiology is unavailable, the text estimate is used alone. If text ML is unavailable, transparent self-rating rules provide a fallback.
4. Crisis indicators override ordinary scoring to Red. Recent PHQ-9 or GAD-7 totals of 15 or more elevate the band to at least Orange. These thresholds are prototype rules and have not been clinically calibrated.
5. The clinician dashboard shows the band, reasons, source, model outputs, key words, self-ratings, screening history, and stress timeline. A crisis notification is recorded for clinician follow-up; an SMS is only reported as sent when the configured provider confirms it.

The fusion implementation is in [`backend/services/fuse.js`](./backend/services/fuse.js); threshold sensitivity can be explored with [`ml-service/evaluation/fusion_sensitivity.py`](./ml-service/evaluation/fusion_sensitivity.py). That analysis requires paired text and physiology probabilities; it does not invent or export patient results.

### Screening questionnaires

The API validates PHQ-9 and GAD-7 answer counts and per-item ranges, stores totals and severity bands, and treats a positive PHQ-9 item 9 as a crisis indicator. The patient interface uses neutral `Item 1`, `Item 2`, … labels rather than reproducing copyrighted questionnaire wording. Use only properly licensed, clinician-approved item wording in any deployment. Screening results are not diagnoses.

### Text models

The text training scripts under [`ml-service/text/`](./ml-service/text/) provide TF-IDF and MiniLM-embedding Logistic Regression baselines, plus optional fine-tuning of DistilBERT classifiers. The embedding baseline uses a frozen `all-MiniLM-L6-v2` encoder and trains only the Logistic Regression classifier, so it is practical on CPU and must not be described as fine-tuned DistilBERT. Training uses deterministic stratified 70/15/15 splits or preserves official dataset splits, and evaluates once on the held-out test split with confusion matrices. Reddit-derived labels are noisy and longer than typical check-ins.

The public Dreaddit mirror was prepared locally as 2,823 posts (1,492 stress / 1,331 non-stress). Its TF-IDF + Logistic Regression baseline achieved held-out accuracy 78.3%, precision 78.9%, recall 80.4%, and F1 79.6% (TN=152, FP=48, FN=44, TP=180). These results describe that single mirror and split, not patient check-ins. Hugging Face metadata for the mirror does not specify a license; verify the source terms before redistributing any dataset or trained artifact.

The official GoEmotions simplified data was locally grouped into 40,451 single-group examples while preserving its train/validation/test assignment. Group counts are imbalanced (anxious 764, sad 2,977, angry 4,712, positive 16,003, neutral 15,995). This machine has no CUDA GPU and has four CPUs; full multi-epoch DistilBERT training on the complete emotion set is not claimed.

CPU-trained MiniLM-embedding baselines are now available locally. On the same held-out Dreaddit split as the TF-IDF baseline, stress accuracy/F1 were 80.4%/81.5% (versus 78.3%/79.6% for TF-IDF); the MiniLM confusion matrix was TN=158, FP=42, FN=41, TP=183. The GoEmotions grouped classifier achieved 65.3% accuracy and 55.5% macro F1 on its untouched official test split; F1 varied substantially by class (anxious 38.7%, sad 43.0%, angry 51.0%, neutral 65.9%, positive 78.8%). These are dataset results, not validated check-in performance. Detailed per-class precision/recall/F1 and confusion matrices are in the local `models\stress_minilm\test-metrics.json` and `models\emotion_minilm\test-metrics.json` files.

Prepare/train commands from `ml-service` (raw source CSVs remain ignored/local):

```powershell
python -m pip install -r requirements-rag.txt
python -m text.prepare_dreaddit
python -m text.baseline_stress --input data\dreaddit_stress.csv --positive-label stress --output-dir outputs\stress-baseline
python -m text.embedding_baseline --input data\dreaddit_stress.csv --task stress --positive-label stress --output-dir models\stress_minilm
python -m text.finetune_stress --csv data\dreaddit_stress.csv --positive-label stress --output-dir models\stress
python -m text.prepare_goemotions --output data\goemotions-groups.csv
python -m text.embedding_baseline --input data\goemotions-groups.csv --task emotion --split-column split --output-dir models\emotion_minilm
python -m text.finetune_emotion --csv data\goemotions-groups.csv --split-column split --output-dir models\emotion
```

The proxy crisis-classifier data source, CC BY-SA attribution/limitations, split and validation-threshold rules, and instructions for independent double-reviewed short-text testing are documented in [`ml-service/evaluation/CRISIS_DATASET.md`](./ml-service/evaluation/CRISIS_DATASET.md). The classifier is research-only until the separately authored short-text set is reviewed and evaluated; subreddit proxy labels are not clinical ground truth.

Text model weights are not bundled in the repository. The ML service can run stress and emotion analysis from the local `models/stress_minilm` and `models/emotion_minilm` embedding-baseline artifacts. Until a reviewed crisis classifier is installed, `/analyze-text` reports `crisis_prob: null` and `crisis_available: false`; the backend's existing direct-text crisis rules remain active. This is not equivalent to a trained crisis model, and those rules need independent short-text evaluation before deployment.

### Wearable stress model

The WESAD workflow in [`ml-service/wesad/`](./ml-service/wesad/) extracts wrist BVP, EDA, temperature, and acceleration features in 60-second windows stepped every 30 seconds. It labels stress (WESAD label 2) against non-stress (labels 1, 3, 4), compares Random Forest and XGBoost with a majority baseline, and evaluates with leave-one-subject-out (LOSO) splits to avoid leaking windows from the same participant across train and test. The deployable model is a Random Forest trained with a subject held out; the S17 replay is a **simulated** feed.

This task measures lab-induced physiological stress in WESAD. Do not describe it as anxiety or depression detection, and do not present its score as a clinical measurement.

In the local completed LOSO run, Random Forest mean accuracy was 90.5% (SD 7.2%) and mean stress-class F1 was 76.6% (SD 23.5%); XGBoost mean accuracy was 91.7% (SD 7.6%) and mean F1 was 80.5% (SD 18.6%). The majority baseline had 77.7% mean accuracy but 0% stress-class recall/F1, illustrating why accuracy alone is misleading. On the held-out S17 replay, the Random Forest scored 88.3% accuracy and 76.6% F1 (TN=65, FP=6, FN=5, TP=18). Per-subject metrics and feature importance are in ignored local outputs under `ml-service/outputs/wesad/`; the held-out results are not evidence of clinical performance or generalization to real smartwatch use.

### AI chat, safety, and optional coping retrieval

The authenticated patient chat stores history against the signed-in patient. The system prompt prohibits diagnosis and medication/dose advice; a post-generation filter replaces detected dose or direct-diagnosis claims and logs each blocked response. Immediate crisis phrases receive a deterministic crisis response before optional retrieval or model generation. These checks are defense-in-depth, not a safety certification.

The optional retrieval feature uses a local `all-MiniLM-L6-v2` sentence-transformer to select up to three short, original general coping suggestions from [`ml-service/resources/coping_snippets.json`](./ml-service/resources/coping_snippets.json). Retrieval is opt-in in the chat interface, does not run for crisis messages, and is not required for normal text ML or chat. The ML endpoint reports an explicit unavailable status when the optional dependency is absent; the chat can continue without retrieved context. The first request may take longer while the model initializes; the backend allows up to 15 seconds for retrieval, then continues without grounding if the service remains unavailable.

To install and enable retrieval in the ML virtual environment:

```powershell
cd ml-service
.\.venv\Scripts\python.exe -m pip install -r requirements-rag.txt
```

Set `ML_URL` on the backend to the ML service URL. Start/restart the ML service after installation so `/health` reports `capabilities.coping_retrieval: true`. Model weights may be downloaded the first time retrieval runs. Optional content is general support only and must not replace clinician or emergency support.

### Privacy, appointments, and clinician review

The patient privacy page reports the configured generative AI provider and text-analysis service. Chat messages and recent context go to the configured chat provider; check-in narratives go to the configured ML service for text analysis; an opted-in coping-retrieval request also sends the current message to that service. Patient deletion removes the patient's active account-linked check-ins, questionnaires, physiological readings, notifications, appointments, chat, consultations, transcripts, and notes. Backup retention is not represented as a fixed period; backup copies may remain until normal rotation. Transcripts and generated notes remain drafts for clinician review. See [`DEPLOY.md`](./DEPLOY.md) for deployment configuration, consent, data handling, SMS limitations, and migrations.

Appointment local times use Asia/Kolkata and are stored as UTC timestamps. The migration script is idempotent and should be run only after configuring the intended database and confirming a backup.

## Development and validation

### Start a local demo (Windows/PowerShell)

The demo can run without MongoDB, but demo-memory data is erased when the backend stops. Do not enter real patient information. From the project root, install the Node dependencies:

```powershell
npm ci
Set-Location frontend
npm ci
Set-Location ..
```

Create `backend\.env` from `backend\.env.example` if it does not already exist, then edit it:

```powershell
if (-not (Test-Path backend\.env)) { Copy-Item backend\.env.example backend\.env }
```

For a local-only demo, leave `MONGO_URI` empty and set a private clinician password and session secrets. To use the chat, install and run Ollama locally, then pull a model such as `llama3.2`:

```powershell
ollama pull llama3.2
```

Configure these values in `backend\.env`:

```dotenv
NODE_ENV=development
MONGO_URI=
DEMO_DOCTOR_PASSWORD=choose-a-local-demo-password
PATIENT_AUTH_SECRET=choose-a-long-random-local-secret
DOCTOR_AUTH_SECRET=choose-a-different-long-random-local-secret
ML_URL=http://127.0.0.1:8000
AI_PROVIDER=ollama
OPENAI_BASE_URL=http://127.0.0.1:11434/v1
OLLAMA_MODEL=llama3.2
AI_PROVIDER_TIMEOUT_MS=90000
```

Use separate terminals from the project root:

```powershell
# Terminal 1: start the ML API (create the venv once if needed)
Set-Location ml-service
if (-not (Test-Path .venv\Scripts\python.exe)) { py -3.13 -m venv .venv }
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app:app --host 127.0.0.1 --port 8000
```

```powershell
# Terminal 2: start the backend
npm start
```

```powershell
# Terminal 3: start the frontend
Set-Location frontend
npm run dev -- --host 127.0.0.1
```

Open `http://127.0.0.1:5173`. Sign in as clinician with username `doctor` and the `DEMO_DOCTOR_PASSWORD` you chose, or register a patient and choose the default clinician. Check `http://127.0.0.1:5000/health` and `http://127.0.0.1:8000/health` if a service is unavailable. Chat requires the configured model provider to be running. Trained model artifacts are not included in a clean clone, so text analysis may use the documented rating fallback until local model artifacts are prepared; optional coping retrieval also requires `requirements-rag.txt`.

### Backend and frontend

From the project root:

```powershell
npm ci
npm test
cd frontend
npm ci
npm run lint
npm run build
```

### Python 3.13 virtual environment (Windows)

From the repository root, using the specified Python installation:

```powershell
& 'C:\Users\Dell\AppData\Local\Programs\Python\Python313\python.exe' -m venv ml-service\.venv
ml-service\.venv\Scripts\python.exe -m pip install -r ml-service\requirements.txt
ml-service\.venv\Scripts\python.exe -m pip install -r ml-service\requirements-test.txt
ml-service\.venv\Scripts\python.exe -m pytest ml-service\evaluation ml-service\wesad ml-service\text
```

See [`DEPLOY.md`](./DEPLOY.md) for WESAD dataset setup and model training commands. Original WESAD data, trained artifacts, generated metrics, and replay data are local artifacts and are not committed.

### Evaluation tools

- **Chat safety suite:** At least 50 categorized prompts are in [`backend/evaluation/safety_prompts.csv`](./backend/evaluation/safety_prompts.csv). For the isolated local setup, verify the local ML and AI providers, then set `RUN_LOCAL_CHAT_EVALUATIONS=approved` and run `node backend/evaluation/run_local_evaluations.js`. It creates a temporary demo-memory patient, observes the configured API rate limit, runs the safety and RAG suites, and deletes that temporary patient from memory afterward. Generated replies and reviewer columns are written under an ignored directory. Follow [`backend/evaluation/HUMAN_REVIEW.md`](./backend/evaluation/HUMAN_REVIEW.md); qualified human scoring remains required.
- **RAG comparison:** The 30-prompt paired scaffold is [`backend/evaluation/run_rag_comparison.js`](./backend/evaluation/run_rag_comparison.js). With the same local test account, set `RAG_TEST_TOKEN` and `RAG_TEST_CONFIRM=dedicated-non-production-test-account`, then run `node backend/evaluation/run_rag_comparison.js`. It sends each prompt without and with optional retrieval, records whether retrieval was actually used, and leaves 0–2 safety/helpfulness/relevance scores blank for human review. Follow [`backend/evaluation/HUMAN_REVIEW.md`](./backend/evaluation/HUMAN_REVIEW.md); the scaffold alone is not evidence that RAG is better.
- After qualified reviewers have scored the CSVs and reconciled disagreements, summarize them without including raw reply text: `node backend/evaluation/summarize_review.js <reviewed.csv> safety` or `... rag`. The descriptive summaries do not establish clinical safety or efficacy.
- **Longitudinal mood-decline model:** [`ml-service/evaluation/mood_decline.py`](./ml-service/evaluation/mood_decline.py) builds short-history features and predicts subsequent worsening using patient-grouped splits. It compares Logistic Regression, Gradient Boosting, a no-change baseline, and an existing threshold rule. `--synthetic` is only a method demonstration; only consented, de-identified real pilot data can support pilot analysis.
- **Pilot analysis:** [`ml-service/evaluation/pilot_analysis.py`](./ml-service/evaluation/pilot_analysis.py) reports Spearman correlation with GAD-7 and quadratic weighted kappa. The blank input header is [`ml-service/evaluation/pilot_template.csv`](./ml-service/evaluation/pilot_template.csv), and [`ml-service/evaluation/PILOT_PROTOCOL.md`](./ml-service/evaluation/PILOT_PROTOCOL.md) lists preparation safeguards. No participant results are included. Recruitment, consent, ethics approval, and independent human review must happen outside this codebase before using real data.

The safety and RAG runners call the configured chat-model provider for 55 and 60 requests respectively. A hosted provider may charge for use and receives the synthetic evaluation prompts. Run them only after the project owner approves provider use and cost, with a dedicated non-production test patient. Never use a real patient's token or send their messages through these suites. The local orchestrator allows up to 90 seconds for a response from CPU-hosted Ollama; normal backend requests retain the 30-second default. `AI_PROVIDER_TIMEOUT_MS` is bounded to 1–120 seconds.

Before collecting pilot data, obtain the applicable institutional/ethics approval and informed consent; make participation voluntary and explain model limitations, data sent to configured providers, deletion, and that this is not clinical care. Do not collect names or raw chat/check-in text for this analysis. Keep any re-identification key separately with restricted access, de-identify and minimize the analysis file, and have a qualified reviewer validate the scoring and interpretation. Do not present a correlation or agreement statistic as diagnostic accuracy or clinical benefit.

## Important limitations

- No model in this prototype is approved for clinical diagnosis, triage, or treatment.
- Public social-media datasets contain sensitive, noisy text. Do not put raw posts in presentations or expose them to patients.
- Short check-ins differ from longer research posts. Results on one dataset do not establish performance in this product or population.
- The crisis classifier and regex checks can miss danger or produce false alarms; maintain human review and clear local emergency support.
- Optional RAG content and its comparison require human scoring before any claim about helpfulness or safety.
- The patient-authored safety suite is not a substitute for specialist review, clinical validation, consent, or a study protocol.
- Never commit credentials, identifiable patient data, raw research data, evaluation responses, or generated model artifacts.
- The deletion test suite exercises both demo-store cleanup and the Mongo persistence deletion query set using mocked models; it does not connect to a live MongoDB instance. Verify deletion in an isolated test database before production release.



1.cd D:\Documents\Projecttttt\mental-health-platform
npm start

2.cd D:\Documents\Projecttttt\mental-health-platform\frontend
npm run dev -- --host 127.0.0.1

3.cd D:\Documents\Projecttttt\mental-health-platform\ml-service
.\.venv\Scripts\python.exe -m uvicorn app:app --host 127.0.0.1 --port 8000