import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { backendUrl } from '../api';
import { transcribeAudioBlob } from '../utils/transcribeAudio';

const loadJitsiApi = () => new Promise((resolve, reject) => {
  if (window.JitsiMeetExternalAPI) {
    resolve(window.JitsiMeetExternalAPI);
    return;
  }

  const existingScript = document.querySelector('script[data-jitsi-external-api]');
  if (existingScript) {
    existingScript.addEventListener('load', () => resolve(window.JitsiMeetExternalAPI), { once: true });
    existingScript.addEventListener('error', () => reject(new Error('Could not load the Jitsi call service.')), { once: true });
    return;
  }

  const script = document.createElement('script');
  script.src = 'https://meet.jit.si/external_api.js';
  script.async = true;
  script.dataset.jitsiExternalApi = 'true';
  script.onload = () => window.JitsiMeetExternalAPI
    ? resolve(window.JitsiMeetExternalAPI)
    : reject(new Error('Jitsi call service did not initialize.'));
  script.onerror = () => reject(new Error('Could not load the Jitsi call service.'));
  document.head.appendChild(script);
});

export default function JitsiConsultationPage() {
  const navigate = useNavigate();
  const { roomUrl: encodedRoomUrl } = useParams();
  const [searchParams] = useSearchParams();
  const roomUrl = decodeURIComponent(encodedRoomUrl || '');
  const role = searchParams.get('role') || 'patient';
  const displayName = searchParams.get('name') || (role === 'doctor' ? 'Doctor' : 'Patient');
  const appointmentId = searchParams.get('appointmentId');
  const meetingRef = useRef(null);
  const jitsiApiRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const audioContextRef = useRef(null);
  const captureStreamsRef = useRef([]);
  const reportCompletionRef = useRef(Promise.resolve());
  const [joined, setJoined] = useState(false);
  const [consent, setConsent] = useState(false);
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState('Joining the Jitsi consultation...');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const parsedRoom = (() => {
    try {
      const url = new URL(roomUrl);
      if (url.protocol !== 'https:' || url.hostname !== 'meet.jit.si') return null;
      return { domain: url.hostname, roomName: url.pathname.split('/').filter(Boolean).join('/') };
    } catch {
      return null;
    }
  })();

  useEffect(() => {
    let mounted = true;
    if (!parsedRoom?.roomName) {
      setError('This Jitsi room link is not valid. Open the appointment and use its Jitsi button.');
      return undefined;
    }

    loadJitsiApi()
      .then(JitsiMeetExternalAPI => {
        if (!mounted || !meetingRef.current) return;
        const api = new JitsiMeetExternalAPI(parsedRoom.domain, {
          roomName: parsedRoom.roomName,
          parentNode: meetingRef.current,
          width: '100%',
          height: '100%',
          userInfo: { displayName },
          configOverwrite: {
            prejoinConfig: { enabled: false },
            startWithAudioMuted: false,
            startWithVideoMuted: false,
            disableDeepLinking: true
          },
          interfaceConfigOverwrite: {
            TOOLBAR_BUTTONS: ['microphone', 'camera', 'chat', 'tileview', 'fullscreen', 'hangup']
          }
        });
        jitsiApiRef.current = api;
        api.addListener('videoConferenceJoined', () => {
          setJoined(true);
          setStatus('Connected to the Jitsi consultation.');
        });
        api.addListener('videoConferenceLeft', () => {
          setJoined(false);
          if (!recording) setStatus('The Jitsi consultation ended.');
        });
        api.addListener('readyToClose', () => setJoined(false));
      })
      .catch(loadError => setError(loadError.message));

    return () => {
      mounted = false;
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
      captureStreamsRef.current.flatMap(stream => stream.getTracks()).forEach(track => track.stop());
      audioContextRef.current?.close();
      jitsiApiRef.current?.dispose();
      jitsiApiRef.current = null;
    };
  }, [parsedRoom?.domain, parsedRoom?.roomName, displayName]);

  const startReportCapture = async () => {
    if (!consent) {
      setError('Get the patient\'s consent before recording or transcribing the consultation.');
      return;
    }
    if (!joined) {
      setError('Join the Jitsi room before starting report capture.');
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia || !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setError('This browser cannot capture meeting audio. Use desktop Chrome or Edge over HTTPS.');
      return;
    }

    let meetingStream;
    let microphoneStream;
    let audioContext;
    try {
      setError('');
      setBusy(true);
      setStatus('Choose this app tab in the share dialog and enable Share tab audio.');
      meetingStream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'browser' },
        audio: true,
        selfBrowserSurface: 'include',
        surfaceSwitching: 'exclude',
        systemAudio: 'include'
      });
      if (!meetingStream.getAudioTracks().length) {
        meetingStream.getTracks().forEach(track => track.stop());
        throw new Error('No tab audio was shared. Stop and retry, choosing this browser tab with Share tab audio enabled.');
      }

      microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioContext = new AudioContext();
      const destination = audioContext.createMediaStreamDestination();
      audioContext.createMediaStreamSource(meetingStream).connect(destination);
      audioContext.createMediaStreamSource(microphoneStream).connect(destination);
      captureStreamsRef.current = [meetingStream, microphoneStream, destination.stream];
      audioContextRef.current = audioContext;
      chunksRef.current = [];

      const mimeType = ['audio/webm;codecs=opus', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(destination.stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      recorder.ondataavailable = event => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      reportCompletionRef.current = new Promise(resolve => {
        recorder.onstop = async () => {
          setRecording(false);
          setStatus('Transcribing the Jitsi conversation in this browser...');
          try {
            const audioBlob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
            const transcript = await transcribeAudioBlob(audioBlob);
            setStatus('Generating and saving the consultation report...');
            await axios.post(`${backendUrl}/api/ai/clinical-note`, {
              roomUrl,
              source: 'jitsi_tab_audio',
              transcript: [{ author: 'Consultation audio', message: transcript }],
              patientName: searchParams.get('patient') || 'the patient',
              doctorName: displayName
            });
            setStatus('Conversation transcribed. Report generated and saved in the doctor patient record.');
          } catch (processingError) {
            setError(`Automatic report failed: ${processingError.message}`);
            setStatus('Recording stopped. The report was not saved.');
          } finally {
            chunksRef.current = [];
            captureStreamsRef.current.flatMap(stream => stream.getTracks()).forEach(track => track.stop());
            captureStreamsRef.current = [];
            await audioContextRef.current?.close();
            audioContextRef.current = null;
            setBusy(false);
            resolve();
          }
        };
      });
      recorder.start(1000);
      setRecording(true);
      setBusy(false);
      setStatus('Capturing Jitsi tab audio and doctor microphone.');
    } catch (captureError) {
      meetingStream?.getTracks().forEach(track => track.stop());
      microphoneStream?.getTracks().forEach(track => track.stop());
      await audioContext?.close();
      setBusy(false);
      setError(captureError.message || 'Could not capture the Jitsi conversation audio.');
      setStatus('Report capture did not start.');
    }
  };

  const stopReportCapture = () => {
    if (recorderRef.current?.state === 'recording') {
      setBusy(true);
      recorderRef.current.stop();
    }
    return reportCompletionRef.current;
  };

  const leaveConsultation = async () => {
    if (role === 'doctor') {
      setBusy(true);
      if (recorderRef.current?.state === 'recording') stopReportCapture();
      await reportCompletionRef.current;
      if (appointmentId) {
        await axios.patch(`${backendUrl}/api/appointment/${encodeURIComponent(appointmentId)}/end-call`).catch(() => null);
      }
    }
    jitsiApiRef.current?.executeCommand('hangup');
    jitsiApiRef.current?.dispose();
    navigate(role === 'doctor' ? '/doctor-dashboard' : '/dashboard');
  };

  return (
    <main style={styles.page}>
      <section style={styles.shell}>
        <header style={styles.header}>
          <div>
            <div style={styles.eyebrow}>Jitsi consultation</div>
            <h1 style={styles.title}>{role === 'doctor' ? 'Doctor consultation' : 'Patient consultation'}</h1>
            <p style={styles.subtitle}>Signed in as {displayName}</p>
          </div>
          <span style={styles.status}>{joined ? 'In meeting' : 'Joining'}</span>
        </header>

        {error && <div role="alert" style={styles.error}>{error}</div>}
        <div ref={meetingRef} style={styles.meeting} />
        <p style={styles.callStatus}>{status}</p>

        {role === 'doctor' && (
          <section style={styles.recordingPanel}>
            <h2 style={styles.panelTitle}>Automatic conversation report</h2>
            <p style={styles.notice}>The browser captures this meeting tab's shared audio plus the doctor's microphone, transcribes it locally, then sends only the transcript to the app to generate and save the report. Use desktop Chrome or Edge and enable Share tab audio in the browser prompt.</p>
            <label style={styles.consent}>
              <input type="checkbox" checked={consent} disabled={recording || busy} onChange={event => setConsent(event.target.checked)} />
              I have informed the patient and received consent to record and transcribe this consultation.
            </label>
            <div style={styles.controls}>
              {!recording ? (
                <button type="button" disabled={!joined || !consent || busy} onClick={startReportCapture} style={styles.startButton}>
                  Start report capture
                </button>
              ) : (
                <button type="button" disabled={busy} onClick={stopReportCapture} style={styles.stopButton}>
                  Stop recording and generate report
                </button>
              )}
              <a href={roomUrl} target="_blank" rel="noreferrer" style={styles.secondaryLink}>Open Jitsi separately</a>
            </div>
          </section>
        )}

        <div style={styles.controls}>
          <button type="button" disabled={busy} onClick={leaveConsultation} style={styles.leaveButton}>
            {busy ? 'Processing recording...' : 'Leave consultation'}
          </button>
          <a href={roomUrl} target="_blank" rel="noreferrer" style={styles.secondaryLink}>Open room in Jitsi</a>
        </div>
      </section>
    </main>
  );
}

const styles = {
  page: { minHeight: '100vh', background: 'linear-gradient(135deg, #0f172a 0%, #164e63 100%)', padding: '24px 14px', color: '#e2e8f0' },
  shell: { maxWidth: '1100px', margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', gap: '16px', alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: '16px' },
  eyebrow: { color: '#67e8f9', textTransform: 'uppercase', fontSize: '12px', fontWeight: 700 },
  title: { margin: '8px 0 4px', color: '#fff', fontSize: '30px' },
  subtitle: { margin: 0, color: '#cbd5e1' },
  status: { border: '1px solid #67e8f9', color: '#cffafe', borderRadius: '999px', padding: '8px 14px', fontWeight: 700 },
  meeting: { width: '100%', height: 'min(70vh, 680px)', minHeight: '420px', background: '#020617', border: '1px solid #334155', borderRadius: '10px', overflow: 'hidden' },
  callStatus: { minHeight: '24px', color: '#cbd5e1' },
  error: { background: '#7f1d1d', color: '#fee2e2', padding: '12px 14px', borderRadius: '8px', marginBottom: '14px' },
  recordingPanel: { marginTop: '18px', border: '1px solid #475569', borderRadius: '8px', padding: '16px', background: 'rgba(15, 23, 42, .55)' },
  panelTitle: { margin: '0 0 8px', color: '#fff', fontSize: '20px' },
  notice: { color: '#cbd5e1', fontSize: '13px', lineHeight: 1.5 },
  consent: { display: 'flex', gap: '8px', alignItems: 'flex-start', margin: '14px 0', fontSize: '14px' },
  controls: { display: 'flex', gap: '10px', flexWrap: 'wrap', margin: '14px 0' },
  startButton: { border: 0, borderRadius: '6px', padding: '10px 14px', background: '#0f766e', color: '#fff', fontWeight: 700, cursor: 'pointer' },
  stopButton: { border: 0, borderRadius: '6px', padding: '10px 14px', background: '#dc2626', color: '#fff', fontWeight: 700, cursor: 'pointer' },
  leaveButton: { border: 0, borderRadius: '6px', padding: '10px 14px', background: '#e2e8f0', color: '#0f172a', fontWeight: 700, cursor: 'pointer' },
  secondaryLink: { display: 'inline-flex', alignItems: 'center', borderRadius: '6px', padding: '10px 14px', background: '#1e293b', color: '#fff', fontWeight: 700, textDecoration: 'none' }
};
