const BANDS = ['Green', 'Yellow', 'Orange', 'Red'];

const toBand = probability => {
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new RangeError('Stress probability must be between 0 and 1.');
  }
  if (probability < 0.35) return 'Green';
  if (probability < 0.55) return 'Yellow';
  if (probability < 0.75) return 'Orange';
  return 'Red';
};

const elevateBand = (band, minimum) => BANDS[Math.max(BANDS.indexOf(band), BANDS.indexOf(minimum))];

const textRuleBand = text => {
  const normalized = String(text || '').toLowerCase();
  const highSignals = ['overwhelmed', 'panic', 'hopeless', "can't cope", 'exhausted', 'terrible', 'awful', 'depressed', 'crying'];
  const moderateSignals = ['stressed', 'anxious', 'anxiety', 'sad', 'upset', 'difficult', 'tired', 'angry', 'frustrated', 'nervous', 'worried', 'lonely'];
  const highCount = highSignals.filter(signal => normalized.includes(signal)).length;
  const moderateCount = moderateSignals.filter(signal => normalized.includes(signal)).length;
  if (highCount >= 2 || moderateCount >= 3) return { band: 'Orange', reason: 'Your check-in includes several signs that extra support may be helpful.' };
  if (highCount === 1 || moderateCount >= 1) return { band: 'Yellow', reason: 'Your check-in includes signs that it may be helpful to pause and seek support.' };
  return { band: 'Green', reason: null };
};

const ruleBand = self => {
  const { sleepHours, selfMood, selfAnxiety } = self || {};
  if ((Number.isFinite(sleepHours) && sleepHours < 4) ||
      (Number.isFinite(selfMood) && selfMood <= 2) ||
      (Number.isFinite(selfAnxiety) && selfAnxiety >= 9)) return 'Red';
  if ((Number.isFinite(sleepHours) && sleepHours < 5) ||
      (Number.isFinite(selfMood) && selfMood <= 4) ||
      (Number.isFinite(selfAnxiety) && selfAnxiety >= 7)) return 'Orange';
  if ((Number.isFinite(sleepHours) && sleepHours < 6) ||
      (Number.isFinite(selfMood) && selfMood <= 6) ||
      (Number.isFinite(selfAnxiety) && selfAnxiety >= 5)) return 'Yellow';
  return 'Green';
};

const fuse = (ml, physiologyProbability, self = {}, questionnaire = {}) => {
  if (ml?.crisisFlag || self.crisis === true) {
    return {
      band: 'Red',
      probability: 1,
      reasons: ['Crisis language or a self-harm screening response requires prompt clinician review.'],
      source: 'crisis'
    };
  }

  if (!ml || ml.status !== 'available') {
    const textResult = textRuleBand(self.text);
    const band = elevateBand(ruleBand(self), textResult.band);
    const reasons = ['The text analysis service was unavailable, so transparent text cues and your self-ratings were used.'];
    if (textResult.reason) reasons.push(textResult.reason);
    if (questionnaire.phq9 >= 15 || questionnaire.gad7 >= 15) {
      return {
        band: elevateBand(band, 'Orange'),
        probability: null,
        reasons: [...reasons, 'A recent screening score is 15 or higher; follow-up is recommended.'],
        source: `rules${textResult.reason ? '+text' : ''}+screening`
      };
    }
    return { band, probability: null, reasons, source: `rules${textResult.reason ? '+text' : ''}` };
  }

  const reasons = [
    `Text stress ${(ml.stressProb * 100).toFixed(0)}%.`,
    `Emotion estimate: ${ml.emotion}.`
  ];
  if (ml.topWords?.length) reasons.push(`Words contributing most: ${ml.topWords.join(', ')}.`);

  let probability = ml.stressProb;
  let source = 'text';
  if (Number.isFinite(physiologyProbability) && physiologyProbability >= 0 && physiologyProbability <= 1) {
    probability = 0.6 * ml.stressProb + 0.4 * physiologyProbability;
    source = 'text+wearable';
    reasons.push(`Physiological stress ${(physiologyProbability * 100).toFixed(0)}% (simulated wearable).`);
  }

  let band = toBand(probability);
  if (questionnaire.phq9 >= 15 || questionnaire.gad7 >= 15) {
    band = elevateBand(band, 'Orange');
    reasons.push('A recent screening score is 15 or higher; follow-up is recommended.');
    source += '+screening';
  }
  return { band, probability, reasons, source };
};

module.exports = { toBand, ruleBand, textRuleBand, fuse };
