import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

function isGenericSpeaker(name) {
  if (!name) return true;
  return /^speaker\s*\d+$/i.test(name.trim());
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { segments } = req.body;

  if (!segments || !Array.isArray(segments) || segments.length === 0) {
    return res.status(400).json({ error: 'No segments provided' });
  }

  const taggedSegments = segments.map(s => ({
    ...s,
    isGeneric: isGenericSpeaker(s.speaker),
  }));

  const labeled = taggedSegments.filter(s => !s.isGeneric);
  const genericCount = taggedSegments.filter(s => s.isGeneric).length;
  const genericNums = taggedSegments.filter(s => s.isGeneric).map(s => s.number);

  // Only send labeled speaker text — compact format to reduce tokens
  const transcriptText = labeled
    .map(s => `${s.number}. [${s.speaker}]: ${s.text}`)
    .join('\n');

  const systemPrompt = `You are a translation analysis assistant for a documentary video production team. You will receive a transcript from an interview/documentary shoot.

Your job:
1. Read the dialogue as one continuous narrative — understand the story, topics, and flow.
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

  // Use streaming to prevent Vercel timeout
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');

  let fullText = '';

  try {
    const stream = await client.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: `Transcript (${labeled.length} labeled segments, ${genericCount} unlabeled ignored):\n\n${transcriptText}`,
        },
      ],
    });

    // Send keepalive spaces while streaming to prevent timeout
    const keepalive = setInterval(() => {
      res.write(' ');
    }, 5000);

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta?.text) {
        fullText += event.delta.text;
      }
    }

    clearInterval(keepalive);

    // Parse the accumulated text and send as final JSON
    let result;
    try {
      result = extractJSON(fullText);
    } catch {
      res.end(JSON.stringify({ error: 'Failed to parse analysis response', raw: fullText }));
      return;
    }

    result.generic_segments = genericNums;
    res.end(JSON.stringify(result));
  } catch (err) {
    console.error('Analyze API error:', err);
    res.end(JSON.stringify({ error: err.message }));
  }
}

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
