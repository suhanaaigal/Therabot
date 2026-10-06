# Task A — Solution built: Therabot

## One-line introduction

Therabot is a mental-wellbeing platform that gives a patient a low-friction way to check in, get a safe first response, practise a calming activity, and connect with a clinician when human care is needed.

## The user problem

People often need support before they are ready for an appointment, while clinicians need a clearer view of patterns between visits. A standalone chatbot would be too narrow and risky, so the product combines self-service support with a clinician workflow and clear hand-offs.

## One-pass demo path (5–6 minutes)

1. Open the Therabot home page and say: “This is the patient entry point. I designed the tone to feel calm and non-clinical, while still making the clinician route visible.”
2. Sign in as a demo patient and open **Daily check-in**. Enter an example such as:
   - Sleep: `5` hours
   - Mood: `4/10`
   - Anxiety: `7/10`
   - Journal: “I feel overwhelmed by work and have not been sleeping well.”
3. Show the returned risk band and explain that this is a transparent triage signal, not a diagnosis. Red/orange bands create an alert for clinician follow-up.
4. Open **Mood trends** and show that the check-in is persisted into the patient’s history as a trend, not treated as an isolated chat message.
5. Open **AI companion** and use the quick prompt “I feel overwhelmed today.” Explain that the backend sends recent conversation context to the configured model, but handles crisis language before calling the model.
6. Show **Mind relief** and start guided breathing or 5-4-3-2-1 grounding. This demonstrates a bounded, deterministic intervention rather than asking the model to improvise a clinical exercise.
7. Open **Appointments**, request a consultation, then switch to the clinician view to show approval and the clinician’s patient context.
8. If time allows, show the consultation route: WebRTC call, Jitsi fallback, transcript capture, and a draft clinical note that the clinician must review.

## How it works under the hood

```text
Patient browser
  ├─ React + React Router dashboard
  ├─ Check-in, trends, appointment and exercise UI
  ├─ AI companion chat
  └─ WebRTC/Jitsi consultation UI
             │ REST / Socket.IO
             ▼
Node.js + Express backend
  ├─ Auth and patient/doctor-scoped routes
  ├─ Check-in risk-band calculation
  ├─ AI chat and clinical-note routes
  ├─ Socket.IO live chat and call signalling
  └─ MongoDB persistence (demo-memory mode for local development)
             │
             ├─ OpenAI-compatible provider (for example gpt-4o-mini)
             └─ Ollama-compatible local provider
```

### AI design

- The provider is configurable through environment variables; the code supports an OpenAI-compatible endpoint and Ollama.
- The chat prompt explicitly says that Therabot is not a clinician, must not diagnose or prescribe, should ask at most one concise question, and should encourage professional care for medical questions.
- The last eight conversation turns are passed as bounded context, and individual message lengths are capped.
- Crisis phrases are detected before the model call. The response prioritises emergency services, a crisis line, and a trusted person nearby.
- If no provider is configured, the UI says that basic mode is active instead of pretending a model generated the answer.
- Clinical notes are drafts. The clinician is told to verify the transcript, assessment, and follow-up plan.

## What is implemented versus deliberately bounded

Implemented: patient and clinician flows, check-ins, risk bands, trend visualisation, appointments, scoped clinician access, AI chat, safety response, live chat, consultation routes, transcript-based draft notes, and local/demo fallback behaviour.

Deliberately bounded: the risk band is not a diagnosis; the AI is not a replacement for a clinician; model output is not silently treated as a medical record; production requires persistent MongoDB; and the Jitsi tab-audio flow requires consent.

## Closing sentence

“The product decision I’m proudest of is that the AI is one part of a care loop, not the product’s authority: the patient gets immediate bounded support, while risk signals and consultation context move toward a human clinician.”

