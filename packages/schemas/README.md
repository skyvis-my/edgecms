# `@edgecms/schemas`

Shared TypeBox schemas and content contracts for EdgeCMS (collections, commands, public delivery, editorial workflow).

Ships TypeScript source under `src/` (Bun / TypeScript consumers). Tests under `src/__tests__` are excluded from the npm tarball.

```bash
bun add @edgecms/schemas
```

```ts
import { FIELD_TYPES } from '@edgecms/schemas'
import type { CommandEnvelope } from '@edgecms/schemas/commands'
```

## Scripts

```sh
bun run --filter @edgecms/schemas check
```
