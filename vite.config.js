import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

export default defineConfig({
    plugins: [react()],
    base: './',
    define: {
        __APP_VERSION__: JSON.stringify(pkg.version),
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true
    },
    server: {
        port: 5173,
        strictPort: true
    }
})
