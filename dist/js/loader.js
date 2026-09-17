const QUESTION_TYPES = new Set(['likert', 'most-least', 'situational']);

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function validateQuestion(question, location) {
  requireValue(question && typeof question === 'object', `${location} must be an object.`);
  requireValue(typeof question.id === 'string' && question.id.trim(), `${location}.id is required.`);
  requireValue(QUESTION_TYPES.has(question.type), `${location} uses unsupported type “${question.type ?? 'missing'}”.`);

  if (question.type === 'likert') {
    requireValue(typeof question.text === 'string' && question.text.trim(), `${location}.text is required.`);
    requireValue(Array.isArray(question.options) && question.options.length >= 2, `${location}.options must contain at least two labels.`);
    requireValue(question.options.every((option) => typeof option === 'string' && option.trim()), `${location}.options must contain non-empty strings.`);
  }

  if (question.type === 'most-least') {
    requireValue(Array.isArray(question.statements) && question.statements.length >= 2, `${location}.statements must contain at least two items.`);
    validateChoices(question.statements, `${location}.statements`);
    requireValue(question.selectionMode == null || ['pick-one-each', 'per-statement'].includes(question.selectionMode), `${location}.selectionMode must be “pick-one-each” or “per-statement”.`);
  }

  if (question.type === 'situational') {
    requireValue(typeof question.scenario === 'string' && question.scenario.trim(), `${location}.scenario is required.`);
    requireValue(Array.isArray(question.actions) && question.actions.length >= 2, `${location}.actions must contain at least two items.`);
    validateChoices(question.actions, `${location}.actions`);
    requireValue(['single', 'most-least'].includes(question.responseMode), `${location}.responseMode must be “single” or “most-least”.`);
  }
  if (question.traits !== undefined) requireValue(question.traits && typeof question.traits === 'object' && !Array.isArray(question.traits), `${location}.traits must be an object.`);
}

function validateChoices(items, location) {
  const ids = new Set();
  items.forEach((item, index) => {
    requireValue(item && typeof item.id === 'string' && item.id.trim(), `${location}[${index}].id is required.`);
    requireValue(!ids.has(item.id), `${location} contains duplicate id “${item.id}”.`);
    ids.add(item.id);
    requireValue(typeof item.text === 'string' && item.text.trim(), `${location}[${index}].text is required.`);
  });
}

export function flattenQuestions(questionnaire) {
  return questionnaire.sections.flatMap((section) => section.questions.map((question) => ({ ...question, sectionId: section.id, sectionTitle: section.title })));
}

export function validateQuestionnaire(questionnaire, expectedId) {
  requireValue(questionnaire && typeof questionnaire === 'object', 'Questionnaire must be an object.');
  requireValue(questionnaire.id === expectedId, `Questionnaire id must match “${expectedId}”.`);
  requireValue(typeof questionnaire.title === 'string' && questionnaire.title.trim(), 'Questionnaire title is required.');
  requireValue(Array.isArray(questionnaire.sections) && questionnaire.sections.length > 0, 'Questionnaire must contain at least one section.');
  requireValue(questionnaire.durationMinutes == null || (Number.isFinite(questionnaire.durationMinutes) && questionnaire.durationMinutes > 0), 'durationMinutes must be null or a positive number.');
  requireValue(questionnaire.allowBack == null || typeof questionnaire.allowBack === 'boolean', 'allowBack must be a boolean.');
  requireValue(questionnaire.randomizeQuestions == null || typeof questionnaire.randomizeQuestions === 'boolean', 'randomizeQuestions must be a boolean.');
  requireValue(questionnaire.warningThresholdsMinutes == null || (Array.isArray(questionnaire.warningThresholdsMinutes) && questionnaire.warningThresholdsMinutes.every((value) => Number.isFinite(value) && value > 0)), 'warningThresholdsMinutes must contain positive numbers.');

  const sectionIds = new Set();
  const questionIds = new Set();
  questionnaire.sections.forEach((section, sectionIndex) => {
    const location = `sections[${sectionIndex}]`;
    requireValue(section && typeof section.id === 'string' && section.id.trim(), `${location}.id is required.`);
    requireValue(!sectionIds.has(section.id), `Duplicate section id “${section.id}”.`);
    sectionIds.add(section.id);
    requireValue(typeof section.title === 'string' && section.title.trim(), `${location}.title is required.`);
    requireValue(Array.isArray(section.questions) && section.questions.length > 0, `${location}.questions must not be empty.`);
    section.questions.forEach((question, questionIndex) => {
      const questionLocation = `${location}.questions[${questionIndex}]`;
      validateQuestion(question, questionLocation);
      requireValue(!questionIds.has(question.id), `Duplicate question id “${question.id}”.`);
      questionIds.add(question.id);
    });
  });
  return questionnaire;
}

async function getJson(path, label) {
  let response;
  try {
    response = await fetch(path, { cache: 'no-store' });
  } catch (error) {
    throw new Error(`${label} could not be loaded. Run the simulator through a local web server.`, { cause: error });
  }
  if (!response.ok) throw new Error(`${label} could not be loaded (${response.status}).`);
  try {
    return await response.json();
  } catch (error) {
    throw new Error(`${label} contains malformed JSON.`, { cause: error });
  }
}

export async function loadCatalog() {
  const catalog = await getJson('questionnaires/index.json', 'Assessment catalog');
  requireValue(Array.isArray(catalog), 'Assessment catalog must be an array.');
  const ids = new Set();
  catalog.forEach((entry, index) => {
    requireValue(entry && typeof entry === 'object', `Catalog entry ${index + 1} must be an object.`);
    requireValue(typeof entry.id === 'string' && entry.id.trim(), `Catalog entry ${index + 1} needs an id.`);
    requireValue(!ids.has(entry.id), `Catalog contains duplicate id “${entry.id}”.`);
    ids.add(entry.id);
    requireValue(typeof entry.name === 'string' && entry.name.trim(), `Catalog entry “${entry.id}” needs a name.`);
    requireValue(typeof entry.file === 'string' && /^[a-z0-9][a-z0-9._-]*\.json$/i.test(entry.file), `Catalog entry “${entry.id}” has an invalid file name.`);
  });
  return catalog;
}

export async function loadQuestionnaire(entry) {
  const questionnaire = await getJson(`questionnaires/${entry.file}`, `Assessment “${entry.name}”`);
  return validateQuestionnaire(questionnaire, entry.id);
}
