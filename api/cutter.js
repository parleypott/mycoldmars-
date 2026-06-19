import { checkAccess } from './_lib/access.js';
import { buildSystemInstruction, buildChatContents } from './_lib/cutter-prompt.js';

export const config = { maxDuration: 300 };

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const BASE = 'https://generativelanguage.googleapis.com';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Use checkAccess adapter — it expects a Request-like object
  const reqLike = {
    method: req.method,
    headers: { get: (k) => req.headers[k.toLowerCase()] },
  };
  const denied = await checkAccess(reqLike);
  if (denied) {
    const body = await denied.json().catch(() => ({}));
    res.status(denied.status).json(body);
    return;
  }

  if (!GEMINI_API_KEY) {
    res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
    return;
  }

  const body = req.body;
  const action = body?.action;

  if (action === 'initiate_upload') return handleInitiateUpload(body, res);
  if (action === 'poll_file') return handlePollFile(body, res);
  if (action === 'analyze_video') return handleAnalyzeVideo(body, res);
  if (action === 'chat') return handleChat(body, res);

  res.status(400).json({ error: `Unknown action: ${action}` });
}

// ── 1. Initiate resumable upload ──────────────────────────────────────────────
// Calls Gemini File API to get a resumable upload URI, returns it to the
// browser so the browser can PUT the file bytes directly without going
// through our Vercel function (which has a 4.5 MB body limit).

async function handleInitiateUpload({ fileName, mimeType, fileSize }, res) {
  if (!fileName || !mimeType || !fileSize) {
    res.status(400).json({ error: 'fileName, mimeType, fileSize required' });
    return;
  }

  const r = await fetch(
    `${BASE}/upload/v1beta/files?uploadType=resumable&key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(fileSize),
        'X-Goog-Upload-Header-Content-Type': mimeType,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ file: { display_name: fileName } }),
    }
  );

  if (!r.ok) {
    const text = await r.text();
    res.status(r.status).json({ error: 'Gemini upload initiation failed', detail: text.slice(0, 400) });
    return;
  }

  const uploadUri = r.headers.get('x-goog-upload-url');
  if (!uploadUri) {
    res.status(502).json({ error: 'No upload URI returned by Gemini' });
    return;
  }

  res.status(200).json({ uploadUri });
}

// ── 2. Poll file status ───────────────────────────────────────────────────────
// After the browser finishes the upload, it sends us the file name.
// We poll Gemini until state is ACTIVE (video processing can take ~30–90s).

async function handlePollFile({ fileName }, res) {
  if (!fileName) {
    res.status(400).json({ error: 'fileName required' });
    return;
  }

  const r = await fetch(
    `${BASE}/v1beta/${fileName}?key=${GEMINI_API_KEY}`
  );

  if (!r.ok) {
    const text = await r.text();
    res.status(r.status).json({ error: 'Gemini file poll failed', detail: text.slice(0, 400) });
    return;
  }

  const data = await r.json();
  res.status(200).json({ state: data.state, file: data });
}

// ── 3. Analyze video → two-column script ──────────────────────────────────────
// Full multimodal analysis. Returns an array of timed segments:
// { timestamp_start, timestamp_end, words, visual }

async function handleAnalyzeVideo({ fileUri, fileName, mimeType }, res) {
  if (!fileUri && !fileName) {
    res.status(400).json({ error: 'fileUri or fileName required' });
    return;
  }

  const resolvedUri = fileUri || `${BASE}/v1beta/${fileName}`;

  const prompt = `Watch this entire video from start to finish. Generate a complete two-column breakdown of every segment.

Return a JSON object: { "title": string, "total_duration": "MM:SS", "segments": [ ... ] }

Each segment object:
  "timestamp_start": "MM:SS"
  "timestamp_end": "MM:SS"
  "words": the exact words spoken — or "[no dialogue]" if silent — or "[music]" if just music
  "visual": plain description of what is on screen

Rules for "visual" (very important):
- Be literal and direct. Camera position + subject + action.
- Say things like: "wide shot, highway at night, cars passing", "medium close on Johnny, seated, talking to camera", "handheld, market crowd, vendor hands wrapping food"
- Never say "stunning", "beautiful", "powerful", "compelling", "cinematic", "gorgeous", "breathtaking" or any quality adjective
- If there are text cards or titles, transcribe the text exactly
- If it's an interview, identify the speaker (Johnny, or describe them) and note what they're doing (talking, reacting, listening, gesturing)
- Keep it under 25 words per segment

Rules for "words":
- Transcribe exactly what's said, verbatim
- For multiple speakers, label each line: "JOHNNY: ...", "SUBJECT: ..."
- Use [no dialogue], [music], or [ambient sound] when appropriate
- Do not paraphrase or summarize

Make segments roughly 10–30 seconds each. More granular is better than less.`;

  const r = await fetch(
    `${BASE}/v1beta/models/gemini-2.5-pro:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            {
              fileData: {
                mimeType: mimeType || 'video/mp4',
                fileUri: resolvedUri,
              },
            },
            { text: prompt },
          ],
        }],
        generationConfig: {
          responseMimeType: 'application/json',
          maxOutputTokens: 65536,
          temperature: 0.1,
        },
      }),
    }
  );

  if (!r.ok) {
    const text = await r.text();
    const isQuota = text.includes('RESOURCE_EXHAUSTED') || r.status === 429;
    res.status(r.status).json({
      error: isQuota ? 'Gemini quota hit — wait a minute and retry' : 'Analysis failed',
      detail: text.slice(0, 600),
    });
    return;
  }

  const data = await r.json();
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

  let result;
  try {
    result = JSON.parse(raw);
  } catch {
    result = { title: 'Untitled cut', total_duration: '?', segments: [], raw_text: raw, parse_error: true };
  }

  res.status(200).json(result);
}

// ── 4. Chat ────────────────────────────────────────────────────────────────────
// The chatbot knows the full two-column script. Designed for narrative
// restructuring conversations — Johnny tells it what's wrong, it proposes
// specific reorderings with timestamps and rationale.

async function handleChat({ message, history, segments, title }, res) {
  if (!message) {
    res.status(400).json({ error: 'message required' });
    return;
  }

  const systemInstruction = buildSystemInstruction(segments, title);
  const contents = buildChatContents(history, message);

  const r = await fetch(
    `${BASE}/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: systemInstruction }] },
        generationConfig: { maxOutputTokens: 3000, temperature: 0.7 },
      }),
    }
  );

  if (!r.ok) {
    const text = await r.text();
    res.status(r.status).json({ error: 'Chat failed', detail: text.slice(0, 400) });
    return;
  }

  const data = await r.json();
  const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response.';
  res.status(200).json({ reply });
}
