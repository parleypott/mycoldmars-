// The Hunter — client-side scene detection (temporal grouping of corpus units).
//
// Camera files encode their shoot wall-clock in the filename
// (YYYYMMDD-HHMM). We group clips shot close together in time into "scenes"
// and label each scene with the day + time it was shot.
//
// TIMEZONE CONTRACT (load-bearing): the timestamp in a clip name is the
// camera's LOCAL wall-clock at the shoot. The scene day/time labels must
// read back that SAME wall-clock, regardless of the machine running the app.
// So we construct the Date in UTC (Date.UTC) and read it back with
// toISOString() — a lossless round-trip of the encoded wall-clock. Building
// the Date in machine-local time (new Date(y,m,d,...)) and then formatting
// with toISOString() (UTC) shifts every label by the runner's offset — a
// late-evening clip lands on the wrong DAY on a non-UTC machine. The gap
// math is unaffected either way (all timestamps shift uniformly), so only
// the labels — and the per-day grouping that depends on them — care.

export const SCENE_TEMPORAL_GAP_MINUTES = 10;

export function extractDateFromClipName(name) {
  const m = name?.match(/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/);
  if (!m) return null;
  // UTC-construct so toISOString() round-trips the filename's wall-clock
  // identically on any machine (see TIMEZONE CONTRACT above).
  return new Date(Date.UTC(
    parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]),
    parseInt(m[4]), parseInt(m[5])
  ));
}

export function extractCameraId(name) {
  const m = name?.match(/C(\d+)/);
  return m ? 'C' + m[1] : null;
}

export function groupIntoScenes(units) {
  // Parse timestamps and sort
  const timed = units
    .map(u => ({
      ...u,
      timestamp: extractDateFromClipName(u.source_clip_name || u.sourceClipName),
      cameraId: extractCameraId(u.source_clip_name || u.sourceClipName),
    }))
    .filter(u => u.timestamp)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (!timed.length) return [];

  // Temporal grouping
  const scenes = [];
  let current = [timed[0]];

  for (let i = 1; i < timed.length; i++) {
    const gap = (timed[i].timestamp - current[current.length - 1].timestamp) / (1000 * 60);
    if (gap <= SCENE_TEMPORAL_GAP_MINUTES) {
      current.push(timed[i]);
    } else {
      scenes.push(current);
      current = [timed[i]];
    }
  }
  if (current.length) scenes.push(current);

  // Build scene objects with metadata enrichment
  return scenes.map(clips => {
    const start = clips[0].timestamp;
    const day = start.toISOString().slice(0, 10);
    const time = start.toISOString().slice(11, 16);
    const cameras = [...new Set(clips.map(c => c.cameraId).filter(Boolean))];
    const firstAnalysis = clips.find(c => c.analyses?.[0]?.output_text)?.analyses[0].output_text || '';

    // Aggregate structured metadata across all clips in the scene
    const emotions = {};
    const shotTypes = {};
    let keepSum = 0, keepN = 0;
    for (const c of clips) {
      const j = c.analyses?.[0]?.output_json;
      if (!j) continue;
      if (j.emotional_register) emotions[j.emotional_register] = (emotions[j.emotional_register] || 0) + 1;
      if (j.shot_type) shotTypes[j.shot_type] = (shotTypes[j.shot_type] || 0) + 1;
      if (j.keepability_score != null) { keepSum += j.keepability_score; keepN++; }
    }

    const topEmotion = Object.entries(emotions).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    const topShot = Object.entries(shotTypes).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    const avgKeep = keepN > 0 ? (keepSum / keepN) : null;

    // Extract a usable label — skip markdown headers/preamble, find actual content
    let label = '';
    if (firstAnalysis) {
      // Strip markdown formatting and headers
      const cleaned = firstAnalysis
        .replace(/^#+\s+.*/gm, '')           // remove ## headers
        .replace(/\*\*[^*]*\*\*:?\s*/g, '')   // remove **bold labels**:
        .replace(/\*[^*]*\*\s*/g, '')         // remove *italic*
        .replace(/^(Here'?s|This|The (video|shot|scene|clip) (opens|begins|starts|shows|is))[^.]*\.\s*/i, '') // skip generic openers
        .trim();
      // Grab first real sentence
      const sentences = cleaned.split(/(?<=[.!?])\s+/).filter(s => s.length > 15);
      label = (sentences[0] || cleaned.slice(0, 70)).slice(0, 70);
      // If still looks like a label/header, bail
      if (/^(what|how|why|analysis|description|shot|physical)/i.test(label)) label = '';
    }
    if (!label && topEmotion) label = `${topEmotion} · ${topShot || 'mixed'}`;
    if (!label) label = `Scene at ${time}`;

    const totalDuration = clips.reduce((sum, c) => {
      const dur = (c.end_seconds || 0) - (c.start_seconds || 0);
      return sum + (dur > 0 ? dur : 0);
    }, 0);

    return { clips, day, time, cameras: cameras.slice(0, 3), label, firstAnalysis, totalDuration, topEmotion, topShot, avgKeep };
  });
}
