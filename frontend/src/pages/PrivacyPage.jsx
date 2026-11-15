import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import PatientSupportBanner from '../components/PatientSupportBanner';

export default function PrivacyPage() {
  const navigate = useNavigate();
  const [provider, setProvider] = useState('');
  const [textAnalysisService, setTextAnalysisService] = useState('');
  const [persistence, setPersistence] = useState('');
  const [providerError, setProviderError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteMessage, setDeleteMessage] = useState('');
  const isLocalProvider = /ollama/i.test(provider);

  useEffect(() => {
    api.get('/api/privacy')
      .then(response => {
        setProvider(response.data?.aiProvider || '');
        setTextAnalysisService(response.data?.textAnalysisService || 'unknown');
        setPersistence(response.data?.persistence || '');
      })
      .catch(() => {
        setProviderError('The configured AI provider could not be identified right now. Contact the service administrator before using AI features.');
        setTextAnalysisService('unknown');
      });
  }, []);

  async function deleteAccount() {
    if (!localStorage.getItem('patientSessionToken')) {
      setDeleteMessage('Sign in to request deletion of your patient account.');
      return;
    }
    if (!window.confirm('Delete your account and its associated check-ins, chats, appointments, notifications, transcripts, and notes from active records? This cannot be undone.')) return;
    setDeleting(true);
    setDeleteMessage('');
    try {
      await api.delete('/api/auth/me');
      for (const key of ['patientId', 'patientName', 'patientSessionToken', 'assignedDoctorId']) localStorage.removeItem(key);
      setDeleteMessage('Your account and associated records have been deleted from active records.');
      window.setTimeout(() => navigate('/'), 1200);
    } catch (error) {
      setDeleteMessage(error?.response?.data?.error || 'We could not delete your account. Please try again or contact your care team.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-form-side">
        <PatientSupportBanner />
        <article className="panel panel-pad" style={{ maxWidth: '850px', margin: '30px auto' }}>
          <button className="quiet-button" type="button" onClick={() => navigate(-1)}>← Back</button>
          <p className="page-eyebrow">Privacy & consent</p>
          <h1 className="page-title">Your data and choices</h1>

          <h2>What this app stores</h2>
          <p>Therabot stores account and profile information, daily check-ins and journal entries, PHQ-9 and GAD-7 screening answers and results, appointment and notification records, AI companion messages when persistent storage is enabled, consultation transcripts and draft notes, and physiological stress-probability readings when the simulated WESAD replay is used. It does not collect data from a real wearable device.</p>
          {persistence === 'demo-memory' && <p role="status">This environment is using temporary in-memory demo storage. Data may be lost when the service restarts; it is not durable storage.</p>}

          <h2>AI processing</h2>
          <p>Messages you send to the AI companion and recent conversation context are sent to <strong>{provider || (providerError ? 'an unverified provider' : 'loading provider information…')}</strong> for a response. When a clinician requests an AI consultation note, the transcript is sent to that provider for drafting. Audio transcription runs in the browser in the supported capture flow; the app sends the resulting transcript, not the raw audio, for note generation. {isLocalProvider ? 'The configured Ollama service is local to the deployment; its host and storage configuration are managed by the service operator.' : 'The configured AI provider’s own privacy and retention policies also apply to information sent to it.'}</p>
          <p>{!textAnalysisService
            ? 'Loading text-analysis service information…'
            : textAnalysisService === 'not_configured'
              ? 'The text-analysis ML service is not configured in this environment.'
              : `Check-in journal text is sent to the configured text-analysis service (${textAnalysisService}) when text ML is enabled. If you opt in to coping guidance in chat, the current message is also sent there for retrieval from its guidance collection. Ask the service operator where this endpoint is hosted and how it is protected.`}</p>
          {providerError && <p className="auth-error" role="alert">{providerError}</p>}

          <h2>Clinician review</h2>
          <p>AI-generated consultation notes are drafts, not signed medical records or diagnoses. A clinician must review and verify the transcript and draft before relying on it.</p>

          <h2>How long we keep your data</h2>
          <p>{persistence === 'mongodb'
            ? 'We keep your account data (profile, check-ins, questionnaire answers and results, simulated physiological stress readings, chat messages, appointments, notifications, consultation transcripts, and notes) until you ask us to delete it. When you request deletion, it is removed from our active records. Backup copies may remain until they are replaced in the normal backup cycle.'
            : persistence === 'demo-memory'
              ? 'This environment uses temporary in-memory demo storage. Data may be lost when the service restarts, so this environment cannot promise durable retention. Deletion removes the account and associated records currently held in active memory.'
              : 'We could not confirm this environment’s storage mode, so we cannot make a reliable retention promise right now. Contact the service administrator before sharing sensitive information.'} {isLocalProvider
              ? 'Messages sent to the configured Ollama service are handled according to the host and storage configuration managed by the service operator.'
              : 'Messages you send to the AI companion are processed by the configured AI provider, whose own privacy and retention policies also apply to that processing.'}</p>

          <h2>Emergency contact consent</h2>
          <p>Providing an emergency contact and consenting to a minimal SMS is optional. We only store those contact details when you opt in at registration. If Twilio is configured, a Red alert may queue an SMS asking the contact to check in; it does not include your health details. A queued message is not a guarantee of delivery. Red alerts also appear in the clinician dashboard. Therabot does not contact emergency services.</p>

          <h2>Request deletion</h2>
          <p>Use the button below while signed in. It deletes your patient profile and associated check-ins, questionnaire answers and results, appointments, notifications, simulated stress readings, AI chat messages associated with your account, consultation sessions, transcripts, and draft notes from active records. Backup copies may remain until the normal backup cycle replaces them.</p>
          <p>Older chat messages saved by an earlier version under a shared, unassigned room cannot be reliably matched to an individual account. Ask the service administrator to review those legacy messages if your account used an earlier version.</p>
          {deleteMessage && <p role="status" className={deleteMessage.includes('could not') ? 'auth-error' : 'success-banner'}>{deleteMessage}</p>}
          <button type="button" className="action-button" onClick={deleteAccount} disabled={deleting}>{deleting ? 'Deleting…' : 'Delete my data'}</button>
          <p style={{ marginTop: '22px' }}>If you are in crisis in India, call <a href="tel:14416">Tele-MANAS at 14416 (24/7)</a>. See the <a href="https://telemanas.mohfw.gov.in/" target="_blank" rel="noreferrer">official Tele-MANAS website</a>, or call your local emergency number if there is immediate danger.</p>
        </article>
      </section>
    </main>
  );
}
