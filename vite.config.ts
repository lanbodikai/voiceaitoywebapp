import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { createReadStream } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ONNX dynamically imports its .mjs runtime. Vite's source transformer must not
// transform those vendor files or reject their imports from public/ in dev.
const speechRuntime = {
  name: 'local-speech-runtime',
  configureServer(server: import('vite').ViteDevServer) {
    server.middlewares.use((request, response, next) => {
      const file = request.url?.split('?')[0]?.replace(/^\/vad\//, '')
      if (!request.url?.startsWith('/vad/') || !file || !['ort-wasm-simd-threaded.mjs','ort-wasm-simd-threaded.wasm','silero_vad_v5.onnx','vad.worklet.bundle.min.js'].includes(file)) return next()
      response.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : file.endsWith('.onnx') ? 'application/octet-stream' : 'text/javascript')
      createReadStream(fileURLToPath(new URL(`./public/vad/${file}`, import.meta.url))).on('error', () => { response.statusCode=404; response.end() }).pipe(response)
    })
  },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [speechRuntime, react()],
  build: { chunkSizeWarningLimit: 550 },
})
