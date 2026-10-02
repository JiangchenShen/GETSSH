import { defineConfig, type Plugin } from 'vite'
import electron from 'vite-plugin-electron'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Node looks up the nearest package.json of every CommonJS entry to learn its module type. The
// sandboxed plugin worker may read only its own directory, and since Node 24.21 (Electron 44) an
// unreadable parent package.json is fatal, so the worker's directory carries its own.
function workerPackageScope(): Plugin {
  return {
    name: 'getssh-worker-package-scope',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'package.json', source: '{ "type": "commonjs" }\n' })
    },
  }
}

export default defineConfig({
  base: './',
  build: {
    chunkSizeWarningLimit: 2000,
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'zustand',
      'zustand/middleware',
      'zustand/react/shallow',
      'immer',
      'framer-motion',
      'lucide-react',
      'i18next',
      'react-i18next',
      '@xterm/xterm',
      '@xterm/addon-fit',
      '@xterm/addon-webgl',
      '@xterm/addon-web-links',
      '@xterm/addon-canvas',
      '@xterm/addon-search',
    ],
  },
  plugins: [
    tailwindcss(),
    react(),
    electron([
      {
        entry: {
          index: 'electron/main/index.ts',
          'plugin-host': 'electron/main/plugin-host.ts',
          'plugin-sandbox': 'electron/main/services/plugin/PluginProcessSandbox.ts',
        },
        vite: {
          build: {
            minify: true,
            rollupOptions: {
              external: ['ssh2', 'node-pty', /rust-core/, 'better-sqlite3-multiple-ciphers'],
            },
            outDir: 'dist-electron/main',
          },
          plugins: [workerPackageScope()],
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
