const scoreQuestionnaire = (type, answers) => {
  const expectedLength = type === 'PHQ-9' ? 9 : type === 'GAD-7' ? 7 : 0;
  if (!expectedLength || !Array.isArray(answers) || answers.length !== expectedLength ||
      answers.some(answer => !Number.isInteger(answer) || answer < 0 || answer > 3)) {
    throw new TypeError('Questionnaire answers are invalid.');
  }

  const total = answers.reduce((sum, answer) => sum + answer, 0);
  let band;
  if (type === 'PHQ-9') {
    band = total <= 4 ? 'minimal' : total <= 9 ? 'mild' : total <= 14 ? 'moderate' : total <= 19 ? 'moderately severe' : 'severe';
  } else {
    band = total <= 4 ? 'minimal' : total <= 9 ? 'mild' : total <= 14 ? 'moderate' : 'severe';
  }

  return {
    type,
    answers,
    total,
    band,
    crisisFlag: type === 'PHQ-9' && answers[8] > 0
  };
};

module.exports = { scoreQuestionnaire };
