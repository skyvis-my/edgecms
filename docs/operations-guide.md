# EdgeCMS Operations Guide

This guide covers day-to-day operational monitoring, troubleshooting, backup, and maintenance procedures for EdgeCMS.

## Health Check Monitoring

EdgeCMS exposes a health endpoint that verifies core dependencies are reachable.

### Endpoint

```
GET /api/health
```

### Expected Response (200 OK)

```json
{
  "status": "ok",
  "timestamp": "2026-03-12T12:00:00.000Z",
  "version": "0.1.0",
  "subsystems": {
    "database": { "status": "ok", "latencyMs": 3 },
    "cache": { "status": "ok", "latencyMs": 1 },
    "media": { "status": "ok", "latencyMs": 0 },
    "assets": { "status": "ok", "latencyMs": 0 },
    "scheduler": { "status": "ok", "latencyMs": 0 },
    "webhooks": { "status": "ok", "latencyMs": 0 }
  }
}
```

### Monitoring Setup

Configure an uptime monitor (Cloudflare Health Checks, UptimeRobot, Pingdom, etc.) to poll the health endpoint:

| Setting | Value |
|---|---|
| URL | `https://<your-domain>/api/health` |
| Method | GET |
| Expected status | 200 |
| Interval | 60 seconds |
| Timeout | 10 seconds |
| Alert on | 2+ consecutive failures |

### Health Check Failures

If the health endpoint returns a non-200 status or times out:

1. Check Cloudflare Worker status on the [Cloudflare dashboard](https://dash.cloudflare.com/) under Workers > edgecms-api-<env> > Logs.
2. Review real-time logs: `wrangler tail --env <env>`
3. Verify D1 database connectivity by running a test query in the dashboard.
4. Check for recent deployments that may have introduced a regression: `wrangler deployments list --env <env>`

## Common Error Codes and Troubleshooting

### HTTP Error Codes

| Code | Meaning | Common Causes | Resolution |
|---|---|---|---|
| 400 | Bad Request | Malformed JSON body, ArkType validation failure, missing required fields | Check request payload against API schema |
| 401 | Unauthorized | Missing or expired session token, invalid API key | Re-authenticate; verify `BETTER_AUTH_SECRET` is set correctly |
| 403 | Forbidden | User lacks required role/permission for the resource | Verify user roles and tenant membership |
| 404 | Not Found | Resource does not exist, wrong tenant slug, incorrect route | Verify the URL path and resource IDs |
| 409 | Conflict | Duplicate slug, unique constraint violation | Use a different slug or check for existing resources |
| 413 | Payload Too Large | Upload exceeds R2/Worker limits | Reduce file size; Worker request body limit is 100 MB |
| 429 | Too Many Requests | Rate limit exceeded | Wait and retry with exponential backoff; see Rate Limit Tuning below |
| 500 | Internal Server Error | Unhandled exception in service/repository layer | Check `wrangler tail` logs for stack trace |
| 503 | Service Unavailable | Worker cold start timeout, D1 overloaded | Retry; check Cloudflare status page for platform issues |

### Worker-Specific Errors

| Error | Cause | Resolution |
|---|---|---|
| `Error: D1_ERROR: no such table` | Migrations not applied | Run `bun run db:migrate:remote -- --env <env>` |
| `Error: Network connection lost` | D1 transient failure | Automatic retry in most cases; monitor frequency |
| `Durable Object not found` | Missing DO migration or binding | Verify `[[migrations]]` tag and `[[durable_objects.bindings]]` in wrangler.toml |
| `Queue send failed` | Queue does not exist or binding mismatch | Verify queue was provisioned and binding name matches wrangler.toml |
| `R2: NoSuchBucket` | R2 bucket not created for environment | Run `wrangler r2 bucket create edgecms-media-<env>` |
| `Vectorize: index not found` | Vectorize index not provisioned | Run `wrangler vectorize create edgecms-assets-vectors-<env> --dimensions 768 --metric cosine` |

### Debugging with Live Logs

Stream real-time Worker logs to your terminal:

```bash
wrangler tail --env <env>
```

Add filters to reduce noise:

```bash
# Only errors
wrangler tail --env <env> --status error

# Filter by specific path
wrangler tail --env <env> --search "/api/tenants"
```

## D1 Backup Strategy

### Automatic Time Travel

Cloudflare D1 includes built-in Time Travel, which retains a continuous history of changes for up to 30 days (Workers Paid plan).

#### Restoring to a Point in Time

```bash
# List available bookmarks (automatic restore points)
wrangler d1 time-travel info edgecms-db-<env> --env <env>

# Restore the database to a specific timestamp
wrangler d1 time-travel restore edgecms-db-<env> \
  --timestamp "2026-02-26T10:00:00Z" \
  --env <env>
```

**Warning:** Time Travel restore replaces the entire database state. All changes after the target timestamp will be lost. Always verify the target timestamp before restoring.

### Manual Export

For offline backups or cross-environment cloning:

```bash
# Export the entire database to a SQL file
wrangler d1 export edgecms-db-<env> \
  --output ./backups/edgecms-db-<env>-$(date +%Y%m%d).sql \
  --env <env>
```

### Backup Schedule Recommendation

| Backup Type | Frequency | Retention |
|---|---|---|
| D1 Time Travel | Continuous (automatic) | 30 days |
| Manual SQL export | Weekly (production), on-demand (staging) | 90 days minimum |
| Pre-migration snapshot | Before every migration | Until migration is verified stable |

### Pre-Migration Backup

Always export the database before applying schema migrations in production:

```bash
# 1. Export current state
wrangler d1 export edgecms-db-production \
  --output ./backups/pre-migration-$(date +%Y%m%d%H%M).sql \
  --env production

# 2. Note the current timestamp for Time Travel fallback
date -u +"%Y-%m-%dT%H:%M:%SZ"

# 3. Apply migrations
cd apps/api
bun run db:migrate:remote -- --env production
```

## Rate Limit Tuning

EdgeCMS uses Cloudflare's rate limiting capabilities. Adjust thresholds based on observed traffic patterns.

### Default Rate Limits

| Route Pattern | Limit | Window | Action |
|---|---|---|---|
| `/api/auth/*` | 20 requests | 60 seconds | 429 response |
| `/api/tenants/*/public/*` | 100 requests | 60 seconds | 429 response |
| `/api/tenants/*/admin/*` | 60 requests | 60 seconds | 429 response |
| `/api/admin/*` | 30 requests | 60 seconds | 429 response |

### Adjusting Rate Limits

Rate limits are configured either at the application level or through Cloudflare's WAF Rate Limiting Rules in the dashboard:

1. Navigate to the Cloudflare dashboard for your zone.
2. Go to Security > WAF > Rate limiting rules.
3. Edit or create rules matching the route patterns above.
4. Adjust the threshold, window, and mitigation action as needed.

### Monitoring Rate Limit Events

Check rate-limited requests in real-time:

```bash
wrangler tail --env <env> --status error --search "429"
```

Review aggregate metrics in the Cloudflare dashboard under Workers > Analytics.

## Cache Invalidation Procedures

EdgeCMS uses a KV namespace (`CACHE` binding) for caching public API responses and computed data.

### Invalidating a Specific Cache Key

```bash
# Delete a specific key from the cache
wrangler kv key delete --binding CACHE "<cache-key>" --env <env>
```

Common cache key patterns:
- `tenant:<tenantSlug>:collection:<collectionSlug>:entries` -- entry list cache
- `tenant:<tenantSlug>:collection:<collectionSlug>:entry:<entrySlug>` -- single entry cache
- `tenant:<tenantSlug>:collections` -- collection list cache

### Bulk Cache Purge

To clear all cached data for an environment:

```bash
# List all keys (paginated)
wrangler kv key list --binding CACHE --env <env>

# Delete keys matching a pattern (requires scripting)
wrangler kv key list --binding CACHE --env <env> --prefix "tenant:my-tenant:" \
  | jq -r '.[].name' \
  | while read key; do
      wrangler kv key delete --binding CACHE "$key" --env <env>
    done
```

### When to Invalidate Cache

Cache should be invalidated when:
- Schema changes are deployed that alter response shapes
- Data corrections are made directly in D1 (bypassing the API)
- Stale data is reported by users
- After a database restore from Time Travel or backup

The API automatically invalidates relevant cache entries on write operations (create, update, delete) during normal operation.

## Webhook Delivery Monitoring

EdgeCMS uses a Cloudflare Queue (`WEBHOOK_QUEUE` binding) for reliable webhook delivery.

### Queue Configuration

| Setting | Value |
|---|---|
| Queue name | `edgecms-webhook-queue-<env>` |
| Max batch size | 10 |
| Max batch timeout | 5 seconds |
| Max retries | 5 |

### Monitoring Queue Health

#### Dashboard

1. Go to the Cloudflare dashboard.
2. Navigate to Workers > Queues.
3. Select `edgecms-webhook-queue-<env>`.
4. Review metrics: messages produced, consumed, retried, and dead-lettered.

#### CLI

```bash
# View queue details
wrangler queues info edgecms-webhook-queue-<env>
```

### Delivery Failures

When a webhook delivery fails, the queue automatically retries up to the configured `max_retries` (5). After exhausting retries, the message is dead-lettered.

#### Diagnosing Failures

1. Check Worker logs for webhook consumer errors:
   ```bash
   wrangler tail --env <env> --search "webhook"
   ```

2. Common failure causes:
   - **Target endpoint unreachable** -- the receiving server is down or returning 5xx
   - **TLS errors** -- the receiving server has an invalid or expired certificate
   - **Timeout** -- the receiving server takes too long to respond
   - **Payload too large** -- webhook body exceeds the target server's limit

3. Review dead-lettered messages in the Cloudflare Queues dashboard for messages that exceeded retry attempts.

#### Reprocessing Failed Webhooks

Dead-lettered messages can be inspected in the Cloudflare dashboard. To replay them:

1. Identify the failed event payload from the dead letter queue in the dashboard.
2. Manually re-trigger the event through the admin API, or
3. Use the API to resend the webhook for the specific entry/event:
   ```bash
   curl -X POST https://<your-domain>/api/tenants/<slug>/admin/webhooks/replay \
     -H "Authorization: Bearer <token>" \
     -H "Content-Type: application/json" \
     -d '{"eventId": "<event-id>"}'
   ```

### Webhook Delivery SLA

| Metric | Target |
|---|---|
| First delivery attempt | Within 10 seconds of event |
| Successful delivery (within retries) | 99.5% |
| Max delivery latency (5 retries) | ~5 minutes |

Monitor these metrics through Cloudflare Queue analytics and set up alerts for sustained increases in retry rates or dead-letter volume.

### Launch Success Metrics

For the `0.1.0` launch, treat the release as healthy only when these pilot metrics pass:

| Metric | Target |
|---|---|
| First publish | A seeded user can publish one entry successfully |
| Public API read | The published entry is readable through tenant public API |
| Media workflow | A seeded user can upload media and retrieve it from the media list |

Use `STAGING_URL=https://<worker-url> bun run smoke:e2e:staging -- --live-persisted` with seeded staging credentials to verify these metrics before production.
