export const config = { runtime: 'edge' };

function isGenericSpeaker(name) {
  if (!name) return true;
  return /^speaker\s*\d+$/i.test(name.trim());
}

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

  const { segments } = await req.json();

  if (!segments?.length) {
    return new Response(JSON.stringify({ error: 'No segments' }), { status: 400 });
  }

  const tagged = segments.map(s => ({ ...s, isGeneric: isGenericSpeaker(s.speaker) }));
  const labeled = tagged.filter(s => !s.isGeneric);
  const genericCount = tagged.filter(s => s.isGeneric).length;
  const genericNums = tagged.filter(s => s.isGeneric).map(s => s.number);

  const transcriptText = labeled
    .map(s => `${s.number}. [${s.speaker}]: ${s.text}`)
    .join('\n');

  const systemPrompt = `You are a translation analysis assistant for a documentary video production team.

Your job:
1. Read the dialogue as one continuous narrative.
2. Identify which language each speaker uses.
3. Identify 3-6 major themes/topics.
4. Flag ambiguous passages needing clarification (max 10).

Respond with JSON only (no markdown fencing):
{
  "narrative_summary": "2-3 sentence summary",
  "themes": ["theme 1", "theme 2"],
  "language_map": { "Speaker Name": "Language" },
  "questions": [{ "id": "q1", "segment_range": "15-18", "quoted_text": "...", "question": "...", "why": "..." }]
}`;

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const apiKey = process.env.ANTHROPIC_API_KEY;

  // Run in background — stream keepalives to client while waiting
  const work = (async () => {
    try {
      // Call Claude with streaming enabled
      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2000,
          stream: true,
          system: systemPrompt,
          messages: [{ role: 'user', content: `Transcript (${labeled.length} labeled, ${genericCount} unlabeled ignored):\n\n${transcriptText}` }],
        }),
      });

      if (!claudeRes.ok) {
        const errText = await claudeRes.text();
        throw new Error(`Claude API ${claudeRes.status}: ${errText}`);
      }

      // Read SSE stream from Claude, accumulate text
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
              // Send keepalive space to browser
              await writer.write(encoder.encode(' '));
            }
          } catch {}
        }
      }

      // Parse result, add generic segments, send final JSON
      const result = extractJSON(fullText);
      result.generic_segments = genericNums;
      await writer.write(encoder.encode(JSON.stringify(result)));
    } catch (err) {
      await writer.write(encoder.encode(JSON.stringify({ error: err.message })));
    } finally {
      await writer.close();
    }
  })();

  // Don't await — let it run while streaming
  void work;

  return new Response(readable, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
