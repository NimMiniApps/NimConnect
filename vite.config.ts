/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// GitHub Pages project site: https://nimminiapps.github.io/NimConnect/
const base = process.env.GITHUB_PAGES === 'true' ? '/NimConnect/' : '/'

export default defineConfig({
  base,
  plugins: [vue()],
  test: {
    environment: 'node',
    setupFiles: ['fake-indexeddb/auto'],
  },
})
