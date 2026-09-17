const LIKERT_VALUES = new Map([
  ['strongly disagree', -2],
  ['disagree', -1],
  ['neutral', 0],
  ['agree', 1],
  ['strongly agree', 2]
]);

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const mean = (values) => values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
const rounded = (value) => value == null ? null : Math.round(value);

function questionPrompt(question) {
  if (question.type === 'situational') return question.scenario;
  if (question.type === 'most-least') return 'Most Like Me / Least Like Me';
  return question.text;
}

function traitsOf(subject) {
  return Object.keys(subject?.traits ?? {});
}

function polarityOf(question) {
  if (question.analysis?.polarity === 1 || question.analysis?.polarity === -1) return question.analysis.polarity;
  const signs = [...new Set(Object.values(question.traits ?? {}).map((value) => Math.sign(Number(value))).filter(Boolean))];
  return signs.length === 1 ? signs[0] : 1;
}

function likertRawValue(question, answer) {
  if (answer == null) return null;
  const selectedText = typeof answer === 'object' && answer.answerText
    ? answer.answerText
    : question.options?.[Number(typeof answer === 'object' ? answer.answer : answer)];
  return LIKERT_VALUES.get(String(selectedText ?? '').trim().toLowerCase()) ?? null;
}

function answerLabel(question, answer) {
  if (answer == null) return 'No answer';
  if (question.type === 'likert') {
    if (typeof answer === 'object' && answer.answerText) return answer.answerText;
    return question.options?.[Number(typeof answer === 'object' ? answer.answer : answer)] ?? 'No answer';
  }
  return 'Recorded response';
}

function answerMapFromExport(result) {
  return Object.fromEntries((result.answers ?? []).map((record) => {
    if (record.type === 'likert') return [record.questionId, { answer: record.answer, answerText: record.answerText }];
    if (Array.isArray(record.responses)) {
      return [record.questionId, { selections: Object.fromEntries(record.responses.map((response) => [response.statementId ?? response.actionId, response.selection])) }];
    }
    if ('most' in record || 'least' in record) return [record.questionId, { most: record.most, least: record.least }];
    return [record.questionId, record.answer ?? null];
  }));
}

function consistencyAnalysis(questions, answers) {
  const groups = new Map();
  questions.filter((question) => question.type === 'likert' && question.consistencyGroup).forEach((question) => {
    const raw = likertRawValue(question, answers[question.id]);
    if (raw == null) return;
    const entry = {
      questionId: question.id,
      question: question.text,
      answer: answerLabel(question, answers[question.id]),
      normalized: raw * polarityOf(question),
      traits: traitsOf(question)
    };
    if (!groups.has(question.consistencyGroup)) groups.set(question.consistencyGroup, []);
    groups.get(question.consistencyGroup).push(entry);
  });

  const groupScores = [];
  const traitScores = new Map();
  const contradictions = [];
  for (const [group, entries] of groups) {
    if (entries.length < 2) continue;
    const differences = [];
    for (let left = 0; left < entries.length; left += 1) {
      for (let right = left + 1; right < entries.length; right += 1) {
        const difference = Math.abs(entries[left].normalized - entries[right].normalized);
        differences.push(difference);
        if (difference >= 3) {
          contradictions.push({
            type: 'contradiction',
            group,
            difference,
            questions: [entries[left], entries[right]]
          });
        }
      }
    }
    const score = clamp(100 * (1 - mean(differences) / 4), 0, 100);
    const traits = [...new Set(entries.flatMap((entry) => entry.traits))];
    groupScores.push(score);
    traits.forEach((trait) => {
      if (!traitScores.has(trait)) traitScores.set(trait, []);
      traitScores.get(trait).push(score);
    });
  }

  contradictions.sort((first, second) => second.difference - first.difference);
  return {
    overall: rounded(mean(groupScores)),
    byTrait: Object.fromEntries([...traitScores].map(([trait, scores]) => [trait, rounded(mean(scores))]).sort()),
    groupsAnalyzed: groupScores.length,
    contradictions: contradictions.slice(0, 8)
  };
}

function alignmentScore(targetScore, selection = 'most') {
  const direction = selection === 'least' ? -1 : 1;
  return ((clamp(Number(targetScore) * direction, -2, 2) + 2) / 4) * 100;
}

function addAlignmentContribution(contributions, question, subject, selection, targetScore, answerText) {
  if (!Number.isFinite(Number(targetScore))) return;
  contributions.push({
    questionId: question.id,
    question: questionPrompt(question),
    subject: subject?.text ?? null,
    answer: answerText,
    score: alignmentScore(targetScore, selection),
    traits: traitsOf(subject ?? question)
  });
}

function addChoiceContributions(contributions, question, answer, items) {
  if (answer?.selections) {
    items.forEach((item) => {
      const selection = answer.selections[item.id];
      if (selection) addAlignmentContribution(contributions, question, item, selection, item.targetScore, selection);
    });
    return;
  }
  if (answer?.most) {
    const item = items.find((candidate) => candidate.id === answer.most);
    if (item) addAlignmentContribution(contributions, question, item, 'most', item.targetScore, 'Most');
  }
  if (answer?.least) {
    const item = items.find((candidate) => candidate.id === answer.least);
    if (item) addAlignmentContribution(contributions, question, item, 'least', item.targetScore, 'Least');
  }
}

function targetAlignmentAnalysis(questions, answers, profile) {
  const contributions = [];
  questions.forEach((question) => {
    const answer = answers[question.id];
    if (answer == null) return;
    if (question.type === 'likert') {
      const raw = likertRawValue(question, answer);
      if (raw == null) return;
      const score = ((raw * polarityOf(question) + 2) / 4) * 100;
      traitsOf(question).forEach((trait) => contributions.push({
        questionId: question.id,
        question: question.text,
        subject: null,
        answer: answerLabel(question, answer),
        score,
        traits: [trait]
      }));
      return;
    }
    if (question.type === 'most-least') {
      if (!question.excludeFromTargetAlignment) addChoiceContributions(contributions, question, answer, question.statements);
      return;
    }
    if (question.type === 'situational') {
      if (question.responseMode === 'single') {
        const answerId = typeof answer === 'object' ? answer.answer : answer;
        const action = question.actions.find((candidate) => candidate.id === answerId);
        if (action) addAlignmentContribution(contributions, question, action, 'most', action.targetScore, 'Selected');
      } else {
        addChoiceContributions(contributions, question, answer, question.actions);
      }
    }
  });

  const byTraitValues = new Map();
  contributions.forEach((contribution) => contribution.traits.forEach((trait) => {
    if (!profile.traits?.[trait]) return;
    if (!byTraitValues.has(trait)) byTraitValues.set(trait, []);
    byTraitValues.get(trait).push(contribution.score);
  }));
  const byTrait = Object.fromEntries([...byTraitValues].map(([trait, scores]) => [trait, rounded(mean(scores))]).sort());
  const weightedTraits = Object.entries(byTrait).map(([trait, score]) => ({ score, weight: Number(profile.traits[trait]?.weight ?? 1) }));
  const weightTotal = weightedTraits.reduce((total, item) => total + item.weight, 0);
  const overall = weightTotal ? rounded(weightedTraits.reduce((total, item) => total + item.score * item.weight, 0) / weightTotal) : null;

  const byQuestion = new Map();
  contributions.forEach((contribution) => {
    if (!byQuestion.has(contribution.questionId)) byQuestion.set(contribution.questionId, { questionId: contribution.questionId, question: contribution.question, scores: [], responses: [] });
    const record = byQuestion.get(contribution.questionId);
    record.scores.push(contribution.score);
    record.responses.push({ subject: contribution.subject, answer: contribution.answer, score: rounded(contribution.score) });
  });
  const questionScores = [...byQuestion.values()].map((record) => ({ ...record, score: rounded(mean(record.scores)) })).map(({ scores, ...record }) => record);
  questionScores.sort((first, second) => first.score - second.score);
  const rankedTraits = Object.entries(byTrait).map(([trait, score]) => ({ trait, score })).sort((first, second) => second.score - first.score);
  return {
    profile: profile.id,
    overall,
    byTrait,
    questionsAnalyzed: questionScores.length,
    strongestTraits: rankedTraits.slice(0, 4),
    areasForAttention: [...rankedTraits].reverse().slice(0, 4),
    lowestAlignmentQuestions: questionScores.slice(0, 6),
    strongestAlignmentQuestions: [...questionScores].reverse().slice(0, 6)
  };
}

export async function loadScoringProfile(profileId) {
  const response = await fetch(`scoring-profiles/${encodeURIComponent(profileId)}.json`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Scoring profile could not be loaded (${response.status}).`);
  const profile = await response.json();
  if (profile.id !== profileId || !profile.traits || typeof profile.traits !== 'object') throw new Error('Scoring profile is invalid.');
  return profile;
}

export function analyzeAssessment(questionnaire, questions, answers, profile) {
  const answerMap = Array.isArray(answers) ? answerMapFromExport({ answers }) : answers;
  const consistency = consistencyAnalysis(questions, answerMap);
  const targetProfileAlignment = targetAlignmentAnalysis(questions, answerMap, profile);
  const lowAlignmentFlags = targetProfileAlignment.lowestAlignmentQuestions
    .filter((question) => question.score < 50)
    .map((question) => ({ type: 'low-alignment', ...question }));
  return {
    consistency,
    targetProfileAlignment,
    flags: [...consistency.contradictions, ...lowAlignmentFlags]
  };
}

export function analyzeExportedResult(questionnaire, questions, result, profile) {
  return analyzeAssessment(questionnaire, questions, answerMapFromExport(result), profile);
}
