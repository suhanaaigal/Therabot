# Deployment guide

## 1. Backend on Render

- Push this project to GitHub.
- Create a Render account.
- Add a new Web Service using the repository.
- Root directory: project root
- Build Command: npm install
- Start Command: npm start
- Environment variables:
  - NODE_ENV=production
  - MONGO_URI
  - FRONTEND_URL
  - AI_PROVIDER=openai
  - OPENAI_BASE_URL=https://api.groq.com/openai/v1
  - OPENAI_API_KEY (set privately in Render; do not commit it)
  - OPENAI_MODEL=llama-3.1-8b-instant
  - Optional emergency SMS: TWILIO_SID, TWILIO_TOKEN, and TWILIO_FROM (set privately; do not commit credentials)

The AI companion requires a real model provider and does not use hardcoded conversational replies. For Groq, set `AI_PROVIDER=openai`, `OPENAI_BASE_URL=https://api.groq.com/openai/v1`, `OPENAI_MODEL=llama-3.1-8b-instant`, and `OPENAI_API_KEY` privately on the backend service. To use Ollama for local development instead, set `AI_PROVIDER=ollama`, `OLLAMA_MODEL`, and `OPENAI_BASE_URL` to the Ollama OpenAI-compatible endpoint. If the provider is unavailable, the chat endpoint returns an error rather than pretending to be an AI response.

Patient signup and sign-in use backend email/password authentication. New passwords are stored as salted scrypt hashes; legacy plaintext passwords are upgraded to hashes after a successful login. Firebase is not used for patient authentication. Email verification and password recovery are currently unavailable. Existing Firebase-linked patient accounts have no backend password and must be migrated by the care team before they can sign in; do not delete their patient records as a shortcut because related care history references those records.

Authentication, AI, and appointment endpoints use per-IP, in-process rate limits. Each backend instance maintains its own counters; deployments with multiple instances should use a shared rate-limit store if the limits must apply across the whole service.

Patients choose a clinician during signup. Doctor dashboards and doctor API access are scoped to the assigned clinician, including patient records, appointments, alerts, and consultation notes. On backend startup, unassigned legacy patient records are assigned to the doctor on their most recent appointment; records without an appointment are assigned to the first provisioned clinician. Production does not create a default clinician; if no clinician exists for legacy assignment, startup fails with an explicit error for administrative resolution. Additional clinician accounts must be provisioned through a trusted administrative process; do not expose public doctor registration.

Clinician passwords are stored as salted scrypt hashes; legacy plaintext passwords are upgraded at next successful login. `DEMO_DOCTOR_PASSWORD` is only for local, non-production demo setup. Do not set or use demo credentials in production.

Emergency-contact details are optional and are only stored when the patient consents during registration. If all Twilio settings are configured, a Red alert may queue a minimal SMS without check-in details. The clinician dashboard reports `queued`, `sent`, `failed`, or `not configured`; a queued Twilio message is not proof of delivery. Commercial SMS in India may require DLT registration. Therabot does not contact emergency services.

The patient privacy page reports the configured AI provider and text-analysis service. Chat context and clinician-requested consultation transcripts are sent to the configured generative AI provider; check-in text is sent to the configured ML service for text analysis, and an opted-in coping retrieval request sends the current chat message to that service. The signed-in **Delete my data** action removes the patient profile and associated check-ins, screening answers/results, simulated physiological stress readings, appointments, notifications, account-linked chat messages, call sessions, transcripts, and notes from active records. Backup copies may remain until their normal rotation. Earlier chat messages saved under a shared, unassigned room cannot be reliably attributed to a patient and need administrator review.

Optional coping retrieval is separate from required text analysis. Install `ml-service/requirements-rag.txt` in the ML virtual environment and restart the ML service to enable `/retrieve-coping`; set the backend `ML_URL` to that service. The patient must opt in per chat request. The retrieval corpus is general guidance, crisis messages bypass retrieval, and retrieval does not replace professional or emergency support. If the optional package or endpoint is unavailable, chat continues without retrieved context and logs the retrieval failure.

For the local chatbot safety and RAG comparison scaffolds, see the evaluation instructions in [README.md](./README.md). Run them only against a dedicated, non-production test account; generated replies must be reviewed by a person before drawing conclusions.

## 2. WESAD physiological stress demo

The WESAD workflow uses wrist-only BVP, EDA, temperature, and acceleration signals for binary stress classification: label 2 is stress; labels 1, 3, and 4 are non-stress. This is lab-induced physiological stress detection, not anxiety or depression detection, and is not a clinical assessment.

Obtain WESAD from the [official UCI dataset page](https://archive.ics.uci.edu/dataset/465/wesad+wearable+stress+and+affect+detection), and read the dataset README and terms before use or redistribution. Cite the WESAD dataset (DOI: [10.24432/C57K5T](https://doi.org/10.24432/C57K5T)) in project materials. Keep the original data local; do not commit it. The expected extracted folders are S2–S17, excluding S12.

From `ml-service`, install `requirements.txt`, then run:

```sh
python -m wesad.features --data-dir data/WESAD --output data/wesad_features.csv --replay replay_S17.json
python -m wesad.train_loso --features data/wesad_features.csv --output-dir outputs/wesad
python -m wesad.train_final --features data/wesad_features.csv --output models/wesad_rf.joblib --holdout 17
uvicorn app:app --host 0.0.0.0 --port 8000
```

Feature extraction produces 60-second windows stepped every 30 seconds and drops windows without a supported label covering at least 80% of the window. LOSO evaluation compares Random Forest and XGBoost with a training-fold majority baseline; it writes per-subject metrics, mean/std summaries, and mean feature importances under `outputs/wesad`. Do not replace LOSO with a random window split. The final model excludes S17; the replay features are derived from S17 and contain no raw signals.

Run `python -m unittest discover -s wesad` from the ML service folder for synthetic feature checks. The trained model file and replay JSON are generated artifacts and are intentionally not committed. For a backend demo, set `ML_URL` to the reachable ML service URL and `WESAD_REPLAY_PATH` to the generated S17 replay JSON available on the backend host. The patient can start or stop replay in the dashboard; readings are generated every five seconds and labeled as simulated in the clinician record. Replay timers are process-local and stop if the backend restarts.

Raw WESAD data, trained artifacts, replay files, and generated per-subject metric files are not committed. The local evaluation summary currently recorded in [`README.md`](./README.md) was produced from the downloaded dataset in this workspace; rerun the documented workflow when changing features, splits, or training code, and do not treat these results as clinical validation.

## 3. Frontend on Vercel

- Import the frontend folder as a project.
- Root directory: frontend
- Build Command: npm run build
- Output Directory: dist
- Environment variable:
  - VITE_API_URL=https://your-render-backend-url

## 4. MongoDB

- Create a MongoDB Atlas cluster and database user.
- Allow the Render backend to connect in Atlas Network Access.
- Set the Atlas connection string as `MONGO_URI` on the Render backend service. Keep the password URL-encoded and never commit this value to Git.
- Confirm the backend `/health` endpoint reports `persistence: "mongodb"`. Production now refuses to start without the database, instead of silently saving patient data only in memory.
- If Render says the backend service is suspended, resume it in the Render dashboard after configuring `MONGO_URI`.
- Accounts created while the backend was using demo-memory mode are not retained across restarts and cannot be recovered from that memory.

## 5. Different-place testing

- Doctor and patient open the same public frontend URL from different Wi‑Fi networks.
- The backend must be public and HTTPS.
- For Jitsi automatic reports, use the app's **Jitsi + Auto Report** link so the Jitsi room is embedded in the app. The doctor must give consent, click **Start report capture**, choose the app tab, and enable **Share tab audio**. The app mixes that tab audio with the doctor's microphone, transcribes it in the browser, then sends only the transcript to the backend for report generation.
- Jitsi tab-audio capture requires a browser that supports tab audio sharing (desktop Chrome or Edge recommended). If the browser does not provide a shared audio track, transcription cannot run. Do not use this capture flow without all participants' consent.
- The in-app call uses Google STUN by default. Some mobile and campus networks also require a TURN relay.
- To enable a TURN provider, set these variables on the Render frontend service and redeploy the frontend:
  - `VITE_TURN_URL` (one or more comma-separated `turn:` or `turns:` URLs)
  - `VITE_TURN_USERNAME`
  - `VITE_TURN_CREDENTIAL`
- Use credentials from a TURN provider such as Metered or Twilio Network Traversal. Do not commit TURN credentials to Git.
- Keep the Jitsi link as a fallback when a network blocks WebRTC or the configured relay is unavailable.

## 6. One-time production password migration

If Render Shell is unavailable, temporarily add these two environment variables to the backend service and redeploy:

```sh
PASSWORD_MIGRATION_DOCTOR_PASSWORD="your-doctor-password"
PASSWORD_MIGRATION_PATIENT_PASSWORD="your-patient-password"
```

The backend runs the migration during startup and logs account counts. Remove both variables immediately after the successful deploy, then redeploy once more. Never commit these passwords or add them to frontend environment variables. The manual script remains available at `backend/scripts/setProductionPasswords.js` if Render Shell becomes available.
