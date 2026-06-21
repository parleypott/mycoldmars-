// Decide what the OpenAI deep-research poll loop should do for a status payload
// (see api/research-openai-status.js). Pure so it can be unit-tested without the
// fetch loop / DOM.
//
//   { action: "done",  report }  → render the report and stop polling
//   { action: "error", error  }  → surface the error and stop polling
//   { action: "wait" }           → keep polling
//
// The bug this fixes: the old loop only treated `completed` as done and
// failed/cancelled as error — every other status (including the terminal
// `incomplete`, when a long run hits its token cap) fell through to "keep
// polling", so an `incomplete` job polled uselessly until the 30-minute deadline
// and reported a timeout, even though OpenAI had already finished with a usable
// partial report. Now `incomplete` is terminal: render the salvaged partial
// report (with a note) if there is one, else fail fast instead of hanging.
export function decidePollOutcome(data) {
  const status = data?.status;

  if (status === 'completed') {
    return { action: 'done', report: data.report ?? '(empty result)' };
  }

  if (status === 'incomplete') {
    if (typeof data.report === 'string' && data.report.trim()) {
      const note = data.incomplete_reason
        ? `\n\n_(research stopped early — ${data.incomplete_reason} — partial report)_`
        : '\n\n_(research stopped early — partial report)_';
      return { action: 'done', report: data.report + note };
    }
    return { action: 'error', error: `openai incomplete: ${data.incomplete_reason ?? 'no output'}` };
  }

  if (status === 'failed' || status === 'cancelled') {
    return { action: 'error', error: `openai ${status}: ${data.error ?? ''}` };
  }

  return { action: 'wait' };
}
