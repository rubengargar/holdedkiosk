import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { headersFile } from './security-headers'

export default defineConfig(({ mode }) => ({
  plugins: [
    vue(),
    {
      name: 'security-headers',
      generateBundle() {
        const workerBase = loadEnv(mode, __dirname, 'VITE_').VITE_WORKER_BASE
        this.emitFile({ type: 'asset', fileName: '_headers', source: headersFile(workerBase) })
      }
    }
  ],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8787' }
  }
}))
