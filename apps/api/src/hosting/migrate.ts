/**
 * Apply OSS hosting migrations without starting the HTTP server.
 *
 *   bun --config bunfig.hosting.toml run src/hosting/migrate.ts
 */
import { loadHostingConfig } from './config'
import { createSqliteFileD1 } from './bindings/sqlite-d1'
import { createPostgresD1 } from './bindings/postgres-d1'

async function main() {
  const config = loadHostingConfig(process.cwd())
  if (config.database.driver === 'postgres') {
    const handle = await createPostgresD1({
      databaseUrl: config.database.databaseUrl!,
      migrationsDir: config.database.migrationsDir,
    })
    console.log(
      JSON.stringify({
        type: 'hosting_migrate',
        driver: 'postgres',
        applied: handle.appliedMigrations,
      })
    )
    await handle.close()
    return
  }

  const handle = createSqliteFileD1({
    path: config.database.sqlitePath,
    migrationsDir: config.database.migrationsDir,
  })
  console.log(
    JSON.stringify({
      type: 'hosting_migrate',
      driver: 'sqlite',
      path: config.database.sqlitePath,
      applied: handle.appliedMigrations,
    })
  )
  handle.sqlite.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
