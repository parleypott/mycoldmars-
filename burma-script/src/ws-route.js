// Burma Script Tool — WORKSPACE ROUTING (the ?ws= hash-query flag, pure + headless).
//
// Workspace state rides the established hash-query channel: `#<slug>?ws=<key>`
// (same posture as ?read / ?backups / ?bm= — parse BOTH location.search AND the text
// after '?' inside the hash, so standalone doors and library slugs both deep-link).
// The library's currentSlug() strips everything after '?' in the hash, so slug
// routing never sees the flag.
//
// Keys are validated against the WORKSPACE_ROLES registry plus the SCRIPT MAP view
// ('map', stage 4's non-editor view) — an unknown token in a stale URL degrades to
// "no workspace", never crashes, never trusts the URL (roles.js parseRoles doctrine).

import { WORKSPACE_ROLES } from './workspaces.js';

// Stage-4 contract: 'map' is a legal ws key that is NOT an editor workspace — it has
// no workspaceRole() entry, so the filter plugin refuses it (EMPTY) and main.jsx
// renders the map host instead of the hub. Stage 4 mounts the Script Map there.
export const WS_MAP_KEY = 'map';

export const WS_KEYS = new Set([...WORKSPACE_ROLES.map((r) => r.key), WS_MAP_KEY]);

function queryOf(hash) {
  const h = String(hash || '');
  return h.includes('?') ? h.slice(h.indexOf('?')) : '';
}

/** The validated ws key carried by the URL (search first, then hash-query), or null. */
export function parseWsFlag(search, hash) {
  for (const qs of [String(search || ''), queryOf(hash)]) {
    if (!qs) continue;
    try {
      const params = new URLSearchParams(qs.startsWith('?') ? qs.slice(1) : qs);
      const v = (params.get('ws') || '').trim().toLowerCase();
      if (v && WS_KEYS.has(v)) return v;
    } catch {}
  }
  return null;
}

/**
 * Rewrite a location HASH ('#slug?backups' / '#slug' / '') to carry ws=<key>
 * (key null = remove the flag). Every other hash-query flag is preserved; the slug
 * part is untouched. Returns '' only when there was no hash content at all and no
 * key to add. NOTE: URLSearchParams serializes a bare flag ('backups') as
 * 'backups=' — the readers ([?&]backups\b) match either form.
 */
export function setWsInHash(hash, key) {
  let h = String(hash || '');
  if (h.startsWith('#')) h = h.slice(1);
  const qi = h.indexOf('?');
  const slug = qi >= 0 ? h.slice(0, qi) : h;
  const params = new URLSearchParams(qi >= 0 ? h.slice(qi + 1) : '');
  if (key) params.set('ws', key);
  else params.delete('ws');
  const qs = params.toString();
  const out = slug + (qs ? '?' + qs : '');
  return out ? '#' + out : '';
}

/** Same rewrite for location.search ('?read&ws=broll' shapes). Returns '' or '?…'. */
export function setWsInSearch(search, key) {
  let s = String(search || '');
  if (s.startsWith('?')) s = s.slice(1);
  const params = new URLSearchParams(s);
  if (key) params.set('ws', key);
  else params.delete('ws');
  const qs = params.toString();
  return qs ? '?' + qs : '';
}
