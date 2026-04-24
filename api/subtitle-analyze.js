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

  const { segments } = req.body;

  if (!segments || !Array.isArray(segments) || segments.length === 0) {
    return res.status(400).json({ error: 'No segments provided' });
  }

  // Tag each segment as labeled or generic
  const taggedSegments = segments.map(s => ({
    ...s,
    isGeneric: isGenericSpeaker(s.speaker),
  }));

  const labeled = taggedSegments.filter(s => !s.isGeneric);
  const genericCount = taggedSegments.filter(s => s.isGeneric).length;

  // Only send labeled speaker text — skip generic entirely to save tokens/time
  const transcriptText = labeled
    .map(s => {
      const speaker = s.speaker ? `[${s.speaker}]` : '';
      return `${s.number}. ${speaker} (${s.start} → ${s.end}): ${s.text}`;
    })
    .join('\n');

  const systemPrompt = `You are a translation analysis assistant for a documentary video production team. You will receive a transcript exported from Happy Scribe (auto-transcription). The transcript is from an interview or documentary shoot containing one or more foreign languages.

IMPORTANT: This transcript contains segments from both LABELED speakers (real interview subjects with names) and UNLABELED speakers (marked as "Speaker 1", "Speaker 2", etc.). The unlabeled segments are background noise, crew chatter, or ambient audio captured by hot mics. IGNORE all unlabeled segments entirely — they are not part of the story.

Focus ONLY on the labeled speakers' dialogue. These are the interview subjects whose words matter.

Your job is to:
1. Read the labeled speakers' dialogue as one continuous narrative — understand the story, topics, and flow.
2. Identify which language each LABELED speaker uses (some may switch languages).
3. Identify the major themes and topics discussed in the conversation.
4. Detect garbled auto-transcription in labeled speaker segments.
5. Flag ambiguous passages where context is needed for accurate translation.

Respond with a JSON object (no markdown fencing) containing:
{
  "narrative_summary": "A 2-3 sentence summary of what this interview/conversation is about — the story, the people, the setting.",
  "themes": ["theme 1", "theme 2", "theme 3"],
  "language_map": { "Speaker Name": "Language (e.g. Mandarin Chinese, Japanese, English)" },
  "questions": [
    {
      "id": "q1",
      "segment_range": "e.g. 15-18",
      "quoted_text": "the original text that's unclear",
      "question": "your specific question to the user",
      "why": "brief explanation of why this matters for translation"
    }
  ]
}

Rules:
- Only include LABELED speakers in language_map. Never include "Speaker 1" etc.
- themes should be 3-6 short phrases capturing the major topics (e.g. "family legacy", "military history", "craft techniques").
- Only ask questions about LABELED speaker segments. Max 10 questions.
- If the transcript is clear, return an empty questions array.
- ${genericCount} of ${segments.length} segments are from unlabeled/generic speakers and should be ignored.`;

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: `Here is the full transcript (${labeled.length} labeled segments, ${genericCount} unlabeled/noise segments):\n\n${transcriptText}`,
        },
      ],
    });

    const text = message.content[0].text;

    let result;
    try {
      result = extractJSON(text);
    } catch {
      return res.status(500).json({ error: 'Failed to parse analysis response', raw: text });
    }

    // Attach generic speaker info so client can mark them
    result.generic_segments = taggedSegments
      .filter(s => s.isGeneric)
      .map(s => s.number);

    return res.status(200).json(result);
  } catch (err) {
    console.error('Analyze API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
