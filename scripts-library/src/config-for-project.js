// Row → EPISODE config. The Script Library replaces the two hand-authored episode
// constants (BURMA / PALAU) with a per-project config BUILT from an index row, so
// the SHARED engine (../../burma-script/src/main.jsx) mounts unchanged for any
// project. The engine reads everything from getEpisode(); feeding it a per-project
// config is the entire integration.
//
// Two cases:
//   • LEGACY seeded projects (row.episode === 'burma' | 'palau') → return the
//     existing BURMA / PALAU config VERBATIM, so their already-saved docs load from
//     the pinned wp01_burma_* / script_palau_* namespaces with ZERO data loss.
//   • BRAND-NEW projects (row.episode falsy) → a fresh config namespaced off the
//     row id (`script_<id>_*`), localOnly, with empty starter blocks.

import { BURMA } from '../../burma-script/config.js';
import { PALAU } from '../../palau-script/config.js';
import { PALAU2 } from '../../palau2-script/config.js';
import { generateSlug } from './slug.js';

// Favicon path that resolves correctly at runtime from /scripts-library/ (the doc
// URL the engine sets the <link rel=icon href> against). Legacy configs carry
// './favicon.svg' (Burma) which would 404 here — override to the shared asset.
const SHARED_FAVICON = '../burma-script/favicon.svg';

const LEGACY = {
  burma: BURMA,
  palau: PALAU,
  palau2: PALAU2,
};

// Sensible default genres for a NEW script — `head` feeds the chapter-reclassifier
// regex; kept small and generic. Authors reshape their doc by editing chapters, not
// config. 'other' with head:null is the required catch-all bin.
const DEFAULT_GENRES = [
  { id: 'cold_open', label: 'COLD OPEN', color: '#b0431f', head: 'COLD\\s*OPEN' },
  { id: 'history',   label: 'HISTORY',   color: '#7a5cc0', head: 'HISTORY' },
  { id: 'ground',    label: 'GROUND',    color: '#1f8a72', head: 'GROUND|GR\\s*\\d' },
  { id: 'ending',    label: 'ENDING',    color: '#2a2a28', head: 'ENDING|EPILOGUE|OUTRO' },
  { id: 'other',     label: '',          head: null },
];

/** All localStorage doc keys a config touches (for purge). */
export function storageKeysForConfig(cfg) {
  const s = (cfg && cfg.storage) || {};
  return Object.values(s).filter((v) => typeof v === 'string' && v);
}

/**
 * The IndexedDB recovery DB name the engine derives from storage.DOC. Mirrors
 * recovery-store.js deriveDbName EXACTLY so purge can delete the right DB (kept in
 * sync here rather than importing recovery-store to keep this module engine-free).
 */
export function recoveryDbNameForConfig(cfg) {
  const doc = cfg && cfg.storage && cfg.storage.DOC ? String(cfg.storage.DOC) : 'wp01_burma_doc_v1';
  if (doc === 'wp01_burma_doc_v1') return 'wp01_burma_recovery';
  return doc.replace(/_doc_v1$/, '') + '_recovery';
}

/** Build the EPISODE config the engine understands from a library index row. */
export function configForProject(row) {
  if (!row || typeof row !== 'object') {
    throw new Error('configForProject requires a project row');
  }

  // LEGACY: adopt the existing episode config + its pinned namespace verbatim.
  const legacy = row.episode && LEGACY[row.episode];
  if (legacy) {
    return { ...legacy, favicon: SHARED_FAVICON };
  }

  // BRAND-NEW: derive an isolated namespace off the row id. recovery-store derives
  // its IDB DB name from storage.DOC, so each new project gets an isolated recovery
  // DB for free.
  const id = String(row.id || 'script');
  const ns = `script_${id}`;
  const title = String(row.title || 'Untitled Script').trim() || 'Untitled Script';

  // CLOUD-BACKED (Wave 2): a new project created online has a REAL cloud project row (its id is the
  // cloud UUID), so it gets a real cloud doc on /api/script-doc?project=<id>. The engine's existing
  // cloud-sync (fetchCloud/pushDoc read config.cloud.api) then GET/PUTs against the generalized
  // endpoint automatically — no engine change. Auth is the signed-in JWT injected by gate.js's fetch
  // interceptor, so there is no per-device write token to provision (tokenHeader is inert here).
  //
  // OFFLINE FALLBACK: a project created while the API was unreachable carries a `local_`-prefixed id
  // (project-store.createProject's fallback). Its id can't resolve server-side, so we keep it
  // localOnly — the calm "ALL CHANGES SAVED" pill, no cloud/offline/conflict churn — exactly as
  // before. It stays device-local until a future re-sync gives it a cloud row.
  const isCloudBacked = !String(id).startsWith('local_');

  return {
    id,
    title,
    favicon: SHARED_FAVICON,
    wordmark: 'WP···',
    figLabel: 'fig — SCRIPT',
    recoverPrefix: `${generateSlug(title)}-recovered`,
    accent: '#1f1d18',
    days: [1, 2, 3],
    sequences: [],
    genres: DEFAULT_GENRES,
    flavors: [],
    blocksData: [], // empty starter — the engine builds an empty doc on first open
    // Cloud-backed projects get the real cloud lifecycle (SAVING / SAVED TO CLOUD / offline / conflict
    // pill states). Offline-created local projects stay calm-local.
    localOnly: !isCloudBacked,
    storage: {
      DOC: `${ns}_doc_v1`,
      DOC_VER: `${ns}_doc_ver_v1`,
      MIGRATED: `${ns}_doc_migrated_v1`,
      BLOCKS: `${ns}_blocks_v1`,
      CTRL: `${ns}_controls_v1`,
      WORKSHOP: `${ns}_workshop_v1`,
      WS_WIDTH: `${ns}_workshop_width_v1`,
      ROLES: `${ns}_roles_v1`,
      WRITE_TOKEN: `${ns}_write_token_v1`,
      DISMISSED: `${ns}_recovery_dismissed_v1`,
    },
    // Cloud-backed: the generalized per-project doc endpoint (login-gated, compare-and-swap, append-only
    // revisions). Offline-local: an inert same-origin path that 404s — the engine's offline machinery
    // handles it gracefully and localOnly suppresses the cloud-conflict UI entirely.
    cloud: {
      api: isCloudBacked
        ? `/api/script-doc?project=${encodeURIComponent(id)}`
        : '/api/__script_cloud_disabled',
      docId: id,
      tokenHeader: 'X-Script-Write-Token', // unused for new projects — auth is the JWT
    },
  };
}
