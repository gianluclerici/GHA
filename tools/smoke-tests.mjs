import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadCatalog, loadQuestionnaire, flattenQuestions, validateQuestionnaire } from '../dist/js/loader.js';
import { calculateRemainingSeconds } from '../dist/js/timer.js';
import { buildResult, resultToCsv } from '../dist/js/exporter.js';
import { questionRenderers, readAnswer } from '../dist/js/renderers.js';

const baseUrl = process.env.GHA_BASE_URL ?? 'http://localhost:8000';
const catalogResponse = await fetch(`${baseUrl}/questionnaires/index.json`);
assert.equal(catalogResponse.status, 200, 'catalog is served');

const originalFetch = globalThis.fetch;
globalThis.fetch = (path, options) => originalFetch(new URL(path, `${baseUrl}/`), options);
const catalog = await loadCatalog();
assert.ok(catalog.length > 0, 'catalog contains an assessment');
const questionnaires = await Promise.all(catalog.map((entry) => loadQuestionnaire(entry)));
assert.deepEqual(new Set(questionnaires.map((item) => item.id)), new Set(['gha-01', 'gha-02', 'gha-03', 'gha-04']), 'all four assessments load and validate');
const questionnaire = questionnaires.find((item) => item.id === 'gha-02');
const questions = flattenQuestions(questionnaire);
assert.equal(questions.length, 65, 'GHA Simulation #2 has sixty-five questions');
assert.deepEqual(new Set(questions.map((question) => question.type)), new Set(['likert', 'most-least', 'situational']), 'all renderer types are represented');
assert.ok(new Set(questions.filter((question) => question.type === 'situational').map((question) => question.responseMode)).has('most-least'), 'most-least situational questions are represented');

const now = Date.parse('2026-01-01T00:05:00.000Z');
assert.equal(calculateRemainingSeconds('2026-01-01T00:00:00.000Z', 15, now), 600, 'timer is derived from persisted start time');
assert.equal(calculateRemainingSeconds('2026-01-01T00:00:00.000Z', 1, now), 0, 'timer clamps at zero');

const answers = Object.fromEntries(questions.map((question) => {
  if (question.type === 'likert') return [question.id, '3'];
  if (question.type === 'situational' && question.responseMode === 'single') return [question.id, question.actions[0].id];
  if (question.type === 'most-least' && question.selectionMode !== 'pick-one-each') {
    return [question.id, { selections: Object.fromEntries(question.statements.map((statement, index) => [statement.id, index % 2 === 0 ? 'most' : 'least'])) }];
  }
  if (question.type === 'situational' && question.responseMode === 'most-least' && question.selectionMode !== 'pick-one-each') {
    return [question.id, { selections: Object.fromEntries(question.actions.map((action, index) => [action.id, index % 2 === 0 ? 'most' : 'least'])) }];
  }
  const items = question.type === 'most-least' ? question.statements : question.actions;
  return [question.id, { most: items[0].id, least: items[1].id }];
}));
const attempt = { questionnaireId: questionnaire.id, startedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-01T00:10:00.000Z', completionReason: 'completed', answers };
const result = buildResult(questionnaire, questions, attempt);
assert.equal(result.answers.length, questions.length, 'JSON export contains every question');
assert.ok(result.answers.some((answer) => answer.traits), 'JSON export preserves hidden metadata');
const perStatementQuestion = questions.find((question) => question.type === 'most-least' && question.selectionMode !== 'pick-one-each');
const perStatementHtml = questionRenderers['most-least'](perStatementQuestion, null, false);
assert.equal((perStatementHtml.match(/name="statement-/g) ?? []).length, perStatementQuestion.statements.length * 2, 'each statement renders its own radio group');
const completeElements = { namedItem: (name) => ({ value: name.endsWith('b') ? 'least' : 'most' }) };
const incompleteElements = { namedItem: (name) => ({ value: name.endsWith('c') ? '' : 'most' }) };
assert.equal(Object.keys(readAnswer(perStatementQuestion, { elements: completeElements }).selections).length, perStatementQuestion.statements.length, 'one response is captured for every statement');
assert.equal(readAnswer(perStatementQuestion, { elements: incompleteElements }), null, 'a missing row prevents submission');
assert.equal(result.answers.find((answer) => answer.questionId === perStatementQuestion.id).responses.length, perStatementQuestion.statements.length, 'JSON export preserves every row response');
const perActionQuestion = questions.find((question) => question.type === 'situational' && question.selectionMode !== 'pick-one-each');
const perActionHtml = questionRenderers.situational(perActionQuestion, null, false);
assert.equal((perActionHtml.match(/name="action-/g) ?? []).length, perActionQuestion.actions.length * 2, 'each situational action renders its own radio group');
const completeActionElements = { namedItem: (name) => ({ value: name.endsWith('b') ? 'least' : 'most' }) };
const incompleteActionElements = { namedItem: (name) => ({ value: name.endsWith('c') ? '' : 'most' }) };
assert.equal(Object.keys(readAnswer(perActionQuestion, { elements: completeActionElements }).selections).length, perActionQuestion.actions.length, 'one response is captured for every situational action');
assert.equal(readAnswer(perActionQuestion, { elements: incompleteActionElements }), null, 'a missing situational row prevents submission');
assert.equal(result.answers.find((answer) => answer.questionId === perActionQuestion.id).responses.length, perActionQuestion.actions.length, 'JSON export preserves every situational row response');
const csv = resultToCsv(result);
assert.ok(csv.includes('questionnaire_id') && csv.includes(questionnaire.id) && csv.includes('traits'), 'CSV export is structured and includes metadata');

assert.throws(() => validateQuestionnaire({ id: 'bad', title: 'Bad', sections: [{ id: 'x', title: 'X', questions: [{ id: 'q', type: 'unknown' }] }] }, 'bad'), /unsupported type/, 'unsupported types fail clearly');

const indexHtml = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
assert.ok(indexHtml.includes('type="module"') && indexHtml.includes('reset-dialog'), 'application shell includes module entry and reset confirmation');
const appSource = await readFile(new URL('../dist/app.js', import.meta.url), 'utf8');
assert.ok(appSource.includes("URLSearchParams(location.search).get('assessment')"), 'direct query parameter loading is wired');
assert.ok(!appSource.includes('sampleTraitAlpha'), 'engine does not hardcode questionnaire traits');

const storageData = new Map();
globalThis.localStorage = {
  getItem: (key) => storageData.get(key) ?? null,
  setItem: (key, value) => storageData.set(key, value),
  removeItem: (key) => storageData.delete(key)
};
const { loadAttempt, saveAttempt } = await import('../dist/js/storage.js');
saveAttempt({ ...attempt, questionOrder: questions.map((question) => question.id), currentIndex: 4 });
assert.equal(loadAttempt(questionnaire.id).currentIndex, 4, 'progress survives a storage round trip');
storageData.set(`gha-simulator:v1:attempt:${questionnaire.id}`, '{bad json');
assert.equal(loadAttempt(questionnaire.id), null, 'corrupted local progress is discarded safely');

console.log(`Smoke tests passed: 4 assessments, ${questions.length} representative questions, per-row controls, persistence, timer, exports, validation, and direct loading.`);
