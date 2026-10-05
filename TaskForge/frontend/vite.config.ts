import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// `strictPort` makes `npm run dev` fail loudly if 5173 is taken instead of
// silently picking another port - the backend's CORS_ORIGIN allows exactly
// http://localhost:5173, so a different port would fail every API call with
// a confusing CORS error.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
