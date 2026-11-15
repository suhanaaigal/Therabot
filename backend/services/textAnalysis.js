const crisisPatterns = [
  /\b(?:kill myself|end(?:ing)? my life|suicid(?:e|al)|hurt myself|harm myself|self[- ]harm|thinking about (?:suicide|self[- ]harm)|don't want to live|do not want to live|wish i were dead|no reason to live|i may hurt myself|i am in immediate danger|i am unsafe|(?:i may be |i might be )?in danger from myself)\b/i,
  /\b(?:marna chahta(?: hoon| hun)?|marna chahti(?: hoon| hun)?|jeena nahi chahta|jeena nahi chahti|khud ko (?:maar|nuksan)|apne aap ko (?:maar|nuksan))\b/i
];
const negatedSelfHarmPattern = /\b(?:i(?:'m| am)?\s+)?(?:not going to|not gonna|will not|won't|do not intend to|don't intend to|do not plan to|don't plan to)\s+(?:ever\s+)?(?:hurt|harm|kill)\s+(?:myself|me)\b/i;

const detectCrisisRegex = (text = '') => {
  const normalized = String(text || '');
  if (negatedSelfHarmPattern.test(normalized)) return false;
  return crisisPatterns.some(pattern => pattern.test(normalized));
};

const analyzeTextWithMl = async text => {
  const baseUrl = String(process.env.ML_URL || '').trim().replace(/\/+$/, '');
  if (!baseUrl || !String(text || '').trim()) return { status: 'not_configured' };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${baseUrl}/analyze-text`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: String(text).slice(0, 2000) })
    });
    if (!response.ok) {
      console.error('Text ML service returned an error:', response.status);
      return { status: 'unavailable' };
    }

    const result = await response.json();
    const probability = value => Number.isFinite(value) && value >= 0 && value <= 1;
    const crisisAvailable = result.crisis_available !== false;
    const crisisProbabilityValid = crisisAvailable
      ? probability(result.crisis_prob)
      : result.crisis_prob === null && result.crisis_flag === false;
    if (!probability(result.stress_prob) || !probability(result.emotion_prob) ||
        !crisisProbabilityValid || typeof result.crisis_flag !== 'boolean' ||
        typeof result.emotion !== 'string' || !Array.isArray(result.top_words)) {
      console.error('Text ML service returned an invalid analysis response.');
      return { status: 'unavailable' };
    }

    return {
      status: 'available',
      stressProb: result.stress_prob,
      emotion: result.emotion,
      emotionProb: result.emotion_prob,
      crisisProb: crisisAvailable ? result.crisis_prob : null,
      crisisAvailable,
      crisisFlag: result.crisis_flag,
      stressModel: typeof result.stress_model === 'string' ? result.stress_model : 'unknown',
      emotionModel: typeof result.emotion_model === 'string' ? result.emotion_model : 'unknown',
      topWords: result.top_words.filter(word => typeof word === 'string').slice(0, 5)
    };
  } catch (error) {
    console.error('Text ML service request failed:', error.name === 'AbortError' ? 'request timed out' : error.message);
    return { status: 'unavailable' };
  } finally {
    clearTimeout(timeout);
  }
};

module.exports = { analyzeTextWithMl, detectCrisisRegex };
