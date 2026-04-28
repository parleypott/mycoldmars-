import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
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
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        pinglobe: resolve(__dirname, 'pinglobe/index.html'),

        bedroom: resolve(__dirname, 'bedroom/index.html'),
        borderGuesser: resolve(__dirname, 'border-guesser/index.html'),
        bounce: resolve(__dirname, 'bounce/index.html'),
        flight: resolve(__dirname, 'flight/index.html'),
        newpressRobot: resolve(__dirname, 'newpress-robot/index.html'),
        board: resolve(__dirname, 'board/index.html'),
        palau: resolve(__dirname, 'palau/index.html'),
        borders: resolve(__dirname, 'borders/index.html'),
        nightMarket: resolve(__dirname, 'night-market/index.html'),
        newpressDeckArchive1: resolve(__dirname, 'newpress-deck-ARCHIVE1/index.html'),
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
      },
    },
  },
});
