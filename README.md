# GHA Simulator

GHA Simulator is a reusable, browser-only assessment runner. The application engine is separate from questionnaire content: adding an assessment requires a JSON file and one catalog entry, with no changes to HTML, CSS, or JavaScript.

The included `gha-01.json` is deliberately synthetic and exists only to exercise the engine. It is not an official Google assessment and is not intended to reproduce one.

## Run locally

From the repository root:

```bash
python -m http.server 8000 --directory dist
```

Open <http://localhost:8000>. A web server is required because browsers normally block `fetch()` requests for local JSON when a page is opened with `file://`.

## Add `gha-02.json`

1. Duplicate `dist/questionnaires/example.json` as `dist/questionnaires/gha-02.json`.
2. Set its `id` to `gha-02`, add sections and questions, and validate the JSON.
3. Add an entry to `dist/questionnaires/index.json`:

```json
{
  "id": "gha-02",
  "name": "GHA Simulation #2",
  "file": "gha-02.json",
  "description": "A concise description"
}
```

Refresh the assessment list. No application-code change is needed. A direct link will then work at `?assessment=gha-02`.

## Questionnaire schema

Top-level fields:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `schemaVersion` | number | recommended | Currently `1`. |
| `id` | string | yes | Must match the catalog entry id. |
| `title` | string | yes | Displayed to the candidate. |
| `description` | string | no | Introductory copy. |
| `durationMinutes` | number or `null` | no | Positive number enables the persistent timer. |
| `warningThresholdsMinutes` | number[] | no | Defaults to `[5, 1]`. |
| `allowBack` | boolean | no | Enables the Previous button. Defaults to false-like behavior. |
| `randomizeQuestions` | boolean | no | Order is shuffled once, then persisted. |
| `sections` | array | yes | Each section needs a unique `id`, `title`, and non-empty `questions`. |

Every question requires a unique `id` and supported `type`. Optional `traits` may contain any string keys with JSON values; the engine never hardcodes trait names. Optional `consistencyGroup` is also preserved. Both fields stay hidden during the assessment and basic review, and are included in exports.

### Likert

```json
{
  "id": "q1",
  "type": "likert",
  "text": "Prompt text",
  "options": ["Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree"],
  "traits": { "anyFutureTrait": 1 },
  "consistencyGroup": "pair-01"
}
```

### Most / least

```json
{
  "id": "q2",
  "type": "most-least",
  "statements": [
    { "id": "a", "text": "Statement A" },
    { "id": "b", "text": "Statement B" },
    { "id": "c", "text": "Statement C" }
  ]
}
```

### Situational

Use `responseMode: "single"` for one response or `responseMode: "most-least"` for paired selections.

```json
{
  "id": "q3",
  "type": "situational",
  "responseMode": "single",
  "scenario": "Scenario text",
  "actions": [
    { "id": "a", "text": "Action A" },
    { "id": "b", "text": "Action B" }
  ]
}
```

## Persistence and exports

Attempts are stored per questionnaire in browser `localStorage`. This includes the stable question order, current position, answers, start time, and completion state. A timed attempt therefore continues across refreshes. Reset removes that questionnaire's local attempt after confirmation.

JSON exports contain question text, choice labels, response ids, section context, traits, and consistency groups for later analysis. CSV exports flatten the same information into a human-readable table. The simulator deliberately produces no score, recommendation, or pass/fail result.

Progress belongs to the browser profile and device. Hosting makes the application accessible from multiple devices, but progress does not sync between them because the project intentionally has no account system or backend.

## Architecture

- `dist/index.html` — semantic application shell and reset dialog
- `dist/styles.css` — responsive professional assessment UI
- `dist/app.js` — navigation and assessment orchestration
- `dist/js/loader.js` — catalog loading and schema validation
- `dist/js/storage.js` — safe local persistence
- `dist/js/timer.js` — refresh-safe countdown logic
- `dist/js/renderers.js` — renderer registry and response parsing
- `dist/js/exporter.js` — structured JSON and CSV generation
- `dist/questionnaires/` — content-only catalog and questionnaires

## Hosting

The repository includes a GitHub Pages workflow that publishes the `dist` directory whenever `main` is updated. In GitHub, set **Settings → Pages → Source** to **GitHub Actions** if it is not already selected.
