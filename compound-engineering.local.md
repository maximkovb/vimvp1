---
review_agents:
  - compound-engineering:review:security-sentinel
  - compound-engineering:review:performance-oracle
  - compound-engineering:review:architecture-strategist
  - compound-engineering:review:kieran-typescript-reviewer
---

# Compound Engineering Local Settings

This is a Next.js 16.2.1 App Router prediction market application.
All reviews should be aware of:
- BigInt handling required for viewCount/likeCount/milestoneThreshold columns
- YouTube Data API quota concerns (fields projection silent failures)
- Next.js async params pattern: `params: Promise<{id: string}>` with `await params`
- Drizzle ORM with Neon serverless Postgres (max: 1 connection)
- "use client" boundary must be explicit — Server Components are the default
