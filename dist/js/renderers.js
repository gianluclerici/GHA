function escapeText(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function checked(condition) {
  return condition ? ' checked' : '';
}

function renderLikert(question, answer, disabled) {
  return `<fieldset class="question-fieldset" ${disabled ? 'disabled' : ''}>
    <legend>${escapeText(question.text)}</legend>
    <div class="likert-grid">
      ${question.options.map((option, index) => `<label class="choice likert-choice">
        <input type="radio" name="answer" value="${index}"${checked(String(answer) === String(index))} />
        <span class="choice-control" aria-hidden="true"></span>
        <span>${escapeText(option)}</span>
      </label>`).join('')}
    </div>
  </fieldset>`;
}

function renderPairedChoices(items, answer, disabled, prompt) {
  return `<fieldset class="question-fieldset" ${disabled ? 'disabled' : ''}>
    <legend>${escapeText(prompt)}</legend>
    <p class="question-help">Choose one statement in each column. A statement cannot be both.</p>
    <div class="pair-grid pair-header" aria-hidden="true"><span>Statement</span><span>Most like me</span><span>Least like me</span></div>
    ${items.map((item) => `<div class="pair-grid pair-row">
      <span class="pair-text">${escapeText(item.text)}</span>
      <label class="compact-choice"><input type="radio" name="most" value="${escapeText(item.id)}"${checked(answer?.most === item.id)} /><span class="sr-only">Most like me: ${escapeText(item.text)}</span><span class="mobile-label">Most</span></label>
      <label class="compact-choice"><input type="radio" name="least" value="${escapeText(item.id)}"${checked(answer?.least === item.id)} /><span class="sr-only">Least like me: ${escapeText(item.text)}</span><span class="mobile-label">Least</span></label>
    </div>`).join('')}
  </fieldset>`;
}

function renderMostLeast(question, answer, disabled) {
  return renderPairedChoices(question.statements, answer, disabled, 'Which statements are most and least like you?');
}

function renderSituational(question, answer, disabled) {
  if (question.responseMode === 'most-least') {
    return renderPairedChoices(question.actions, answer, disabled, question.scenario);
  }
  return `<fieldset class="question-fieldset" ${disabled ? 'disabled' : ''}>
    <legend>${escapeText(question.scenario)}</legend>
    <p class="question-help">Select the action you would be most likely to take.</p>
    <div class="stacked-choices">
      ${question.actions.map((action) => `<label class="choice action-choice">
        <input type="radio" name="answer" value="${escapeText(action.id)}"${checked(answer === action.id)} />
        <span class="choice-control" aria-hidden="true"></span>
        <span>${escapeText(action.text)}</span>
      </label>`).join('')}
    </div>
  </fieldset>`;
}

export const questionRenderers = {
  likert: renderLikert,
  'most-least': renderMostLeast,
  situational: renderSituational
};

export function readAnswer(question, form) {
  if (question.type === 'most-least' || (question.type === 'situational' && question.responseMode === 'most-least')) {
    const most = form.elements.most?.value;
    const least = form.elements.least?.value;
    if (!most || !least || most === least) return null;
    return { most, least };
  }
  return form.elements.answer?.value ?? null;
}

export function answerSummary(question, answer) {
  if (answer == null) return 'No answer recorded';
  if (question.type === 'likert') return question.options[Number(answer)] ?? 'No answer recorded';
  const items = question.type === 'most-least' ? question.statements : question.actions;
  const find = (id) => items.find((item) => item.id === id)?.text ?? id;
  if (question.type === 'situational' && question.responseMode === 'single') return find(answer);
  return `Most: ${find(answer.most)} · Least: ${find(answer.least)}`;
}
