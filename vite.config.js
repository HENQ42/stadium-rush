import { defineConfig } from 'vite';

// Em desenvolvimento (npm run dev), a sinalizacao PeerJS, o relay WebSocket e a
// lista de salas vem do servidor local (npm run server, porta 8080).
const target = process.env.LAN_SERVER || 'http://localhost:8080';

export default defineConfig({
  // No GitHub Pages o site fica em /<repo>/; o workflow define BASE_PATH.
  base: process.env.BASE_PATH || '/',
  server: {
    proxy: {
      '/api': target,
      '/peerjs': { target, ws: true },
      '/relay': { target, ws: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 1200,
  },
});
