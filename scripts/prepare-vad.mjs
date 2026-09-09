// Serve inference assets from our own origin; do not contact a third-party CDN.
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { mkdir, copyFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const vadEntry = require.resolve('@ricky0123/vad-web')
const vad = dirname(vadEntry)
const ort = dirname(createRequire(vadEntry).resolve('onnxruntime-web/wasm'))
const dest = fileURLToPath(new URL('../public/vad/', import.meta.url))
await mkdir(dest, {recursive:true})
for (const file of ['silero_vad_v5.onnx','vad.worklet.bundle.min.js']) await copyFile(join(vad,file),join(dest,file))
for (const file of ['ort-wasm-simd-threaded.mjs','ort-wasm-simd-threaded.wasm']) await copyFile(join(ort,file),join(dest,file))
console.log('Local speech detector assets ready.')
