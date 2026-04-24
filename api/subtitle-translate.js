import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

function extractJSON(text) {
  try { return JSON.parse(text.trim()); } catch {}

  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenced) {
    try { return JSON.parse(fenced[1].trim()); } catch {}
  }

  const startArr = text.indexOf('[');
  const startObj = text.indexOf('{');
  const start = startArr === -1 ? startObj : startObj === -1 ? startArr : Math.min(startArr, startObj);
  if (start !== -1) {
    const open = text[start];
    const close = open === '[' ? ']' : '}';
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      if (text[i] === open) depth++;
      else if (text[i] === close) depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch {}
        break;
      }
    }
  }

  throw new Error('No valid JSON found');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { segments, language_map, narrative_summary, clarifications, editorial_focus } = req.body;

  if (!segments || !Array.isArray(segments) || segments.length === 0) {
    return res.status(400).json({ error: 'No segments provided' });
  }

  let context = `NARRATIVE CONTEXT:\n${narrative_summary || 'No summary available.'}\n\n`;

  if (editorial_focus) {
    context += `EDITORIAL FOCUS (from the editor):\n${editorial_focus}\n\n`;
  }

  if (language_map && Object.keys(language_map).length > 0) {
    context += `LANGUAGES:\n`;
    for (const [speaker, lang] of Object.entries(language_map)) {
      context += `- ${speaker}: ${lang}\n`;
    }
    context += '\n';
  }

  if (clarifications && clarifications.length > 0) {
    context += `CLARIFICATIONS FROM THE EDITOR:\n`;
    for (const c of clarifications) {
      context += `- Q(${c.id}): ${c.answer}\n`;
    }
    context += '\n';
  }

  const segmentText = segments
    .map(s => `SEG ${s.number} [${s.speaker || ''}]: ${s.text}`)
    .join('\n');

  const systemPrompt = `You are a professional subtitle translator for a documentary production team.

${context}

RULES:
1. Translate non-English segments into natural English for subtitles.
2. English segments: pass through as-is, mark kept_original: true.
3. Keep the speaker's tone. Be concise. No quotes or speaker labels.
4. Garbled transcription: infer from context or output "[inaudible]".

Respond with JSON array only (no markdown):
[{"number": 1, "original": "...", "translated": "...", "language": "...", "kept_original": false}]

${segments.length} segments. Maintain exact order and count.`;

  // Use streaming to prevent Vercel timeout
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');

  let fullText = '';

  try {
    const stream = await client.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: `Translate these ${segments.length} segments:\n\n${segmentText}`,
        },
      ],
    });

    const keepalive = setInterval(() => {
      res.write(' ');
    }, 5000);

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta?.text) {
        fullText += event.delta.text;
      }
    }

    clearInterval(keepalive);

    let translated;
    try {
      translated = extractJSON(fullText);
    } catch {
      res.end(JSON.stringify({ error: 'Failed to parse translation response', raw: fullText }));
      return;
    }

    if (!Array.isArray(translated)) {
      res.end(JSON.stringify({ error: 'Translation response is not an array', raw: fullText }));
      return;
    }

    res.end(JSON.stringify(translated));
  } catch (err) {
    console.error('Translate API error:', err);
    res.end(JSON.stringify({ error: err.message }));
  }
}
