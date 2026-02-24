import { defineConfig, configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    exclude: ['e2e/**', ...configDefaults.exclude],
    coverage: {
      provider: 'v8',
      exclude: ['e2e/**', ...configDefaults.exclude],
      thresholds: {
        statements: 51,
        branches: 65,
        functions: 44,
        lines: 51,
      },
    },
  },
  resolve: {
    // Help Vite resolve packages from the monorepo root node_modules
    preserveSymlinks: true,
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
    include: ['mp4-muxer'],
  },
})
