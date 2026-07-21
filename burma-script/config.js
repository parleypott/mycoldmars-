import scriptData from './sample-blocks.json';
import { DAY_SEQUENCES } from './schema.ts';

export const BURMA = {
  id: 'burma',
  title: scriptData.title || 'Burma — The Human Element',
  favicon: './favicon.svg',
  wordmark: 'WP·01',
  figLabel: 'fig.03 — CARTRIDGE RACK',
  recoverPrefix: 'burma-recovered',
  accent: '#ff5b1f',
  days: [1, 2, 3],
  sequences: DAY_SEQUENCES,
  genres: [
    { id: 'coldopen', label: 'HISTORY', head: 'COLD\\s*OPEN' },
    { id: 'history', label: 'HISTORY', head: 'HISTORY' },
    { id: 'ground', label: 'GROUND', head: 'GROUND' },
    { id: 'inquiry', label: 'GROUND', head: 'INQUIRY' },
    { id: 'latm', label: 'GROUND', head: 'LATM' },
    { id: 'other', label: '', head: null },
  ],
  flavors: [],
  // Engine feature flags (read via episodeFlag in episode-config.js). Burma adopts the SAFE visual
  // dials of the shared doctrine: chipChrome hides the REC pill + VO/DIRECTION labels and gives the
  // calm chip / gridline / split-row treatment; chapterFrames gives the light book-header chapters;
  // Burma is fully on Palau's doctrine now: presentation + interaction dials all on. LEFT OFF:
  // sequencePicker (swaps Burma's DAY 1/2/3 tagging for Palau's sequence model — a workflow/content
  // change, Burma is organized by shoot day) and every DATA-touching flag (palauTimecodes,
  // inlineSotName, normalizeTableRows, rebuildFromSourceWhenPristine), which would reinterpret
  // Burma's already-saved doc — gated on an explicit content-migration decision, not style.
  features: {
    chipChrome: true, chapterFrames: true, dayFold: true,
    rowDragReorder: true, convertMenu: true, archiveOwnLine: true,
    // timecodeChips: PRESENTATION only — a typed/pasted timecode self-chips + the right-click
    // retro-convert for dead codes. This is NOT the data-touching `palauTimecodes` (which stays
    // OFF for Burma, gated in document-builder): chip rendering never reinterprets the saved doc,
    // and the RED "DAY ?" nag stays tied to palauTimecodes (main.jsx [data-daytc]), so Burma's
    // chips read as quiet brackets. Fixes "day-timecodes don't render into tags" on Burma.
    timecodeChips: true,
    // COLLAB (Phase 1) — real-time co-editing via Liveblocks + Yjs (room `script-burma`). NOT a
    // data-touching flag: the saved doc's shape/content is untouched (spike-proven lossless
    // round-trip); it only changes WHO can hold the pen at once. The save engine stays as the
    // local durability + cloud version-history snapshot layer. Verified live 2026-07-06 with a
    // two-browser concurrent-edit test before this flag was enabled.
    collab: true, // real-time co-editing via Liveblocks + Yjs (room `script-burma`)
  },
  blocksData: scriptData.blocks || [],
  storage: {
    DOC: 'wp01_burma_doc_v1',
    DOC_VER: 'wp01_burma_doc_ver_v1',
    MIGRATED: 'wp01_burma_doc_migrated_v2',
    BLOCKS: 'wp01_burma_blocks_v1',
    CTRL: 'wp01.controls.v1',
    WORKSHOP: 'wp01_burma_workshop_v1',
    WS_WIDTH: 'wp01_burma_workshop_width_v1',
    ROLES: 'wp01_burma_roles_v1',
    WRITE_TOKEN: 'wp01_burma_write_token_v1',
    DISMISSED: 'wp01.recovery.dismissed.v1',
  },
  cloud: {
    // CUT OVER to the generalized, login-gated per-project endpoint (Enterprise Wave 2). The new
    // public.script_docs row for project 'burma' was re-synced byte-identical to the legacy
    // burma_script_docs row at cutover (228 nodes, same version). The LEGACY endpoint + row are
    // kept as a permanent untouched fallback — revert is a one-line change back to
    // '/api/burma-script-doc'. Auth is now the signed-in JWT (no write token needed).
    api: '/api/script-doc?project=burma',
    docId: 'wp01-burma',
    tokenHeader: 'X-Burma-Write-Token',
    // Workshop {TK}/fact-check endpoint. The engine falls back to '/api/burma-tk' when an
    // episode omits this, but Burma pins it explicitly.
    tkApi: '/api/burma-tk',
  },
};
