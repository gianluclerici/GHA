import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { flattenQuestions } from '../dist/js/loader.js';
import { analyzeExportedResult } from '../dist/scoring.js';

const resultPath = process.argv[2];
if (!resultPath) throw new Error('Usage: node tools/score-results.mjs <results.json>');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const result = JSON.parse(await readFile(path.resolve(resultPath), 'utf8'));
const questionnaire = JSON.parse(await readFile(path.join(root, 'dist', 'questionnaires', `${result.questionnaireId}.json`), 'utf8'));
const profile = JSON.parse(await readFile(path.join(root, 'dist', 'scoring-profiles', `${questionnaire.scoring.profile}.json`), 'utf8'));
const analysis = analyzeExportedResult(questionnaire, flattenQuestions(questionnaire), result, profile);
console.log(JSON.stringify(analysis, null, 2));
