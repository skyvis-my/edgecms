import { Elysia, t } from 'elysia'
import { execute, parse, validate } from 'graphql'
import type { Database } from '@/database/db'
import { withTenantBindings } from '@/tenants/with-tenant-bindings'
import { validateD1Guards } from './d1-guard'
import { renderGraphiQLHtml } from './graphiql-playground'
import { buildDynamicGraphQLSchema } from './graphql-schema.builder'

async function executeGraphQLQuery(options: {
  db: Database
  tenantId: string
  queryString: string
  variableValues?: Record<string, unknown>
  operationName?: string
}) {
  const document = parse(options.queryString)
  const guardResult = validateD1Guards(document, { maxDepth: 3, maxComplexity: 50 })
  if (!guardResult.valid) {
    return {
      status: 400 as const,
      response: { errors: [{ message: guardResult.error }] },
    }
  }

  const schema = await buildDynamicGraphQLSchema(options.db, options.tenantId)
  const validationErrors = validate(schema, document)
  if (validationErrors.length > 0) {
    return {
      status: 400 as const,
      response: { errors: validationErrors.map((err) => ({ message: err.message })) },
    }
  }

  const result = await execute({
    schema,
    document,
    variableValues: options.variableValues,
    operationName: options.operationName,
  })

  return {
    status: 200 as const,
    response: result,
  }
}

export const graphqlController = new Elysia({ prefix: '/api/graphql' })
  .use(withTenantBindings)
  /**
   * GET /api/graphql — GraphiQL interactive playground or query execution.
   */
  .get('/', {
    query: t.Object({
      query: t.Optional(t.String()),
      variables: t.Optional(t.String()),
      operationName: t.Optional(t.String()),
    }),
  }, async ({ request, query, set, db, tenantCtx }) => {
    const acceptHeader = request.headers.get('accept') || ''
    const queryString = query.query

    // Resolve endpoint URL for GraphiQL
    const url = new URL(request.url)
    const endpoint = url.pathname

    // If client explicitly requests application/json without a query string, return 400
    if (!queryString && acceptHeader.includes('application/json') && !acceptHeader.includes('text/html')) {
      set.status = 400
      return {
        errors: [{ message: 'Missing "query" parameter in GET request.' }],
      }
    }

    // If text/html requested or no query given, render GraphiQL HTML
    if (!queryString || acceptHeader.includes('text/html')) {
      set.headers['Content-Type'] = 'text/html; charset=utf-8'
      return renderGraphiQLHtml({
        endpoint,
        title: `EdgeCMS GraphiQL — ${endpoint}`,
      })
    }

    // Execute GET query
    const tenantId = tenantCtx?.tenant.id || 'global'

    try {
      let variableValues: Record<string, unknown> | undefined
      if (query.variables) {
        try {
          variableValues = JSON.parse(query.variables)
        } catch {
          set.status = 400
          return { errors: [{ message: 'Invalid variables JSON' }] }
        }
      }

      const res = await executeGraphQLQuery({
        db,
        tenantId,
        queryString,
        variableValues,
        operationName: query.operationName,
      })
      if (res.status !== 200) {
        set.status = res.status
      }
      return res.response
    } catch (err) {
      set.status = 400
      const message = err instanceof Error ? err.message : String(err)
      return {
        errors: [{ message }],
      }
    }
  })

  /**
   * POST /api/graphql — Execute GraphQL queries with D1 guard enforcement.
   */
  .post('/', {
    body: t.Object({
      query: t.String(),
      variables: t.Optional(t.Record(t.String(), t.Unknown(), { properties: {} })),
      operationName: t.Optional(t.String()),
    }),
  }, async ({ body, set, db, tenantCtx }) => {
    const tenantId = tenantCtx?.tenant.id || 'global'

    if (!body.query || typeof body.query !== 'string') {
      set.status = 400
      return {
        errors: [{ message: 'Missing or invalid "query" field in request body.' }],
      }
    }

    try {
      const res = await executeGraphQLQuery({
        db,
        tenantId,
        queryString: body.query,
        variableValues: body.variables as Record<string, unknown> | undefined,
        operationName: body.operationName,
      })
      if (res.status !== 200) {
        set.status = res.status
      }
      return res.response
    } catch (err) {
      set.status = 400
      const message = err instanceof Error ? err.message : String(err)
      return {
        errors: [{ message }],
      }
    }
  })
