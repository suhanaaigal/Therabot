import React from 'react';
import { useNavigate } from 'react-router-dom';

export default function TherabotHomePage() {
  const navigate = useNavigate();
  return (
    <main className="home-page">
      <header className="home-nav">
        <button className="brand-lockup" type="button" onClick={() => navigate('/')} aria-label="Therabot home"><span className="brand-mark">t</span><span className="brand-name">therabot<span>.</span></span></button>
        <div className="home-nav-actions"><button className="quiet-button" type="button" onClick={() => navigate('/doctor')}>Clinician access</button><button className="action-button" type="button" onClick={() => navigate('/patient')}>Patient sign in →</button></div>
      </header>
      <section className="home-main">
        <div className="home-copy">
          <div className="home-kicker">Mental wellbeing, made more human</div>
          <h1 className="home-title">Care for your mind, <em>at your pace.</em></h1>
          <p className="home-description">A thoughtful space to check in with yourself, find a moment of calm, and stay connected with the people supporting your care.</p>
          <div className="home-cta"><button className="action-button" type="button" onClick={() => navigate('/patient')}>Enter patient space <span aria-hidden="true">→</span></button><button className="quiet-button" type="button" onClick={() => navigate('/doctor')}>Clinician workspace</button></div>
        </div>
        <div className="home-visual" aria-label="Illustration of a calm growing plant">
          <div className="visual-plate"><span className="visual-sun" /><div className="visual-plant"><span className="plant-stem" /><span className="plant-leaf one" /><span className="plant-leaf two" /><span className="plant-leaf three" /></div><span className="visual-ground" /></div>
          <div className="visual-caption"><strong>Progress can be quiet.</strong><span>Notice small changes. Give yourself room to grow.</span></div>
        </div>
      </section>
      <section className="home-features" aria-label="Therabot services">
        <div className="feature-strip"><strong>Daily reflections</strong><span>Build awareness through simple mood, sleep and anxiety check-ins.</span></div>
        <div className="feature-strip"><strong>Support, when you need it</strong><span>Explore guided grounding, breathing and supportive conversation.</span></div>
        <div className="feature-strip"><strong>Connected care</strong><span>Coordinate appointments and review progress with your care team.</span></div>
      </section>
    </main>
  );
}
