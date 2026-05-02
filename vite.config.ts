import { defineConfig } from 'vite'
import electron from 'vite-plugin-electron'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  build: {
    minify: 'esbuild',
    chunkSizeWarningLimit: 2000,
  },
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main/index.ts',
        vite: {
          build: {
            minify: true,
            rollupOptions: {
              external: ['ssh2'],
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
