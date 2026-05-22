import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  // Local dev proxies /api to the URL in MCM_DEV_API. Defaults to the
  // prod Vercel deployment so existing workflows keep working, but
  // setting MCM_DEV_API=https://preview-branch.vercel.app in .env.local
  // points local dev at a preview branch — without that, every local
  // /api/claude / /api/transcribe call burns real prod-account tokens.
  server: {
    proxy: {
      '/api': {
        target: process.env.MCM_DEV_API || 'https://mycoldmars.vercel.app',
        changeOrigin: true,
        secure: true,
      },
    },
  },
  esbuild: {
    jsxFactory: 'h',
    jsxFragment: 'Fragment',
    jsxInject: `import { h, Fragment } from 'preact'`,
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
    // Strip dev-only console + debugger calls from production bundles.
    // Editorial app — diagnostic noise that survives to prod just adds
    // overhead and leaks app internals to anyone with DevTools open.
    // Console.warn and console.error survive so real failures still
    // surface; only `log/debug/info/trace` are stripped.
    esbuildOptions: { drop: ['debugger'] },
    rollupOptions: {
      output: {
        // Code-split the heavy editor/AI/Supabase chunks out of the
        // translation entry bundle. The gate (sign-in form) doesn't
        // need any of these — splitting them defers ~500KB of parse
        // cost until AFTER the user has signed in. Big TTI win on
        // mobile / cold cache.
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
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
        board: resolve(__dirname, 'board/index.html'),
        palau: resolve(__dirname, 'palau/index.html'),
        borders: resolve(__dirname, 'borders/index.html'),
        nightMarket: resolve(__dirname, 'night-market/index.html'),
        newpressDeck: resolve(__dirname, 'newpress-deck/index.html'),
        commentbank: resolve(__dirname, 'commentbank/index.html'),
        pinglobeFeedback: resolve(__dirname, 'pinglobe-feedback/index.html'),
        zanyplans: resolve(__dirname, 'zanyplans/index.html'),
        spin: resolve(__dirname, 'spin/index.html'),
        hakka: resolve(__dirname, 'hakka/index.html'),
        animation: resolve(__dirname, 'animation/index.html'),
        essays: resolve(__dirname, 'essays/index.html'),
        eez: resolve(__dirname, 'eez/index.html'),
        modernMiddleEast: resolve(__dirname, 'modern-middle-east/index.html'),
        flyingMoney: resolve(__dirname, 'flyingmoney/index.html'),
        fascism: resolve(__dirname, 'fascism/index.html'),
        growth: resolve(__dirname, 'growth/index.html'),
        viewsGrowth: resolve(__dirname, 'views-growth/index.html'),
        translation: resolve(__dirname, 'translation/index.html'),
        hunter: resolve(__dirname, 'hunter/index.html'),
        queenScarletSchool: resolve(__dirname, 'queen-scarlet-school/index.html'),
        queenScarletSchoolLibrary: resolve(__dirname, 'queen-scarlet-school/library/index.html'),
        queenScarletSchoolCast: resolve(__dirname, 'queen-scarlet-school/cast/index.html'),
        democracy: resolve(__dirname, 'democracy/index.html'),
        trippy: resolve(__dirname, 'trippy/index.html'),
        taiwan: resolve(__dirname, 'taiwan/index.html'),
        todo: resolve(__dirname, 'todo/index.html'),
        research: resolve(__dirname, 'research/index.html'),
        memory: resolve(__dirname, 'memory/index.html'),
      },
    },
  },
});
