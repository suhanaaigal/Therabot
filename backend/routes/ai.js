const router = require('express').Router();
const ChatMessage = require('../models/ChatMessage');
const mongoose = require('mongoose');
const CallSession = require('../models/CallSession');
const Appointment = require('../models/Appointment');
const Patient = require('../models/Patient');
const { demoAppointments, demoCallSessions, demoPatients, demoChatMessages } = require('../demoStore');
const { requireDoctorSession } = require('../doctorSession');
const { requirePatientSession } = require('../patientSession');
const { detectCrisisRegex } = require('../services/textAnalysis');

const crisisMessage = `I want to take this seriously. If you feel like you might hurt yourself or you are in immediate danger, please contact emergency services or a local crisis line right now. In the US and Canada, call or text 988. If you are elsewhere, use your local emergency or crisis support number. I can also stay with you and help you take the next safe step.`;

const detectCrisis = (text = '') => detectCrisisRegex(text);
const blockedReplyPatterns = [
  /\b\d+\s?(mg|milligrams?|tablets?|pills?)\b/i,
  /\byou (have|are suffering from) (depression|bipolar|schizophrenia|ptsd|an anxiety disorder)\b/i
];
const safeReply = "I can't give medical advice or a diagnosis. A clinician can help with that, and I can help you book an appointment. Meanwhile, I'm here to listen.";
let blockedReplyCount = 0;
const guardAiReply = (reply, model) => {
  if (!blockedReplyPatterns.some(pattern => pattern.test(reply))) return reply;
  blockedReplyCount += 1;
  console.warn('AI reply blocked by medical-safety guard', { blockedReplyCount, model });
  return safeReply;
};
router.getBlockedReplyCount = () => blockedReplyCount;
router.guardAiReply = guardAiReply;
router.detectCrisis = detectCrisis;
const getConfiguredModel = (useOllama, baseUrl = '') => {
  if (useOllama) return process.env.OLLAMA_MODEL || 'llama3.2';

  const configuredModel = process.env.OPENAI_MODEL || 'openai/gpt-oss-20b';
  const isGroq = /api\.groq\.com/i.test(baseUrl);
  const retiredGroqModel = /^(llama-3\.1-8b-instant|llama-3\.3-70b-versatile)$/i.test(configuredModel);

  return isGroq && retiredGroqModel ? 'openai/gpt-oss-20b' : configuredModel;
};

const getAiRequestTimeout = () => {
  const configured = process.env.AI_PROVIDER_TIMEOUT_MS;
  if (!configured) return 20_000;
  const timeout = Number(configured);
  if (!Number.isInteger(timeout) || timeout < 1_000 || timeout > 120_000) {
    throw new Error('AI_PROVIDER_TIMEOUT_MS must be an integer between 1000 and 120000.');
  }
  return timeout;
};

const generateAiReply = async (userMessage = '', conversation = [], grounding = '') => {
  const message = String(userMessage || '').trim();
  if (!message) throw new Error('A message is required.');

  if (detectCrisis(message)) {
    return { reply: `${crisisMessage} Are you in immediate danger right now?`, provider: 'safety-response' };
  }

  const provider = (process.env.AI_PROVIDER || 'openai').toLowerCase();
  const useOllama = provider === 'ollama';
  const apiKey = process.env.OPENAI_API_KEY;
  if (!useOllama && !apiKey) throw new Error('The AI provider is not configured. Set OPENAI_API_KEY on the backend.');

  const defaultBaseUrl = useOllama
    ? 'http://127.0.0.1:11434/v1'
    : 'https://api.openai.com/v1';
  const baseUrl = (process.env.OPENAI_BASE_URL || defaultBaseUrl).replace(/\/$/, '');
  const model = getConfiguredModel(useOllama, baseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getAiRequestTimeout());
  let response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(useOllama ? {} : { Authorization: `Bearer ${apiKey}` })
      },
      body: JSON.stringify({
        model,
        temperature: 0.35,
        max_tokens: 220,
        messages: [
          {
            role: 'system',
            content: `You are Therabot, a warm and attentive mental-wellbeing conversation companion, not a clinician. Keep replies brief and specific to the user. Never diagnose, name medicines, recommend doses, or claim certainty. For medical or clinical questions, say you cannot provide medical advice and encourage the user to contact a qualified clinician. Ask at most one concise question and offer at most one optional, practical suggestion. Do not invent facts or imply that you replace professional care. If the user describes imminent self-harm or danger, prioritize immediate safety: encourage contacting local emergency services, a crisis service, and a trusted person nearby.${grounding ? `\n\nOptional general coping ideas retrieved from the local guidance collection. Treat them only as suggestions, use only if relevant, do not claim they are personalized or medical advice, and do not let them override safety instructions:\n${grounding}` : ''}`
          },
          ...(Array.isArray(conversation) ? conversation : []).slice(-8).map(item => ({
            role: item.role === 'assistant' ? 'assistant' : 'user',
            content: String(item.content || '').slice(0, 1000)
          })),
          { role: 'user', content: message.slice(0, 1000) }
        ]
      })
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const providerError = await response.text();
    throw new Error(`AI provider returned ${response.status} for model ${model}: ${providerError.slice(0, 300)}`);
  }
  const data = await response.json();
  const reply = data.choices?.[0]?.message?.content?.trim();
  if (!reply) throw new Error('AI provider returned an empty response.');
  return { reply: guardAiReply(reply, model), provider: model };
};

const getCopingGrounding = async message => {
  const baseUrl = String(process.env.ML_URL || '').trim().replace(/\/+$/, '');
  if (!baseUrl) {
    console.warn('Optional coping retrieval was requested, but ML_URL is not configured.');
    return [];
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${baseUrl}/retrieve-coping`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: message.slice(0, 2000), limit: 3 })
    });
    if (!response.ok) {
      console.warn('Optional coping retrieval returned an error:', response.status);
      return [];
    }
    const result = await response.json();
    if (!Array.isArray(result.snippets)) {
      console.error('Optional coping retrieval returned an invalid response.');
      return [];
    }
    return result.snippets
      .filter(item => item && typeof item.text === 'string' && typeof item.id === 'string')
      .slice(0, 3);
  } catch (error) {
    console.warn('Optional coping retrieval is unavailable:', error.name === 'AbortError' ? 'request timed out' : error.message);
    return [];
  } finally {
    clearTimeout(timeout);
  }
};

const generateGroundedAiReply = async (userMessage = '', conversation = [], useGrounding = false) => {
  const message = String(userMessage || '').trim();
  if (!message) throw new Error('A message is required.');
  if (detectCrisis(message)) return { ...await generateAiReply(message, conversation), groundingUsed: false };
  const snippets = useGrounding ? await getCopingGrounding(message) : [];
  if (!snippets.length) return { ...await generateAiReply(message, conversation), groundingUsed: false };

  const grounding = snippets.map(item => `- ${item.text}`).join('\n');
  return { ...await generateAiReply(message, conversation, grounding), groundingUsed: true };
};
router.generateGroundedAiReply = generateGroundedAiReply;

const generateFallbackClinicalNote = (transcript = [], patientName = 'the patient', doctorName = 'the clinician') => {
  const messages = (Array.isArray(transcript) ? transcript : [])
    .map(item => ({
      author: String(item?.author || 'Speaker'),
      message: String(item?.message || '').replace(/\s+/g, ' ').trim()
    }))
    .filter(item => item.message);
  const patientMessages = messages.filter(item => /patient/i.test(item.author)).map(item => item.message);
  const doctorMessages = messages.filter(item => /doctor|clinician/i.test(item.author)).map(item => item.message);
  const transcriptText = messages.map(item => `${item.author}: ${item.message}`).join(' ');
  const isCombinedAudio = messages.some(item => /consultation audio/i.test(item.author));
  const cleanedTranscriptText = transcriptText
    .replace(/(?:\bhello\b[\s,.!?]*){3,}/gi, 'Hello. ')
    .replace(/(?:\bhi\b[\s,.!?]*){3,}/gi, 'Hi. ')
    .replace(/\s+/g, ' ')
    .trim();
  const concernKeywords = ['stress', 'anxiety', 'sleep', 'mood', 'fear', 'panic', 'sad', 'depressed', 'lonely', 'overwhelmed', 'burnout'];
  const concerns = concernKeywords.filter(keyword => cleanedTranscriptText.toLowerCase().includes(keyword));
  const patientSummary = isCombinedAudio
    ? `Combined consultation audio indicates: ${cleanedTranscriptText.replace(/^Consultation audio:\s*/i, '').slice(0, 500)}`
    : (patientMessages.slice(-2).join(' ') || cleanedTranscriptText).slice(0, 500);
  const doctorSummary = (doctorMessages.slice(-2).join(' ') || 'Supportive guidance was discussed during the consultation.').slice(0, 500);
  const safetyFlag = /suicid|self[- ]harm|kill myself|hurt myself|unsafe/i.test(cleanedTranscriptText)
    ? 'Safety concern mentioned in transcript; immediate clinician review is required.'
    : 'No immediate safety concern was identified in the captured transcript.';

  return [
    `Subjective\nPatient: ${patientName}. ${patientSummary}`,
    `Objective\n${isCombinedAudio ? 'A combined consultation audio transcript was captured; speaker attribution was not available.' : 'Consultation transcript captured from the patient-doctor conversation.'} Report prepared by the system for review by ${doctorName}.`,
    `Assessment\nReported themes: ${concerns.length ? concerns.join(', ') : 'No specific concern keyword identified'}. ${safetyFlag}`,
    `Plan\n${isCombinedAudio ? 'Clinician should verify the audio transcript, correct speaker attribution, and confirm the patient-reported concerns before making care decisions.' : doctorSummary} Clinician should verify this draft, complete any missing assessment, and decide follow-up actions.`
  ].join('\n\n');
};

const generateTranscriptSummary = (transcript = []) => {
  const messages = (Array.isArray(transcript) ? transcript : [])
    .map(item => ({
      author: String(item?.author || 'Speaker'),
      message: String(item?.message || '').replace(/\s+/g, ' ').trim()
    }))
    .filter(item => item.message);

  if (!messages.length) return 'No transcript captured yet.';

  const transcriptText = messages.map(item => item.message).join(' ');
  const concernKeywords = ['stress', 'anxiety', 'sleep', 'mood', 'fear', 'panic', 'sad', 'depressed', 'lonely', 'overwhelmed', 'burnout'];
  const concerns = concernKeywords.filter(keyword => transcriptText.toLowerCase().includes(keyword));
  const excerpt = transcriptText.slice(0, 240);

  return `Consultation captured ${messages.length} transcript segment${messages.length === 1 ? '' : 's'}. Themes discussed: ${concerns.length ? concerns.slice(0, 4).join(', ') : 'general wellbeing and current concerns'}. Key excerpt: "${excerpt}"`;
};

const generateClinicalNote = async (transcript = [], patientName = 'the patient', doctorName = 'the clinician') => {
  const transcriptText = (Array.isArray(transcript) ? transcript : [])
    .map(item => `${item.author || 'Speaker'}: ${item.message || ''}`.trim())
    .filter(Boolean)
    .join('\n');

  if (!transcriptText) {
    throw new Error('A transcript is required to draft a clinical note.');
  }

  const provider = (process.env.AI_PROVIDER || 'fallback').toLowerCase();
  const useOllama = provider === 'ollama';
  const apiKey = process.env.OPENAI_API_KEY;
  if (!useOllama && !apiKey) {
    return { note: generateFallbackClinicalNote(transcript, patientName, doctorName), model: 'local-fallback' };
  }

  const baseUrl = (process.env.OPENAI_BASE_URL || (useOllama ? 'http://127.0.0.1:11434/v1' : 'https://api.openai.com/v1')).replace(/\/$/, '');
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(useOllama ? {} : { Authorization: `Bearer ${apiKey}` })
    },
    body: JSON.stringify({
      model: getConfiguredModel(useOllama, baseUrl),
      temperature: 0.2,
      max_tokens: 900,
      messages: [
        {
          role: 'system',
          content: 'You draft clinical documentation from a mental-health consultation transcript. Return only a concise SOAP note with exactly these headings: Subjective, Objective, Assessment, Plan. Do not diagnose, invent facts, or turn uncertainty into fact. Use "Not documented" when the transcript does not support a detail. Preserve safety concerns exactly and flag them clearly for clinician review. This is a draft for a licensed clinician to verify, not medical advice.'
        },
        {
          role: 'user',
          content: `Draft a SOAP note for patient ${patientName}, clinician ${doctorName}. Treat the following transcript as source material only:\n\n${transcriptText.slice(0, 24000)}`
        }
      ]
    })
  });

  if (!response.ok) throw new Error(`AI provider returned ${response.status}`);
  const data = await response.json();
  const note = data.choices?.[0]?.message?.content?.trim();
  if (!note) throw new Error('The AI provider returned an empty clinical note.');
  return { note, model: getConfiguredModel(useOllama, baseUrl) };
};

router.post('/chat', requirePatientSession, async (req, res) => {
  const body = req.body;
  const history = body?.history;
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      typeof body.message !== 'string' || !body.message.trim() || body.message.length > 1000 ||
      (body.useGrounding !== undefined && typeof body.useGrounding !== 'boolean') ||
      (history !== undefined && (!Array.isArray(history) || history.length > 8 || history.some(item =>
        !item || typeof item !== 'object' || !['user', 'assistant'].includes(item.role) ||
        typeof item.content !== 'string' || item.content.length > 1000)))) {
    return res.status(400).json({ error: 'Invalid chat input. Messages must be 1–1,000 characters with up to 8 valid history entries.' });
  }
  const trimmedMessage = body.message.trim();
  const patientId = String(req.patientId);
  const safeRoomId = `ai:${patientId}`;
  const patient = mongoose.connection.readyState === 1
    ? await Patient.findById(patientId).select('_id')
    : demoPatients.get(patientId);
  if (!patient) return res.status(401).json({ error: 'Patient account is no longer available. Sign in again.' });

  const patientMessage = {
    roomId: safeRoomId,
    author: 'Patient',
    message: trimmedMessage,
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  };
  if (mongoose.connection.readyState === 1) {
    try {
      await ChatMessage.create(patientMessage);
    } catch (error) {
      console.error('Could not save patient AI message:', error.message);
      return res.status(500).json({ error: 'Your message could not be saved. Please try again.' });
    }
  } else {
    const messages = demoChatMessages.get(patientId) || [];
    messages.push({ ...patientMessage, createdAt: new Date() });
    demoChatMessages.set(String(req.patientId), messages);
  }

  let generated;
  try {
    generated = await generateGroundedAiReply(trimmedMessage, history || [], body.useGrounding === true);
  } catch (error) {
    console.error('AI provider request failed:', error.message);
    console.error('AI chat unavailable:', error.message);
    return res.status(503).json({
      error: 'The AI companion is temporarily unavailable. Please reconnect the configured AI provider and try again.'
    });
  }

  const aiMessage = {
    roomId: safeRoomId,
    author: 'AI Companion',
    message: generated.reply,
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  };

  if (mongoose.connection.readyState === 1) {
    try {
      await ChatMessage.create(aiMessage);
    } catch (error) {
      console.error('Could not save AI response:', error.message);
      return res.status(500).json({ error: 'The response was generated, but could not be saved to your chat history.' });
    }
  } else {
    const messages = demoChatMessages.get(patientId) || [];
    messages.push({ ...aiMessage, createdAt: new Date() });
    demoChatMessages.set(String(req.patientId), messages);
  }

  res.status(200).json({
    reply: generated.reply,
    provider: generated.provider,
    groundingUsed: generated.groundingUsed,
    timestamp: new Date().toISOString(),
    riskDetected: detectCrisis(trimmedMessage)
  });

});

router.get('/history', requirePatientSession, async (req, res) => {
  try {
    const patientId = String(req.patientId);
    const messages = mongoose.connection.readyState === 1
      ? await ChatMessage.find({ roomId: { $in: [`ai:${patientId}`, patientId] } })
        .sort({ createdAt: -1 }).limit(20).lean()
      : (demoChatMessages.get(patientId) || []).slice(-20).reverse();
    return res.status(200).json(messages.reverse());
  } catch (error) {
    console.error('Patient AI history lookup failed:', error.message);
    return res.status(500).json({ error: 'Could not load your AI chat history.' });
  }
});

router.post('/clinical-note', requireDoctorSession, async (req, res) => {
  const { roomUrl, appointmentId, transcript = [], source = 'transcript', patientName = 'the patient', doctorName = 'the clinician' } = req.body || {};

  if (!roomUrl) return res.status(400).json({ error: 'roomUrl is required' });
  if (!Array.isArray(transcript) || transcript.length === 0) {
    return res.status(400).json({ error: 'A transcript is required to draft a clinical note.' });
  }

  if (mongoose.connection.readyState === 1) {
    const appointment = appointmentId
      ? await Appointment.findOne({ _id: appointmentId, doctorId: String(req.doctorId) })
      : null;
    const session = roomUrl ? await CallSession.findOne({ roomUrl }) : null;
    if (appointmentId && !appointment) return res.status(404).json({ error: 'Appointment not found in your care team.' });
    if (session && appointment && String(session.patientId) !== String(appointment.patientId)) {
      return res.status(403).json({ error: 'Appointment and session do not belong to the same patient.' });
    }
    const patientId = appointment?.patientId || session?.patientId;
    const patient = patientId
      ? await Patient.findOne({ _id: patientId, assignedDoctorId: String(req.doctorId) }).select('_id')
      : null;
    if (!patient) return res.status(404).json({ error: 'Consultation not found in your care team.' });
    if (appointment && String(appointment.roomUrl || '') !== String(roomUrl || '')) {
      return res.status(403).json({ error: 'The consultation link does not match this appointment.' });
    }
  } else {
    const appointment = appointmentId
      ? demoAppointments.find(item => String(item._id) === String(appointmentId) && String(item.doctorId) === String(req.doctorId))
      : null;
    const session = roomUrl ? demoCallSessions.find(item => String(item.roomUrl) === String(roomUrl)) : null;
    if (appointmentId && !appointment) return res.status(404).json({ error: 'Appointment not found in your care team.' });
    if (session && appointment && String(session.patientId) !== String(appointment.patientId)) {
      return res.status(403).json({ error: 'Appointment and session do not belong to the same patient.' });
    }
    const patientId = appointment?.patientId || session?.patientId;
    const patient = [...demoPatients.values()].find(item => String(item._id) === String(patientId));
    if (!patient || String(patient.assignedDoctorId || 'doctor-default') !== String(req.doctorId)) {
      return res.status(404).json({ error: 'Consultation not found in your care team.' });
    }
    if (appointment && String(appointment.roomUrl || '') !== String(roomUrl || '')) {
      return res.status(403).json({ error: 'The consultation link does not match this appointment.' });
    }
  }

  try {
    let note;
    let model;
    try {
      ({ note, model } = await generateClinicalNote(transcript, patientName, doctorName));
    } catch (providerError) {
      console.warn('Clinical note provider failed; using local transcript-based draft:', providerError.message);
      note = generateFallbackClinicalNote(transcript, patientName, doctorName);
      model = 'local-fallback';
    }

    const clinicalNote = {
      text: note,
      generatedAt: new Date(),
      model,
      source
    };
    const savedTranscript = transcript
      .map(item => ({
        author: String(item?.author || 'Speaker'),
        message: String(item?.message || '').replace(/\s+/g, ' ').trim(),
        time: item?.time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }))
      .filter(item => item.message);

    if (mongoose.connection.readyState === 1) {
      let session = await CallSession.findOne({ roomUrl });
      if (!session && appointmentId) {
        const appointment = await Appointment.findById(appointmentId);
        if (appointment && String(appointment.roomUrl) === String(roomUrl)) {
          session = await CallSession.create({
            patientId: appointment.patientId,
            patientName: appointment.patientName,
            doctorName: appointment.doctorName || doctorName,
            roomUrl,
            scheduledDate: appointment.scheduledDate,
            scheduledTime: appointment.scheduledTime,
            transcript: [],
            summary: 'No transcript captured yet.',
            isRecorded: false
          });
        }
      }
      if (!session) return res.status(404).json({ error: 'Session not found' });
      session.clinicalNote = clinicalNote;
      session.transcript = savedTranscript;
      session.summary = generateTranscriptSummary(savedTranscript);
      session.isRecorded = savedTranscript.length > 0;
      await session.save();
      return res.status(200).json({ message: 'SOAP note drafted successfully', clinicalNote, session });
    }

    let session = demoCallSessions.find(item => String(item.roomUrl) === String(roomUrl));
    if (!session && appointmentId) {
      const appointment = demoAppointments.find(item => String(item._id) === String(appointmentId));
      if (appointment && String(appointment.roomUrl) === String(roomUrl)) {
        session = {
          _id: `demo-session-${Date.now()}`,
          patientId: appointment.patientId,
          patientName: appointment.patientName,
          doctorName: appointment.doctorName || doctorName,
          roomUrl,
          scheduledDate: appointment.scheduledDate,
          scheduledTime: appointment.scheduledTime,
          transcript: [],
          summary: 'No transcript captured yet.',
          isRecorded: false,
          createdAt: new Date()
        };
        demoCallSessions.unshift(session);
      }
    }
    if (!session) return res.status(404).json({ error: 'Session not found' });
    session.clinicalNote = clinicalNote;
    session.transcript = savedTranscript;
    session.summary = generateTranscriptSummary(savedTranscript);
    session.isRecorded = savedTranscript.length > 0;
    return res.status(200).json({ message: 'SOAP note drafted successfully', clinicalNote, session });
  } catch (error) {
    console.error('Clinical note generation failed:', error.message);
    return res.status(502).json({ error: error.message });
  }
});

module.exports = router;
