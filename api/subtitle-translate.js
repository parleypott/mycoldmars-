export const config = { runtime: 'edge' };

function extractJSON(text) {
  try { return JSON.parse(text.trim()); } catch {}
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenced) try { return JSON.parse(fenced[1].trim()); } catch {}
  const startArr = text.indexOf('[');
  const startObj = text.indexOf('{');
  const start = startArr === -1 ? startObj : startObj === -1 ? startArr : Math.min(startArr, startObj);
  if (start !== -1) {
    const open = text[start], close = open === '[' ? ']' : '}';
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

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const { segments, language_map, narrative_summary, clarifications, editorial_focus } = await req.json();

  if (!segments?.length) {
    return new Response(JSON.stringify({ error: 'No segments' }), { status: 400 });
  }

  let context = `NARRATIVE CONTEXT:\n${narrative_summary || 'No summary available.'}\n\n`;
  if (editorial_focus) context += `EDITORIAL FOCUS:\n${editorial_focus}\n\n`;
  if (language_map && Object.keys(language_map).length > 0) {
    context += `LANGUAGES:\n${Object.entries(language_map).map(([s, l]) => `- ${s}: ${l}`).join('\n')}\n\n`;
  }
  if (clarifications?.length > 0) {
    context += `CLARIFICATIONS:\n${clarifications.map(c => `- Q(${c.id}): ${c.answer}`).join('\n')}\n\n`;
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

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const apiKey = process.env.ANTHROPIC_API_KEY;

  const work = (async () => {
    try {
      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4096,
          stream: true,
          system: systemPrompt,
          messages: [{ role: 'user', content: `Translate these ${segments.length} segments:\n\n${segmentText}` }],
        }),
      });

      if (!claudeRes.ok) {
        const errText = await claudeRes.text();
        throw new Error(`Claude API ${claudeRes.status}: ${errText}`);
      }

      const reader = claudeRes.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      let sseBuffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split('\n');
        sseBuffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          try {
            const event = JSON.parse(data);
            if (event.type === 'content_block_delta' && event.delta?.text) {
              fullText += event.delta.text;
              await writer.write(encoder.encode(' '));
            }
          } catch {}
        }
      }

      const translated = extractJSON(fullText);
      if (!Array.isArray(translated)) throw new Error('Response is not an array');
      await writer.write(encoder.encode(JSON.stringify(translated)));
    } catch (err) {
      await writer.write(encoder.encode(JSON.stringify({ error: err.message })));
    } finally {
      await writer.close();
    }
  })();

  void work;

  return new Response(readable, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
