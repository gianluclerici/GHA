import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const questionnaireDirectory = path.join(root, 'dist', 'questionnaires');
const profile = JSON.parse(await readFile(path.join(root, 'dist', 'scoring-profiles', 'google-practice-2026.json'), 'utf8'));
const files = ['gha-01.json', 'gha-02.json', 'gha-03.json', 'gha-04.json'];

const clamp = (value) => Math.min(2, Math.max(-2, value));

function traitScore(subject) {
  return clamp(Object.entries(subject.traits ?? {}).reduce((score, [trait, value]) => {
    if (!profile.traits[trait]) throw new Error(`Unknown trait “${trait}”.`);
    return score + Number(value) * Number(profile.traits[trait].weight ?? 1);
  }, 0));
}

function migrateQuestion(question) {
  if (question.type === 'likert') {
    const signs = [...new Set(Object.values(question.traits ?? {}).map((value) => Math.sign(Number(value))).filter(Boolean))];
    if (signs.length !== 1) throw new Error(`${question.id}: Likert traits must share one polarity.`);
    question.analysis = { ...(question.analysis ?? {}), polarity: signs[0] };
    return;
  }
  if (question.type === 'situational') {
    question.actions.forEach((action) => { action.targetScore = traitScore(action); });
    return;
  }
  if (question.type === 'most-least') {
    const scores = question.statements.map((statement) => traitScore(statement));
    const hasMeaningfulDistinction = new Set(scores).size > 1;
    if (hasMeaningfulDistinction) {
      question.statements.forEach((statement, index) => { statement.targetScore = scores[index]; });
      delete question.excludeFromTargetAlignment;
    } else {
      question.statements.forEach((statement) => { delete statement.targetScore; });
      question.excludeFromTargetAlignment = true;
    }
  }
}

for (const file of files) {
  const target = path.join(questionnaireDirectory, file);
  const questionnaire = JSON.parse(await readFile(target, 'utf8'));
  questionnaire.scoring = { profile: profile.id, version: 1 };
  questionnaire.sections.forEach((section) => section.questions.forEach(migrateQuestion));
  await writeFile(target, `${JSON.stringify(questionnaire, null, 2)}\n`, 'utf8');
  console.log(`Migrated ${file}`);
}
