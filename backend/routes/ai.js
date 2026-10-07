const router = require('express').Router();
const ChatMessage = require('../models/ChatMessage');
const mongoose = require('mongoose');
const CallSession = require('../models/CallSession');
const Appointment = require('../models/Appointment');
const Patient = require('../models/Patient');
const { demoAppointments, demoCallSessions, demoPatients } = require('../demoStore');
const { requireDoctorSession } = require('../doctorSession');

const crisisMessage = `I want to take this seriously. If you feel like you might hurt yourself or you are in immediate danger, please contact emergency services or a local crisis line right now. In the US and Canada, call or text 988. If you are elsewhere, use your local emergency or crisis support number. I can also stay with you and help you take the next safe step.`;

const detectCrisis = (text = '') => /\b(kill myself|end my life|suicid(?:e|al)|hurt myself|self[- ]harm|don't want to live|do not want to live|wish i were dead|no reason to live|i may hurt myself|i am in immediate danger|i am unsafe)\b/i.test(text);
const getConfiguredModel = useOllama => useOllama
  ? process.env.OLLAMA_MODEL || 'llama3.2'
  : process.env.OPENAI_MODEL || 'gpt-4o-mini';

const generateContextualFallback = (message, conversation = []) => {
  const latestUserMessage = String(message || '').replace(/\s+/g, ' ').trim();
  const contextAvailable = Array.isArray(conversation) && conversation.some(item => item?.content);
  return `The AI provider is unavailable right now, so I cannot generate a real conversational response. Please check the Ollama connection and try again.${contextAvailable ? ' Your conversation is still here.' : ''}`;
};

const generateAiReply = async (userMessage = '', conversation = []) => {
  const message = String(userMessage || '').trim();
  if (!message) throw new Error('A message is required.');

  if (detectCrisis(message)) {
    return { reply: `${crisisMessage} Are you in immediate danger right now?`, provider: 'safety-response' };
  }

  const provider = (process.env.AI_PROVIDER || 'fallback').toLowerCase();
  const useOllama = provider === 'ollama';
  const apiKey = process.env.OPENAI_API_KEY;
  if (!useOllama && !apiKey) {
    return { reply: generateContextualFallback(message, conversation), provider: 'basic-fallback' };
  }

  const baseUrl = (process.env.OPENAI_BASE_URL || (useOllama ? 'http://127.0.0.1:11434/v1' : 'https://api.openai.com/v1')).replace(/\/$/, '');
  const model = getConfiguredModel(useOllama);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
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
        max_tokens: 450,
        messages: [
          {
            role: 'system',
            content: 'You are Therabot, a warm and attentive mental-wellbeing conversation companion, not a clinician. Respond to the specific details the user shared and use recent conversation context. If the user sends a short follow-up such as “my project”, connect it to the immediately preceding concern instead of treating it as a new unrelated message. Do not repeat a generic greeting or ask what matters most when the context already makes the topic clear. Start by acknowledging their experience without exaggerating, diagnosing, or claiming certainty. Ask at most one concise, relevant question. Offer one practical suggestion only when it fits, and keep it optional. Do not invent facts, repeat canned scripts, prescribe medication, or imply that you replace professional care. For medical or clinical questions, be transparent about limits and encourage discussion with a qualified professional. If the user describes imminent self-harm or danger, prioritize immediate safety: encourage contacting local emergency services, a crisis service, and a trusted person nearby.'
          },
          ...(Array.isArray(conversation) ? conversation : []).slice(-8).map(item => ({
            role: item.role === 'assistant' ? 'assistant' : 'user',
            content: String(item.content || '').slice(0, 1500)
          })),
          { role: 'user', content: message.slice(0, 4000) }
        ]
      })
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) throw new Error(`AI provider returned ${response.status}`);
  const data = await response.json();
  const reply = data.choices?.[0]?.message?.content?.trim();
  if (!reply) throw new Error('AI provider returned an empty response.');
  return { reply, provider: model };
};

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
      model: getConfiguredModel(useOllama),
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
  return { note, model: getConfiguredModel(useOllama) };
};

router.post('/chat', async (req, res) => {
  const { message, roomId, author = 'Patient', history = [] } = req.body || {};
  const trimmedMessage = (message || '').trim();
  const safeRoomId = roomId || 'general';

  if (trimmedMessage) {
    await ChatMessage.create({
      roomId: safeRoomId,
      author,
      message: trimmedMessage,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }).catch(() => null);
  }

  let generated;
  try {
    generated = await generateAiReply(trimmedMessage, history);
  } catch (error) {
    console.error('AI provider request failed:', error.message);
    generated = {
      reply: generateContextualFallback(trimmedMessage, history),
      provider: 'basic-fallback'
    };
  }

  const aiMessage = {
    roomId: safeRoomId,
    author: 'AI Companion',
    message: generated.reply,
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  };

  await ChatMessage.create(aiMessage).catch(() => null);

  res.status(200).json({
    reply: generated.reply,
    provider: generated.provider,
    timestamp: new Date().toISOString(),
    riskDetected: detectCrisis(trimmedMessage)
  });
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
