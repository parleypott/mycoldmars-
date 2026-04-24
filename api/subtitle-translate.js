import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

/** Speakers like "Speaker 1", "Speaker 9", etc. are unlabeled mic noise */
function isGenericSpeaker(name) {
  if (!name) return true;
  return /^speaker\s*\d+$/i.test(name.trim());
}

/** Extract JSON from Claude's response, handling markdown fencing and surrounding text */
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

  throw new Error('No valid JSON found in response');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { segments, language_map, narrative_summary, clarifications, editorial_focus } = req.body;

  if (!segments || !Array.isArray(segments) || segments.length === 0) {
    return res.status(400).json({ error: 'No segments provided' });
  }

  // Build context block
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

  // Build segments for translation (client already filtered to labeled only)
  const segmentText = segments
    .map(s => {
      const speaker = s.speaker ? `[${s.speaker}]` : '';
      return `SEG ${s.number} ${speaker}: ${s.text}`;
    })
    .join('\n');

  const systemPrompt = `You are a professional subtitle translator for a documentary production team. You have full context about this transcript and must now translate the labeled speakers' dialogue segment by segment.

${context}

TRANSLATION RULES:
1. Translate each non-English segment into natural, conversational English suitable for on-screen subtitles.
2. If a segment is ALREADY in English, pass it through exactly as-is and mark it as kept_original: true.
3. Maintain the speaker's tone and register — formal speech stays formal, casual stays casual.
4. Use the narrative context, editorial focus, and clarifications to resolve ambiguities. Do NOT guess blindly.
5. Keep translations concise — subtitles must be readable in the time available.
6. Do NOT add quotation marks, speaker labels, or formatting — just the translated text.
7. Preserve proper nouns, place names, and technical terms as discussed in clarifications.
8. If a segment appears to be garbled auto-transcription, do your best to infer meaning from context and translate. If impossible, output "[inaudible]".

Respond with a JSON array (no markdown fencing). Each element must have:
{
  "number": <segment number>,
  "original": "<original text>",
  "translated": "<English translation or original if already English>",
  "language": "<detected language of this segment>",
  "kept_original": <true if English, false if translated>
}

Maintain the exact same order and count as the input segments (${segments.length} segments).`;

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: `Translate these ${segments.length} labeled segments:\n\n${segmentText}`,
        },
      ],
    });

    const text = message.content[0].text;

    let translated;
    try {
      translated = extractJSON(text);
    } catch {
      return res.status(500).json({ error: 'Failed to parse translation response', raw: text });
    }

    if (!Array.isArray(translated)) {
      return res.status(500).json({ error: 'Translation response is not an array', raw: text });
    }

    return res.status(200).json(translated);
  } catch (err) {
    console.error('Translate API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
