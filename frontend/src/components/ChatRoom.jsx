import React, { useState, useEffect, useRef } from 'react';
import { api, backendUrl } from '../api';
import io from 'socket.io-client';

const socket = io(backendUrl, { autoConnect: false });

const quickPrompts = [
  'I feel overwhelmed today',
  'I am very anxious',
  'I am having trouble sleeping',
  'I need a grounding exercise',
  'I feel lonely and exhausted'
];

export default function ChatRoom({ roomId, senderName, mode = 'live' }) {
  const [message, setMessage] = useState('');
  const [listening, setListening] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [chatError, setChatError] = useState('');
  const [basicMode, setBasicMode] = useState(false);
  const useCopingGuidance = false;
  const recognizerRef = useRef(null);
  const messageEndRef = useRef(null);
  const requestInFlightRef = useRef(false);
  const [messageList, setMessageList] = useState([
    {
      author: 'AI Companion',
      message: 'Hi, I’m here with you. Tell me how you are feeling today, and we can take it one small step at a time.',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isAi: true
    }
  ]);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.continuous = false;

    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0].transcript)
        .join(' ');
      setMessage(transcript);
    };

    recognition.onend = () => setListening(false);
    recognizerRef.current = recognition;

    return () => recognition.stop();
  }, []);

  useEffect(() => {
    if (mode === 'live') {
      const token = localStorage.getItem('doctorSessionToken') || localStorage.getItem('patientSessionToken');
      socket.auth = { token };
      socket.connect();

      const onReceiveMessage = data => {
        setMessageList((list) => [...list, data]);
      };
      const onConnectionError = () => setChatError('Your secure chat session could not be verified. Sign in again.');
      socket.on('receive_message', onReceiveMessage);
      socket.on('connect_error', onConnectionError);
      socket.emit('join_room', roomId, result => {
        if (result?.error) setChatError('You do not have access to this patient chat.');
      });

      return () => {
        socket.off('receive_message', onReceiveMessage);
        socket.off('connect_error', onConnectionError);
        socket.disconnect();
      };
    }
  }, [roomId, mode]);

  useEffect(() => {
    if (mode !== 'ai') return undefined;
    let active = true;
    api.get('/api/ai/history')
      .then(response => {
        if (!active) return;
        const history = (response.data || []).map(item => ({
          author: item.author,
          message: item.message,
          time: item.time || new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          isAi: item.author === 'AI Companion'
        }));
        if (history.length) setMessageList(history);
      })
      .catch(error => {
        if (active) setChatError(error?.response?.data?.error || 'Could not load your saved conversation.');
      });
    return () => { active = false; };
  }, [mode]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messageList, isTyping]);

  const startVoiceInput = () => {
    if (!recognizerRef.current) {
      alert('Speech-to-text is not supported in this browser.');
      return;
    }

    setListening(true);
    recognizerRef.current.start();
  };

  const sendMessage = async (customText) => {
    const textToSend = (customText || message || '').trim();
    if (!textToSend) return;
    if (mode !== 'live' && requestInFlightRef.current) return;

    const userMessage = {
      room: roomId,
      author: senderName,
      message: textToSend,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    if (mode === 'live') {
      await socket.emit('send_message', userMessage);
      setMessageList((list) => [...list, userMessage]);
      setMessage('');
      return;
    }

    setMessageList((list) => [...list, userMessage]);
    setMessage('');
    const conversationHistory = messageList.slice(-8).map((item) => ({
      role: item.author === senderName ? 'user' : 'assistant',
      content: item.message
    }));
    await requestAiReply(textToSend, conversationHistory, useCopingGuidance);
  };

  const requestAiReply = async (textToSend, conversationHistory, includeGrounding = useCopingGuidance) => {
    if (requestInFlightRef.current) return;
    requestInFlightRef.current = true;
    setIsTyping(true);
    setChatError('');

    try {
      const res = await api.post('/api/ai/chat', {
        message: textToSend,
        history: conversationHistory,
        useGrounding: includeGrounding
      });
      setBasicMode(res.data.provider === 'basic-fallback');
      setMessageList((list) => [...list, {
        author: 'AI Companion',
        message: res.data.reply,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        isAi: true,
        groundingUsed: res.data.groundingUsed === true
      }]);
    } catch (error) {
      setChatError(error?.response?.data?.error || 'The companion could not reply. Your message is still here; please try again.');
    } finally {
      requestInFlightRef.current = false;
      setIsTyping(false);
    }
  };

  return (
    <div style={{
      maxWidth: '760px',
      margin: '20px auto',
      background: 'linear-gradient(180deg, #f8fbff 0%, #eef4ff 100%)',
      border: '1px solid #dfe9ff',
      borderRadius: '22px',
      boxShadow: '0 18px 45px rgba(59, 130, 246, 0.12)',
      overflow: 'hidden'
    }}>
      <div style={{ padding: '18px 20px 10px', background: 'linear-gradient(135deg, #1d4ed8, #7c3aed)', color: '#fff' }}>
        <div style={{ fontSize: '12px', letterSpacing: '1.5px', textTransform: 'uppercase', opacity: 0.9 }}>
          {mode === 'live' ? 'Secure Live Chat' : 'AI Mental Wellness Companion'}
        </div>
        <h3 style={{ margin: '8px 0 0', fontSize: '24px' }}>Supportive conversation</h3>
      </div>

      {mode !== 'live' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', padding: '12px 18px 0' }}>
          {quickPrompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => sendMessage(prompt)}
              style={{
                border: '1px solid #d6dbff',
                background: '#fff',
                color: '#2d3d5c',
                borderRadius: '999px',
                padding: '8px 12px',
                cursor: 'pointer',
                fontSize: '13px'
              }}
            >
              {prompt}
            </button>
          ))}
        </div>
      )}

      {mode !== 'live' && basicMode && (
        <div role="status" className="chat-mode-notice">Guided companion mode is active. You can continue the conversation normally.</div>
      )}

      {chatError && <div role="alert" className="chat-error-notice">{chatError}</div>}

      <div aria-live="polite" aria-relevant="additions" style={{ height: '360px', overflowY: 'auto', padding: '18px', background: '#f7f9ff' }}>
        {messageList.map((content, index) => {
          const isMine = content.author === senderName || (mode === 'ai' && content.author === 'Patient');
          const isAi = content.isAi || content.author === 'AI Companion';

          return (
            <div key={index} style={{ display: 'flex', justifyContent: isMine ? 'flex-end' : 'flex-start', marginBottom: '14px' }}>
              <div style={{ maxWidth: '78%' }}>
                <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px', paddingLeft: isMine ? 0 : '2px', textAlign: isMine ? 'right' : 'left' }}>
                  {content.author} · {content.time}
                </div>
                <div style={{
                  background: isMine ? '#2563eb' : isAi ? '#e7ecff' : '#ffffff',
                  color: isMine ? '#fff' : '#1f2937',
                  border: isAi ? '1px solid #dce5ff' : '1px solid #e5e7eb',
                  borderRadius: isMine ? '18px 18px 6px 18px' : '18px 18px 18px 6px',
                  padding: '12px 14px',
                  lineHeight: '1.5',
                  boxShadow: '0 8px 18px rgba(15, 23, 42, 0.04)'
                }}>
                  {content.message}
                </div>
                {content.groundingUsed && <small style={{ display: 'block', marginTop: '4px', color: '#64748b' }}>Includes optional general coping ideas</small>}
              </div>
            </div>
          );
        })}

        {isTyping && (
          <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: '8px' }}>
            <div style={{
              background: '#e7ecff',
              border: '1px solid #dce5ff',
              borderRadius: '18px 18px 18px 6px',
              padding: '10px 14px',
              color: '#475569',
              fontSize: '14px'
            }}>
              AI is thinking...
            </div>
          </div>
        )}
        <div ref={messageEndRef} />
      </div>

      <form onSubmit={(event) => { event.preventDefault(); sendMessage(); }} style={{ display: 'flex', gap: '10px', padding: '14px 18px 18px', background: '#ffffff' }}>
        <input
          type="text"
          maxLength={1000}
          value={message}
          placeholder={mode === 'live' ? 'Type a message...' : 'Share how you are feeling today...'}
          onChange={(e) => setMessage(e.target.value)}
          aria-label="Message"
          disabled={mode !== 'live' && isTyping}
          style={{
            flex: 1,
            border: '1px solid #dfe7f3',
            borderRadius: '12px',
            padding: '12px 14px',
            fontSize: '14px',
            outline: 'none'
          }}
        />
        <button
          type="button"
          onClick={startVoiceInput}
          disabled={mode !== 'live' && isTyping}
          aria-label={listening ? 'Stop voice input' : 'Start voice input'}
          title={listening ? 'Stop voice input' : 'Start voice input'}
          style={{
            padding: '0 14px',
            borderRadius: '12px',
            border: 'none',
            background: listening ? '#ef4444' : '#10b981',
            color: '#fff',
            cursor: 'pointer',
            fontSize: '20px'
          }}
        >
          {listening ? '●' : '🎙️'}
        </button>
        <button
          type="submit"
          disabled={!message.trim() || (mode !== 'live' && isTyping)}
          style={{
            padding: '0 18px',
            borderRadius: '12px',
            border: 'none',
            background: 'linear-gradient(135deg, #2563eb, #7c3aed)',
            color: '#fff',
            cursor: !message.trim() || (mode !== 'live' && isTyping) ? 'not-allowed' : 'pointer',
            opacity: !message.trim() || (mode !== 'live' && isTyping) ? 0.6 : 1,
            fontWeight: 600
          }}
        >
          Send
        </button>
      </form>
    </div>
  );
}