function questionPrompt(question) {
  return question.type === 'situational' ? question.scenario : question.text ?? '';
}

function choicesFor(question) {
  if (question.type === 'likert') return question.options.map((text, index) => ({ id: String(index), text }));
  if (question.type === 'most-least') return question.statements;
  return question.actions;
}

function selectionLabel(question, value) {
  if (value == null) return '';
  const choice = choicesFor(question).find((item) => String(item.id) === String(value));
  return choice?.text ?? String(value);
}

function perStatementExport(question, answer) {
  const responses = question.statements.map((statement) => ({
    statementId: statement.id,
    statement: statement.text,
    selection: answer?.selections?.[statement.id] ?? null
  }));
  const answerText = responses.map((response) => `${response.statement}: ${response.selection === 'most' ? 'Most like me' : response.selection === 'least' ? 'Least like me' : 'No answer'}`).join(' | ');
  return { selectionMode: 'per-statement', responses, answerText };
}

export function buildResult(questionnaire, questions, attempt) {
  return {
    schemaVersion: 1,
    questionnaireId: questionnaire.id,
    title: questionnaire.title,
    startedAt: attempt.startedAt,
    completedAt: attempt.completedAt,
    completionReason: attempt.completionReason,
    durationSeconds: attempt.durationSeconds ?? Math.max(0, Math.floor((Date.parse(attempt.completedAt) - Date.parse(attempt.startedAt)) / 1000)),
    answers: questions.map((question) => {
      const answer = attempt.answers[question.id] ?? null;
      return {
        questionId: question.id,
        sectionId: question.sectionId,
        sectionTitle: question.sectionTitle,
        type: question.type,
        question: questionPrompt(question),
        choices: choicesFor(question),
        ...(question.traits ? { traits: question.traits } : {}),
        ...(question.consistencyGroup ? { consistencyGroup: question.consistencyGroup } : {}),
        ...(question.type === 'most-least' && question.selectionMode === 'per-statement'
          ? perStatementExport(question, answer)
          : question.type === 'likert' || (question.type === 'situational' && question.responseMode === 'single')
          ? { answer, answerText: selectionLabel(question, answer) }
          : {
              most: answer?.most ?? null,
              mostText: selectionLabel(question, answer?.most),
              least: answer?.least ?? null,
              leastText: selectionLabel(question, answer?.least)
            })
      };
    })
  };
}

function csvCell(value) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return `"${serialized.replaceAll('"', '""')}"`;
}

export function resultToCsv(result) {
  const header = ['questionnaire_id', 'question_id', 'section', 'type', 'question', 'answer', 'most', 'least', 'traits', 'consistency_group'];
  const rows = result.answers.map((item) => [
    result.questionnaireId,
    item.questionId,
    item.sectionTitle,
    item.type,
    item.question,
    item.answerText ?? '',
    item.mostText ?? '',
    item.leastText ?? '',
    item.traits ?? {},
    item.consistencyGroup ?? ''
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

export function downloadFile(filename, contents, type) {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
