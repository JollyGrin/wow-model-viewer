# 13 — Visual Eval Agent: Parallelized Screenshot Comparison

## The Problem

Ralph's feedback loop currently works like this:

```
ralph makes code change
  → runs /e2e-eval inline (same context)
    → builds project
    → runs Playwright
    → reads screenshots into context
    → compares against reference
    → evaluates issues
  → ralph processes result
  → ralph makes next change
```

Three problems:

1. **Context rot** — Every screenshot read, reference comparison, and evaluation description adds tokens to ralph's main context window. After 3-4 eval cycles, the context is dominated by visual eval details that aren't relevant to the next code change.

2. **Sequential blocking** — Ralph sits idle while build + Playwright + screenshot capture + evaluation runs. Could be doing research or planning the next hypothesis instead.

3. **Evaluation drift** — As ralph's context fills with prior eval results, the evaluation quality can degrade. The evaluator "remembers" previous screenshots and may conflate current issues with past ones.

## The Proposal

A dedicated **visual eval agent** that runs as a parallelized Task subagent. It has zero knowledge of what code was changed — it purely evaluates **how far the current rendering is from the reference**.

```
ralph makes code change
  → fires off eval agent in background (Task, run_in_background: true)
  → continues thinking/researching
  → gets notified when eval completes
  → reads structured result (pass/fail + specific deltas)
```

## Agent Design

### Input

The agent receives:
1. A build command to run (`bun run build`)
2. A test spec to execute (`bunx playwright test e2e/human-male.spec.ts`)
3. Paths to reference images (`screenshots/REFERENCE/`)
4. Paths where test screenshots will be saved (`screenshots/`)
5. An evaluation rubric (what to check for)

### Output

A structured JSON-like result:

```
{
  verdict: "PASS" | "REGRESSED" | "IMPROVED" | "BLOCKED",
  buildStatus: "ok" | "tsc-error" | "build-error",
  views: {
    "front": {
      delta: "MATCH" | "IMPROVED" | "REGRESSED" | "NEW_ISSUE",
      confidence: 85,
      issues: ["upper thigh gap between waist and knees, ~40px of empty space"],
      improvements: [],
    },
    "back": { ... },
    "legs": { ... },
  },
  summary: "Front view: thigh gap persists. Back view: neck patch intact. No regressions.",
  blockers: [],  // build failures, test crashes, etc.
}
```

### Key Properties

**Stateless** — No memory of previous evaluations. Every run starts fresh with just the reference images and the current screenshots. This prevents evaluation drift.

**Pure** — No knowledge of what code change was made. It can't be biased by knowing "we tried to fix the thigh gap" — it just reports what it sees.

**Parallel** — Runs in background while ralph does other work. Ralph reads the result when notified.

**Structured** — Returns machine-parseable deltas, not prose. Ralph can programmatically check `views.legs.delta === "REGRESSED"` instead of parsing paragraphs.

## Implementation Options

### Option A: Custom Skill (New SKILL.md)

Create `.claude/skills/visual-eval/SKILL.md` that:
1. Runs build gates (tsc + bun run build)
2. Runs the Playwright test
3. Reads each screenshot + its reference
4. Returns the structured delta

Ralph invokes it via Task tool with `run_in_background: true`.

**Pros:** Uses Claude Code's built-in multimodal Read tool for image comparison. No API key needed. Cheapest option.

**Cons:** Still uses context tokens for the comparison (just in a different agent's context). The agent subprocess has its own context window, so this is fine — it doesn't pollute ralph's context.

### Option B: Anthropic API Agent (ai-eval.ts Enhanced)

Enhance the existing `e2e/ai-eval.ts` to:
1. Accept multiple screenshots + references
2. Return per-view structured deltas
3. Run as a Node.js script (not inside Playwright)

Ralph fires it off via `Bash` with `run_in_background: true`:
```bash
node scripts/visual-eval.js --test e2e/human-male.spec.ts
```

**Pros:** Dedicated evaluation model (Sonnet). Fast. Deterministic prompt. Lower cost than spawning a full agent.

**Cons:** Requires ANTHROPIC_API_KEY. Adds API cost per eval. Needs its own script infrastructure.

### Option C: Hybrid — Skill Orchestrates, API Evaluates

The skill handles build + Playwright. The API call handles screenshot comparison. Best of both worlds:

```
Skill agent:
  1. tsc --noEmit
  2. bun run build
  3. bunx playwright test
  4. For each screenshot:
     - Call evaluateScreenshot() API with reference + current
  5. Aggregate into structured result
  6. Return to ralph
```

**Pros:** Clean separation. Evaluation is fast (API) while infrastructure is handled by the skill.

**Cons:** Most complex. Two layers of abstraction.

### Recommendation: Option A (Custom Skill)

Simplest, no API key dependency, leverages Claude Code's native multimodal capabilities. The key insight is that **the eval agent's context window is separate from ralph's** — that's the whole point. It can read 10 screenshots without polluting ralph's working memory.

## Proposed Skill: `/visual-eval`

```markdown
---
name: visual-eval
description: >
  Build, screenshot, compare against reference. Returns structured pass/fail
  delta per camera view. No code changes — pure evaluation only.
---

# Visual Eval — Pure Screenshot Comparison

You are a stateless visual evaluator. You do NOT know what code was changed.
You compare current rendered output against reference images and report deltas.

## Step 1 — Build

Run both. If either fails, return BLOCKED with the error.

    tsc --noEmit
    bun run build

## Step 2 — Capture

Run the test spec:

    bunx playwright test e2e/human-male.spec.ts

## Step 3 — Compare

For each screenshot in screenshots/:
1. Read the test screenshot (e.g., screenshots/human-male-front-test.png)
2. Read the matching reference (e.g., screenshots/REFERENCE/human-male-front.png)
3. Compare visually. Focus on:
   - Silhouette completeness (any gaps, holes, missing limbs?)
   - Texture coverage (transparent regions? wrong colors?)
   - Geometry artifacts (floating bands, spikes, collapsed triangles?)
   - Proportions (limbs correct length? head size right?)

## Step 4 — Report

Output a structured report:

    VERDICT: PASS | REGRESSED | IMPROVED | BLOCKED
    BUILD: ok | error

    VIEW: front
    DELTA: match | improved | regressed | new_issue
    ISSUES: [list specific problems with pixel-level descriptions]
    IMPROVEMENTS: [list things that got better vs reference]

    VIEW: back
    ...

    VIEW: legs
    ...

    SUMMARY: One sentence overall assessment.

## Rules

- Do NOT suggest code fixes. You are an evaluator, not a developer.
- Do NOT reference previous evaluations. Each run is independent.
- Be specific: "40px gap between waist and knee" not "legs look wrong"
- SwiftShader caveats are NOT issues: color dulling, aliasing, minor lighting differences
```

## How Ralph Would Use It

In the ralph skill, Step 4 changes from:

**Current (inline):**
```
## Step 4 — Feedback Gates
3. Visual eval (if visual change): Run /e2e-eval
```

**Proposed (parallel):**
```
## Step 4 — Feedback Gates
1. Type check: tsc --noEmit
2. Build: bun run build
3. If visual change:
   - Fire off visual-eval agent in background (Task, run_in_background: true)
   - Continue to Step 5 (record progress with "eval pending")
   - When eval returns, update progress with result
   - If REGRESSED: next iteration addresses the regression
   - If BLOCKED: investigate build/test infrastructure
```

Or, if ralph has nothing else to do, run it in foreground and wait:
```
3. Visual eval: Launch /visual-eval agent (foreground)
   - Read structured result
   - If PASS or IMPROVED: proceed
   - If REGRESSED: fix and retry (max 3)
```

## Context Window Benefits

| Current | Proposed |
|---------|----------|
| Ralph reads 5 screenshots (~500KB of image tokens) | Eval agent reads them in its own context |
| Ralph reads 2 reference images (~800KB) | Eval agent reads them in its own context |
| Ralph writes evaluation prose (500+ tokens) | Ralph reads a 10-line structured result |
| After 3 evals: ~4000 tokens of eval noise in ralph's context | After 3 evals: ~30 lines of structured results |

The eval agent's context window is disposable — it's created fresh each time and discarded after returning the result. Ralph's context stays clean.

## Future Enhancements

1. **Pixel-level metrics** — The Playwright test could extract pixel data from specific regions (e.g., thigh area bounding box) and report percentage of non-background pixels. Gives a numeric delta alongside the visual eval.

2. **Regression detection** — Store eval results in `eval-history.json`. If a view that was previously PASS becomes REGRESSED, flag it more prominently.

3. **Multi-model support** — As we add more races/genders, the eval agent handles them all with the same rubric. Just point it at different test specs and reference directories.

4. **CI integration** — The eval agent's structured output is easy to parse in GitHub Actions. Auto-comment on PRs with visual delta reports.
