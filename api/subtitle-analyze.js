import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { segments } = req.body;

  if (!segments || !Array.isArray(segments) || segments.length === 0) {
    return res.status(400).json({ error: 'No segments provided' });
  }

  // Build full transcript text for Claude to read as one piece
  const transcriptText = segments
    .map(s => {
      const speaker = s.speaker ? `[${s.speaker}]` : '';
      return `${s.number}. ${speaker} (${s.start} → ${s.end}): ${s.text}`;
    })
    .join('\n');

  const systemPrompt = `You are a translation analysis assistant for a video production team. You will receive a full transcript exported from Happy Scribe (an auto-transcription service). The transcript is from an interview or documentary shoot, likely containing one or more foreign languages.

Your job is to:
1. Read the ENTIRE transcript as one continuous narrative — understand the story, topics, and flow.
2. Identify which language each speaker is using (some may switch languages mid-conversation).
3. Detect passages where the auto-transcription may have garbled the text (nonsensical words, repeated fragments, etc.).
4. Flag any ambiguous passages where context is needed for accurate translation (proper nouns, local slang, cultural references, technical terms).

Respond with a JSON object (no markdown fencing) containing:
{
  "narrative_summary": "A 2-3 sentence summary of what this transcript is about — the story, the people, the themes.",
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
- If all speakers use English, say so in the language_map and note that translation may not be needed.
- Only ask questions that would genuinely affect translation quality. Do NOT ask trivial questions.
- Maximum 10 questions. Focus on the most impactful ambiguities.
- If the transcript is clear and straightforward, return an empty questions array.`;

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: `Here is the full transcript:\n\n${transcriptText}`,
        },
      ],
    });

    const text = message.content[0].text;

    // Parse JSON from Claude's response — handle possible markdown fencing
    let result;
    try {
      const cleaned = text.replace(/^```json?\n?/, '').replace(/\n?```$/, '').trim();
      result = JSON.parse(cleaned);
    } catch {
      return res.status(500).json({ error: 'Failed to parse analysis response', raw: text });
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error('Analyze API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
