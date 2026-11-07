import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const GIF_DIR = fileURLToPath(new URL('./public/weapons/gifs/', import.meta.url));

/** Só em dev: recebe os GIFs da página tools/gifs.html e grava em public/. */
function saveGifPlugin(): Plugin {
  return {
    name: 'save-weapon-gifs',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__tools/save-gif', (req, res) => {
        const id = new URL(req.url ?? '', 'http://x').searchParams.get('id') ?? '';
        if (req.method !== 'POST' || !/^[a-z0-9_]+$/.test(id)) {
          res.statusCode = 400;
          res.end('id inválido');
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          mkdirSync(GIF_DIR, { recursive: true });
          writeFileSync(`${GIF_DIR}${id}.gif`, Buffer.concat(chunks));
          res.end('ok');
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [saveGifPlugin()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
