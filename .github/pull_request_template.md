## Summary


## Verification

- [ ] `bun run check:merge-markers`
- [ ] Relevant typecheck/test commands:
- [ ] Browser/manual smoke when UI changed:

## Risk Checklist

- [ ] Tenant isolation considered for routes, queries, and cache keys.
- [ ] Auth, RBAC, CSRF, and rate limits considered for changed endpoints.
- [ ] Public cache tags, TTLs, and invalidation considered.
- [ ] D1 migrations are backward-compatible or have rollback notes.
- [ ] Cloudflare bindings/env vars documented when changed.
- [ ] Release/rollback impact documented for deploy-affecting changes.
