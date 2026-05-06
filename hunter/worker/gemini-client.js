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
 * Run a Flash analysis pass on a corpus unit.
 * Uses cached context if available.
 * projectContext: optional string with project-level context for grounding.
 */
export async function analyzeUnit({ fileUri, startSeconds, endSeconds, cacheName, prompt, projectContext }) {
  const genai = getAI();
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  const parts = [];

  if (!cacheName) {
    parts.push({ fileData: { fileUri, mimeType: 'video/mp4' } });
  }

  const defaultPrompt = buildAnalysisPrompt(startSeconds, endSeconds, projectContext);

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
 * Build the training-mode analysis prompt.
 * Designed to produce descriptions rich enough for cross-tier comparison:
 * when raw is compared against selects and finished cuts, the AI can learn
 * WHY certain moments were kept and how they were used.
 */
function buildAnalysisPrompt(startSeconds, endSeconds, projectContext) {
  const timeContext = startSeconds != null
    ? `Focus on the segment from ${formatTime(startSeconds)} to ${formatTime(endSeconds)}.\n\n`
    : '';

  const contextBlock = projectContext
    ? `PROJECT CONTEXT:\n${projectContext}\n\n`
    : '';

  return `${contextBlock}${timeContext}You are analyzing documentary footage in TRAINING MODE. The goal is to build a detailed record of this footage so that later — when comparing raw footage against the editor's selected cuts and the final published piece — an AI can learn WHY certain moments were kept, how they were reordered, and what editorial instincts drove those decisions.

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
 * Generate an embedding for a text description.
 */
export async function generateEmbedding(text) {
  const genai = getAI();
  const result = await genai.models.embedContent({
    model: 'text-embedding-004',
    contents: [{ parts: [{ text }] }],
  });
  return result.embeddings[0].values;
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
