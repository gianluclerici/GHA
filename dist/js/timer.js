export class AssessmentTimer {
  constructor({ onTick, onExpire, onThreshold }) {
    this.onTick = onTick;
    this.onExpire = onExpire;
    this.onThreshold = onThreshold;
    this.intervalId = null;
    this.seenThresholds = new Set();
  }

  start(attempt, questionnaire) {
    this.stop();
    if (!questionnaire.durationMinutes || attempt.completedAt) {
      this.onTick(null);
      return;
    }
    const tick = () => {
      const remainingSeconds = calculateRemainingSeconds(attempt.startedAt, questionnaire.durationMinutes);
      this.onTick(remainingSeconds);
      const thresholds = questionnaire.warningThresholdsMinutes ?? [5, 1];
      thresholds.forEach((minutes) => {
        const seconds = minutes * 60;
        if (remainingSeconds <= seconds && remainingSeconds > 0 && !this.seenThresholds.has(seconds)) {
          this.seenThresholds.add(seconds);
          this.onThreshold(minutes);
        }
      });
      if (remainingSeconds === 0) {
        this.stop();
        this.onExpire();
      }
    };
    tick();
    this.intervalId = window.setInterval(tick, 1000);
  }

  stop() {
    if (this.intervalId) window.clearInterval(this.intervalId);
    this.intervalId = null;
  }
}

export function calculateRemainingSeconds(startedAt, durationMinutes, now = Date.now()) {
  const totalSeconds = durationMinutes * 60;
  const elapsedSeconds = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000));
  return Math.max(0, totalSeconds - elapsedSeconds);
}

export function formatClock(totalSeconds) {
  if (totalSeconds == null) return '';
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')} remaining`;
}

export function formatDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}
