import React, { useEffect, useState } from 'react';

const activities = [
  { id: 'breathing', label: 'Guided Breathing' },
  { id: 'grounding', label: '5-4-3-2-1 Grounding' },
  { id: 'garden', label: 'Calm Garden' },
  { id: 'bubbles', label: 'Bubble Calm' }
];

const makeBubbles = () => [
  { id: Date.now(), left: 12, top: 28, size: 42 },
  { id: Date.now() + 1, left: 31, top: 62, size: 30 },
  { id: Date.now() + 2, left: 52, top: 23, size: 54 },
  { id: Date.now() + 3, left: 70, top: 57, size: 36 },
  { id: Date.now() + 4, left: 84, top: 31, size: 26 },
  { id: Date.now() + 5, left: 63, top: 78, size: 44 }
];

export default function MindRelief() {
  const [activity, setActivity] = useState('breathing');
  const [breathingPhase, setBreathingPhase] = useState('Ready when you are');
  const [breathingActive, setBreathingActive] = useState(false);
  const [groundingStep, setGroundingStep] = useState(0);
  const [gardenPoints, setGardenPoints] = useState(0);
  const [bubbleRound, setBubbleRound] = useState({ active: false, score: 0, timeLeft: 30 });
  const [bubbles, setBubbles] = useState(makeBubbles);

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

  useEffect(() => {
    if (!bubbleRound.active) return undefined;
    const interval = window.setInterval(() => {
      setBubbleRound(current => {
        if (current.timeLeft <= 1) return { ...current, active: false, timeLeft: 0 };
        return { ...current, timeLeft: current.timeLeft - 1 };
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [bubbleRound.active]);

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

      {activity === 'bubbles' && (
        <div style={{ padding: '16px 10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#315b55', fontSize: '13px', fontWeight: '700' }}>
            <span>{bubbleRound.score} calm pops</span>
            <span>{bubbleRound.timeLeft}s</span>
          </div>
          <div style={{ position: 'relative', minHeight: '220px', margin: '14px 0', overflow: 'hidden', borderRadius: '14px', background: 'linear-gradient(160deg, #dff6ec, #c4e4ef)', boxShadow: 'inset 0 0 30px rgba(255,255,255,.55)' }}>
            {bubbles.map(bubble => (
              <button
                key={bubble.id}
                type="button"
                aria-label="Pop calm bubble"
                onClick={() => {
                  if (!bubbleRound.active) return;
                  setBubbleRound(current => ({ ...current, score: current.score + 1 }));
                  setBubbles(current => [...current.filter(item => item.id !== bubble.id), { ...bubble, id: Date.now(), left: (bubble.left + 23) % 82 + 8, top: (bubble.top + 31) % 70 + 12 }]);
                }}
                style={{ position: 'absolute', left: `${bubble.left}%`, top: `${bubble.top}%`, width: `${bubble.size}px`, height: `${bubble.size}px`, transform: 'translate(-50%, -50%)', border: '2px solid rgba(255,255,255,.8)', borderRadius: '50%', background: 'rgba(255,255,255,.38)', boxShadow: 'inset 8px 8px 12px rgba(255,255,255,.65), 0 5px 12px rgba(67,130,145,.12)', cursor: bubbleRound.active ? 'pointer' : 'default', transition: 'transform .15s ease' }}
              />
            ))}
            {!bubbleRound.active && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: '20px', color: '#315b55', fontSize: '14px', fontWeight: '700', textAlign: 'center' }}>{bubbleRound.timeLeft === 0 ? `Lovely. You found ${bubbleRound.score} moments of calm.` : 'Let the bubbles drift. Pop as many as you like.'}</div>}
          </div>
          <button type="button" onClick={() => { setBubbleRound({ active: true, score: 0, timeLeft: 30 }); setBubbles(makeBubbles()); }} style={{ padding: '10px 16px', background: '#167d6a', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>
            {bubbleRound.timeLeft === 0 ? 'Play another round' : 'Start bubble calm'}
          </button>
        </div>
      )}
    </div>
  );
}