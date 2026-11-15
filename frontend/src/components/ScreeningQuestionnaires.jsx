import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

const definitions = {
  'PHQ-9': {
    count: 9,
    max: 27,
    questions: [
      'Little interest or pleasure in doing things?',
      'Feeling down, depressed, or hopeless?',
      'Trouble falling or staying asleep, or sleeping too much?',
      'Feeling tired or having little energy?',
      'Poor appetite or overeating?',
      'Feeling bad about yourself—or that you are a failure or have let yourself or your family down?',
      'Trouble concentrating on things, such as reading the newspaper or watching television?',
      'Moving or speaking so slowly that other people could have noticed? Or the opposite—being so fidgety or restless that you have been moving around a lot more than usual?',
      'Thoughts that you would be better off dead or of hurting yourself in some way?'
    ]
  },
  'GAD-7': {
    count: 7,
    max: 21,
    questions: [
      'Feeling nervous, anxious, or on edge?',
      'Not being able to stop or control worrying?',
      'Worrying too much about different things?',
      'Trouble relaxing?',
      'Being so restless that it is hard to sit still?',
      'Becoming easily annoyed or irritable?',
      'Feeling afraid, as if something awful might happen?'
    ]
  }
};

const responseLabels = ['Not at all', 'Several days', 'More than half the days', 'Nearly every day'];

export default function ScreeningQuestionnaires() {
  const navigate = useNavigate();
  const [type, setType] = useState('PHQ-9');
  const [answers, setAnswers] = useState(Array(9).fill(null));
  const [gadDifficulty, setGadDifficulty] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setAnswers(Array(definitions[type].count).fill(null));
    setGadDifficulty('');
  }, [type]);

  const updateAnswer = (index, value) => {
    setAnswers(previous => previous.map((answer, answerIndex) => answerIndex === index ? value : answer));
  };

  const submit = async event => {
    event.preventDefault();
    if (answers.some(answer => answer === null)) {
      setError('Select a score for every item using the wording supplied by your clinician.');
      setStatus('');
      return;
    }
    setSaving(true);
    setStatus('');
    setError('');
    try {
      const response = await api.post('/api/patient/questionnaires', { type, answers, gadDifficulty: type === 'GAD-7' ? gadDifficulty : undefined });
      setStatus(response.data.message);
    } catch (requestError) {
      setError(requestError?.response?.data?.error || 'Could not save your screening score.');
    } finally {
      setSaving(false);
    }
  };

  const needsSignIn = /session is invalid or expired/i.test(error);

  return <section className="panel panel-pad">
    <div className="panel-head"><div><h2 className="panel-title">Screening</h2></div></div>
    <div className="form-field">
      <label htmlFor="questionnaire-type">Questionnaire</label>
      <select id="questionnaire-type" value={type} onChange={event => setType(event.target.value)}>
        <option value="PHQ-9">PHQ-9 · 9 items</option>
        <option value="GAD-7">GAD-7 · 7 items</option>
      </select>
    </div>
    <div className="screening-progress" role="status">{answers.filter(answer => answer !== null).length} of {definitions[type].count} questions answered</div>
    <form onSubmit={submit}>
      <div className="form-grid">
        {answers.map((answer, index) => (
          <div className="form-field" key={`${type}-${index}`}>
            <label htmlFor={`questionnaire-${index}`}>{index + 1}. {definitions[type].questions[index]}{type === 'PHQ-9' && index === 8 ? ' · safety item' : ''}</label>
            <select id={`questionnaire-${index}`} aria-label={`Score for ${type} item ${index + 1}`} value={answer ?? ''} onChange={event => updateAnswer(index, Number(event.target.value))}>
              <option value="" disabled>Select score</option>
              {responseLabels.map((label, value) => <option key={value} value={value}>{label} · {value}</option>)}
            </select>
          </div>
        ))}
      </div>
      {type === 'GAD-7' && <div className="form-field screening-difficulty"><label htmlFor="gad-difficulty">If you checked off any problems, how difficult have these problems made it for you to do your work, take care of things at home, or get along with other people?</label><select id="gad-difficulty" value={gadDifficulty} onChange={event => setGadDifficulty(event.target.value)} required><option value="" disabled>Select difficulty</option><option>Not difficult at all</option><option>Somewhat difficult</option><option>Very difficult</option><option>Extremely difficult</option></select><span className="screening-item-hint">This question is recorded separately and is not included in the GAD-7 total.</span></div>}
      <div className="form-actions"><button className="action-button" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save screening score'}</button></div>
    </form>
    {error && <div className="auth-error" role="alert">
      {error}
      {needsSignIn && <button className="quiet-button" type="button" onClick={() => navigate('/patient')}>Return to sign in</button>}
    </div>}
    {status && <div className="success-banner" role="status">{status}</div>}
  </section>;
}
