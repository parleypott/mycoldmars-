import { checkAccess } from './_lib/access.js';

export const config = { runtime: 'edge', maxDuration: 60 };

/**
 * Nano Banana image-gen proxy. POST { prompt, referenceImages?, model? }.
 * Returns { images: [{ mimeType, dataBase64 }], text? }.
 *
 * Gated by checkAccess(): without the right x-access-code or signed-in
 * Supabase session, the endpoint 401s. Same posture as /api/gemini.
 *
 * Models:
 *   - nano-banana      → gemini-2.5-flash-image-preview (fast, cheap, default)
 *   - nano-banana-pro  → gemini-3-pro-image-preview   (higher fidelity)
 *
 * Reference images: array of { mimeType, dataBase64 } — used for character
 * or style consistency. Pass through to Gemini as inlineData parts.
 */
export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }
  const denied = checkAccess(req);
  if (denied) return denied;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return jsonError(500, 'GEMINI_API_KEY not configured');
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'Invalid JSON body');
  }

  const prompt = (body.prompt || '').toString().trim();
  if (!prompt) {
    return jsonError(400, 'Missing prompt');
  }

  const modelMap = {
    'nano-banana': 'gemini-3.1-flash-image-preview',
    'nano-banana-2.5': 'gemini-2.5-flash-image',
    'nano-banana-pro': 'gemini-3-pro-image-preview',
  };
  const modelId = modelMap[body.model] || modelMap['nano-banana'];

  const parts = [];
  if (Array.isArray(body.referenceImages)) {
    for (const ref of body.referenceImages) {
      if (ref && ref.dataBase64 && ref.mimeType) {
        parts.push({
          inlineData: { mimeType: ref.mimeType, data: ref.dataBase64 },
        });
      }
    }
  }
  parts.push({ text: prompt });

  const payload = {
    contents: [{ parts }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
    },
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`;

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return jsonError(502, `Gemini request failed: ${err.message}`);
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    return jsonError(response.status, `Gemini ${response.status}: ${errText.slice(0, 800)}`);
  }

  const data = await response.json().catch(() => null);
  if (!data) {
    return jsonError(502, 'Gemini returned non-JSON response');
  }

  const images = [];
  let text = '';
  const candidates = data.candidates || [];
  for (const c of candidates) {
    const cParts = c?.content?.parts || [];
    for (const p of cParts) {
      if (p.inlineData?.data) {
        images.push({
          mimeType: p.inlineData.mimeType || 'image/png',
          dataBase64: p.inlineData.data,
        });
      } else if (p.text) {
        text += (text ? '\n' : '') + p.text;
      }
    }
  }

  if (!images.length) {
    return jsonError(502, text ? `No image returned. Model said: ${text.slice(0, 400)}` : 'No image returned');
  }

  return new Response(JSON.stringify({ images, text, model: modelId }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function jsonError(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
