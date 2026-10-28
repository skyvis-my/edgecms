import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/**
 * Auth tables for better-auth.
 *
 * These tables match the schema that better-auth expects (table names: user,
 * session, account, verification). Dates are stored as INTEGER (unix ms) for
 * D1/SQLite compatibility. Boolean fields use INTEGER (0/1).
 *
 * @see https://www.better-auth.com/docs/concepts/database
 */

export const user = sqliteTable(
  'user',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    role: text('role').notNull().default('viewer'),
    emailVerified: integer('emailVerified', { mode: 'boolean' }).notNull().default(false),
    twoFactorEnabled: integer('twoFactorEnabled', { mode: 'boolean' }).default(false),
    image: text('image'),
    createdAt: integer('createdAt', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull(),
  },
  (table) => [index('user_created_at_idx').on(table.createdAt)]
)

export const session = sqliteTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: integer('expiresAt', { mode: 'timestamp' }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: integer('createdAt', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull(),
    ipAddress: text('ipAddress'),
    userAgent: text('userAgent'),
    /** True only for sessions created by completing a second-factor challenge. */
    mfaVerified: integer('mfaVerified', { mode: 'boolean' }).notNull().default(false),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [
    index('session_user_id_idx').on(table.userId),
    index('session_expires_at_idx').on(table.expiresAt),
  ]
)

export const account = sqliteTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('accountId').notNull(),
    providerId: text('providerId').notNull(),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('accessToken'),
    refreshToken: text('refreshToken'),
    idToken: text('idToken'),
    accessTokenExpiresAt: integer('accessTokenExpiresAt', { mode: 'timestamp' }),
    refreshTokenExpiresAt: integer('refreshTokenExpiresAt', { mode: 'timestamp' }),
    scope: text('scope'),
    password: text('password'),
    createdAt: integer('createdAt', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull(),
  },
  (table) => [
    index('account_user_id_idx').on(table.userId),
    uniqueIndex('account_provider_account_unique').on(table.providerId, table.accountId),
  ]
)

export const verification = sqliteTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: integer('expiresAt', { mode: 'timestamp' }).notNull(),
    createdAt: integer('createdAt', { mode: 'timestamp' }),
    updatedAt: integer('updatedAt', { mode: 'timestamp' }),
  },
  (table) => [
    index('verification_identifier_value_idx').on(table.identifier, table.value),
  ]
)

/** TOTP secrets and encrypted recovery codes for better-auth's two-factor plugin. */
export const twoFactor = sqliteTable(
  'twoFactor',
  {
    id: text('id').primaryKey(),
    secret: text('secret').notNull(),
    backupCodes: text('backupCodes').notNull(),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    verified: integer('verified', { mode: 'boolean' }).default(true),
    failedVerificationCount: integer('failedVerificationCount').default(0),
    lockedUntil: integer('lockedUntil', { mode: 'timestamp' }),
  },
  (table) => [
    index('two_factor_secret_idx').on(table.secret),
    index('two_factor_user_id_idx').on(table.userId),
  ]
)
