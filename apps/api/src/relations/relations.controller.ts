import { Elysia, t } from 'elysia'
import { betterAuthPlugin } from '@/auth/auth.middleware'
import { toServiceResponse } from '@/shared/utils/service-response'
import { withTenantBindings } from '@/tenants/with-tenant-bindings'
import { relationsService } from './relations.service'

/**
 * ElysiaJS controller for relation CRUD endpoints.
 *
 * All routes are protected with `{ auth: true }` and return responses
 * in the standard API envelope format.
 *
 * Registered under `/api/admin/relations` in the main app.
 */
export const relationsController = new Elysia({ prefix: '/api/admin/relations' })
  .use(betterAuthPlugin)
  .use(withTenantBindings)

  /**
   * POST /link — Link two entries.
   * Creates a relation between a source entry and a target entry.
   */
  .post('/link', {
    auth: true,
    body: t.Object({
      sourceEntryId: t.String({ minLength: 1 }),
      targetEntryId: t.String({ minLength: 1 }),
      sourceCollectionId: t.String({ minLength: 1 }),
      targetCollectionId: t.String({ minLength: 1 }),
      relationType: t.Union([
        t.Literal('one-to-one'),
        t.Literal('one-to-many'),
        t.Literal('many-to-many'),
      ]),
      fieldName: t.String({ minLength: 1 }),
      sortOrder: t.Optional(t.Integer({ minimum: 0 })),
    }),
  }, async ({ db, body, set }) => {
    return toServiceResponse(set, await relationsService.link(db, body), { successStatus: 201 })
  })

  /**
   * POST /unlink — Unlink two entries.
   * Removes a relation between a source entry and a target entry.
   */
  .post('/unlink', {
    auth: true,
    body: t.Object({
      sourceEntryId: t.String({ minLength: 1 }),
      targetEntryId: t.String({ minLength: 1 }),
      fieldName: t.String({ minLength: 1 }),
    }),
  }, async ({ db, body, set }) => {
    return toServiceResponse(set, await relationsService.unlink(db, body))
  })

  /**
   * GET /:entryId — List relations for an entry.
   * Returns all relations where the given entry is the source.
   * Optional query param: fieldName to filter by specific field.
   */
  .get('/:entryId', {
    auth: true,
    params: t.Object({
      entryId: t.String({ minLength: 1 }),
    }),
    query: t.Object({
      fieldName: t.Optional(t.String()),
    }),
  }, async ({ db, params, query, set }) => {
    return toServiceResponse(
      set,
      await relationsService.getRelationsForEntry(db, params.entryId, query.fieldName)
    )
  })
