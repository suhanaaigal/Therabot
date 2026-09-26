import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import io from 'socket.io-client';

const configuredBackendUrl = import.meta.env.VITE_API_URL;
const backendUrl = configuredBackendUrl && !/^https?:\/\//i.test(configuredBackendUrl)
  ? `https://${configuredBackendUrl}`
  : configuredBackendUrl || `${window.location.protocol}//${window.location.hostname}:5000`;
const socket = io(backendUrl, { autoConnect: true });
const rtcConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    ...(import.meta.env.VITE_TURN_URL ? [{
      urls: import.meta.env.VITE_TURN_URL.split(',').map(url => url.trim()).filter(Boolean),
      username: import.meta.env.VITE_TURN_USERNAME,
      credential: import.meta.env.VITE_TURN_CREDENTIAL
    }] : [])
  ]
};
let whisperPipelinePromise;

const loadWhisperPipeline = async () => {
  whisperPipelinePromise ||= new Function('url', 'return import(url)')(
    'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2'
  ).then(({ pipeline }) => pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en'));
  return whisperPipelinePromise;
};

export default function VideoCallPage() {
  const navigate = useNavigate();
  const { roomId: encodedRoomId } = useParams();
  const [searchParams] = useSearchParams();
  const roomId = decodeURIComponent(encodedRoomId || '');
  const appointmentId = searchParams.get('appointmentId');
  const role = searchParams.get('role') || 'patient';
  const displayName = searchParams.get('name') || (role === 'doctor' ? 'Doctor' : 'Patient');
  const scheduledDate = searchParams.get('date');
  const scheduledTime = searchParams.get('time');
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(new MediaStream());
  const peersRef = useRef(new Map());
  const pendingCandidatesRef = useRef(new Map());
  const recorderRef = useRef(null);
  const recordingChunksRef = useRef([]);
  const audioContextRef = useRef(null);
  const mixedAudioStreamRef = useRef(null);
  const reportCompletionRef = useRef(Promise.resolve());
  const [status, setStatus] = useState('Requesting camera and microphone access...');
  const [peerConnected, setPeerConnected] = useState(false);
  const [remoteAudioReady, setRemoteAudioReady] = useState(false);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [recording, setRecording] = useState(false);
  const [remoteRecording, setRemoteRecording] = useState(false);
  const [recordingConsent, setRecordingConsent] = useState(false);
  const [error, setError] = useState('');
  const isSecureCallContext = window.isSecureContext || window.location.hostname === 'localhost';

  useEffect(() => {
    let mounted = true;

    const attachRemoteStream = () => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStreamRef.current;
      }
    };

    const removePeer = (peerId) => {
      const peer = peersRef.current.get(peerId);
      if (peer) peer.close();
      peersRef.current.delete(peerId);
      setPeerConnected([...peersRef.current.values()].some(item => item.connectionState === 'connected'));
      setRemoteAudioReady(remoteStreamRef.current.getAudioTracks().some(track => track.readyState === 'live'));
      setStatus('The other participant left the call.');
      if (role === 'doctor' && recorderRef.current?.state === 'recording') {
        recorderRef.current.stop();
        setRecording(false);
        socket.emit('call_recording_status', { room: roomId, recording: false });
      }
    };

    const createPeer = (peerId, initiator) => {
      if (peersRef.current.has(peerId)) return peersRef.current.get(peerId);

      const peer = new RTCPeerConnection(rtcConfiguration);
      peersRef.current.set(peerId, peer);

      localStreamRef.current?.getTracks().forEach(track => peer.addTrack(track, localStreamRef.current));
      peer.ontrack = (event) => {
        (event.streams[0]?.getTracks() || [event.track]).forEach(track => {
          if (!remoteStreamRef.current.getTracks().some(existing => existing.id === track.id)) {
            remoteStreamRef.current.addTrack(track);
          }
        });
        if (event.track.kind === 'audio') setRemoteAudioReady(true);
        attachRemoteStream();
        setPeerConnected(true);
        setStatus('Connected to the other participant.');
      };
      peer.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('webrtc_signal', { to: peerId, signal: { type: 'candidate', candidate: event.candidate } });
        }
      };
      peer.onconnectionstatechange = () => {
        setPeerConnected([...peersRef.current.values()].some(item => item.connectionState === 'connected'));
        if (peer.connectionState === 'failed') {
          setError('The network could not establish a direct video connection. Configure a TURN relay or use Join Jitsi.');
        }
        if (['failed', 'closed', 'disconnected'].includes(peer.connectionState)) removePeer(peerId);
      };

      if (initiator) {
        peer.createOffer()
          .then(offer => peer.setLocalDescription(offer))
          .then(() => socket.emit('webrtc_signal', { to: peerId, signal: { type: 'offer', sdp: peer.localDescription } }))
          .catch(() => setError('Could not start the call connection.'));
      }

      return peer;
    };

    const shouldInitiateOffer = peerId => socket.id < peerId;
    const onPeerJoined = ({ peerId }) => {
      if (peerId) createPeer(peerId, shouldInitiateOffer(peerId));
    };
    const onRoomPeers = ({ peerIds = [] } = {}) => {
      peerIds.forEach(peerId => createPeer(peerId, shouldInitiateOffer(peerId)));
    };

    const onSignal = async ({ from, signal }) => {
      if (!from || !signal) return;
      const peer = createPeer(from, false);
      const addPendingCandidates = async () => {
        const queued = pendingCandidatesRef.current.get(from) || [];
        for (const candidate of queued) await peer.addIceCandidate(candidate);
        pendingCandidatesRef.current.delete(from);
      };

      try {
        if (signal.type === 'offer') {
          await peer.setRemoteDescription(signal.sdp);
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          socket.emit('webrtc_signal', { to: from, signal: { type: 'answer', sdp: peer.localDescription } });
          await addPendingCandidates();
        } else if (signal.type === 'answer') {
          await peer.setRemoteDescription(signal.sdp);
          await addPendingCandidates();
        } else if (signal.type === 'candidate') {
          if (peer.remoteDescription) await peer.addIceCandidate(signal.candidate);
          else pendingCandidatesRef.current.set(from, [...(pendingCandidatesRef.current.get(from) || []), signal.candidate]);
        }
      } catch (connectionError) {
        setError(`Call connection error: ${connectionError.message}`);
      }
    };

    const onPeerLeft = ({ peerId }) => removePeer(peerId);
    const onRemoteRecording = ({ recording: isRecording }) => setRemoteRecording(isRecording);

    const start = async () => {
      if (!isSecureCallContext) {
        setStatus('Phone calls need an HTTPS address. Use the secure link provided by your tunnel, or use the Jitsi fallback.');
        setError('This phone address uses HTTP. Mobile browsers block camera and microphone access unless the page is HTTPS.');
        return;
      }
      if (scheduledDate && scheduledTime) {
        const appointmentStart = new Date(`${scheduledDate}T${scheduledTime}`).getTime();
        const callWindowStart = appointmentStart - (2 * 60 * 1000);
        if (Number.isNaN(appointmentStart) || Date.now() < callWindowStart) {
          setStatus('This call opens 2 minutes before the scheduled appointment.');
          return;
        }
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (!mounted) return;
        localStreamRef.current = stream;
        localVideoRef.current.srcObject = stream;
        if (!socket.connected) {
          socket.connect();
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              socket.off('connect', onConnect);
              reject(new Error('Could not connect to the call signaling server.'));
            }, 15000);
            const onConnect = () => {
              clearTimeout(timeout);
              resolve();
            };
            socket.once('connect', onConnect);
          });
        }
        if (!mounted) return;
        setStatus('Waiting for the other participant to join...');
        socket.emit('join_call', roomId);
      } catch (mediaError) {
        setError(mediaError.message || 'Camera and microphone access is required for the in-app call. Check browser permissions and try again.');
        setStatus('Media access unavailable.');
      }
    };

    socket.on('call_peer_joined', onPeerJoined);
    socket.on('call_room_peers', onRoomPeers);
    socket.on('webrtc_signal', onSignal);
    socket.on('call_peer_left', onPeerLeft);
    socket.on('call_recording_status', onRemoteRecording);
    start();

    return () => {
      mounted = false;
      socket.emit('leave_call', roomId);
      socket.off('call_peer_joined', onPeerJoined);
      socket.off('call_room_peers', onRoomPeers);
      socket.off('webrtc_signal', onSignal);
      socket.off('call_peer_left', onPeerLeft);
      socket.off('call_recording_status', onRemoteRecording);
      peersRef.current.forEach(peer => peer.close());
      peersRef.current.clear();
      localStreamRef.current?.getTracks().forEach(track => track.stop());
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    };
  }, [roomId, scheduledDate, scheduledTime]);

  const toggleMute = () => {
    const nextMuted = !muted;
    localStreamRef.current?.getAudioTracks().forEach(track => { track.enabled = !nextMuted; });
    setMuted(nextMuted);
  };

  const toggleCamera = () => {
    const nextCameraOff = !cameraOff;
    localStreamRef.current?.getVideoTracks().forEach(track => { track.enabled = !nextCameraOff; });
    setCameraOff(nextCameraOff);
  };

  const startRecording = () => {
    if (!recordingConsent) {
      setError('Confirm that the patient has been informed before recording your clinician audio notes.');
      return;
    }
    if (!localStreamRef.current || !window.MediaRecorder) {
      setError('Recording is not supported by this browser.');
      return;
    }
    if (!remoteStreamRef.current.getAudioTracks().some(track => track.readyState === 'live')) {
      setStatus('Waiting for the patient audio track before starting report capture...');
      return;
    }

    const audioContext = new AudioContext();
    const destination = audioContext.createMediaStreamDestination();
    audioContext.createMediaStreamSource(localStreamRef.current).connect(destination);
    if (remoteStreamRef.current.getAudioTracks().length) {
      audioContext.createMediaStreamSource(remoteStreamRef.current).connect(destination);
    }
    audioContextRef.current = audioContext;
    mixedAudioStreamRef.current = destination.stream;
    const recordingStream = destination.stream;
    const mimeType = ['audio/webm;codecs=opus', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type));
    recorderRef.current = new MediaRecorder(recordingStream, mimeType ? { mimeType } : undefined);
    recordingChunksRef.current = [];
    recorderRef.current.ondataavailable = event => {
      if (event.data.size > 0) recordingChunksRef.current.push(event.data);
    };
    reportCompletionRef.current = new Promise(resolve => {
      recorderRef.current.onstop = async () => {
      const blob = new Blob(recordingChunksRef.current, { type: recorderRef.current.mimeType || 'audio/webm' });
      recordingChunksRef.current = [];
      audioContextRef.current?.close();
      audioContextRef.current = null;
      mixedAudioStreamRef.current = null;
      setStatus('Transcribing the consultation locally...');
      try {
        const decoder = new AudioContext();
        const decoded = await decoder.decodeAudioData(await blob.arrayBuffer());
        const monoAudio = decoded.numberOfChannels === 1
          ? decoded.getChannelData(0)
          : Float32Array.from({ length: decoded.length }, (_, index) => {
            let total = 0;
            for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) total += decoded.getChannelData(channel)[index];
            return total / decoded.numberOfChannels;
          });
        await decoder.close();
        const transcriber = await loadWhisperPipeline();
        const result = await transcriber(monoAudio, { sampling_rate: decoded.sampleRate, chunk_length_s: 30, stride_length_s: 5 });
        const transcriptText = String(result.text || '').trim();
        if (!transcriptText) throw new Error('No speech was detected in the consultation.');
        setStatus('Generating the clinical report from the conversation...');
        await axios.post(`${backendUrl}/api/ai/clinical-note`, {
          roomUrl,
          source: 'automatic_audio',
          transcript: [{ author: 'Consultation audio', message: transcriptText }],
          patientName: searchParams.get('patient') || 'the patient',
          doctorName: displayName
        });
        setStatus('Report generated and saved. Please review it in the doctor dashboard.');
      } catch (transcriptionError) {
        setError(`Automatic report failed: ${transcriptionError.message}`);
        setStatus('Call ended. No audio was saved.');
      }
        resolve();
      };
    });
    recorderRef.current.start();
    setRecording(true);
    socket.emit('call_recording_status', { room: roomId, recording: true });
  };

  const stopRecording = () => {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop();
    }
    setRecording(false);
    socket.emit('call_recording_status', { room: roomId, recording: false });
    return reportCompletionRef.current;
  };

  useEffect(() => {
    if (role === 'doctor' && peerConnected && remoteAudioReady && recordingConsent && !recording) startRecording();
  }, [role, peerConnected, remoteAudioReady, recordingConsent, recording]);

  const leaveCall = async () => {
    if (role === 'doctor') {
      if (recorderRef.current?.state === 'recording') stopRecording();
      await reportCompletionRef.current;
      socket.emit('call_ended', { room: roomId, endedBy: displayName });
      if (appointmentId) {
        await axios.patch(`${backendUrl}/api/appointment/${encodeURIComponent(appointmentId)}/end-call`).catch(() => null);
      }
    }
    navigate(role === 'doctor' ? '/doctor-dashboard' : '/dashboard');
  };

  return (
    <main style={styles.page}>
      <section style={styles.shell}>
        <header style={styles.header}>
          <div>
            <div style={styles.eyebrow}>In-app consultation</div>
            <h1 style={styles.title}>{role === 'doctor' ? 'Doctor call room' : 'Patient call room'}</h1>
            <p style={styles.subtitle}>Signed in as {displayName}. Use headphones where possible.</p>
          </div>
          <div style={styles.status}>{peerConnected ? 'Connected' : 'Waiting'}</div>
        </header>

        {error && <div style={styles.error}>{error}</div>}
        <div style={styles.videoGrid}>
          <div style={styles.videoCard}>
            <video ref={remoteVideoRef} autoPlay playsInline style={styles.video} />
            {!peerConnected && <div style={styles.videoPlaceholder}>Waiting for the other participant...</div>}
            <span style={styles.videoLabel}>Other participant{remoteRecording ? ' | recording started there' : ''}</span>
          </div>
          <div style={styles.videoCard}>
            <video ref={localVideoRef} autoPlay muted playsInline style={styles.video} />
            <span style={styles.videoLabel}>You: {displayName}</span>
          </div>
        </div>

        <p style={styles.callStatus}>{status}</p>
        <div style={styles.controls}>
          <button type="button" onClick={toggleMute} style={styles.controlButton}>{muted ? 'Unmute' : 'Mute'}</button>
          <button type="button" onClick={toggleCamera} style={styles.controlButton}>{cameraOff ? 'Turn camera on' : 'Turn camera off'}</button>
          {role === 'doctor' && <span style={{ ...styles.notice, alignSelf: 'center' }}>{recording ? 'Automatic report capture is active' : 'Report capture starts after consent and connection'}</span>}
          <button type="button" onClick={leaveCall} style={styles.leaveButton}>Leave call</button>
        </div>

        {role === 'doctor' && (
          <section style={styles.insightsPanel}>
            <h2 style={styles.insightsTitle}>Automatic consultation report</h2>
            <p style={styles.notice}>Check consent before the call. Once both participants connect, the doctor device temporarily captures the mixed call audio, transcribes it locally, and sends only the transcript for SOAP drafting.</p>
            <label style={styles.consent}>
              <input type="checkbox" checked={recordingConsent} onChange={event => setRecordingConsent(event.target.checked)} />
              I have informed the patient and received consent for this automatic transcription.
            </label>
          </section>
        )}
        <p style={styles.notice}>Only the doctor device runs transcription. Raw audio is not downloaded, uploaded, or stored by this call page. Phone browsers require HTTPS for camera and microphone access.</p>
      </section>
    </main>
  );
}

const styles = {
  page: { minHeight: '100vh', background: 'linear-gradient(135deg, #0f172a 0%, #164e63 100%)', padding: '24px 14px', color: '#e2e8f0' },
  shell: { maxWidth: '1100px', margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', gap: '16px', alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: '20px' },
  eyebrow: { color: '#67e8f9', textTransform: 'uppercase', letterSpacing: '1.5px', fontSize: '12px', fontWeight: 700 },
  title: { margin: '8px 0 4px', color: '#fff', fontSize: 'clamp(26px, 5vw, 42px)' },
  subtitle: { margin: 0, color: '#cbd5e1' },
  status: { border: '1px solid #67e8f9', color: '#cffafe', borderRadius: '999px', padding: '8px 14px', fontWeight: 700 },
  error: { background: '#7f1d1d', color: '#fee2e2', padding: '12px 14px', borderRadius: '10px', marginBottom: '14px' },
  videoGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px' },
  videoCard: { minHeight: '260px', position: 'relative', overflow: 'hidden', background: '#020617', border: '1px solid #334155', borderRadius: '12px' },
  video: { width: '100%', height: '100%', minHeight: '260px', objectFit: 'cover', display: 'block' },
  videoPlaceholder: { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#94a3b8' },
  videoLabel: { position: 'absolute', left: '12px', bottom: '10px', background: 'rgba(2, 6, 23, .75)', borderRadius: '6px', padding: '6px 9px', fontSize: '13px' },
  callStatus: { color: '#cbd5e1', minHeight: '22px' },
  controls: { display: 'flex', gap: '10px', flexWrap: 'wrap', margin: '14px 0' },
  controlButton: { border: '1px solid #64748b', borderRadius: '8px', padding: '10px 13px', background: '#1e293b', color: '#fff', cursor: 'pointer' },
  recordButton: { border: 'none', borderRadius: '8px', padding: '10px 13px', background: '#0f766e', color: '#fff', cursor: 'pointer' },
  stopButton: { border: 'none', borderRadius: '8px', padding: '10px 13px', background: '#dc2626', color: '#fff', cursor: 'pointer' },
  leaveButton: { border: 'none', borderRadius: '8px', padding: '10px 13px', background: '#e2e8f0', color: '#0f172a', cursor: 'pointer' },
  consent: { display: 'flex', gap: '8px', alignItems: 'flex-start', color: '#e2e8f0', fontSize: '14px' },
  notice: { color: '#94a3b8', fontSize: '13px', lineHeight: 1.5 },
  insightsPanel: { marginTop: '20px', border: '1px solid #475569', borderRadius: '12px', padding: '16px', background: 'rgba(15, 23, 42, .55)' },
  insightsTitle: { margin: 0, color: '#fff', fontSize: '20px' }
};
