import { checkAccess } from './_lib/access.js';

export const config = { runtime: 'edge', maxDuration: 20 };

const SUPABASE_URL = process.env.QSS_SUPABASE_URL || process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.QSS_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-access-code',
};

/**
 * Aggregated patterns of Henry's storytelling. Reads qss_observations and
 * computes:
 *   - block_count, distinct_characters, distinct_settings
 *   - character_frequency (across all blocks)
 *   - setting_frequency
 *   - escalation_curve (per block, in order)
 *   - fixation_streaks (longest same-character / same-setting run)
 *   - vibe_pick_frequency (which direction tags Henry picks)
 *   - vibe_reject_frequency (which directions he passes on)
 *   - block_origin (option vs direction vs own_block)
 *   - timeline (events per day)
 *
 * GET /api/qss-report
 *   ?story_id=<uuid>        only this story
 *   ?story_name=<name>      filter by name when id isn't known
 *   ?since=<ISO>            time-bound the window (default: all-time)
 *
 * No id/name → returns global aggregates across every story.
 */
export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: CORS });

  const denied = await checkAccess(req);
  if (denied) return withCors(denied);

  if (!SUPABASE_URL || !SUPABASE_KEY) return json(503, { error: 'NO_DB' });

  const url = new URL(req.url);
  const storyId = url.searchParams.get('story_id');
  const storyName = url.searchParams.get('story_name');
  const since = url.searchParams.get('since');

  const params = new URLSearchParams();
  params.set('select', 'event,payload,signals,story_id,story_name,created_at');
  params.set('order', 'created_at.asc');
  params.set('limit', '5000');
  if (storyId) params.append('story_id', `eq.${storyId}`);
  if (storyName) params.append('story_name', `eq.${storyName}`);
  if (since) params.append('created_at', `gte.${since}`);

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/qss_observations?${params}`, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    });
    if (!res.ok) {
      const txt = await res.text();
      if (/PGRST205|Could not find the table/.test(txt)) {
        return json(503, { error: 'MIGRATION_PENDING' });
      }
      return json(502, { error: 'DB', detail: txt.slice(0, 200) });
    }
    const rows = await res.json();
    return json(200, summarize(rows));
  } catch (e) {
    return json(500, { error: 'INTERNAL', message: e.message });
  }
}

export function summarize(rows) {
  const blockEvents = rows.filter(r => ['block_added', 'own_block_added'].includes(r.event));
  const directionPicks = rows.filter(r => r.event === 'direction_picked');
  const directionRejects = rows.filter(r => r.event === 'direction_rejected');
  const optionRejects = rows.filter(r => r.event === 'option_rejected' || r.event === 'options_rejected_all');

  // Character frequency across all block_added blocks
  const charFreq = {};
  const settingFreq = {};
  const vibeFreq = {};
  const vibeRejFreq = {};
  let totalWords = 0, totalSentences = 0, totalEscalation = 0;
  const escalationCurve = [];
  const originCounts = { option: 0, direction: 0, kid: 0, opening: 0 };

  for (const r of blockEvents) {
    const sig = r.signals || {};
    for (const c of (sig.characters || [])) charFreq[c] = (charFreq[c] || 0) + 1;
    for (const st of (sig.settings || [])) settingFreq[st] = (settingFreq[st] || 0) + 1;
    totalWords += sig.words || 0;
    totalSentences += sig.sentences || 0;
    totalEscalation += sig.escalation || 0;
    escalationCurve.push({ t: r.created_at, score: sig.escalation || 0 });
    const origin = sig.origin || 'option';
    originCounts[origin] = (originCounts[origin] || 0) + 1;
  }

  for (const r of directionPicks) {
    const vibe = (r.signals?.vibe || r.payload?.vibe || '').toLowerCase();
    if (vibe) vibeFreq[vibe] = (vibeFreq[vibe] || 0) + 1;
  }
  for (const r of directionRejects) {
    const vibe = (r.signals?.vibe || r.payload?.vibe || '').toLowerCase();
    if (vibe) vibeRejFreq[vibe] = (vibeRejFreq[vibe] || 0) + 1;
  }

  // Longest same-character run across the BLOCK event timeline
  let longestCharStreak = 0, currentCharStreak = 0, currentChar = null;
  for (const r of blockEvents) {
    const chars = r.signals?.characters || [];
    const main = chars[0] || null;
    if (main && main === currentChar) {
      currentCharStreak++;
    } else {
      currentChar = main;
      currentCharStreak = main ? 1 : 0;
    }
    if (currentCharStreak > longestCharStreak) longestCharStreak = currentCharStreak;
  }

  // Longest same-setting run
  let longestSettingStreak = 0, currentSettingStreak = 0, currentSetting = null;
  for (const r of blockEvents) {
    const s = (r.signals?.settings || [])[0] || null;
    if (s && s === currentSetting) currentSettingStreak++;
    else { currentSetting = s; currentSettingStreak = s ? 1 : 0; }
    if (currentSettingStreak > longestSettingStreak) longestSettingStreak = currentSettingStreak;
  }

  // Timeline by day
  const byDay = {};
  for (const r of rows) {
    const d = (r.created_at || '').slice(0, 10);
    if (!d) continue;
    byDay[d] = (byDay[d] || 0) + 1;
  }

  // Stories touched
  const stories = {};
  for (const r of rows) {
    if (r.story_name) stories[r.story_name] = (stories[r.story_name] || 0) + 1;
  }

  const blocks = blockEvents.length;
  return {
    totals: {
      events: rows.length,
      blocks,
      direction_picks: directionPicks.length,
      direction_rejects: directionRejects.length,
      option_rejects: optionRejects.length,
      stories_touched: Object.keys(stories).length,
    },
    averages: {
      words_per_block: blocks ? Math.round(totalWords / blocks) : 0,
      sentences_per_block: blocks ? +(totalSentences / blocks).toFixed(1) : 0,
      escalation_per_block: blocks ? +(totalEscalation / blocks).toFixed(2) : 0,
    },
    character_frequency: topN(charFreq, 20),
    setting_frequency: topN(settingFreq, 20),
    vibe_pick_frequency: topN(vibeFreq, 20),
    vibe_reject_frequency: topN(vibeRejFreq, 20),
    block_origin: originCounts,
    fixation: {
      longest_same_character_streak: longestCharStreak,
      longest_same_setting_streak: longestSettingStreak,
    },
    escalation_curve: escalationCurve,
    by_day: byDay,
    stories,
    distinct: {
      characters: Object.keys(charFreq).length,
      settings: Object.keys(settingFreq).length,
      vibes_picked: Object.keys(vibeFreq).length,
    },
  };
}

export function topN(obj, n) {
  return Object.entries(obj)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => ({ key: k, count: v }));
}

function withCors(res) {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) h.set(k, v);
  return new Response(res.body, { status: res.status, headers: h });
}
function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
