/**
 * Gemini API client for Hunter's worker process.
 * Uses the Google GenAI SDK for File API, caching, and generation.
 */

import { GoogleGenAI } from '@google/genai';

let ai = null;

function getAI() {
  if (!ai) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error('GEMINI_API_KEY not set');
    ai = new GoogleGenAI({ apiKey: key });
  }
  return ai;
}

/**
 * Upload a file to Gemini File API.
 * Returns the file metadata including URI for use in prompts.
 */
export async function uploadFile(filePath, mimeType = 'video/mp4') {
  const { readFileSync } = await import('node:fs');
  const { basename } = await import('node:path');

  const genai = getAI();
  const name = basename(filePath);

  console.log(`[gemini] uploading ${name}...`);
  const result = await genai.files.upload({
    file: filePath,
    config: { mimeType, displayName: name },
  });

  // Wait for processing
  let file = result;
  while (file.state === 'PROCESSING') {
    console.log(`[gemini] waiting for ${name} to process...`);
    await new Promise(r => setTimeout(r, 5000));
    file = await genai.files.get({ name: file.name });
  }

  if (file.state === 'FAILED') {
    throw new Error(`File processing failed: ${file.name}`);
  }

  console.log(`[gemini] ${name} ready: ${file.uri}`);
  return file;
}

/**
 * Delete a file from Gemini File API to free storage quota.
 * Call after analysis is complete — files are only needed during generation.
 */
export async function deleteFile(fileName) {
  try {
    const genai = getAI();
    await genai.files.delete({ name: fileName });
  } catch (err) {
    // Non-fatal — file may already be expired
    console.log(`[gemini] delete ${fileName}: ${err.message?.slice(0, 60)}`);
  }
}

/**
 * Delete ALL files in the project to reclaim storage quota.
 */
export async function purgeAllFiles() {
  const genai = getAI();
  let deleted = 0;
  try {
    const files = await genai.files.list();
    for await (const file of files) {
      await genai.files.delete({ name: file.name });
      deleted++;
    }
  } catch (err) {
    console.log(`[gemini] purge error after ${deleted} files: ${err.message?.slice(0, 60)}`);
  }
  return deleted;
}

/**
 * Create a context cache for a file (cost savings for multiple queries).
 */
export async function createCache(fileUri, systemInstruction, ttlSeconds = 3600) {
  const genai = getAI();
  const cache = await genai.caches.create({
    model: 'gemini-2.5-flash',
    config: {
      contents: [{
        role: 'user',
        parts: [{ fileData: { fileUri, mimeType: 'video/mp4' } }],
      }],
      systemInstruction: systemInstruction || 'You are a video analysis assistant for a documentary filmmaker.',
      ttl: `${ttlSeconds}s`,
    },
  });
  console.log(`[gemini] cache created: ${cache.name}, expires in ${ttlSeconds}s`);
  return cache;
}

/**
 * Transcribe a video file using Flash (cheap, fast).
 * Returns a transcript string that can be fed into the analysis prompt
 * as a grounding anchor to improve visual description quality.
 */
export async function transcribeVideo({ fileUri }) {
  const genai = getAI();
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  const result = await genai.models.generateContent({
    model,
    contents: [{
      role: 'user',
      parts: [
        { fileData: { fileUri, mimeType: 'video/mp4' } },
        { text: `Transcribe all spoken dialogue in this video. Include timestamps in MM:SS format. If multiple speakers, label them (Speaker 1, Speaker 2, etc.). If there is no dialogue, write "NO DIALOGUE" and briefly describe the ambient audio (wind, traffic, music, silence, etc.). Be accurate and concise.` },
      ],
    }],
    config: {
      mediaResolution: 'MEDIA_RESOLUTION_LOW',
    },
  });

  return result.text;
}

/**
 * Run a Flash analysis pass on a corpus unit.
 * Uses cached context if available.
 * projectContext: optional string with project-level context for grounding.
 * transcript: optional pre-generated transcript for grounding.
 */
export async function analyzeUnit({ fileUri, startSeconds, endSeconds, cacheName, prompt, projectContext, transcript, tasteContext }) {
  const genai = getAI();
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  const parts = [];

  if (!cacheName) {
    parts.push({ fileData: { fileUri, mimeType: 'video/mp4' } });
  }

  const defaultPrompt = buildAnalysisPrompt(startSeconds, endSeconds, projectContext, transcript, tasteContext);

  parts.push({ text: prompt || defaultPrompt });

  const config = {
    model,
    contents: [{ role: 'user', parts }],
  };

  if (cacheName) {
    config.cachedContent = cacheName;
  }

  const result = await genai.models.generateContent(config);
  return {
    text: result.text,
    usage: result.usageMetadata,
  };
}

/**
 * Run a structured analysis pass that returns JSON.
 * Builds on the narrative analysis but produces machine-readable output
 * for cross-tier comparison.
 */
export async function analyzeUnitStructured({ fileUri, startSeconds, endSeconds, projectContext, transcript, tasteContext }) {
  const genai = getAI();
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  const contextBlock = projectContext ? `PROJECT CONTEXT:\n${projectContext}\n\n` : '';
  const transcriptBlock = transcript ? `TRANSCRIPT (pre-generated):\n${transcript}\n\n` : '';
  const tasteBlock = tasteContext ? `EDITORIAL TASTE PROFILE:\n${tasteContext}\n\nUse this taste profile to calibrate your keepability scoring. This editor's actual preferences may differ from generic film conventions.\n\n` : '';
  const timeContext = startSeconds != null
    ? `Focus on the segment from ${formatTime(startSeconds)} to ${formatTime(endSeconds)}.\n\n`
    : '';

  const prompt = `${contextBlock}${transcriptBlock}${tasteBlock}${timeContext}Analyze this documentary footage and return a JSON object with the following fields:

{
  "transcript_summary": "Brief summary of dialogue/audio (2-3 sentences max)",
  "visual_description": "Detailed description of what's physically happening, setting, subjects, objects (3-5 sentences)",
  "subjects": [{"description": "person description", "action": "what they're doing", "emotion": "emotional state"}],
  "shot_type": "one of: wide|medium|close-up|extreme-close-up|aerial|pov|handheld|locked-off|tracking|pan|tilt",
  "camera_movement": "one of: static|pan-left|pan-right|tilt-up|tilt-down|dolly|handheld|crane|aerial|rack-focus|zoom",
  "lighting": "one of: natural-daylight|golden-hour|overcast|interior-natural|interior-artificial|mixed|low-key|high-key|silhouette",
  "audio_quality": "one of: clean-dialogue|noisy-dialogue|ambient-only|music|silence|unusable",
  "emotional_register": "the honest energy: tension|wonder|intimacy|awkwardness|joy|loneliness|boredom|revelation|contemplation|urgency|humor|gravity",
  "editorial_function": "one of: establishing|transitional|climactic|intimate|expository|comedic|contemplative|action|reaction|cutaway",
  "keepability_score": 0.0-1.0,
  "keepability_reason": "Why this would or wouldn't survive an edit (1-2 sentences)",
  "unique_identifiers": ["specific visual/audio details that make this moment findable across tiers"]
}

Return ONLY valid JSON, no markdown formatting.`;

  const result = await genai.models.generateContent({
    model,
    contents: [{
      role: 'user',
      parts: [
        { fileData: { fileUri, mimeType: 'video/mp4' } },
        { text: prompt },
      ],
    }],
    config: {
      responseMimeType: 'application/json',
    },
  });

  try {
    return JSON.parse(result.text);
  } catch {
    // If JSON parsing fails, return the raw text wrapped
    return { raw_text: result.text, parse_error: true };
  }
}

/**
 * Build the training-mode analysis prompt.
 * Designed to produce descriptions rich enough for cross-tier comparison:
 * when raw is compared against selects and finished cuts, the AI can learn
 * WHY certain moments were kept and how they were used.
 */
function buildAnalysisPrompt(startSeconds, endSeconds, projectContext, transcript, tasteContext) {
  const timeContext = startSeconds != null
    ? `Focus on the segment from ${formatTime(startSeconds)} to ${formatTime(endSeconds)}.\n\n`
    : '';

  const contextBlock = projectContext
    ? `PROJECT CONTEXT:\n${projectContext}\n\n`
    : '';

  const transcriptBlock = transcript
    ? `TRANSCRIPT (pre-generated — use as grounding for your visual analysis):\n${transcript}\n\n`
    : '';

  const tasteBlock = tasteContext
    ? `EDITORIAL TASTE PROFILE:\n${tasteContext}\n\nUse this taste profile to inform your assessment of what makes footage keepable or expendable for THIS filmmaker.\n\n`
    : '';

  return `${contextBlock}${transcriptBlock}${tasteBlock}${timeContext}You are analyzing documentary footage in TRAINING MODE. The goal is to build a detailed record of this footage so that later — when comparing raw footage against the editor's selected cuts and the final published piece — an AI can learn WHY certain moments were kept, how they were reordered, and what editorial instincts drove those decisions.

Describe this moment with enough specificity to uniquely identify it across edit tiers. Cover:

- **What is physically happening**: Action, setting, subjects, objects. Be concrete — "a man in a white thobe gestures toward a construction crane" not "a person near a building."
- **Composition & camera craft**: Movement, framing, lens feel, lighting, depth of field. What would a cinematographer notice about this shot?
- **Who is present**: Describe every person visible. Body language, emotional state, what they're doing. If the filmmaker is on camera, note it explicitly.
- **Audio**: Dialogue (paraphrase key lines), ambient sound, music, silence. Note whether audio is clean and usable.
- **Emotional register**: The honest energy of the moment — tension, wonder, intimacy, awkwardness, joy, loneliness, boredom, revelation. Don't flatter; name the actual feeling.
- **Editorial potential**: How might this function in a cut? Establishing, transitional, climactic, intimate, expository, comedic, contemplative? Could it open or close a scene?
- **What makes this keepable or expendable**: If an editor had 1000 clips and needed 100, why would this one survive — or why wouldn't it?

Write naturally and specifically. Avoid generic descriptions. Name what you actually see.`;
}

/**
 * Run a Pro synthesis pass — the "what do you see?" query.
 * Takes all analyses for a project and surfaces patterns.
 */
export async function synthesizePatterns(analysisTexts) {
  const genai = getAI();

  const corpus = analysisTexts.map((a, i) =>
    `[Unit ${i + 1}]\n${a}`
  ).join('\n\n---\n\n');

  const result = await genai.models.generateContent({
    model: 'gemini-2.5-pro',
    contents: [{
      role: 'user',
      parts: [{
        text: `You are a perceptive documentary editor's assistant. Below is a corpus of shot-by-shot analysis from a filmmaker's footage archive.

Read the entire corpus carefully. Then write 5-8 prose observations about RECURRING PATTERNS you notice across the footage. Each observation should:

1. Name a specific pattern (visual motif, compositional habit, emotional rhythm, subject behavior, etc.)
2. Cite 2-4 specific units by number that exemplify it
3. Explain WHY this pattern is editorially interesting — what does it reveal about the filmmaker's instincts, or what storytelling opportunity does it create?

Write as a thoughtful collaborator, not a database. Use editorial language. Be specific. Surprise the filmmaker with things they might not have consciously noticed about their own work.

Format each observation as a separate paragraph. Start each with a bold pattern name.

CORPUS:
${corpus}`
      }],
    }],
    config: {
      maxOutputTokens: 4000,
    },
  });

  return result.text;
}

/**
 * Analyze a script section in training mode.
 * Captures editorial intent so it can be compared against footage analysis.
 */
export async function analyzeScript({ text, sectionTitle, projectContext }) {
  const genai = getAI();
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  const contextBlock = projectContext
    ? `PROJECT CONTEXT:\n${projectContext}\n\n`
    : '';

  const prompt = `${contextBlock}You are analyzing a documentary filmmaker's SCRIPT in TRAINING MODE. This script represents the filmmaker's original editorial intent — what they planned to say, show, and convey before entering the edit room.

This is a TWO-COLUMN SCRIPT format used by documentary filmmakers. The original document has two columns side-by-side — one for VOICE (narration, voiceover, dialogue, interview SOTs) and one for VISUAL (shot descriptions, camera directions, what should be on screen).

In this text, paired cells from the table are marked as:
- "COL_A:" and "COL_B:" — these represent the two columns of a single script beat
- "---BEAT---" separates each row/beat
- Determine which column is voice and which is visual BY READING THE CONTENT — one column will contain narration/dialogue, the other will contain shot descriptions and camera instructions
- When both appear together, the filmmaker intended that voice and visual to play SIMULTANEOUSLY
- Non-prefixed lines are headings, notes, production metadata, or content that wasn't in the table

The goal is to build a detailed record so that later — when comparing against raw footage, selected cuts, and the finished piece — an AI can learn HOW editorial intent translates into footage selection, what gets kept vs. cut, and where the final story diverges from or fulfills the original vision.

${sectionTitle ? `SECTION: "${sectionTitle}"\n\n` : ''}SCRIPT TEXT:
${text}

Analyze this section. Cover:

- **Story beat**: What narrative function does this section serve? (setup, conflict, revelation, transition, climax, resolution, aside, context-setting)
- **Voice/visual pairing**: For each beat, what is the relationship between what's being SAID and what's being SHOWN? Is the visual illustrating the voice literally, counterpointing it, or adding subtext?
- **Intended footage**: What specific footage would this require? Interview clips, B-roll type, establishing shots, archival, graphics, animations. Note when the visual column names specific shots or files.
- **Emotional register**: What feeling is the filmmaker trying to create? (wonder, tension, intimacy, humor, gravity, urgency)
- **Pacing signals**: How does the density of voice/visual pairs signal the intended rhythm? Rapid cuts? Lingering shots? Voice-heavy exposition vs. visual-driven moments?
- **Edit room prediction**: When this section meets the raw footage, what's likely to survive intact, what will be rewritten in the edit, and what might be cut entirely? Which visual directions are specific enough to match real footage vs. aspirational?

Write naturally and specifically. This analysis will be compared against footage-level analysis to understand the gap between script intent and editorial reality.`;

  const result = await genai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
  });

  return {
    text: result.text,
    usage: result.usageMetadata,
  };
}

/**
 * Analyze a rich script section with full formatting awareness.
 * Uses the parsed document structure with colors, bold/italic, table beats.
 */
export async function analyzeScriptRich({ beats, annotatedText, sectionTitle, projectContext, scriptContext, colorProfile }) {
  const genai = getAI();
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  const contextBlock = projectContext ? `PROJECT CONTEXT:\n${projectContext}\n\n` : '';
  const scriptContextBlock = scriptContext ? `SCRIPT TRAINING CONTEXT (learned from this filmmaker's scripts):\n${scriptContext}\n\n` : '';

  const colorBlock = colorProfile && Object.keys(colorProfile).length > 0
    ? `COLOR PROFILE (observed highlight colors in this document):\n${Object.entries(colorProfile).map(([color, data]) => `  ${color}: ${data.count} occurrences. Samples: ${data.sampleTexts.slice(0, 3).map(s => `"${s}"`).join(', ')}`).join('\n')}\n\n`
    : '';

  const prompt = `${contextBlock}${scriptContextBlock}${colorBlock}You are analyzing a documentary filmmaker's SCRIPT with FULL FORMATTING AWARENESS. Unlike plain text analysis, you can see:
- Highlight colors (e.g., [PURPLE: ...], [RED: ...]) — these encode editorial meaning
- Bold/italic formatting — structural emphasis signals
- Voice/visual column pairing — what's being SAID alongside what should be SHOWN

This is a TWO-COLUMN SCRIPT. Each "BEAT" pairs:
- VOICE: narration, voiceover, dialogue, interview SOTs
- VISUAL: shot descriptions, camera directions, what should be on screen

Formatting annotations appear inline:
- [PURPLE: text] — purple-highlighted text
- [RED: text] — red-highlighted text
- [BOLD: text] — bold text
- Other colors appear by name or hex code

${sectionTitle ? `SECTION: "${sectionTitle}"\n\n` : ''}ANNOTATED SCRIPT:
${annotatedText}

Analyze this section. Cover:

- **Story beat**: Narrative function (setup, conflict, revelation, transition, climax, resolution, aside)
- **Voice/visual pairing**: For each beat, relationship between SAID and SHOWN (literal illustration, counterpoint, subtext, complementary)
- **Color-coded elements**: What's highlighted and why? What editorial signal do the colors carry? List all colored items with their likely purpose
- **Animation requirements**: Any elements marked for animation — what's needed? Complexity? Style? Dependencies on other assets?
- **Archive/stock needs**: Any elements marked for archive footage — what's needed? Source suggestions? Rights considerations?
- **Intended footage**: What specific footage would this require? Interview clips, B-roll, establishing shots, archival, graphics
- **Emotional register**: What feeling is the filmmaker creating? (wonder, tension, intimacy, humor, gravity, urgency)
- **Pacing signals**: Beat density, voice/visual ratio, rhythm indicators
- **Edit room prediction**: What survives intact vs. gets rewritten in the edit?

Write naturally and specifically. This analysis grounds all future script intelligence.`;

  const result = await genai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
  });

  return {
    text: result.text,
    usage: result.usageMetadata,
    structured: null, // future: parse structured items from response
  };
}

// ── Intelligence Pass Functions ──

/**
 * Animation Audit pass — identifies all animation cues from a script snapshot.
 * Uses learned color conventions + explicit visual column references.
 */
export async function animationAudit({ annotatedText, scriptContext, colorProfile }) {
  const genai = getAI();
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  const contextBlock = scriptContext ? `SCRIPT CONTEXT (learned from training):\n${scriptContext}\n\n` : '';
  const colorBlock = colorProfile ? `COLOR PROFILE:\n${JSON.stringify(colorProfile, null, 2)}\n\n` : '';

  const prompt = `${contextBlock}${colorBlock}You are auditing a documentary script for ANIMATION REQUIREMENTS. Using the color coding and visual column descriptions, identify every element that requires animation or motion graphics.

SCRIPT:
${annotatedText}

Return JSON:
{
  "animation_items": [
    {
      "beat_context": "Which section/beat this appears in",
      "description": "What needs to be animated",
      "source_text": "The exact text from the script",
      "complexity": "simple|moderate|complex|hero",
      "estimated_hours": number,
      "style_notes": "Inferred style based on context (2D, 3D, data viz, map, diagram, etc.)",
      "dependencies": ["Any assets, data, or approvals needed"],
      "priority": "essential|important|nice-to-have"
    }
  ],
  "summary": {
    "total_items": number,
    "total_estimated_hours": number,
    "complexity_breakdown": { "simple": n, "moderate": n, "complex": n, "hero": n },
    "style_recommendations": "Overall animation style suggestions based on the script's tone"
  }
}

Be thorough — catch animated maps, data visualizations, text treatments, motion graphics, illustrated sequences, and anything that isn't live-action footage. Return ONLY valid JSON.`;

  const result = await genai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: { responseMimeType: 'application/json', maxOutputTokens: 8000 },
  });

  try { return JSON.parse(result.text); }
  catch { return { raw_text: result.text, parse_error: true }; }
}

/**
 * Archive Audit pass — identifies all archive/stock footage requests.
 */
export async function archiveAudit({ annotatedText, scriptContext, colorProfile }) {
  const genai = getAI();
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  const contextBlock = scriptContext ? `SCRIPT CONTEXT:\n${scriptContext}\n\n` : '';
  const colorBlock = colorProfile ? `COLOR PROFILE:\n${JSON.stringify(colorProfile, null, 2)}\n\n` : '';

  const prompt = `${contextBlock}${colorBlock}You are auditing a documentary script for ARCHIVE AND STOCK FOOTAGE REQUIREMENTS. Identify every element that requires archival footage, stock footage, historical imagery, or pre-existing media.

SCRIPT:
${annotatedText}

Return JSON:
{
  "archive_items": [
    {
      "beat_context": "Section/beat reference",
      "description": "What archive/stock footage is needed",
      "source_text": "Exact text from the script",
      "type": "archive|stock|historical|news|photo|document|map",
      "era": "Time period if applicable",
      "search_terms": ["Suggested search queries for finding this"],
      "source_suggestions": ["Potential archives, stock libraries, or sources"],
      "rights_notes": "Licensing considerations (public domain, editorial use, etc.)",
      "priority": "essential|important|nice-to-have"
    }
  ],
  "summary": {
    "total_items": number,
    "type_breakdown": {},
    "major_research_tasks": ["Top 3-5 items requiring significant research effort"]
  }
}

Return ONLY valid JSON.`;

  const result = await genai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: { responseMimeType: 'application/json', maxOutputTokens: 8000 },
  });

  try { return JSON.parse(result.text); }
  catch { return { raw_text: result.text, parse_error: true }; }
}

/**
 * Fact-Check pass — identifies factual claims and verifies them.
 */
export async function factCheck({ annotatedText, scriptContext }) {
  const genai = getAI();
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  const contextBlock = scriptContext ? `SCRIPT CONTEXT:\n${scriptContext}\n\n` : '';

  const prompt = `${contextBlock}You are fact-checking a documentary script. Identify every factual claim — dates, statistics, historical events, scientific claims, geographic facts, named individuals and their roles, cause-and-effect assertions.

SCRIPT:
${annotatedText}

Return JSON:
{
  "claims": [
    {
      "claim_text": "The exact factual claim from the script",
      "beat_context": "Section/beat reference",
      "category": "date|statistic|historical|scientific|geographic|biographical|causal",
      "status": "verified|likely_correct|needs_verification|likely_incorrect|incorrect",
      "verification_notes": "What you know about this claim's accuracy",
      "correction": "If incorrect, the correct information (or null)",
      "source_needed": true/false,
      "suggested_sources": ["Where to verify this"]
    }
  ],
  "summary": {
    "total_claims": number,
    "verified": number,
    "needs_verification": number,
    "flagged": number,
    "high_priority_checks": ["Top claims that absolutely must be verified before broadcast"]
  }
}

Be honest about uncertainty. If you're not sure, mark as needs_verification. Return ONLY valid JSON.`;

  const result = await genai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: { responseMimeType: 'application/json', maxOutputTokens: 8000 },
  });

  try { return JSON.parse(result.text); }
  catch { return { raw_text: result.text, parse_error: true }; }
}

/**
 * Pacing Analysis pass — word counts, timing estimates, density analysis.
 * Mostly computational with some LLM insight.
 */
export async function pacingAnalysis({ parsedDoc, annotatedText }) {
  const genai = getAI();
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  const prompt = `You are analyzing the PACING of a documentary script. This is both a computational and editorial analysis.

Assumptions:
- Voice narration: ~150 words per minute
- Typical visual beat: 5-10 seconds screen time
- Interview SOT: variable, estimate from word count at 120 wpm

SCRIPT:
${annotatedText}

Return JSON:
{
  "sections": [
    {
      "title": "Section name",
      "beat_count": number,
      "voice_word_count": number,
      "visual_word_count": number,
      "estimated_duration_seconds": number,
      "voice_density": "voice-heavy|balanced|visual-heavy|rapid-fire|sparse",
      "pacing_notes": "1-2 sentences on the rhythm of this section"
    }
  ],
  "overall": {
    "total_beats": number,
    "total_voice_words": number,
    "total_visual_words": number,
    "estimated_total_minutes": number,
    "voice_visual_ratio": number,
    "pacing_curve": "Description of how pacing changes across the script — where it's dense, where it breathes",
    "bloat_warnings": ["Sections that seem overlong or could be tightened"],
    "thin_spots": ["Sections that may need more material"],
    "recommended_cuts": ["Specific suggestions for tightening"]
  }
}

Return ONLY valid JSON.`;

  const result = await genai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: { responseMimeType: 'application/json', maxOutputTokens: 6000 },
  });

  try { return JSON.parse(result.text); }
  catch { return { raw_text: result.text, parse_error: true }; }
}

/**
 * Coherence Check pass — analyzes voice/visual relationship for each beat.
 */
export async function coherenceCheck({ annotatedText, scriptContext }) {
  const genai = getAI();
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  const contextBlock = scriptContext ? `SCRIPT CONTEXT:\n${scriptContext}\n\n` : '';

  const prompt = `${contextBlock}You are checking VOICE/VISUAL COHERENCE in a documentary script. For each beat (voice + visual pair), analyze the relationship.

SCRIPT:
${annotatedText}

Return JSON:
{
  "beats": [
    {
      "beat_index": number,
      "voice_summary": "Brief summary of voice content",
      "visual_summary": "Brief summary of visual content",
      "relationship": "illustration|counterpoint|complementary|disconnected|missing_pair",
      "coherence_score": 0.0-1.0,
      "notes": "Explanation of the voice/visual relationship"
    }
  ],
  "summary": {
    "total_beats": number,
    "coherent_beats": number,
    "disconnected_beats": number,
    "missing_pairs": number,
    "strongest_pairings": ["2-3 beats where voice/visual work together brilliantly"],
    "weakest_pairings": ["2-3 beats where voice/visual are disconnected or contradictory"],
    "overall_assessment": "2-3 sentences on the script's voice/visual strategy"
  }
}

Return ONLY valid JSON.`;

  const result = await genai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: { responseMimeType: 'application/json', maxOutputTokens: 8000 },
  });

  try { return JSON.parse(result.text); }
  catch { return { raw_text: result.text, parse_error: true }; }
}

/**
 * Generate an embedding for a text description.
 */
export async function generateEmbedding(text) {
  const genai = getAI();
  const result = await genai.models.embedContent({
    model: 'gemini-embedding-001',
    contents: [{ parts: [{ text }] }],
    config: { outputDimensionality: 768 },
  });
  return result.embeddings[0].values;
}

/**
 * Synthesize a single scene from its constituent clip analyses.
 * Model: Flash — each scene is ~30 clips × 270 tokens = ~8K input.
 */
export async function synthesizeScene({ clipAnalyses, clipNames, sceneContext }) {
  const genai = getAI();
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  const corpus = clipAnalyses.map((text, i) =>
    `[Clip ${i + 1}: ${clipNames[i] || 'unknown'}]\n${text}`
  ).join('\n\n---\n\n');

  const contextBlock = sceneContext ? `SCENE CONTEXT:\n${sceneContext}\n\n` : '';

  const prompt = `${contextBlock}You are a working documentary editor reviewing footage from one shooting session. Below are ${clipAnalyses.length} clip analyses. Be direct and specific — describe what was actually shot, not what it could symbolize.

Synthesize into a JSON object:

{
  "name": "Short, descriptive scene name based on what actually happens (e.g. 'Coffee ceremony with host family', 'Driving through NEOM construction zone', 'Johnny standup at the Red Sea')",
  "scene_type": "one of: interview|broll|establishing|transition|action|ceremony|conversation|observational|travel|meal|work|performance",
  "arc_summary": "2-3 paragraphs. What was shot, who appears, what happens, what's the strongest material. Write like log notes for an editor who hasn't seen the footage.",
  "emotional_curve": "One sentence: how the energy shifts across the scene",
  "editorial_notes": "2-3 sentences of blunt editorial assessment. Is this scene essential? What's the best moment? What's filler?",
  "location": "Where this takes place — be specific if the clips tell you",
  "time_of_day": "dawn|morning|midday|afternoon|golden-hour|evening|night",
  "subjects": ["people who appear — use names when available, otherwise brief descriptions"],
  "hero_clips": ["clip names with the strongest material — what you'd build the scene around"],
  "supporting_clips": ["clip names that provide coverage or context"],
  "cutaway_clips": ["clip names useful as cutaways or inserts"],
  "connections": "How this scene might connect to other parts of the project",
  "keepability": 0.0-1.0
}

Return ONLY valid JSON.

CLIPS:
${corpus}`;

  const result = await genai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: { responseMimeType: 'application/json', maxOutputTokens: 8000 },
  });

  try {
    return JSON.parse(result.text);
  } catch {
    return { raw_text: result.text, parse_error: true };
  }
}

/**
 * Synthesize a day's worth of scenes into a day-level narrative.
 * Model: Flash — ~10 scene summaries × 500 tokens = ~5K input.
 */
export async function synthesizeDay({ sceneSummaries, dayLabel, projectContext }) {
  const genai = getAI();
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  const contextBlock = projectContext ? `PROJECT CONTEXT:\n${projectContext}\n\n` : '';

  const corpus = sceneSummaries.map((s, i) =>
    `[Scene ${i + 1}: ${s.name || 'Untitled'}]\nType: ${s.scene_type || '?'} | Location: ${s.location || '?'} | Time: ${s.time_of_day || '?'}\nKeepability: ${s.keepability ?? '?'}\n\n${s.arc_summary || ''}\n\nEmotional curve: ${s.emotional_curve || ''}\nEditorial notes: ${s.editorial_notes || ''}`
  ).join('\n\n---\n\n');

  const prompt = `${contextBlock}You are a working documentary editor reviewing a full shooting day. Be factual and specific about what was actually captured.

DAY: ${dayLabel}
${sceneSummaries.length} scenes captured this day.

${corpus}

Summarize this shooting day for an editor. Return JSON:

{
  "day_narrative": "2-3 paragraphs. What locations were visited, who was filmed, what happened, what's the strongest footage. Write like production notes — factual, useful, grounded in what was actually shot.",
  "dominant_themes": ["3-5 topics or subjects covered this day"],
  "emotional_arc": "One sentence: how the day's energy and content shifted",
  "strongest_scene": "Name of the best scene and why — be specific about what makes the footage strong",
  "weakest_scene": "Name of the weakest scene and why",
  "day_character": "One sentence summary of what this day was about (e.g. 'First day in Jeddah — old town walkthrough and initial interviews')"
}

Return ONLY valid JSON.`;

  const result = await genai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: { responseMimeType: 'application/json', maxOutputTokens: 4000 },
  });

  try {
    return JSON.parse(result.text);
  } catch {
    return { raw_text: result.text, parse_error: true };
  }
}

/**
 * Synthesize the entire project from day-level summaries.
 * Model: Pro — the one big token spend (~16K input).
 */
export async function synthesizeProject({ daySummaries, projectName, stats }) {
  const genai = getAI();

  const corpus = daySummaries.map((d, i) =>
    `[Day ${i + 1}: ${d.dayLabel || '?'}]\nCharacter: ${d.day_character || ''}\nEmotional arc: ${d.emotional_arc || ''}\nStrongest scene: ${d.strongest_scene || ''}\nThemes: ${(d.dominant_themes || []).join(', ')}\n\n${d.day_narrative || ''}`
  ).join('\n\n---\n\n');

  const statsBlock = stats
    ? `\nSTATS: ${stats.totalClips || 0} clips, ${stats.totalScenes || 0} scenes, ${stats.totalDays || 0} shooting days, ${stats.totalDuration || '?'} total footage\n`
    : '';

  const prompt = `You are a senior documentary editor reviewing all the footage from this project. Summarize what was shot and what's there to work with. Be direct, specific, and grounded in the actual footage — not poetic.

PROJECT: "${projectName || 'Untitled'}"${statsBlock}

${corpus}

Return JSON:

{
  "title": "A clear working title that reflects what the project is actually about",
  "lede": "One sentence summary of the project — what's the story, who's involved, where does it take place",
  "master_arc": "4-6 paragraphs describing what was shot across the whole project. Go chronologically — what happened each day, how the story evolved, what subjects emerged, what locations were covered. Write like production notes for an editor inheriting this project.",
  "themes": [{"name": "theme name", "description": "1-2 sentences on how this theme shows up in the footage"}],
  "subject_arcs": [{"name": "person/subject", "arc": "Where and how this person appears across the shoot"}],
  "editorial_recommendations": ["3-5 specific editorial suggestions — sequences to build, scenes that pair well, footage gaps, strongest material to lead with"],
  "project_context_string": "3-4 paragraphs for use as context in future clip analysis. Cover: key subjects and their roles, locations visited, the project's story and themes, the filmmaker's shooting patterns. Help future analysis understand where each clip fits."
}

Return ONLY valid JSON.`;

  const result = await genai.models.generateContent({
    model: 'gemini-2.5-pro',
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: { responseMimeType: 'application/json', maxOutputTokens: 8000 },
  });

  try {
    return JSON.parse(result.text);
  } catch {
    return { raw_text: result.text, parse_error: true };
  }
}

/**
 * Extract and consolidate subjects from a batch of clip analyses.
 * Model: Flash — processes in batches of 200 clips.
 */
export async function extractSubjectsFromAnalyses(clipAnalyses) {
  const genai = getAI();
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  const corpus = clipAnalyses.map((a, i) => {
    const subjects = a.output_json?.subjects || [];
    const visual = a.output_json?.visual_description || '';
    const subjectStr = subjects.map(s => `${s.description || ''} — ${s.action || ''} (${s.emotion || ''})`).join('; ');
    return `[Clip ${i + 1}: ${a.clipName || 'unknown'}]\nSubjects: ${subjectStr || 'none detected'}\nVisual: ${visual}`;
  }).join('\n\n');

  const prompt = `You are analyzing documentary footage to build a comprehensive SUBJECT DATABASE. Below are subject descriptions and visual descriptions from ${clipAnalyses.length} clips.

Your job: identify every distinct PERSON who appears and consolidate all references to the same person under one canonical name. Be aggressive about merging — "the filmmaker", "Johnny", "a man with a camera", "the narrator" are likely the same person. "A local guide", "Mohammed", "the man in the white thobe" might also be the same person if descriptions match.

Return JSON:

{
  "subjects": [
    {
      "canonical_name": "The most specific name available (real name > role > description)",
      "description": "2-3 sentences: who this person is, how they typically appear, their role in the footage",
      "aliases": ["all other ways this person is referred to across clips"],
      "clip_appearances": [clip numbers where this person appears],
      "confidence": 0.0-1.0
    }
  ]
}

Err on the side of merging. It's better to have 15 well-consolidated subjects than 80 fragments. Return ONLY valid JSON.

CLIPS:
${corpus}`;

  const result = await genai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: { responseMimeType: 'application/json', maxOutputTokens: 4000 },
  });

  try {
    return JSON.parse(result.text);
  } catch {
    return { subjects: [], parse_error: true };
  }
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
