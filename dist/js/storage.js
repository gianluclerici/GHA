const STORAGE_PREFIX = 'gha-simulator:v1:';

export function attemptKey(questionnaireId) {
  return `${STORAGE_PREFIX}attempt:${questionnaireId}`;
}

export function loadAttempt(questionnaireId) {
  const key = attemptKey(questionnaireId);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const attempt = JSON.parse(raw);
    if (!attempt || attempt.questionnaireId !== questionnaireId || !Array.isArray(attempt.questionOrder) || typeof attempt.answers !== 'object') {
      throw new Error('Stored attempt has an invalid shape.');
    }
    return attempt;
  } catch (error) {
    console.warn(`[GHA Simulator] Ignoring corrupted progress for ${questionnaireId}.`, error);
    try { localStorage.removeItem(key); } catch {}
    return null;
  }
}

export function saveAttempt(attempt) {
  try {
    localStorage.setItem(attemptKey(attempt.questionnaireId), JSON.stringify(attempt));
  } catch (error) {
    console.error('[GHA Simulator] Progress could not be saved.', error);
    throw new Error('Progress could not be saved on this device.');
  }
}

export function removeAttempt(questionnaireId) {
  localStorage.removeItem(attemptKey(questionnaireId));
}

export function summarizeAttempt(attempt) {
  if (!attempt) return { kind: 'new', label: 'Not started' };
  if (attempt.completedAt) return { kind: 'complete', label: 'Completed' };
  return { kind: 'progress', label: 'In progress' };
}
