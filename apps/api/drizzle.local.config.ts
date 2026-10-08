import { readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'drizzle-kit'

function resolveLocalD1SqlitePath() {
  const sqliteDir = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject'
  const files = readdirSync(sqliteDir)
    .filter((file) => file.endsWith('.sqlite'))
    .map((file) => {
      const fullPath = resolve(sqliteDir, file)
      return { fullPath, mtimeMs: statSync(fullPath).mtimeMs }
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)

  if (files.length === 0) {
    throw new Error(
      `No local D1 SQLite file found in "${sqliteDir}". Run "wrangler dev" or apply local migrations first.`
    )
  }

  return `file:${files[0].fullPath}`
}

export default defineConfig({
  out: './drizzle/migrations',
  schema: './src/database/schema/index.ts',
  dialect: 'sqlite',
  dbCredentials: {
    url: resolveLocalD1SqlitePath(),
  },
})
