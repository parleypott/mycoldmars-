import { resolve } from 'path';
import { defineConfig, loadEnv } from 'vite';

// PROD-WRITE GUARD (2026-07-08 data-loss audit, rank 5): local dev proxies /api to a target that
// DEFAULTS to production, so a localhost cloud-sync PUT silently overwrites the prod database — an
// independent clobber channel beside the collab room. This pure predicate says whether a given
// request must be refused: a data-mutating method to a script-doc/script-projects endpoint whose
// proxy target is a production host, unless MCM_ALLOW_PROD_WRITES=1 is set. GET always passes (the
// ?read share + normal reads need it). Exported for the unit test.
const PROD_API_HOSTS = ['mycoldmars.vercel.app', 'mycoldmars.com', 'newpress.press'];
const MUTATING_METHODS = new Set(['PUT', 'POST', 'DELETE', 'PATCH']);
const MUTATING_API = /^\/api\/(script-doc|script-projects)\b/;
export function shouldBlockProdWrite({ method, path, target, allow }) {
  if (allow === '1' || allow === true) return false;
  if (!MUTATING_METHODS.has(String(method || '').toUpperCase())) return false;
  if (!MUTATING_API.test(String(path || '').split('?')[0])) return false;
  const t = String(target || '');
  return PROD_API_HOSTS.some((h) => t.includes(h));
}

// Dev-only middleware that enforces the predicate BEFORE vite's proxy forwards the write.
function blockProdApiWritesPlugin(target) {
  return {
    name: 'block-prod-api-writes',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api', (req, res, next) => {
        if (shouldBlockProdWrite({ method: req.method, path: req.originalUrl || req.url, target, allow: process.env.MCM_ALLOW_PROD_WRITES })) {
          // eslint-disable-next-line no-console
          console.warn(`[guardrail] BLOCKED ${req.method} ${req.url} → PRODUCTION (${target}). Set MCM_DEV_API to a preview, or MCM_ALLOW_PROD_WRITES=1 to override.`);
          res.statusCode = 403;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: { code: 'PROD_WRITE_BLOCKED', message: 'local dev refuses a write to a PRODUCTION /api data endpoint (2026-07-08 guardrail)' } }));
          return;
        }
        next();
      });
    },
  };
}

// LOCAL LIVEBLOCKS AUTH (collab Phase 1) — dev-only middleware that serves POST
// /api/liveblocks-auth from the LOCAL handler (api/liveblocks-auth.js) instead of proxying it.
// Two reasons: (a) the proxy target may not have the endpoint deployed yet, and (b) the token
// mint needs LIVEBLOCKS_SECRET_KEY from .env.local, which should be exercised locally, not via a
// remote deployment's env. configureServer middlewares run BEFORE vite's internal proxy, so this
// wins for exactly this one path; every other /api/* call proxies exactly as before. Registered
// only when a secret is present — without one, dev behaves as it always did (the path proxies).
function localLiveblocksAuthPlugin(env) {
  return {
    name: 'local-liveblocks-auth',
    apply: 'serve',
    configureServer(server) {
      if (!env.LIVEBLOCKS_SECRET_KEY) return;
      server.middlewares.use('/api/liveblocks-auth', (req, res) => {
        (async () => {
          // Surface .env.local vars to the handler (edge handlers read process.env at request time).
          for (const k of [
            'LIVEBLOCKS_SECRET_KEY', 'ACCESS_CODE',
            'SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
            'SUPABASE_ANON_KEY', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY',
          ]) {
            if (env[k] && !process.env[k]) process.env[k] = env[k];
          }
          const chunks = [];
          for await (const c of req) chunks.push(c);
          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers)) {
            if (typeof v === 'string') headers.set(k, v);
            else if (Array.isArray(v)) headers.set(k, v.join(', '));
          }
          const { default: handler } = await import('./api/liveblocks-auth.js');
          const request = new Request('http://localhost' + (req.originalUrl || req.url || '/'), {
            method: req.method,
            headers,
            body: (req.method === 'GET' || req.method === 'HEAD') ? undefined : Buffer.concat(chunks),
            duplex: 'half',
          });
          const response = await handler(request);
          res.statusCode = response.status;
          response.headers.forEach((v, k) => res.setHeader(k, v));
          res.end(await response.text());
        })().catch((e) => {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: { code: 'DEV_AUTH', message: String((e && e.message) || e) } }));
        });
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // .env.local (gitignored) carries the Liveblocks keys; loadEnv with the '' prefix exposes the
  // non-VITE_ vars to the dev middleware above. Vite still only ships VITE_* vars to the client.
  const env = loadEnv(mode, __dirname, '');
  const apiTarget = process.env.MCM_DEV_API || 'https://mycoldmars.vercel.app';
  return {
  plugins: [localLiveblocksAuthPlugin(env), blockProdApiWritesPlugin(apiTarget)],
  // COLLAB ENV (2026-07-08 data-loss guardrail): inject VERCEL_ENV so collab.js can namespace the
  // Liveblocks room by environment (prod → `script-burma`, preview → `-preview`, dev → `-development`).
  // Keyed on VERCEL_ENV, NOT import.meta.env.PROD (which is true for preview builds too). Unset on
  // localhost `vite dev` → 'development', so a dev build can never name the production room.
  define: {
    'import.meta.env.VITE_COLLAB_ENV': JSON.stringify(process.env.VERCEL_ENV || 'development'),
  },
  // Local dev proxies /api to the URL in MCM_DEV_API. Defaults to the
  // prod Vercel deployment so existing workflows keep working, but
  // setting MCM_DEV_API=https://preview-branch.vercel.app in .env.local
  // points local dev at a preview branch — without that, every local
  // /api/claude / /api/transcribe call burns real prod-account tokens.
  server: {
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        secure: true,
      },
    },
  },
  esbuild: {
    jsxFactory: 'h',
    jsxFragment: 'Fragment',
    jsxInject: `import { h, Fragment } from 'preact'`,
    // PERF-5 — ACTUALLY strip dev-only diagnostics from production bundles. This is the REAL vite
    // esbuild hook (the old `build.esbuildOptions` below was not a vite key and was silently
    // ignored — only `debugger` was ever "configured", and even that didn't take effect). `drop`
    // removes debugger statements; `pure` marks the console methods side-effect-free so minify
    // tree-shakes their calls out. console.warn / console.error deliberately SURVIVE so real
    // failures still surface; only log/info/debug/trace (the hot-path + startup noise in
    // cloud-sync/main) are stripped, so app internals don't leak to anyone with DevTools open.
    drop: ['debugger'],
    pure: ['console.log', 'console.info', 'console.debug', 'console.trace'],
  },
  resolve: {
    alias: {
      'react': 'preact/compat',
      'react-dom': 'preact/compat',
      'react-dom/client': 'preact/compat',
      'react/jsx-runtime': 'preact/jsx-runtime',
    },
  },
  build: {
    // Dev-console/debugger stripping is configured in the top-level `esbuild` block above (the real
    // vite hook). The previous `esbuildOptions` key here was not a recognised vite option and never
    // took effect — see PERF-5.
    rollupOptions: {
      output: {
        // Code-split the heavy editor/AI/Supabase chunks out of the
        // translation entry bundle. The gate (sign-in form) doesn't
        // need any of these — splitting them defers ~500KB of parse
        // cost until AFTER the user has signed in. Big TTI win on
        // mobile / cold cache.
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          // linkifyjs is a dependency of @tiptap/extension-link (a StarterKit member → editor-vendor).
          // It MUST be pinned to editor-vendor and MUST be matched BEFORE the collab rule below.
          // ROOT CAUSE of the prod-only "Cannot access 'Pi' before initialization" (TDZ) crash:
          // the collab rule's `id.includes('yjs')` is a naive substring test, and the string
          // "linkif·yjs" ends in "yjs" — so linkifyjs was being swept into collab-vendor. That made
          // editor-vendor import linkifyjs FROM collab-vendor, while collab-vendor already imports
          // PluginKey (prosemirror-state, in editor-vendor) and calls `new PluginKey('y-sync')` at
          // module top-level. Two chunks importing each other can't be init-ordered, so collab-vendor
          // ran before editor-vendor finished defining PluginKey (minified `Pi`) → TDZ → blank page.
          // Dev masked it (unminified, no forced chunk split). Pinning linkifyjs here + scoping the
          // yjs match to a path boundary (below) removes the back-edge: collab-vendor → editor-vendor
          // is now one-directional, so editor-vendor always initializes first.
          if (/[\\/]linkifyjs?[\\/]/.test(id)) return 'editor-vendor';
          // COLLAB — keep the realtime stack OUT of editor-vendor (which every script session
          // loads). These packages are only reachable through the dynamically-imported
          // collab-runtime chunk, so grouping them here means a non-collab session never fetches
          // a byte of yjs/liveblocks. MUST come before the '@tiptap' catch-all below, or
          // @tiptap/y-tiptap + the collaboration extensions would leak into editor-vendor.
          // NOTE: yjs / y-protocols / y-tiptap are matched with path-boundary regexes (not bare
          // substrings) so a package like linkifyjs that merely CONTAINS "yjs" is never captured.
          if (
            /[\\/]y-tiptap[\\/]/.test(id) || /[\\/]yjs[\\/]/.test(id) || id.includes('@liveblocks') ||
            id.includes('extension-collaboration') || /[\\/]y-protocols[\\/]/.test(id) ||
            /[\\/]lib0[\\/]/.test(id)
          ) return 'collab-vendor';
          if (id.includes('@tiptap') || id.includes('prosemirror')) return 'editor-vendor';
          if (id.includes('wavesurfer')) return 'wavesurfer';
          if (id.includes('@supabase/supabase-js')) return 'supabase';
          if (id.includes('@anthropic-ai') || id.includes('@google/genai')) return 'ai-sdk';
          if (id.includes('tus-js-client')) return 'tus';
          if (id.includes('preact')) return 'preact';
        },
      },
      input: {
        main: resolve(__dirname, 'index.html'),
        pinglobe: resolve(__dirname, 'pinglobe/index.html'),
        mapkeys: resolve(__dirname, 'mapkeys/index.html'),
        animatedcrazy: resolve(__dirname, 'animatedcrazy/index.html'),

        bedroom: resolve(__dirname, 'bedroom/index.html'),
        borderGuesser: resolve(__dirname, 'border-guesser/index.html'),
        bounce: resolve(__dirname, 'bounce/index.html'),
        flight: resolve(__dirname, 'flight/index.html'),
        newpressRobot: resolve(__dirname, 'newpress-robot/index.html'),
        palau: resolve(__dirname, 'palau/index.html'),
        borders: resolve(__dirname, 'borders/index.html'),
        nightMarket: resolve(__dirname, 'night-market/index.html'),
        newpressDeck: resolve(__dirname, 'newpress-deck/index.html'),
        commentbank: resolve(__dirname, 'commentbank/index.html'),
        pinglobeFeedback: resolve(__dirname, 'pinglobe-feedback/index.html'),
        zanyplans: resolve(__dirname, 'zanyplans/index.html'),
        spin: resolve(__dirname, 'spin/index.html'),
        hakka: resolve(__dirname, 'hakka/index.html'),
        essays: resolve(__dirname, 'essays/index.html'),
        eez: resolve(__dirname, 'eez/index.html'),
        modernMiddleEast: resolve(__dirname, 'modern-middle-east/index.html'),
        flyingMoney: resolve(__dirname, 'flyingmoney/index.html'),
        fascism: resolve(__dirname, 'fascism/index.html'),
        growth: resolve(__dirname, 'growth/index.html'),
        viewsGrowth: resolve(__dirname, 'views-growth/index.html'),
        translation: resolve(__dirname, 'translation/index.html'),
        hunter: resolve(__dirname, 'hunter/index.html'),
        cutter: resolve(__dirname, 'cutter/index.html'),
        queenScarletSchool: resolve(__dirname, 'queen-scarlet-school/index.html'),
        queenScarletSchoolLibrary: resolve(__dirname, 'queen-scarlet-school/library/index.html'),
        queenScarletSchoolCast: resolve(__dirname, 'queen-scarlet-school/cast/index.html'),
        queenScarletSchoolUniverse: resolve(__dirname, 'queen-scarlet-school/universe/index.html'),
        queenScarletSchoolExplore: resolve(__dirname, 'queen-scarlet-school/explore/index.html'),
        queenScarletSchoolStyle: resolve(__dirname, 'queen-scarlet-school/style/index.html'),
        democracy: resolve(__dirname, 'democracy/index.html'),
        democracyMap: resolve(__dirname, 'democracy/map/index.html'),
        trippy: resolve(__dirname, 'trippy/index.html'),
        taiwan: resolve(__dirname, 'taiwan/index.html'),
        taiwanChart: resolve(__dirname, 'taiwan-chart/index.html'),
        research: resolve(__dirname, 'research/index.html'),
        memory: resolve(__dirname, 'memory/index.html'),
        falling: resolve(__dirname, 'falling/index.html'),
        laserspace: resolve(__dirname, 'laserspace/index.html'),
        prawn: resolve(__dirname, 'prawn/index.html'),
        burmaScript: resolve(__dirname, 'burma-script/index.html'),
        palauScript: resolve(__dirname, 'palau-script/index.html'),
        palau2Script: resolve(__dirname, 'palau2-script/index.html'),
        scriptsLibrary: resolve(__dirname, 'scripts-library/index.html'),
      },
    },
  },
  };
});
