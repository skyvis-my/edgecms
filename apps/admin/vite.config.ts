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
        target: process.env.EDGECMS_API_PROXY_TARGET ?? 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Ensure assets use relative paths for Worker serving
    assetsDir: 'assets',
    target: 'es2022',
    cssMinify: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const packageName = getTopLevelPackageName(id)
          if (!packageName) return undefined
          if (INLINE_VENDOR_PACKAGES.has(packageName)) return undefined

          if (packageName === 'react' || packageName === 'react-dom' || packageName === 'scheduler') {
            return 'react-vendor'
          }
          if (packageName.startsWith('@tanstack/')) return 'tanstack-vendor'
          if (packageName.startsWith('@radix-ui/')) return 'radix-vendor'
          if (packageName.startsWith('@floating-ui/')) return 'floating-vendor'
          if (packageName.startsWith('prosemirror-') || packageName.startsWith('@tiptap/')) {
            return 'editor-vendor'
          }
          if (
            packageName === 'react-hook-form' ||
            packageName.startsWith('@hookform/') ||
            packageName === 'zod' ||
            packageName === '@sinclair/typebox'
          ) {
            return 'form-vendor'
          }
          if (
            packageName === 'date-fns' ||
            packageName.startsWith('@date-fns/') ||
            packageName === 'react-day-picker'
          ) {
            return 'date-vendor'
          }
          if (packageName === 'dexie' || packageName.startsWith('dexie-')) {
            return 'storage-vendor'
          }
          if (
            packageName === 'tailwind-merge' ||
            packageName === 'clsx' ||
            packageName === 'class-variance-authority'
          ) {
            return 'css-vendor'
          }
          if (
            packageName === 'lucide-react' ||
            packageName === 'sonner' ||
            packageName === 'cmdk' ||
            packageName === 'input-otp'
          ) {
            return 'ui-vendor'
          }
          if (packageName.startsWith('@better-auth/') || packageName === 'better-auth') {
            return 'auth-vendor'
          }

          return `vendor-${toChunkSafeName(packageName)}`
        },
      },
    },
  },
  // Base path for static file serving from Worker
  base: '/',
})
