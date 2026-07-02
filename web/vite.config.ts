import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // .env lives at the repo root so the seed script and the app share one file.
  envDir: '..',
  build: {
    chunkSizeWarningLimit: 1200,
  },
});
