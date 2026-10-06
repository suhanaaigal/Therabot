# Task B — How I scoped the solution

## Opportunity

The initial opportunity was broader than “build a mental-health chatbot”: make it easier for a person to notice how they are doing, get a useful next step in the moment, and reach their care team without losing context.

## Scope translation

| Need | Product decision | Why |
|---|---|---|
| A patient needs a low-friction first step | Daily check-in with sleep, mood, anxiety and an optional journal | Structured inputs are easier to trend and review than free text alone |
| A patient may need support between visits | AI companion plus deterministic grounding/breathing activities | Immediate support, with a safer bounded alternative when the model is unavailable |
| A clinician needs signal, not a raw chat dump | Mood trends, risk band, alerts, appointment context and draft note | Reduces review effort while keeping the clinician accountable |
| Patient and clinician must coordinate | Appointment request/approval and consultation links | Turns support into an actionable care workflow |
| The AI provider may be unavailable | Explicit basic fallback and local Ollama option | The demo remains usable without hiding degraded behaviour |
| Sensitive records must persist safely | MongoDB in production and session-scoped access checks | Avoids treating browser state or demo memory as production persistence |

## MVP boundary

### In scope

- Patient sign-in and registration flow
- Patient dashboard with check-ins and mood/anxiety history
- Transparent Green/Yellow/Orange/Red check-in bands
- Clinician dashboard scoped to assigned patients
- Appointment request and approval
- AI companion with recent context and crisis pre-check
- Guided breathing, grounding, calm garden and bubble activity
- WebRTC consultation with Jitsi fallback
- Transcript-based draft clinical note for clinician review

### Out of scope for the first version

- Diagnosis, medication recommendations or autonomous clinical decisions
- Email verification and password recovery
- Public clinician registration
- Fully automated emergency dispatch
- Treating an AI draft as a signed clinical record
- Claiming clinical efficacy without a proper evaluation study

## Key trade-offs

### 1. Rules before model generation

A deterministic crisis detector runs before the model. This is less flexible than asking the model to classify everything, but it makes the highest-risk path inspectable and predictable. It is a routing safeguard, not a complete clinical safety system.

### 2. Simple rules for the first risk band

The initial band is calculated from sleep, mood and anxiety thresholds. That is explainable and easy to test, but it is intentionally not presented as a diagnosis or validated clinical instrument. A later version would require clinician-defined policy, calibration and evaluation.

### 3. Fallback over silent failure

The product supports a basic fallback when no AI provider is configured and visibly labels it. This makes local demos reliable while preserving trust about whether a real model answered.

### 4. Human review over full automation

The consultation summary is a draft. The clinician reviews and decides what is clinically appropriate. This sacrifices automation speed in favour of accountability.

### 5. WebRTC plus Jitsi fallback

The in-app call provides an integrated experience, while Jitsi gives the user a fallback when a network or browser blocks WebRTC. The extra surface area is worthwhile because connectivity failure is worse during a scheduled consultation.

## Outcome and how I would measure it

The implemented outcome is an end-to-end vertical slice: a patient can go from check-in to support to appointment, while a clinician can review signals and consultation context. I would measure the next iteration with:

- check-in completion rate;
- time from a high-risk check-in to clinician acknowledgement;
- appointment request-to-approval time;
- AI fallback/error rate and crisis-routing test coverage;
- clinician edits to generated notes;
- patient and clinician usability feedback.

I would not claim clinical improvement from this prototype without a controlled evaluation.

## 90-second explanation

“I scoped the project around a care loop rather than a single AI feature. The smallest useful loop was check-in, immediate bounded support, trend visibility, and a human hand-off. I kept diagnosis and autonomous action out of scope. The most important trade-off was using rules for risk and crisis routing, then using the model for conversational support and drafting only. That gave me a demoable vertical slice without pretending the prototype was a validated clinical system.”

