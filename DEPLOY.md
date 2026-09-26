# Deployment guide

## 1. Backend on Render

- Push this project to GitHub.
- Create a Render account.
- Add a new Web Service using the repository.
- Root directory: project root
- Build Command: npm install
- Start Command: npm start
- Environment variables:
  - MONGO_URI
  - FRONTEND_URL
  - AI_PROVIDER
  - OPENAI_API_KEY (optional if using Ollama)
  - OPENAI_MODEL
  - OLLAMA_MODEL

## 2. Frontend on Vercel

- Import the frontend folder as a project.
- Root directory: frontend
- Build Command: npm run build
- Output Directory: dist
- Environment variable:
  - VITE_API_URL=https://your-render-backend-url

## 3. MongoDB

- Create a MongoDB Atlas cluster.
- Paste the connection string into MONGO_URI.

## 4. Different-place testing

- Doctor and patient open the same public frontend URL from different Wi‑Fi networks.
- The backend must be public and HTTPS.
- The in-app call uses Google STUN by default. Some mobile and campus networks also require a TURN relay.
- To enable a TURN provider, set these variables on the Render frontend service and redeploy the frontend:
  - `VITE_TURN_URL` (one or more comma-separated `turn:` or `turns:` URLs)
  - `VITE_TURN_USERNAME`
  - `VITE_TURN_CREDENTIAL`
- Use credentials from a TURN provider such as Metered or Twilio Network Traversal. Do not commit TURN credentials to Git.
- Keep the Jitsi link as a fallback when a network blocks WebRTC or the configured relay is unavailable.
