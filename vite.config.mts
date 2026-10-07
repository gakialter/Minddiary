import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))
const require = createRequire(import.meta.url)
const pdfjsCmapsDir = join(dirname(require.resolve('pdfjs-dist/package.json')), 'cmaps')
const pdfjsCmaps = new Map(
    readdirSync(pdfjsCmapsDir, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => [entry.name, join(pdfjsCmapsDir, entry.name)])
)

function pdfjsCmapsPlugin(): Plugin {
    const routePrefix = '/pdfjs/cmaps/'
    let isBuild = false

    return {
        name: 'pdfjs-cmaps',
        configResolved(config) {
            isBuild = config.command === 'build'
        },
        configureServer(server) {
            server.middlewares.use((request, response, next) => {
                if (request.method !== 'GET' && request.method !== 'HEAD') {
                    next()
                    return
                }

                let pathname
                try {
                    pathname = new URL(request.url ?? '/', 'http://localhost').pathname
                } catch {
                    next()
                    return
                }
                if (!pathname.startsWith(routePrefix)) {
                    next()
                    return
                }

                let filename
                try {
                    filename = decodeURIComponent(pathname.slice(routePrefix.length))
                } catch {
                    response.statusCode = 400
                    response.end('Bad request')
                    return
                }
                const filePath = pdfjsCmaps.get(filename)
                if (!filePath || filename.includes('/') || filename.includes('\\')) {
                    response.statusCode = 404
                    response.end('Not found')
                    return
                }

                const contents = readFileSync(filePath)
                response.statusCode = 200
                response.setHeader('Content-Type', filename === 'LICENSE' ? 'text/plain; charset=utf-8' : 'application/octet-stream')
                response.setHeader('Content-Length', contents.length)
                if (request.method === 'HEAD') response.end()
                else response.end(contents)
            })
        },
        buildStart() {
            if (!isBuild) return

            for (const [filename, filePath] of pdfjsCmaps) {
                this.emitFile({
                    type: 'asset',
                    fileName: `pdfjs/cmaps/${filename}`,
                    source: readFileSync(filePath),
                })
            }
        },
    }
}

export default defineConfig({
    plugins: [react(), pdfjsCmapsPlugin()],
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
