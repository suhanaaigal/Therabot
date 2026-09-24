import React, { useEffect, useState } from 'react';

const activities = [
  { id: 'breathing', label: 'Guided Breathing' },
  { id: 'grounding', label: '5-4-3-2-1 Grounding' },
  { id: 'garden', label: 'Calm Garden' }
];

export default function MindRelief() {
  const [activity, setActivity] = useState('breathing');
  const [breathingPhase, setBreathingPhase] = useState('Ready when you are');
  const [breathingActive, setBreathingActive] = useState(false);
  const [groundingStep, setGroundingStep] = useState(0);
  const [gardenPoints, setGardenPoints] = useState(0);

  useEffect(() => {
    if (!breathingActive) return undefined;
    const phases = ['Breathe in', 'Hold gently', 'Breathe out slowly'];
    let phase = 0;
    setBreathingPhase(phases[phase]);
    const interval = window.setInterval(() => {
      phase = (phase + 1) % phases.length;
      setBreathingPhase(phases[phase]);
    }, 4000);
    return () => window.clearInterval(interval);
  }, [breathingActive]);

  const groundingPrompts = [
    'Name 5 things you can see.',
    'Notice 4 things you can feel.',
    'Listen for 3 sounds.',
    'Notice 2 scents nearby.',
    'Name 1 thing you appreciate right now.'
  ];

  return (
    <div style={{ border: '1px solid #cce8df', padding: '20px', borderRadius: '16px', maxWidth: '520px', margin: '20px auto', textAlign: 'center', background: '#f2fbf7' }}>
      <h3 style={{ marginTop: 0, color: '#164e63' }}>Mind-Relief Studio</h3>
      <p style={{ fontSize: '14px', color: '#46645f' }}>Choose a gentle activity for a few quiet minutes.</p>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center', margin: '16px 0' }}>
        {activities.map(item => (
          <button key={item.id} type="button" onClick={() => setActivity(item.id)} style={{ border: '1px solid #9dd8c8', borderRadius: '999px', padding: '8px 12px', cursor: 'pointer', background: activity === item.id ? '#167d6a' : '#fff', color: activity === item.id ? '#fff' : '#166052' }}>
            {item.label}
          </button>
        ))}
      </div>

      {activity === 'breathing' && (
        <div>
          <div style={{ width: '150px', height: '150px', borderRadius: '50%', background: breathingActive ? '#9edfd0' : '#d6eee7', margin: '22px auto', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'transform 4s ease, background 4s ease', transform: breathingActive && breathingPhase === 'Breathe in' ? 'scale(1.18)' : 'scale(1)', color: '#164e63', fontWeight: '700', padding: '12px', boxSizing: 'border-box' }}>
            {breathingActive ? breathingPhase : '4 - 7 - 8'}
          </div>
          <button type="button" onClick={() => setBreathingActive(value => !value)} style={{ padding: '10px 16px', background: breathingActive ? '#c2415d' : '#167d6a', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>
            {breathingActive ? 'Pause breathing' : 'Start breathing'}
          </button>
        </div>
      )}

      {activity === 'grounding' && (
        <div style={{ padding: '20px 10px' }}>
          <div style={{ fontSize: '42px', fontWeight: '800', color: '#167d6a' }}>{5 - groundingStep}</div>
          <p style={{ minHeight: '42px', color: '#315b55' }}>{groundingPrompts[groundingStep]}</p>
          <button type="button" onClick={() => setGroundingStep(step => (step + 1) % groundingPrompts.length)} style={{ padding: '10px 16px', background: '#167d6a', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>
            {groundingStep === groundingPrompts.length - 1 ? 'Begin again' : 'Next sense'}
          </button>
        </div>
      )}

      {activity === 'garden' && (
        <div style={{ padding: '16px 10px' }}>
          <p style={{ color: '#315b55' }}>Place small moments of attention in your garden. Tap the stones slowly and let your shoulders soften.</p>
          <div style={{ minHeight: '150px', borderRadius: '14px', background: 'linear-gradient(180deg, #dff6ec, #b6dfc8)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', flexWrap: 'wrap', padding: '18px' }}>
            {[0, 1, 2, 3, 4, 5].map(stone => (
              <button key={stone} type="button" aria-label="Place a calm stone" onClick={() => setGardenPoints(points => points + 1)} style={{ width: '36px', height: '28px', borderRadius: '50%', border: '2px solid #79af96', background: stone < gardenPoints ? '#4f8f72' : '#f4fbf5', cursor: 'pointer' }} />
            ))}
          </div>
          <div style={{ marginTop: '10px', color: '#315b55', fontSize: '13px' }}>{Math.min(gardenPoints, 6)} of 6 calm stones placed</div>
        </div>
      )}
    </div>
  );
}