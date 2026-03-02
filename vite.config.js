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
      },
    },
  },
});
