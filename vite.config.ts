/// <reference types="vitest/config" />
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import basicSsl from '@vitejs/plugin-basic-ssl'

const require = createRequire(import.meta.url)
const fakeIndexedDbAuto = require.resolve('fake-indexeddb/auto')

// GitHub Pages project site: https://nimminiapps.github.io/NimConnect/
const base = process.env.GITHUB_PAGES === 'true' ? '/NimConnect/' : '/'
const useHttps = process.env.VITE_HTTPS === 'true'
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string }

function gitCommitShort(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return 'unknown'
  }
}

export default defineConfig({
  base,
  plugins: [vue(), ...(useHttps ? [basicSsl()] : [])],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
    __GIT_COMMIT__: JSON.stringify(gitCommitShort()),
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('qr-scanner')) return 'qr'
          if (id.includes('node_modules/@nimiq/')) return 'nimiq'
          if (id.includes('node_modules/dexie')) return 'dexie'
        },
      },
    },
  },
  server: {
    host: useHttps,
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
    },
  },
  test: {
    environment: 'happy-dom',
    environmentOptions: {
      happyDOM: {
        url: 'https://nimconnect.nimiqminiapps.com/',
      },
    },
    // Absolute path keeps vitest from resolving into a parent checkout's node_modules
    // (common when this repo is opened from a git worktree nested under another clone).
    setupFiles: [fakeIndexedDbAuto],
  },
})
