import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateQuestionnaire } from '../dist/js/loader.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const questionnaireDirectory = path.join(root, 'dist', 'questionnaires');
const files = ['gha-01.json', 'gha-02.json', 'gha-03.json', 'gha-04.json'];

function removeScoringMetadata(questionnaire) {
  const clean = structuredClone(questionnaire);
  delete clean.scoring;
  clean.sections.forEach((section) => section.questions.forEach((question) => {
    if (question.type === 'likert' && question.analysis) {
      delete question.analysis.polarity;
      if (Object.keys(question.analysis).length === 0) delete question.analysis;
    }
    if (question.type === 'situational') question.actions.forEach((action) => delete action.targetScore);
    if (question.type === 'most-least') {
      delete question.excludeFromTargetAlignment;
      question.statements.forEach((statement) => delete statement.targetScore);
    }
  }));
  return clean;
}

let likertCount = 0;
let actionCount = 0;
let excludedCount = 0;
for (const file of files) {
  const current = JSON.parse(await readFile(path.join(questionnaireDirectory, file), 'utf8'));
  const original = JSON.parse(await readFile(path.join(questionnaireDirectory, 'legacy', file.replace('.json', '-original.json')), 'utf8'));
  validateQuestionnaire(current, current.id);
  assert.deepEqual(removeScoringMetadata(current), removeScoringMetadata(original), `${file}: content changed beyond scoring metadata`);
  assert.deepEqual(current.scoring, { profile: 'google-practice-2026', version: 1 }, `${file}: scoring header`);

  current.sections.flatMap((section) => section.questions).forEach((question) => {
    if (question.type === 'likert') {
      likertCount += 1;
      assert.ok([1, -1].includes(question.analysis?.polarity), `${question.id}: Likert polarity`);
    }
    if (question.type === 'situational') question.actions.forEach((action) => {
      actionCount += 1;
      assert.ok(Number.isInteger(action.targetScore) && action.targetScore >= -2 && action.targetScore <= 2, `${question.id}/${action.id}: action targetScore`);
    });
    if (question.type === 'most-least') {
      const scores = question.statements.map((statement) => statement.targetScore).filter(Number.isFinite);
      if (question.excludeFromTargetAlignment) {
        excludedCount += 1;
        assert.equal(scores.length, 0, `${question.id}: excluded question must not invent statement scores`);
      } else {
        assert.equal(scores.length, question.statements.length, `${question.id}: every statement needs a targetScore`);
        assert.ok(new Set(scores).size > 1, `${question.id}: statement scores need a meaningful distinction`);
      }
    }
  });
}

console.log(`Migration verified: 4 valid questionnaires, ${likertCount} Likert polarities, ${actionCount} SJT action scores, ${excludedCount} excluded most/least questions, and no visible content changes.`);
