import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react-swc'
import { defineConfig } from 'vite'

function toChunkSafeName(packageName: string): string {
  return packageName.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function getTopLevelPackageName(id: string): string | null {
  const cleanId = id.split('?')[0] ?? id
  const marker = `${path.sep}node_modules${path.sep}`
  const markerIndex = cleanId.lastIndexOf(marker)
  if (markerIndex === -1) return null

  const packagePath = cleanId.slice(markerIndex + marker.length)
  const segments = packagePath.split(path.sep)
  const first = segments[0]
  if (!first) return null

  if (first.startsWith('@')) {
    const second = segments[1]
    if (!second) return null
    return `${first}/${second}`
  }

  return first
}

const INLINE_VENDOR_PACKAGES = new Set([
  'seroval',
  'seroval-plugins',
  '@better-auth/utils',
  'goober',
  'detect-node-es',
])

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
      routeFileIgnorePattern: '\\.(test|spec)\\.(ts|tsx)$',
    }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Ensure assets use relative paths for Worker serving
    assetsDir: 'assets',
    rollupOptions: {
      output: {
        manualChunks(id) {
          const packageName = getTopLevelPackageName(id)
          if (!packageName) return undefined
          if (INLINE_VENDOR_PACKAGES.has(packageName)) return undefined

          if (packageName.startsWith('@tanstack/')) return 'tanstack-vendor'
          if (packageName.startsWith('@radix-ui/')) return 'radix-vendor'
          if (packageName === 'recharts' || packageName.startsWith('d3')) {
            return 'charts-vendor'
          }
          if (packageName === 'react' || packageName === 'react-dom' || packageName === 'scheduler')
            return 'react-vendor'

          return `vendor-${toChunkSafeName(packageName)}`
        },
      },
    },
  },
  // Base path for static file serving from Worker
  base: '/',
})
