import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();
const BATCH_SIZE = 50;

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

/** Translate a single batch of labeled segments */
async function translateBatch(batch, context) {
  const segmentText = batch
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

Maintain the exact same order and count as the input segments (${batch.length} segments).`;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: `Translate these ${batch.length} labeled segments:\n\n${segmentText}`,
      },
    ],
  });

  const text = message.content[0].text;
  const parsed = extractJSON(text);

  if (!Array.isArray(parsed)) {
    throw new Error('Translation response is not an array');
  }

  return parsed;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { segments, language_map, narrative_summary, clarifications, editorial_focus } = req.body;

  if (!segments || !Array.isArray(segments) || segments.length === 0) {
    return res.status(400).json({ error: 'No segments provided' });
  }

  // Separate labeled vs generic segments
  const labeled = [];
  const results = [];

  for (const s of segments) {
    if (isGenericSpeaker(s.speaker)) {
      results.push({
        number: s.number,
        original: s.text,
        translated: '[unintelligible]',
        language: 'unknown',
        kept_original: false,
        unintelligible: true,
      });
    } else {
      labeled.push(s);
      results.push(null); // placeholder
    }
  }

  if (labeled.length === 0) {
    return res.status(200).json(results);
  }

  // Build shared context block
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

  try {
    // Split labeled segments into batches and translate in parallel
    const batches = [];
    for (let i = 0; i < labeled.length; i += BATCH_SIZE) {
      batches.push(labeled.slice(i, i + BATCH_SIZE));
    }

    const batchResults = await Promise.all(
      batches.map(batch => translateBatch(batch, context))
    );

    // Flatten all batch results
    const allTranslated = batchResults.flat();

    // Merge back into full results array
    let tIdx = 0;
    for (let i = 0; i < results.length; i++) {
      if (results[i] === null) {
        results[i] = allTranslated[tIdx] || {
          number: segments[i].number,
          original: segments[i].text,
          translated: segments[i].text,
          language: 'unknown',
          kept_original: true,
        };
        tIdx++;
      }
    }

    return res.status(200).json(results);
  } catch (err) {
    console.error('Translate API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
