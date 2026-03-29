---
title: "Drizzle-kit CLI Cannot Read .env.local — PostgreSQL Connection Error"
date: 2026-03-22
category: integration-issues
tags: [drizzle-orm, drizzle-kit, environment-variables, postgresql, nextjs, neon, dotenv]
related_files:
  - drizzle.config.ts
  - .env.local
  - package.json
summary: |
  drizzle-kit CLI commands fail because the tool does not load .env.local automatically.
  Fix by explicitly calling dotenv config({ path: ".env.local" }) at the top of drizzle.config.ts.
---

# Drizzle-kit CLI Cannot Read .env.local — PostgreSQL Connection Error

## Problem Symptom

Running any drizzle-kit CLI command fails with:

```
Error: Either connection "url" or "host", "database" are required for PostgreSQL database connection
```

This happens even when `DATABASE_URL` is correctly set in `.env.local`. The Next.js dev server starts fine and the app connects to the database, but the CLI tools cannot.

Affected commands:
- `npm run db:push`
- `npm run db:migrate`
- `npm run db:generate`
- `npm run db:studio`

## Root Cause

drizzle-kit is a standalone CLI tool — it runs as a separate Node.js process outside the Next.js runtime. Next.js automatically loads `.env.local` for the app, but this does not extend to external CLI tools. When drizzle-kit evaluates `drizzle.config.ts`, `process.env.DATABASE_URL` is `undefined`.

This is a common confusion in Next.js projects: developers see the app connecting to the database successfully and assume all env vars are globally available, but only Next.js (not npm scripts) loads `.env.local` automatically.

## Solution

**Step 1 — Install dotenv:**

```bash
npm install dotenv --save-dev
```

**Step 2 — Update `drizzle.config.ts`:**

```typescript
import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

config({ path: ".env.local" });  // must be called before defineConfig reads process.env

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

The `config()` call must come before `defineConfig` so the env vars are populated when the config object is evaluated.

## Why This Happens in Next.js Projects

Next.js has built-in dotenv support that auto-loads `.env`, `.env.local`, `.env.development`, etc. when the dev server or build starts. External CLI tools like drizzle-kit, Prisma, and others have no awareness of this — they each require explicit env loading.

This catches most developers because the app runtime "just works" while CLI migrations fail.

## Prevention

### New project setup checklist

- [ ] Add `dotenv` to `devDependencies` during project init
- [ ] Add `config({ path: ".env.local" })` to `drizzle.config.ts` immediately
- [ ] Commit a `.env.local.example` showing all required variables (without values)
- [ ] Document in README: "Copy `.env.local.example` to `.env.local` and fill in `DATABASE_URL`"

### `.env` vs `.env.local` — which to use for DB credentials

| | `.env` | `.env.local` |
|---|---|---|
| Committed to git | Sometimes | Never (gitignored) |
| Loaded by Next.js | Yes | Yes |
| Loaded by drizzle-kit | No | No (requires dotenv fix) |
| Safe for secrets | No | Yes |

**Recommendation:** Keep `DATABASE_URL` and all secrets in `.env.local`. Use `dotenv` in `drizzle.config.ts` to bridge the gap. Never put real credentials in `.env`.

### Alternative approaches

**Option A — Inline env var (not recommended — leaks to shell history):**
```bash
DATABASE_URL="postgresql://..." npm run db:push
```

**Option B — Shell wrapper (works in CI/CD environments without Node):**
```bash
# scripts/db.sh
set -a; source .env.local; set +a
npx drizzle-kit "$@"
```

**Option C — `dotenv` in `drizzle.config.ts` (recommended — current implementation):**
Cross-platform, no extra scripts, idiomatic Node.js.

### Quick verification

```bash
node -e "require('dotenv').config({ path: '.env.local' }); console.log(process.env.DATABASE_URL ? 'OK' : 'MISSING')"
```

Should print `OK`. If it prints `MISSING`, the `.env.local` file is absent or `DATABASE_URL` is not defined in it.

## Related

- No prior documentation on this pattern existed in `docs/solutions/` at the time of writing.
- The same fix applies to any CLI tool that reads `drizzle.config.ts` outside the Next.js runtime (e.g. custom scripts, CI pipelines).
