/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import basicSsl from '@vitejs/plugin-basic-ssl'

// GitHub Pages project site: https://nimminiapps.github.io/NimConnect/
const base = process.env.GITHUB_PAGES === 'true' ? '/NimConnect/' : '/'
const useHttps = process.env.VITE_HTTPS === 'true'

export default defineConfig({
  base,
  plugins: [vue(), ...(useHttps ? [basicSsl()] : [])],
  server: {
    host: useHttps,
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
    },
  },
  test: {
    environment: 'node',
    setupFiles: ['fake-indexeddb/auto'],
  },
})
