import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  out: './drizzle/migrations',
  schema: './src/database/schema/index.ts',
  dialect: 'sqlite',
  driver: 'd1-http',
})
