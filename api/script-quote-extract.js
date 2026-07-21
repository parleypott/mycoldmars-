import { checkAccess } from './_lib/access.js';
import { readJsonBody } from './_lib/read-json-body.js';
import { parseImageInput, MAX_INLINE_IMAGE_BASE64 } from './_lib/walden-image-input.js';
import { parseQuoteExtraction } from './_lib/script-quote-extract.js';

export const config = { runtime: 'edge', maxDuration: 30 };

// ── TRANSCRIPT SCREENSHOT → QUOTE (the IMAGE road of TRANSCRIPT DROP) ─────────────────────────────
// Johnny drops a screenshot of an Interpreter/Trint transcript panel into the script; the editor's
// image handler routes a "QUOTE" choice here. This endpoint reads the still with a vision model and
// returns the ONE structured soundbite it holds: { tcIn, tcOut, text, speaker } — the exact shape the
// editor's insertQuoteRow builds a timecode-chip + ON CAM run from.
//
// AUTH: same checkAccess gate as every other write-path API (the client's fetch interceptor injects
// the signed-in JWT or x-access-code). NEVER an open endpoint — it spends Johnny's Gemini quota.
//
// MODEL: gemini-2.5-flash — the cheapest capable vision tier this repo already uses (api/gemini.js
// and neighbors). One image + a short prompt in, one tiny JSON object out → ~0.001 USD per call.
// temperature 0 + responseMimeType application/json + a responseSchema make the output deterministic
// and machine-parseable; the model is told to REFUSE (found:false) when it can't confidently read a
// timecode AND quote text, so a non-transcript image can never fabricate a fake soundbite.
//
// The image-input parse + the model-JSON parse both live in ./_lib/script-quote-extract.js so they
// are unit-testable without the network (script-quote-extract.test.mjs mocks the model response).

const MODEL = 'gemini-2.5-flash';

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    found: { type: 'boolean' },
    tcIn: { type: 'string' },
    tcOut: { type: 'string' },
    speaker: { type: 'string' },
    text: { type: 'string' },
  },
  required: ['found'],
};

const SYSTEM_PROMPT = `You read a single screenshot of a video-transcript panel (from tools like Interpreter or Trint — usually a dark UI). It shows ONE soundbite: a broadcast timecode or timecode range (formatted HH:MM:SS:FF or HH:MM:SS, sometimes shown as "IN - OUT"), optionally a speaker name, and the spoken quote text.

Return STRICT JSON with these fields:
- "found": true only if you can confidently read BOTH a timecode AND quote text. If the image is not a transcript, or you cannot read a timecode and text, return {"found": false} and nothing else.
- "tcIn": the first/in timecode exactly as shown (digits and colons only, e.g. "00:25:14:22"). Required when found.
- "tcOut": the second/out timecode when a range is shown; otherwise "".
- "text": the spoken quote text, verbatim. Strip any leading speaker label and any "[...]" ellipsis markers the transcript tool inserts. Required when found.
- "speaker": the speaker name if one is clearly labeled; otherwise "".

Never invent a timecode or words that are not legible in the image. Output only the JSON object.`;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
  });
}

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  // Same gate as script-doc / script-image-* — never open.
  const denied = await checkAccess(req);
  if (denied) return denied;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return json({ ok: false, error: 'GEMINI_API_KEY not configured' }, 500);

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return json({ ok: false, error: parsed.error }, parsed.status);

  const { dataBase64, mimeType } = parsed.body || {};
  // Accept either a bare base64 + mime pair (what the editor sends) or a data: URL in dataBase64.
  const image = parseImageInput(
    typeof dataBase64 === 'string' && dataBase64.startsWith('data:')
      ? dataBase64
      : (mimeType ? `data:${mimeType};base64,${dataBase64 || ''}` : dataBase64),
  );
  if (!image) return json({ ok: false, error: 'no readable image in request' }, 400);
  if (image.dataBase64.length > MAX_INLINE_IMAGE_BASE64) {
    return json({ ok: false, error: 'image too large to read inline' }, 413);
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{
          parts: [
            { inlineData: { mimeType: image.mimeType, data: image.dataBase64 } },
            { text: 'Extract the soundbite as JSON.' },
          ],
        }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 1024,
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
    });
  } catch (e) {
    return json({ ok: false, error: 'vision request failed: ' + (e?.message || 'network') }, 502);
  }

  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    const isQuota = detail.includes('RESOURCE_EXHAUSTED') || res.status === 429;
    return json({ ok: false, error: isQuota ? 'gemini quota exhausted' : 'vision model error', detail }, isQuota ? 429 : 502);
  }

  const data = await res.json().catch(() => null);
  const modelText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const quote = parseQuoteExtraction(modelText);
  if (!quote) {
    return json({ ok: false, error: 'no timecode + quote could be read from the image' }, 422);
  }
  return json({ ok: true, quote });
}
