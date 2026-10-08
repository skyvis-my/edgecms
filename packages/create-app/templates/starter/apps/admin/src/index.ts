export function getAdminBootMessage(apiUrl = 'http://localhost:8787') {
  return `EdgeCMS starter admin ready for ${apiUrl}`
}

export function createAdminHandler(apiUrl = process.env.EDGE_CMS_URL || 'http://localhost:8787') {
  return function handle(req: Request): Response {
    const url = new URL(req.url)
    if (url.pathname === '/health') {
      return Response.json({ status: 'ok', role: 'admin', apiUrl })
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>EdgeCMS Starter Admin</title>
  <style>
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 680px; margin: 40px auto; padding: 0 20px; color: #1e293b; background: #f8fafc; }
    .card { background: white; border-radius: 8px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); border: 1px solid #e2e8f0; }
    h1 { margin-top: 0; color: #0f172a; font-size: 1.5rem; }
    .badge { display: inline-block; background: #dcfce7; color: #15803d; padding: 4px 10px; border-radius: 9999px; font-size: 0.85rem; font-weight: 500; }
    code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; font-family: monospace; }
    ul { padding-left: 20px; line-height: 1.6; }
    a { color: #2563eb; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="card">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
      <h1>EdgeCMS Starter Admin</h1>
      <span class="badge">Running</span>
    </div>
    <p>Connected API: <code>${apiUrl}</code></p>
    <h3>Available Endpoints</h3>
    <ul>
      <li>API Health: <code><a href="${apiUrl}/health" target="_blank">${apiUrl}/health</a></code></li>
      <li>Public Smoke Entry: <code><a href="${apiUrl}/api/tenants/smoke/api/public/smoke-posts/hello-edgecms" target="_blank">${apiUrl}/api/tenants/smoke/api/public/smoke-posts/hello-edgecms</a></code></li>
    </ul>
  </div>
</body>
</html>`

    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }
}

const apiUrl = process.env.EDGE_CMS_URL || 'http://localhost:8787'
const port = Number(process.env.ADMIN_PORT || process.env.PORT || 5173)
const handler = createAdminHandler(apiUrl)

export default {
  port,
  fetch(req: Request): Response {
    return handler(req)
  },
}

if (import.meta.main) {
  console.log(getAdminBootMessage(apiUrl))
  console.log(`EdgeCMS starter admin running on http://localhost:${port}`)
}
