import { loadCatalog, loadQuestionnaire, flattenQuestions } from './js/loader.js';
import { loadAttempt, saveAttempt, removeAttempt, summarizeAttempt } from './js/storage.js';
import { AssessmentTimer, formatClock, formatDuration } from './js/timer.js';
import { buildResult, resultToCsv, downloadFile } from './js/exporter.js';
import { questionRenderers, readAnswer, answerSummary } from './js/renderers.js';
import { analyzeAssessment, loadScoringProfile } from './scoring.js';

const app = document.querySelector('#app');
const toastRegion = document.querySelector('#toast-region');
const resetDialog = document.querySelector('#reset-dialog');

const state = { catalog: [], entry: null, questionnaire: null, questions: [], attempt: null, pendingResetId: null, analysis: null, scoringProfile: null };

function escapeText(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function setDocumentTitle(label = '') {
  document.title = label ? `${label} · GHA Simulator` : 'GHA Simulator';
}

function showToast(message, tone = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${tone}`;
  toast.textContent = message;
  toastRegion.replaceChildren(toast);
  window.setTimeout(() => toast.remove(), 4200);
}

function renderError(title, message) {
  timer.stop();
  setDocumentTitle('Something went wrong');
  app.innerHTML = `<section class="shell compact-shell" aria-labelledby="error-title">
    <div class="error-panel" role="alert"><div class="eyebrow">Unable to continue</div><h1 id="error-title">${escapeText(title)}</h1><p>${escapeText(message)}</p><button class="button button-primary" type="button" data-action="home">Return to assessments</button></div>
  </section>`;
}

function shuffle(items) {
  const output = [...items];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [output[index], output[randomIndex]] = [output[randomIndex], output[index]];
  }
  return output;
}

function orderedQuestions(questionnaire, order) {
  const questions = flattenQuestions(questionnaire);
  const byId = new Map(questions.map((question) => [question.id, question]));
  const ordered = order.map((id) => byId.get(id)).filter(Boolean);
  if (ordered.length !== questions.length) throw new Error('Saved progress no longer matches this assessment. Reset the attempt to continue.');
  return ordered;
}

function renderHome() {
  timer.stop();
  Object.assign(state, { entry: null, questionnaire: null, questions: [], attempt: null, analysis: null, scoringProfile: null });
  setDocumentTitle();
  history.replaceState({}, '', location.pathname);
  app.innerHTML = `<section class="shell" aria-labelledby="page-title">
    <div class="eyebrow">Practice workspace</div><h1 id="page-title">Choose an assessment</h1>
    <p class="lede">Technical sample questionnaires for testing the simulator. No official Google questions are included.</p>
    <div class="assessment-list">
      ${state.catalog.map((entry) => {
        const attempt = loadAttempt(entry.id);
        const status = summarizeAttempt(attempt);
        const buttonText = status.kind === 'complete' ? 'View results' : status.kind === 'progress' ? 'Resume' : 'Start';
        return `<article class="assessment-card"><div><h2>${escapeText(entry.name)}</h2><p>${escapeText(entry.description ?? '')}</p><span class="status status-${status.kind}">${escapeText(status.label)}${status.kind === 'complete' ? ' ✓' : ''}</span></div><div class="card-actions"><button class="button button-primary" type="button" data-action="open" data-id="${escapeText(entry.id)}">${buttonText}</button>${attempt ? `<button class="button button-quiet" type="button" data-action="ask-reset" data-id="${escapeText(entry.id)}">Reset</button>` : ''}</div></article>`;
      }).join('') || '<div class="empty-panel"><h2>No assessments available</h2><p>Add an entry to <code>questionnaires/index.json</code>.</p></div>'}
    </div>
  </section>`;
}

async function openAssessment(questionnaireId) {
  const entry = state.catalog.find((item) => item.id === questionnaireId);
  if (!entry) {
    showToast(`Assessment “${questionnaireId}” was not found.`, 'warning');
    renderHome();
    return;
  }
  try {
    const questionnaire = await loadQuestionnaire(entry);
    const savedAttempt = loadAttempt(entry.id);
    state.entry = entry;
    state.questionnaire = questionnaire;
    state.attempt = savedAttempt;
    state.analysis = null;
    state.scoringProfile = null;
    state.questions = savedAttempt ? orderedQuestions(questionnaire, savedAttempt.questionOrder) : flattenQuestions(questionnaire);
    history.replaceState({}, '', `${location.pathname}?assessment=${encodeURIComponent(entry.id)}`);
    if (savedAttempt?.completedAt) renderCompletion();
    else if (savedAttempt) renderQuestion();
    else renderIntro();
  } catch (error) {
    console.error(`[GHA Simulator] Unable to open ${questionnaireId}.`, error);
    renderError('Assessment unavailable', error.message);
  }
}

function renderIntro() {
  const questionnaire = state.questionnaire;
  setDocumentTitle(questionnaire.title);
  const questionCount = flattenQuestions(questionnaire).length;
  app.innerHTML = `<section class="shell compact-shell" aria-labelledby="assessment-title"><button class="text-button back-link" type="button" data-action="home">← All assessments</button><div class="intro-card"><div class="eyebrow">Technical sample</div><h1 id="assessment-title">${escapeText(questionnaire.title)}</h1><p class="lede">${escapeText(questionnaire.description ?? '')}</p><dl class="assessment-facts"><div><dt>Questions</dt><dd>${questionCount}</dd></div><div><dt>Time limit</dt><dd>${questionnaire.durationMinutes ? `${questionnaire.durationMinutes} minutes` : 'None'}</dd></div><div><dt>Back navigation</dt><dd>${questionnaire.allowBack ? 'Allowed' : 'Not allowed'}</dd></div></dl><div class="notice"><strong>Before you begin</strong><p>Your progress is saved in this browser. Timer-based attempts continue to run if this page is closed.</p></div><button class="button button-primary button-large" type="button" data-action="begin">Begin assessment</button></div></section>`;
}

function beginAssessment() {
  const allQuestions = flattenQuestions(state.questionnaire);
  const ordered = state.questionnaire.randomizeQuestions ? shuffle(allQuestions) : allQuestions;
  state.questions = ordered;
  state.attempt = { schemaVersion: 1, questionnaireId: state.questionnaire.id, questionOrder: ordered.map((question) => question.id), currentIndex: 0, answers: {}, startedAt: new Date().toISOString(), completedAt: null, completionReason: null };
  if (!persistAttempt()) return;
  renderQuestion();
}

function persistAttempt() {
  try {
    saveAttempt(state.attempt);
    return true;
  } catch (error) {
    renderError('Progress cannot be saved', error.message);
    return false;
  }
}

function renderQuestion() {
  const { questionnaire, attempt, questions } = state;
  const question = questions[attempt.currentIndex];
  if (!question) return renderError('Saved progress is out of date', 'Reset this attempt from the assessment list, then start again.');
  const renderer = questionRenderers[question.type];
  if (!renderer) return renderError('Unsupported question type', `The type “${question.type}” is not supported by this version of the simulator.`);
  setDocumentTitle(`Question ${attempt.currentIndex + 1}`);
  const progress = ((attempt.currentIndex + 1) / questions.length) * 100;
  const answer = attempt.answers[question.id];
  app.innerHTML = `<section class="assessment-shell" aria-labelledby="question-number"><div class="assessment-toolbar"><div><span id="question-number" class="question-number">Question ${attempt.currentIndex + 1} of ${questions.length}</span><span class="section-name">${escapeText(question.sectionTitle)}</span></div><div id="timer" class="timer" aria-live="polite"></div></div><div class="progress-track" role="progressbar" aria-label="Assessment progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progress)}"><span style="width:${progress}%"></span></div><form id="question-form" class="question-card" novalidate>${renderer(question, answer, false)}<p id="answer-error" class="form-error" role="alert" tabindex="-1" hidden>Please complete the question before continuing.</p><div class="question-actions">${questionnaire.allowBack && attempt.currentIndex > 0 ? '<button class="button button-secondary" type="button" data-action="previous">Previous</button>' : '<span></span>'}<button class="button button-primary" type="submit">${attempt.currentIndex === questions.length - 1 ? 'Finish assessment' : 'Next'}</button></div></form></section>`;
  const form = document.querySelector('#question-form');
  form.addEventListener('change', handlePairExclusivity);
  timer.start(attempt, questionnaire);
  requestAnimationFrame(() => form.querySelector('input:checked, input')?.focus({ preventScroll: true }));
}

function handlePairExclusivity(event) {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  const error = document.querySelector('#answer-error');
  if (error) error.hidden = true;
  if (!['most', 'least'].includes(input.name)) return;
  const otherName = input.name === 'most' ? 'least' : 'most';
  const matching = document.querySelector(`input[name="${otherName}"][value="${CSS.escape(input.value)}"]`);
  if (matching?.checked) matching.checked = false;
}

function submitCurrentQuestion(form) {
  const question = state.questions[state.attempt.currentIndex];
  const answer = readAnswer(question, form);
  if (answer == null) {
    const error = document.querySelector('#answer-error');
    error.hidden = false;
    error.focus();
    return;
  }
  state.attempt.answers[question.id] = answer;
  if (state.attempt.currentIndex === state.questions.length - 1) return finishAssessment('completed');
  state.attempt.currentIndex += 1;
  if (!persistAttempt()) return;
  renderQuestion();
}

function previousQuestion() {
  if (!state.questionnaire.allowBack || state.attempt.currentIndex === 0) return;
  state.attempt.currentIndex -= 1;
  if (!persistAttempt()) return;
  renderQuestion();
}

function finishAssessment(reason) {
  if (state.attempt.completedAt) return;
  state.attempt.completedAt = new Date().toISOString();
  state.attempt.completionReason = reason;
  const elapsed = Math.max(0, Math.floor((Date.parse(state.attempt.completedAt) - Date.parse(state.attempt.startedAt)) / 1000));
  state.attempt.durationSeconds = state.questionnaire.durationMinutes ? Math.min(elapsed, state.questionnaire.durationMinutes * 60) : elapsed;
  if (!persistAttempt()) return;
  renderCompletion();
}

function renderCompletion() {
  timer.stop();
  setDocumentTitle('Assessment completed');
  const answered = Object.keys(state.attempt.answers).length;
  const elapsed = state.attempt.durationSeconds ?? Math.max(0, Math.floor((Date.parse(state.attempt.completedAt) - Date.parse(state.attempt.startedAt)) / 1000));
  const timedOut = state.attempt.completionReason === 'time-expired';
  app.innerHTML = `<section class="shell" aria-labelledby="completion-title"><div class="completion-card"><div class="completion-mark" aria-hidden="true">✓</div><div class="eyebrow">${timedOut ? 'Time expired' : 'Attempt saved'}</div><h1 id="completion-title">Assessment completed</h1><p class="completion-summary">${answered} / ${state.questions.length} questions answered<br />Time used: ${formatDuration(elapsed)}</p><p class="lede">Your responses have been analyzed for practice consistency and target-profile alignment. These are training indicators, not a pass/fail result.</p><div id="analysis-panel" class="analysis-panel" aria-live="polite"><p class="analysis-loading">Preparing analysis…</p></div><div class="completion-actions"><button class="button button-primary" type="button" data-action="download-json">Download results JSON</button><button class="button button-secondary" type="button" data-action="download-csv">Download results CSV</button><button class="button button-secondary" type="button" data-action="review">Review answers</button><button class="button button-quiet" type="button" data-action="home">Return to assessments</button></div></div></section>`;
  void hydrateAnalysisPanel();
}

async function ensureAnalysis() {
  if (state.analysis && state.scoringProfile) return state.analysis;
  const profileId = state.questionnaire.scoring?.profile;
  if (!profileId) throw new Error('This assessment does not define a scoring profile.');
  const profile = await loadScoringProfile(profileId);
  state.scoringProfile = profile;
  state.analysis = analyzeAssessment(state.questionnaire, state.questions, state.attempt.answers, profile);
  return state.analysis;
}

function metricValue(value) {
  return value == null ? 'N/A' : `${value}%`;
}

function traitLabel(value) {
  return String(value).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (letter) => letter.toUpperCase());
}

function traitRows(analysis) {
  const traits = new Set([
    ...Object.keys(analysis.targetProfileAlignment.byTrait),
    ...Object.keys(analysis.consistency.byTrait)
  ]);
  return [...traits].sort().map((trait) => `<tr><th scope="row">${escapeText(traitLabel(trait))}</th><td>${metricValue(analysis.targetProfileAlignment.byTrait[trait])}</td><td>${metricValue(analysis.consistency.byTrait[trait])}</td></tr>`).join('');
}

function analysisMarkup(analysis, profile) {
  const lowAlignment = analysis.targetProfileAlignment.lowestAlignmentQuestions.filter((item) => item.score < 50);
  const contradictions = analysis.consistency.contradictions;
  const reviewItems = [
    ...lowAlignment.slice(0, 4).map((item) => `<li><strong>Low alignment (${item.score}%):</strong> ${escapeText(item.question)}<span class="flag-answer">Response: ${escapeText(item.responses.map((response) => response.subject ? `${response.subject} — ${response.answer}` : response.answer).join('; '))}</span></li>`),
    ...contradictions.slice(0, 4).map((item) => `<li><strong>Consistency review:</strong><span class="flag-answer">${escapeText(item.questions[0].question)} — ${escapeText(item.questions[0].answer)}</span><span class="flag-answer">${escapeText(item.questions[1].question)} — ${escapeText(item.questions[1].answer)}</span></li>`)
  ];
  return `<div class="analysis-heading"><div class="eyebrow">Practice analysis</div><h2>Assessment analysis</h2></div><div class="metric-grid"><article class="metric-card"><span>Consistency Score</span><strong>${metricValue(analysis.consistency.overall)}</strong><small>${analysis.consistency.groupsAnalyzed} consistency groups analyzed</small></article><article class="metric-card"><span>Target Profile Alignment</span><strong>${metricValue(analysis.targetProfileAlignment.overall)}</strong><small>${analysis.targetProfileAlignment.questionsAnalyzed} scored questions</small></article></div><div class="analysis-section"><h3>Trait breakdown</h3><div class="table-scroll"><table class="trait-table"><thead><tr><th>Trait</th><th>Alignment</th><th>Consistency</th></tr></thead><tbody>${traitRows(analysis)}</tbody></table></div></div><div class="analysis-section"><h3>Areas to review</h3>${reviewItems.length ? `<ul class="review-flags">${reviewItems.join('')}</ul>` : '<p>No material low-alignment or contradiction flags were detected.</p>'}</div><p class="analysis-disclaimer">${escapeText(profile.disclaimer)}</p>`;
}

async function hydrateAnalysisPanel() {
  const panel = document.querySelector('#analysis-panel');
  if (!panel) return;
  try {
    const analysis = await ensureAnalysis();
    if (panel.isConnected) panel.innerHTML = analysisMarkup(analysis, state.scoringProfile);
  } catch (error) {
    console.error('[GHA Simulator] Analysis failed.', error);
    if (panel.isConnected) panel.innerHTML = `<p class="form-error">Analysis could not be prepared: ${escapeText(error.message)}</p>`;
  }
}

function renderReview() {
  timer.stop();
  setDocumentTitle('Review answers');
  app.innerHTML = `<section class="shell" aria-labelledby="review-title"><button class="text-button back-link" type="button" data-action="completion">← Completion summary</button><div class="eyebrow">Completed attempt</div><h1 id="review-title">Review answers</h1><p class="lede">This review shows only your responses. Analysis metadata remains hidden.</p><ol class="review-list">${state.questions.map((question, index) => `<li class="review-card"><div class="review-meta">${escapeText(question.sectionTitle)} · Question ${index + 1}</div><h2>${escapeText(question.type === 'situational' ? question.scenario : question.text ?? 'Most / least choice')}</h2><p><strong>Your answer:</strong> ${escapeText(answerSummary(question, state.attempt.answers[question.id]))}</p></li>`).join('')}</ol></section>`;
}

async function exportResults(format) {
  let analysis = null;
  try { analysis = await ensureAnalysis(); }
  catch (error) { showToast(`Analysis unavailable: ${error.message}`, 'warning'); }
  const result = buildResult(state.questionnaire, state.questions, state.attempt, analysis);
  const stem = `${state.questionnaire.id}-results`;
  if (format === 'json') downloadFile(`${stem}.json`, `${JSON.stringify(result, null, 2)}\n`, 'application/json;charset=utf-8');
  else downloadFile(`${stem}.csv`, resultToCsv(result), 'text/csv;charset=utf-8');
  showToast(`${format.toUpperCase()} export prepared.`, 'success');
}

function askReset(questionnaireId) {
  const entry = state.catalog.find((item) => item.id === questionnaireId);
  if (!entry) return;
  state.pendingResetId = questionnaireId;
  document.querySelector('#reset-assessment-name').textContent = entry.name;
  resetDialog.showModal();
}

function confirmReset() {
  if (!state.pendingResetId) return;
  removeAttempt(state.pendingResetId);
  state.pendingResetId = null;
  resetDialog.close();
  showToast('Attempt reset.', 'success');
  renderHome();
}

const timer = new AssessmentTimer({
  onTick(remaining) {
    const target = document.querySelector('#timer');
    if (target) { target.textContent = formatClock(remaining); target.classList.toggle('timer-warning', remaining != null && remaining <= 300); target.hidden = remaining == null; }
  },
  onThreshold(minutes) { showToast(`${minutes} minute${minutes === 1 ? '' : 's'} remaining.`, 'warning'); },
  onExpire() { finishAssessment('time-expired'); }
});

function registerWebMcpTools() {
  const context = document.modelContext;
  if (!context?.registerTool) return;
  const lifecycle = new AbortController();
  const report = (error) => console.warn('[GHA Simulator] WebMCP tool registration failed.', error);
  try {
    void Promise.resolve(context.registerTool({
      name: 'list_assessments', title: 'List assessments', description: 'List available simulator assessments and their local progress status.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute() { return state.catalog.map((entry) => ({ id: entry.id, name: entry.name, status: summarizeAttempt(loadAttempt(entry.id)).kind })); }
    }, { signal: lifecycle.signal })).catch(report);
    void Promise.resolve(context.registerTool({
      name: 'open_assessment', title: 'Open assessment', description: 'Open an assessment at its start, resume, or completion screen.',
      inputSchema: { type: 'object', properties: { questionnaireId: { type: 'string', description: 'Assessment id from list_assessments.' } }, required: ['questionnaireId'], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute(input) {
        if (!input || typeof input.questionnaireId !== 'string' || !state.catalog.some((entry) => entry.id === input.questionnaireId)) throw new Error('Unknown questionnaireId.');
        await openAssessment(input.questionnaireId);
        return { questionnaireId: input.questionnaireId, view: state.attempt?.completedAt ? 'completed' : state.attempt ? 'in-progress' : 'ready' };
      }
    }, { signal: lifecycle.signal })).catch(report);
    window.addEventListener('pagehide', () => lifecycle.abort(), { once: true });
  } catch (error) { report(error); }
}

app.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'home') renderHome();
  if (action === 'open') openAssessment(button.dataset.id);
  if (action === 'begin') beginAssessment();
  if (action === 'previous') previousQuestion();
  if (action === 'completion') renderCompletion();
  if (action === 'review') renderReview();
  if (action === 'download-json') void exportResults('json');
  if (action === 'download-csv') void exportResults('csv');
  if (action === 'ask-reset') askReset(button.dataset.id);
});

app.addEventListener('submit', (event) => {
  if (event.target.id !== 'question-form') return;
  event.preventDefault();
  submitCurrentQuestion(event.target);
});

resetDialog.addEventListener('click', (event) => {
  if (event.target.dataset.action === 'cancel-reset') { state.pendingResetId = null; resetDialog.close(); }
  if (event.target.dataset.action === 'confirm-reset') confirmReset();
});

async function initialize() {
  try {
    state.catalog = await loadCatalog();
    registerWebMcpTools();
    const requestedId = new URLSearchParams(location.search).get('assessment');
    if (requestedId && state.catalog.some((entry) => entry.id === requestedId)) await openAssessment(requestedId);
    else { if (requestedId) showToast(`Assessment “${requestedId}” was not found.`, 'warning'); renderHome(); }
  } catch (error) {
    console.error('[GHA Simulator] Initialization failed.', error);
    renderError('Assessments unavailable', error.message);
  }
}

initialize();
