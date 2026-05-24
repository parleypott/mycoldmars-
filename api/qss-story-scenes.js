// queen-scarlet-school: Book View — scenes CRUD.
//
// Actions (query param action=):
//   GET  ?action=list&story_id=...        → { scenes: [...] }
//   POST ?action=vote                     → body: { scene_id, vote: up|down|null }
//   POST ?action=set-active-variation     → body: { scene_id, variation_id }
//   POST ?action=delete-variation         → body: { scene_id, variation_id }
//
// Image generation is handled by qss-scene-illustrate.
// Scene detection is handled by qss-scene-detect.

import { checkAccess } from './_lib/access.js';

export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.QSS_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.QSS_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY || '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-access-code',
};

function j(status, payload) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
}

async function sb(method, path, body) {
  const headers = {
    apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json', Prefer: 'return=representation',
  };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`supabase_${res.status}: ${t.slice(0, 200)}`);
  }
  return res.headers.get('content-type')?.includes('application/json') ? res.json() : null;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const denied = await checkAccess(req);
  if (denied) {
    const h = new Headers(denied.headers);
    for (const [k, v] of Object.entries(CORS)) h.set(k, v);
    return new Response(denied.body, { status: denied.status, headers: h });
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) return j(500, { error: 'no_db' });

  const url = new URL(req.url);
  const action = url.searchParams.get('action') || (req.method === 'GET' ? 'list' : '');

  try {
    if (req.method === 'GET' && action === 'list') {
      const storyId = url.searchParams.get('story_id') || '';
      if (!storyId) return j(400, { error: 'no_story_id' });
      const rows = await sb('GET', `qss_story_scenes?story_id=eq.${encodeURIComponent(storyId)}&order=scene_index.asc&select=*`);
      return j(200, { scenes: rows || [] });
    }

    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));

      if (action === 'vote') {
        const sceneId = String(body?.scene_id || '').trim();
        if (!sceneId) return j(400, { error: 'no_scene_id' });
        const voteIn = String(body?.vote || '').toLowerCase();
        const vote = (voteIn === 'up' || voteIn === 'down') ? voteIn : null;
        const reason = String(body?.reason || '').slice(0, 400) || null;
        await sb('PATCH', `qss_story_scenes?id=eq.${encodeURIComponent(sceneId)}`, {
          vote, vote_reason: reason, updated_at: new Date().toISOString(),
        });
        return j(200, { ok: true });
      }

      if (action === 'set-active-variation') {
        const sceneId = String(body?.scene_id || '').trim();
        const varId = String(body?.variation_id || '').trim();
        if (!sceneId || !varId) return j(400, { error: 'need_scene_id_and_variation_id' });
        // Find the variation, swap it into the primary slot (image_url +
        // storage_path) so list responses serve it directly.
        const rows = await sb('GET', `qss_story_scenes?id=eq.${encodeURIComponent(sceneId)}&select=variations,image_url,storage_path,active_variation_id&limit=1`);
        const scene = rows?.[0];
        if (!scene) return j(404, { error: 'scene_not_found' });
        const variations = Array.isArray(scene.variations) ? scene.variations : [];
        const target = variations.find(v => v?.id === varId);
        if (!target) return j(404, { error: 'variation_not_found' });
        // Keep the OLD primary in variations[] so Henry can flip back.
        let nextVariations = variations.filter(v => v?.id !== varId);
        if (scene.image_url && scene.active_variation_id) {
          nextVariations.push({
            id: scene.active_variation_id,
            image_url: scene.image_url,
            storage_path: scene.storage_path,
            generated_at: Date.now(),
          });
        }
        await sb('PATCH', `qss_story_scenes?id=eq.${encodeURIComponent(sceneId)}`, {
          image_url: target.image_url,
          storage_path: target.storage_path || null,
          active_variation_id: varId,
          variations: nextVariations,
          updated_at: new Date().toISOString(),
        });
        return j(200, { ok: true, active_variation_id: varId, image_url: target.image_url });
      }

      if (action === 'delete-variation') {
        const sceneId = String(body?.scene_id || '').trim();
        const varId = String(body?.variation_id || '').trim();
        if (!sceneId || !varId) return j(400, { error: 'need_scene_id_and_variation_id' });
        const rows = await sb('GET', `qss_story_scenes?id=eq.${encodeURIComponent(sceneId)}&select=variations&limit=1`);
        const scene = rows?.[0];
        if (!scene) return j(404, { error: 'scene_not_found' });
        const variations = (Array.isArray(scene.variations) ? scene.variations : []).filter(v => v?.id !== varId);
        await sb('PATCH', `qss_story_scenes?id=eq.${encodeURIComponent(sceneId)}`, {
          variations, updated_at: new Date().toISOString(),
        });
        return j(200, { ok: true });
      }

      if (action === 'delete-scene') {
        const sceneId = String(body?.scene_id || '').trim();
        if (!sceneId) return j(400, { error: 'no_scene_id' });
        await sb('DELETE', `qss_story_scenes?id=eq.${encodeURIComponent(sceneId)}`);
        return j(200, { ok: true });
      }

      return j(400, { error: 'bad_action' });
    }

    return j(405, { error: 'method_not_allowed' });
  } catch (e) {
    console.error('[qss-story-scenes]', e);
    return j(500, { error: 'internal', detail: (e?.message || String(e)).slice(0, 300) });
  }
}
