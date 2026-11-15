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
    const band = ruleBand(self);
    const reasons = ['Text analysis unavailable; used the self-rating rules.'];
    if (questionnaire.phq9 >= 15 || questionnaire.gad7 >= 15) {
      return {
        band: elevateBand(band, 'Orange'),
        probability: null,
        reasons: [...reasons, 'A recent screening score is 15 or higher; follow-up is recommended.'],
        source: 'rules+screening'
      };
    }
    return { band, probability: null, reasons, source: 'rules' };
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

module.exports = { toBand, ruleBand, fuse };
