import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export interface Env {
  DB?: unknown
  CACHE?: unknown
  MEDIA?: unknown
  EDGE_CMS_URL?: string
  EDGE_CMS_ADMIN_URL?: string
  [key: string]: unknown
}

export type SmokeSeed = {
  tenant?: { name?: string; slug?: string }
  collection?: { name?: string; slug?: string; tenantSlug?: string }
  entry?: { title?: string; slug?: string; status?: string; collectionSlug?: string }
  media?: { filename?: string; contentType?: string; alt?: string }
  trustedPluginStatus?: { pluginId?: string; status?: string }
  webhook?: { event?: string; destination?: string; dryRun?: boolean }
}

export function getSmokeSeed(): SmokeSeed {
  const possiblePaths = [
    resolve(import.meta.dir, '../../fixtures/smoke-seed.json'),
    resolve(process.cwd(), 'fixtures/smoke-seed.json'),
  ]
  for (const path of possiblePaths) {
    if (existsSync(path)) {
      try {
        return JSON.parse(readFileSync(path, 'utf8'))
      } catch {
        // Fall back to default fixture data below
      }
    }
  }
  return {
    tenant: { name: 'Smoke Tenant', slug: 'smoke' },
    collection: { name: 'Smoke Posts', slug: 'smoke-posts', tenantSlug: 'smoke' },
    entry: {
      title: 'Hello EdgeCMS',
      slug: 'hello-edgecms',
      status: 'published',
      collectionSlug: 'smoke-posts',
    },
    media: { filename: 'smoke-hero.txt', contentType: 'text/plain', alt: 'Smoke media fixture' },
  }
}

export interface EdgeCmsApiInstance {
  name: string
  routes: string[]
  fetch(request: Request, env?: Env): Promise<Response> | Response
  handle(request: Request, env?: Env): Promise<Response> | Response
}

export function createEdgeCmsApi(options: { env?: Env } = {}): EdgeCmsApiInstance {
  const name = 'edgecms-starter-api'
  const routes = [
    '/health',
    '/api/health',
    '/api/public/:collectionSlug',
    '/api/public/:collectionSlug/:entrySlug',
    '/api/tenants/:tenantSlug/api/public/:collectionSlug',
    '/api/tenants/:tenantSlug/api/public/:collectionSlug/:entrySlug',
  ]

  const corsHeaders: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }

  function handle(request: Request, _env?: Env): Response {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }

    if (url.pathname === '/health' || url.pathname === '/api/health') {
      return Response.json(
        {
          status: 'ok',
          name,
          version: '0.1.0',
          timestamp: new Date().toISOString(),
        },
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const seed = getSmokeSeed()
    const tenantSlug = seed.tenant?.slug ?? 'smoke'
    const collectionSlug = seed.collection?.slug ?? 'smoke-posts'
    const entrySlug = seed.entry?.slug ?? 'hello-edgecms'

    const tenantPublicPrefix = `/api/tenants/${tenantSlug}/api/public/${collectionSlug}`
    const genericPublicPrefix = `/api/public/${collectionSlug}`

    if (
      url.pathname === `${tenantPublicPrefix}/${entrySlug}` ||
      url.pathname === `${genericPublicPrefix}/${entrySlug}`
    ) {
      return Response.json(
        {
          success: true,
          data: {
            ...seed.entry,
            media: seed.media,
          },
          tenant: seed.tenant,
          collection: seed.collection,
        },
        {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            'x-edgecms-cache': 'hit',
          },
        },
      )
    }

    if (url.pathname === tenantPublicPrefix || url.pathname === genericPublicPrefix) {
      return Response.json(
        {
          success: true,
          data: [
            {
              ...seed.entry,
              media: seed.media,
            },
          ],
          meta: { total: 1, page: 1, perPage: 20 },
        },
        {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            'x-edgecms-cache': 'hit',
          },
        },
      )
    }

    if (url.pathname === '/' || url.pathname === '/api') {
      return Response.json(
        {
          name,
          version: '0.1.0',
          routes,
          endpoints: [
            '/health',
            '/api/health',
            `${tenantPublicPrefix}/${entrySlug}`,
            tenantPublicPrefix,
          ],
        },
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    return Response.json(
      {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Route ${url.pathname} not found on ${name}`,
        },
      },
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  return {
    name,
    routes,
    fetch(request: Request, env?: Env) {
      return handle(request, env ?? options.env)
    },
    handle(request: Request, env?: Env) {
      return handle(request, env ?? options.env)
    },
  }
}

const defaultApi = createEdgeCmsApi()
const port = Number(process.env.PORT || process.env.EDGE_CMS_PORT || 8787)

export default {
  port,
  fetch(request: Request, env?: Env): Promise<Response> | Response {
    return defaultApi.fetch(request, env)
  },
}

if (import.meta.main) {
  console.log(`${defaultApi.name} running on http://localhost:${port}`)
  console.log(`Routes: ${defaultApi.routes.join(', ')}`)
}
