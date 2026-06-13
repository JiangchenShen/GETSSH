import { defineConfig } from 'vite'
import electron from 'vite-plugin-electron'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  base: './',
  build: {
    chunkSizeWarningLimit: 2000,
  },
  plugins: [
    tailwindcss(),
    react(),
    electron([
      {
        entry: 'electron/main/index.ts',
        vite: {
          build: {
            minify: true,
            rollupOptions: {
              external: ['ssh2', 'node-pty', '@lancedb/lancedb', /@lancedb\/.*/, /rust-core/],
            },
            outDir: 'dist-electron/main',
          },
        },
      },
      {
        entry: 'electron/preload/index.ts',
        onstart(options) {
          options.reload()
        },
        vite: {
          build: {
            minify: true,
            outDir: 'dist-electron/preload',
          },
        },
      },
    ]),
  ],
})
