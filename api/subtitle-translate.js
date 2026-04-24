import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

/** Speakers like "Speaker 1", "Speaker 9", etc. are unlabeled mic noise */
function isGenericSpeaker(name) {
  if (!name) return true;
  return /^speaker\s*\d+$/i.test(name.trim());
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
      // Mark as unintelligible — don't send to Claude
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
      results.push(null); // placeholder — will be filled
    }
  }

  // If no labeled segments, return all as unintelligible
  if (labeled.length === 0) {
    return res.status(200).json(results);
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

  // Build only labeled segments for translation
  const segmentText = labeled
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

Maintain the exact same order and count as the input segments (${labeled.length} segments).`;

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: `Translate these ${labeled.length} labeled segments:\n\n${segmentText}`,
        },
      ],
    });

    const text = message.content[0].text;

    let translated;
    try {
      const cleaned = text.replace(/^```json?\n?/, '').replace(/\n?```$/, '').trim();
      translated = JSON.parse(cleaned);
    } catch {
      return res.status(500).json({ error: 'Failed to parse translation response', raw: text });
    }

    if (!Array.isArray(translated)) {
      return res.status(500).json({ error: 'Translation response is not an array', raw: text });
    }

    // Merge translated results back into the full results array
    let tIdx = 0;
    for (let i = 0; i < results.length; i++) {
      if (results[i] === null) {
        results[i] = translated[tIdx] || {
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
