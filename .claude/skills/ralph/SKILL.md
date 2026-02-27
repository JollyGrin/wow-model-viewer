---
name: ralph
description: >
  Run a single Ralph Wiggum iteration: pick a task from scope, implement it,
  validate with feedback loops, track progress, and commit.
---

# Ralph Wiggum — Single Iteration

You are inside a Ralph Wiggum autonomous iteration. Follow these steps exactly.

## Step 1 — Understand Context (Prior Art First)

Read these files **in this order**:
1. `docs/LEARNINGS.md` — what has been discovered across all iterations
2. `ralph-progress.md` — what's been done (also in `<progress>` tags)
3. The scope (provided in `<scope>` tags) — defines what to build
4. Any key files referenced in the scope (use the Read tool)

**Mandatory prior-art check** before choosing an approach:
- List related prior attempts from LEARNINGS.md and ralph-progress.md
- Explain how your planned approach differs from each prior attempt
- If you cannot articulate a clear difference → go to **Step 6 (Research Mode)**

Identify the highest-priority incomplete task.

## Step 2 — Form Hypothesis

Before writing any code, state your hypothesis:

```
Hypothesis: If I [specific change], then [expected visual/behavioral outcome],
because [evidence from LEARNINGS, WoW docs, or source code].
```

Requirements:
- Must cite at least one concrete evidence source (LEARNINGS entry, research doc, source code line, or external reference)
- Must predict a specific, observable outcome (not "it should look better")
- If you cannot cite evidence for your approach → go to **Step 6 (Research Mode)**

## Step 3 — Implement

Make the minimal code changes needed for ONE task. Follow existing patterns in the codebase.

Rules:
- One task per iteration. Do not scope-creep.
- Prefer editing existing files over creating new ones.
- If the task is blocked by a prerequisite, note it in progress and pick the next task.

## Step 4 — Feedback Gates

Run these checks in order. Fix and retry if they fail (max 3 attempts each).

1. **Type check:** `tsc --noEmit`
2. **Build:** `bun run build`
3. **Visual eval (if visual change):** Launch `/visual-eval` as a **Task agent**.
   - Use the Task tool with `subagent_type: "general-purpose"` and `run_in_background: true`
   - Prompt: "Run the /visual-eval skill. Build the project, run Playwright screenshots, compare against references, and return the structured VERDICT report."
   - While it runs, continue to **Step 5** (record progress with "eval: pending")
   - When the agent returns, read its structured result
   - If VERDICT is **REGRESSED**: next iteration must address the regression
   - If VERDICT is **BLOCKED**: investigate build/test infrastructure before proceeding
   - If VERDICT is **PASS** or **IMPROVED**: proceed normally
   - If eval agent fails 3 times on the same issue, mark the task as blocked

   **Why a separate agent?** The eval agent reads 5+ screenshots and 2 reference images
   in its own disposable context window. This keeps ralph's context clean for code work.
   The eval agent is stateless — it has no memory of previous evaluations or code changes.

If after 3 attempts a gate still fails, REVERT your changes and move on.

**Failure counter:** If 2 consecutive iterations are blocked or reverted on the **same problem**, stop trying code fixes → go to **Step 6 (Research Mode)**.

## Step 5 — Record Progress

Append to `ralph-progress.md` using this format:

```
## [YYYY-MM-DD] Task: <name>
- Status: done | blocked | reverted
- Hypothesis: <what you predicted and why>
- Result: confirmed | refuted | partial
- Prior art checked: <LEARNINGS/progress entries reviewed before starting>
- Files changed: <list>
- Decisions: <architectural choices>
- Notes: <blockers, findings, issues>
- Next: <what to try next, or N/A if done>
```

If the result refuted your hypothesis, record what the actual outcome was and why the prediction was wrong.

## Step 6 — Research Mode

**No code changes in this step.** This step is for when you can't form an evidence-backed hypothesis or when repeated attempts have failed.

Actions:
1. Search existing research docs: `docs/research/`
2. Search GitHub repos: `wowserhq/scene`, `wowserhq/format`, `WoWModelViewer/wowmodelviewer`
3. Search https://wowdev.wiki for the relevant topic
4. Use `gh search repos` + WebSearch for blog posts and other references

Record findings in `docs/LEARNINGS.md` using the standard format. Then **stop this iteration** — the next run will use the research to form an evidence-backed hypothesis.

## Step 7 — No Git

Do NOT run any git commands. The human will commit manually.

## Step 8 — Completion Check

If ALL tasks in the scope file are done (or blocked), output:
```
<promise>COMPLETE</promise>
```

Otherwise, stop. The next iteration will pick up where you left off.
