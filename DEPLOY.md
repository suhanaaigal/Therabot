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
  - FIREBASE_PROJECT_ID (same project used by frontend)
  - FRONTEND_URL
  - AI_PROVIDER=openai
  - OPENAI_API_KEY (set privately in Render; do not commit it)
  - OPENAI_MODEL=gpt-4o-mini

The AI companion uses a context-aware basic fallback when no model provider is configured. For model-generated replies, set a valid provider and credentials on the backend service. To use Ollama instead, set `AI_PROVIDER=ollama`, `OLLAMA_MODEL`, and `OPENAI_BASE_URL` to the Ollama OpenAI-compatible endpoint.

Patient authentication and password reset use Firebase Authentication:

- Create a Firebase project, then in **Authentication → Sign-in method** enable **Email/Password**.
- In **Project settings → General**, register a Web app and copy its Web API key and Project ID.
- Add the deployed frontend hostname (for example, `therabot-frontend.onrender.com`) to **Authentication → Settings → Authorized domains**.
- Set `VITE_FIREBASE_API_KEY` and `VITE_FIREBASE_PROJECT_ID` on the Render frontend, plus the matching `FIREBASE_PROJECT_ID` on the backend. Redeploy both services after setting these values.
- Firebase sends password reset links through its own email action handler; no Resend key, SMTP password, Twilio trial, or custom sending domain is required.
- Existing MongoDB patient accounts with an email address are linked to Firebase on their first successful legacy sign-in; after linking, the old plaintext password is cleared from the patient record.

Patient accounts use private credentials. Doctors cannot view patient passwords.

## 2. Frontend on Vercel

- Import the frontend folder as a project.
- Root directory: frontend
- Build Command: npm run build
- Output Directory: dist
- Environment variable:
  - VITE_API_URL=https://your-render-backend-url
  - VITE_FIREBASE_API_KEY
  - VITE_FIREBASE_PROJECT_ID

## 3. MongoDB

- Create a MongoDB Atlas cluster and database user.
- Allow the Render backend to connect in Atlas Network Access.
- Set the Atlas connection string as `MONGO_URI` on the Render backend service. Keep the password URL-encoded and never commit this value to Git.
- Confirm the backend `/health` endpoint reports `persistence: "mongodb"`. Production now refuses to start without the database, instead of silently saving patient data only in memory.
- If Render says the backend service is suspended, resume it in the Render dashboard after configuring `MONGO_URI`.
- Accounts created while the backend was using demo-memory mode are not retained across restarts and cannot be recovered from that memory.

## 4. Different-place testing

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
