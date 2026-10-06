# Task C — Fix/rework: making degraded AI behaviour explicit

## The wall

An early demo could appear to work locally even when the AI provider or database was not configured. That was useful for development, but it created two trust problems:

1. A user could mistake a basic fallback message for a model-generated conversation.
2. Demo-memory persistence could disappear on restart, which is unacceptable for a production care workflow.

This is the failure/rework story to present honestly: the prototype was too easy to mistake for a fully live AI and persistent system.

## Evidence in the implementation

- The patient chat UI now labels **Basic mode** when the backend reports `basic-fallback`.
- A failed AI request remains visible as an error, with the user message preserved and a retry path.
- The backend exposes `/health` with the persistence mode.
- Production refuses API requests when MongoDB is unavailable instead of silently accepting ephemeral records.
- The deployment guide tells the operator to verify `persistence: "mongodb"` and warns that demo-memory accounts do not survive restarts.

## What changed

### Before

The demo path optimised for “something appears on screen.” Local fallback and in-memory data made it easy to click through, but they blurred the difference between:

- a real model response and a fallback;
- durable data and temporary demo state;
- a prototype environment and production behaviour.

### After

The system makes the state visible and fails in the safer direction:

```text
AI provider configured
  -> call the OpenAI-compatible/Ollama endpoint
  -> show the returned model/provider label

AI provider unavailable
  -> return a labelled basic fallback
  -> show "Basic mode is active" in the UI

Production database unavailable
  -> health endpoint reports database_unavailable
  -> API returns 503 instead of accepting non-durable care data
```

## Why this was the right fix

The change is not just error handling. It protects the user’s mental model of the product. In a sensitive workflow, a transparent degraded mode is better than a success-shaped response that hides missing infrastructure.

## What I learned

1. A working click path is not the same as a trustworthy system.
2. Every fallback needs a visible contract: what happened, what did not happen, and what the user can do next.
3. Persistence assumptions must be tested separately from UI behaviour.
4. In a health-related product, safety and observability belong in the first slice, not as polish after the demo.
5. A draft generated from a transcript still needs a named human reviewer and an explicit verification step.

## 60-second explanation

“The first version was optimised for a smooth demo, but that hid two important truths: the AI might not be configured, and local data might be temporary. I changed the product so degraded states are explicit: the UI labels basic mode, failed requests preserve the message and show an error, health reports persistence, and production refuses to proceed without MongoDB. The lesson was that reliability here is partly technical and partly about honest communication.”

## Do not overclaim

Do not describe this as a clinical safety certification or say that the crisis detector guarantees safety. Describe it as an implemented prototype safeguard and say that a production version needs clinical governance, red-team testing, monitoring, privacy review and formal evaluation.

