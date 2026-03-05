import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        pinglobe: resolve(__dirname, 'pinglobe/index.html'),
        theHumanElement: resolve(__dirname, 'the-human-element/index.html'),
        bedroom: resolve(__dirname, 'bedroom/index.html'),
        borderGuesser: resolve(__dirname, 'border-guesser/index.html'),
        bounce: resolve(__dirname, 'bounce/index.html'),
        flight: resolve(__dirname, 'flight/index.html'),
        newpressRobot: resolve(__dirname, 'newpress-robot/index.html'),
        board: resolve(__dirname, 'board/index.html'),
        palau: resolve(__dirname, 'palau/index.html'),
        borders: resolve(__dirname, 'borders/index.html'),
        nightMarket: resolve(__dirname, 'night-market/index.html'),
      },
    },
  },
});
