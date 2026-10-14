export interface GraphiQLRenderOptions {
  endpoint: string
  title?: string
  defaultQuery?: string
}

/**
 * Generates an interactive GraphiQL HTML playground page.
 */
export function renderGraphiQLHtml(options: GraphiQLRenderOptions): string {
  const {
    endpoint,
    title = 'EdgeCMS GraphiQL Playground',
    defaultQuery = `# Welcome to EdgeCMS GraphiQL
# Query your EdgeCMS collections directly on Cloudflare D1 with zero configuration.

query GetEdgeCMSInfo {
  _version
  _collections {
    id
    name
    slug
    singleton
    supportedLocales
  }
}
`,
  } = options

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body {
      height: 100vh;
      margin: 0;
      width: 100vw;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: #0b0f19;
      color: #f3f4f6;
    }
    #graphiql {
      height: 100vh;
    }
    .header-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 16px;
      background: #111827;
      border-bottom: 1px solid #1f2937;
      font-size: 13px;
    }
    .header-title {
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
      color: #60a5fa;
    }
    .header-endpoint {
      background: #1f2937;
      padding: 4px 8px;
      border-radius: 4px;
      color: #9ca3af;
      font-family: ui-monospace, monospace;
    }
  </style>
  <link rel="stylesheet" href="https://unpkg.com/graphiql@3.7.1/graphiql.min.css" />
</head>
<body>
  <div id="graphiql">Loading GraphiQL...</div>
  <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/graphiql@3.7.1/graphiql.min.js"></script>
  <script>
    const endpoint = ${JSON.stringify(endpoint)};
    const defaultQuery = ${JSON.stringify(defaultQuery)};

    function fetcher(graphQLParams, opts) {
      const headers = Object.assign({
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      }, opts && opts.headers);

      return fetch(endpoint, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(graphQLParams),
      }).then(function (response) {
        return response.text().then(function (text) {
          try {
            return JSON.parse(text);
          } catch (e) {
            return { errors: [{ message: text || response.statusText }] };
          }
        });
      });
    }

    const container = document.getElementById('graphiql');
    const rootComponent = React.createElement(GraphiQL, {
      fetcher: fetcher,
      defaultQuery: defaultQuery,
      headerEditorEnabled: true,
      shouldPersistHeaders: true,
    });

    if (ReactDOM.createRoot) {
      ReactDOM.createRoot(container).render(rootComponent);
    } else {
      ReactDOM.render(rootComponent, container);
    }
  </script>
</body>
</html>`
}
