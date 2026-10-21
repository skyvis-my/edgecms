## Summary


PRD: <!-- requirement IDs from PRD.md, e.g. DL-08, P5; or n/a for chores. Run /prd-check to find them. -->


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
