const router = require('express').Router();
const ChatMessage = require('../models/ChatMessage');
const mongoose = require('mongoose');
const CallSession = require('../models/CallSession');
const { demoCallSessions } = require('../demoStore');

const crisisMessage = `I want to take this seriously. If you feel like you might hurt yourself or you are in immediate danger, please contact emergency services or a local crisis line right now. In the US and Canada, call or text 988. If you are elsewhere, use your local emergency or crisis support number. I can also stay with you and help you take the next safe step.`;

/* Kept out of the response path: the companion uses a language model, not keyword rules. */
const conversationDataset = [
  {
    id: 'anxiety',
    keywords: ['anxious', 'panic', 'worried', 'nervous', 'afraid', 'fear'],
    responses: [
      'Anxiety can make your mind race ahead before your body has even caught up. Let’s slow this down and focus on the present moment instead of everything that might happen later.',
      'It sounds like your nervous system feels activated. That does not mean you are failing; it means your body is under stress. Let’s ground it with something simple and steady.',
      'When anxiety spikes, the mind tends to imagine the worst case. We can reduce that by focusing on one concrete fact, one breath, and one next step.'
    ],
    followUps: ['What feels most intense right now?', 'What is the thought that feels loudest at the moment?']
  },
  {
    id: 'overwhelm',
    keywords: ['overwhelmed', 'too much', 'stress', 'stressed', 'pressure', 'burnt out'],
    responses: [
      'It sounds like too much is landing at once, and that can make even small tasks feel impossible. You do not have to solve your whole life today.',
      'When everything piles up, the brain treats it like a wall. We can make the wall smaller by choosing only the next reasonable action.',
      'This is a lot to carry, and it makes sense that you feel stretched thin. Let’s reduce the load instead of adding more pressure.'
    ],
    followUps: ['Which task feels most urgent?', 'What would make today feel a little lighter?']
  },
  {
    id: 'work',
    keywords: ['project', 'work', 'deadline', 'task', 'assignment', 'report', 'lot of work', 'too much work'],
    responses: [
      'Big work becomes impossible when you look at all of it as one giant block. The trick is to stop thinking about the whole project and focus on the next visible step.',
      'A project does not need to be finished in one sitting. The goal is to choose the next action clearly and keep moving without forcing perfection.',
      'That kind of workload can make anyone feel stuck. We can break it down into smaller chunks so it starts to feel doable again.'
    ],
    followUps: ['What part of the work feels most blocked?', 'Can we find the smallest next step together?']
  },
  {
    id: 'sleep',
    keywords: ['sleep', 'tired', 'exhausted', 'cannot sleep', 'insomnia', 'low energy'],
    responses: [
      'Low sleep can make everything feel louder and heavier. Your mind may be trying to stay alert because your body is tired and unsettled.',
      'When the body is exhausted, the mind often feels more restless. A calmer routine helps the body remember that it is safe to rest.',
      'You may not need to fix the whole night; you just need one gentle action that helps your body feel a little safer.'
    ],
    followUps: ['What usually happens before sleep becomes difficult?', 'Are you feeling mentally wired or physically drained?']
  },
  {
    id: 'sadness',
    keywords: ['sad', 'lonely', 'empty', 'depressed', 'hopeless', 'cry', 'down'],
    responses: [
      'It sounds like you are carrying a heavy feeling right now, and it deserves gentleness. You are not weak for feeling low.',
      'When sadness is strong, even small tasks can feel impossible. Try noticing one tiny comfort you can offer yourself without forcing it.',
      'The pain is real, and it does not need to be solved all at once. We can make this moment smaller and easier to carry.'
    ],
    followUps: ['What feels heaviest right now?', 'Is there one small comfort that might help you feel a bit safer?']
  },
  {
    id: 'anger',
    keywords: ['angry', 'frustrated', 'mad', 'irritated', 'annoyed'],
    responses: [
      'Frustration often hides deeper stress or a sense that something feels unfair. It makes sense that you feel activated.',
      'Anger is a signal, not a verdict. Before reacting, ask what is really being threatened or ignored underneath the emotion.',
      'You do not have to handle the whole problem in this moment. Choose one action that reduces the tension without escalating things.'
    ],
    followUps: ['What specifically triggered this feeling?', 'What would help your body feel a little more settled?']
  },
  {
    id: 'guilt',
    keywords: ['guilty', 'ashamed', 'worthless', 'failure', 'not enough', 'bad person'],
    responses: [
      'That is a painful thought pattern, and it is not a fair summary of who you are. One difficult moment does not define your value.',
      'I would not talk to you the way that thought is talking to you. Try replacing “I failed” with “I am struggling, and I need support.”',
      'You are allowed to be imperfect and still deserve kindness. A hard day is not the same as a broken identity.'
    ],
    followUps: ['What thought feels the harshest right now?', 'What would you say to a friend who had this thought?']
  },
  {
    id: 'support',
    keywords: ['hello', 'hi', 'hey', 'help me', 'i need help', 'good morning'],
    responses: [
      'I’m here with you, and you do not need to explain everything perfectly. Start with the feeling that is most present, and we will move gently from there.',
      'You do not have to be productive to deserve support. Tell me what is happening in the simplest words you can find.',
      'This space is meant to be supportive, not demanding. We can keep it simple and honest.'
    ],
    followUps: ['What feels most difficult right now?', 'Would you like to talk about stress, thoughts, or your energy?']
  }
];

const detectCrisis = (text = '') => {
  const message = text.toLowerCase();
  const crisisPatterns = [
    'suicidal', 'kill myself', 'end my life', 'hurt myself', 'self harm', 'self-harm',
    'don\'t want to live', 'wish i were dead', 'can\'t go on', 'no reason to live',
    'hopeless', 'panic attack', 'i am unsafe', 'i may hurt myself', 'i want to disappear'
  ];

  return crisisPatterns.some((pattern) => message.includes(pattern));
};

const findDatasetMatch = (userMessage = '') => {
  const text = (userMessage || '').toLowerCase();
  return conversationDataset.find((entry) =>
    entry.keywords.some((keyword) => text.includes(keyword.toLowerCase()))
  );
};

const buildGroundingStep = (userMessage = '') => {
  const text = (userMessage || '').toLowerCase();

  if (text.includes('anxious') || text.includes('panic') || text.includes('worried')) {
    return 'Try a 4-6 breathing rhythm: inhale for 4 counts, exhale for 6, and repeat it 4 times. Let your jaw and shoulders soften as you breathe out.';
  }

  if (text.includes('project') || text.includes('work') || text.includes('deadline') || text.includes('task')) {
    return 'Choose the single next visible step and do only that for the next 15 minutes. The goal is not to finish everything; it is to make the next move clear.';
  }

  if (text.includes('sleep') || text.includes('tired') || text.includes('exhausted')) {
    return 'Reduce stimulation for a little while and dim the lights. A calmer environment helps your nervous system signal that it is safe to rest.';
  }

  if (text.includes('sad') || text.includes('lonely') || text.includes('empty')) {
    return 'Name one small comfort you can give yourself right now, even if it is tiny: water, a blanket, music, sunlight, or a text to someone you trust.';
  }

  return 'Put both feet on the ground, take one slow breath, and remind yourself: “I can handle this one step at a time.”';
};

const generateAiReply = async (userMessage = '', conversation = []) => {
  const message = (userMessage || '').trim();

  if (!message) {
    return 'I am here with you. Tell me what is weighing on your mind, and we can handle it one small step at a time.';
  }

  if (detectCrisis(message)) {
    return `${crisisMessage} Right now, the safest next step is to tell someone you trust or contact a crisis line. Would you like help making a quick safety plan?`;
  }

  const provider = (process.env.AI_PROVIDER || 'fallback').toLowerCase();
  const useOllama = provider === 'ollama';
  const apiKey = process.env.OPENAI_API_KEY;
  if (!useOllama && !apiKey) {
    return 'The AI companion is not configured yet. Add an API key or set AI_PROVIDER=ollama to use a local Ollama model.';
  }

  const baseUrl = (process.env.OPENAI_BASE_URL || (useOllama ? 'http://127.0.0.1:11434/v1' : 'https://api.openai.com/v1')).replace(/\/$/, '');
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(useOllama ? {} : { Authorization: `Bearer ${apiKey}` })
    },
    body: JSON.stringify({
      model: process.env.OLLAMA_MODEL || process.env.OPENAI_MODEL || 'llama3.2',
      temperature: 0.7,
      max_tokens: 500,
      messages: [
        {
          role: 'system',
          content: 'You are a warm, calm mental-health support companion. Listen carefully, reflect feelings, ask one useful follow-up question, and offer small practical coping steps. Do not diagnose, claim to be a therapist, prescribe medication, or pretend to know facts about the user. Encourage professional support when appropriate. If the user describes immediate danger or self-harm, tell them to contact emergency services or a local crisis line and a trusted person now.'
        },
        ...(conversation || []).slice(-10).map(item => ({
          role: item.role === 'assistant' ? 'assistant' : 'user',
          content: String(item.content || '').slice(0, 2000)
        })),
        { role: 'user', content: message }
      ]
    })
  });

  if (!response.ok) throw new Error(`AI provider returned ${response.status}`);
  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || 'I am here with you. Could you tell me a little more about what you are feeling?';
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
  const concernKeywords = ['stress', 'anxiety', 'sleep', 'mood', 'fear', 'panic', 'sad', 'depressed', 'lonely', 'overwhelmed', 'burnout'];
  const concerns = concernKeywords.filter(keyword => transcriptText.toLowerCase().includes(keyword));
  const patientSummary = (patientMessages.slice(-2).join(' ') || transcriptText).slice(0, 500);
  const doctorSummary = (doctorMessages.slice(-2).join(' ') || 'Supportive guidance was discussed during the consultation.').slice(0, 500);
  const safetyFlag = /suicid|self[- ]harm|kill myself|hurt myself|unsafe/i.test(transcriptText)
    ? 'Safety concern mentioned in transcript; immediate clinician review is required.'
    : 'No immediate safety concern was identified in the captured transcript.';

  return [
    `Subjective\nPatient: ${patientName}. ${patientSummary}`,
    `Objective\nConsultation transcript captured from the patient-doctor conversation. Report prepared by the system for review by ${doctorName}.`,
    `Assessment\nReported themes: ${concerns.length ? concerns.join(', ') : 'No specific concern keyword identified'}. ${safetyFlag}`,
    `Plan\n${doctorSummary} Clinician should verify this draft, complete any missing assessment, and decide follow-up actions.`
  ].join('\n\n');
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
      model: process.env.OLLAMA_MODEL || process.env.OPENAI_MODEL || 'llama3.2',
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
  return { note, model: process.env.OLLAMA_MODEL || process.env.OPENAI_MODEL || 'llama3.2' };
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

  let reply;
  try {
    reply = await generateAiReply(trimmedMessage, history);
  } catch (error) {
    console.error('AI provider request failed:', error.message);
    reply = 'I could not reach the AI companion right now. Please try again shortly, or contact a trusted person or mental-health professional if you need immediate support.';
  }

  const aiMessage = {
    roomId: safeRoomId,
    author: 'AI Companion',
    message: reply,
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  };

  await ChatMessage.create(aiMessage).catch(() => null);

  res.status(200).json({
    reply,
    timestamp: new Date().toISOString(),
    riskDetected: detectCrisis(trimmedMessage)
  });
});

router.post('/clinical-note', async (req, res) => {
  const { roomUrl, transcript = [], source = 'transcript', patientName = 'the patient', doctorName = 'the clinician' } = req.body || {};

  if (!roomUrl) return res.status(400).json({ error: 'roomUrl is required' });
  if (!Array.isArray(transcript) || transcript.length === 0) {
    return res.status(400).json({ error: 'A transcript is required to draft a clinical note.' });
  }

  try {
    const { note, model } = await generateClinicalNote(transcript, patientName, doctorName);
    const clinicalNote = {
      text: note,
      generatedAt: new Date(),
      model,
      source
    };

    if (mongoose.connection.readyState === 1) {
      const session = await CallSession.findOne({ roomUrl });
      if (!session) return res.status(404).json({ error: 'Session not found' });
      session.clinicalNote = clinicalNote;
      await session.save();
      return res.status(200).json({ message: 'SOAP note drafted successfully', clinicalNote, session });
    }

    const session = demoCallSessions.find(item => String(item.roomUrl) === String(roomUrl));
    if (!session) return res.status(404).json({ error: 'Session not found' });
    session.clinicalNote = clinicalNote;
    return res.status(200).json({ message: 'SOAP note drafted successfully', clinicalNote, session });
  } catch (error) {
    console.error('Clinical note generation failed:', error.message);
    return res.status(502).json({ error: error.message });
  }
});

module.exports = router;
