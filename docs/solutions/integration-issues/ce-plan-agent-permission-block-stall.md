---
title: "ce:plan Hangs Indefinitely When External Research Agent Is Permission-Blocked"
category: integration-issues
date: 2026-04-01
tags:
  - agent-permissions
  - blocked-tool-call
  - session-hang
  - fallback-logic
  - ce-plan
description: "When the ce:plan skill spawns a best-practices-researcher agent that is blocked by user permission settings, no fallback or timeout logic triggers, causing the session to hang indefinitely until manual user intervention."
---

# ce:plan Hangs Indefinitely When External Research Agent Is Permission-Blocked

## Symptom

Running `/ce:plan` completes local research (step 1) successfully, then appears to freeze.
No output, no error, no forward progress — the session stalls silently for an unbounded amount of time
until the user manually intervenes.

**Context:** Occurred when planning a "clean TikTok video embed" feature. Local research agents
(`repo-research-analyst`, `learnings-researcher`) completed. Step 1.5b spawned
`best-practices-researcher` to look up TikTok embed API docs. User permissions blocked the agent
call. Session hung for ~10 hours.

---

## Root Cause

The `ce:plan` skill includes a **conditional external research step (1.5b)** that spawns
`best-practices-researcher` and `framework-docs-researcher` agents. When user permission settings
block these agent calls, the skill has **no fallback or timeout logic** — it simply awaits results
that never arrive. Because the blocked call returns neither a success nor an explicit error, there
is no signal to trigger continuation. The workflow freezes at the last dispatched agent call.

This is an integration handoff failure: the skill assumes external agents are always available, and
has no defined bypass path for the permission-denied case.

---

## Working Solution (Recovery)

1. User manually intervened after ~10 hours: "you've been stuck for 10 hours, fix it."
2. AI recognized the stall, abandoned the blocked external research agent.
3. Confirmed local research agents (`repo-research-analyst`, `learnings-researcher`) had already
   completed successfully.
4. Proceeded directly to step 1.6 (consolidate research) using only local findings.
5. Plan was written successfully without external research — output was complete and usable.

**Key insight:** Local research from step 1 is always sufficient to produce a valid plan.
External research (step 1.5b) adds depth but is never required. A plan without `best-practices-researcher`
input is useful; a plan that never finishes is not.

---

## Behavioral Rule Going Forward

**When any agent tool call is rejected or blocked during a skill workflow:**

1. **Do not wait or retry.** A blocked call will never resolve.
2. **Immediately announce** what was skipped: _"External research agent blocked by permissions — proceeding with local research only."_
3. **Treat external research agents as optional.** `best-practices-researcher` and `framework-docs-researcher` (step 1.5b) add depth but never gate plan completion.
4. **Proceed to the next required step.** If step 1 agents have completed, go directly to step 1.6 and write the plan.
5. **Apply this rule to any skill** that spawns optional research agents. A blocked agent call is a signal to continue without it, not a reason to stall.

---

## Prevention Strategies

- **Detect → Announce → Continue (immediate):** When any agent tool call is rejected, do not wait, retry, or loop. Announce what was skipped and why, then continue from the next required step. Optional agents must never block forward progress.

- **Permission-aware execution:** Before spawning conditional agents (step 1.5b), check if any agent call was denied earlier in this session. If so, skip all subsequent optional external agent invocations without attempting them — convert a runtime stall into a silent, graceful omission.

- **Timeout heuristic (~30s):** If an agent call has been dispatched and no response arrives within ~30 seconds (success, error, or rejection), treat it as implicitly blocked. Announce the skip and proceed. Never allow indefinite pending states to freeze a skill run.

- **Session context awareness:** Once a single external agent call is denied, treat the entire session as operating under restrictive permissions. All subsequent optional agent calls should be skipped preemptively. This prevents repeated interruptions across multi-step skills.

- **Required vs. optional distinction:** Before attempting an agent call, ask: "Does the workflow produce a coherent result without this agent's output?" If yes, it's optional and must never stall. If no, it's required — and a block should surface a clear error with guidance, not a silent hang.

- **Graceful degradation over completeness:** Under restrictive permissions, produce a reduced-but-complete output rather than a stalled-but-thorough one. Every optional enrichment step should have a defined bypass path.

---

## Cross-References

- **`docs/solutions/integration-issues/anthropic-claude-api-nextjs-server-action.md`** — Architecturally analogous: documents fallback logic failures where a blocked call throws before the catch can fire. The lesson there ("deferred construction so a blocked call triggers the fallback path") applies at the app level; this document covers the same failure mode at the workflow-orchestration layer.

---

## Related

- Skill affected: `compound-engineering:ce-plan` (step 1.5b)
- Agents involved: `best-practices-researcher`, `framework-docs-researcher`
- Trigger: User's Claude Code permission settings set to restrict agent tool calls
- Resolution time if undocumented: hours to days (silent stall, no error signal)
