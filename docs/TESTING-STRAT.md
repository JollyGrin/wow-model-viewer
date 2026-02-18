# Visual Testing Strategy

Screenshot-based e2e tests evaluated by AI vision. No pixel-diff fragility — Claude looks at the screenshot and tells you if it's right.

## Stack

| Tool | Role |
|------|------|
| `@playwright/test` | Headless browser, screenshot capture, test runner |
| `@anthropic-ai/sdk` | Send screenshots to Claude for pass/fail evaluation |

Two dependencies. Three files. ~80 lines of code.

## Setup

```bash
npm install -D @playwright/test @anthropic-ai/sdk
npx playwright install chromium
```

## File Structure

```
tests/
  ai-eval.mjs            # Claude vision evaluation helper
  learnings.mjs           # Records insights across runs to avoid loops
  model-viewer.spec.mjs   # The actual tests
  test-learnings.json     # Auto-generated (gitignored)
playwright.config.ts
```

## Config

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  use: {
    baseURL: 'http://localhost:3000',
    launchOptions: {
      args: ['--use-gl=swiftshader'], // software WebGL for headless
    },
    viewport: { width: 1280, height: 720 },
  },
});
```

`--use-gl=swiftshader` enables software-rendered WebGL in headless Chromium. Works everywhere including CI with no GPU.

## AI Evaluation Helper

```js
// tests/ai-eval.mjs
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

export async function evaluateScreenshot(screenshotBuffer, criteria, context = {}) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: screenshotBuffer.toString('base64') },
        },
        {
          type: 'text',
          text: `You are a visual QA evaluator for a 3D WoW model viewer.

Evaluate this screenshot against these criteria:
${criteria}

${context.previousLearnings ? `Avoid these known issues from past runs:\n${context.previousLearnings}` : ''}

Respond in JSON:
{
  "pass": true/false,
  "confidence": 0-100,
  "description": "What you see",
  "issues": ["list of problems if any"],
  "learnings": "New insight for future evaluations"
}`,
        },
      ],
    }],
  });

  const text = response.content[0].text;
  return JSON.parse(text.match(/\{[\s\S]*\}/)[0]);
}
```

## Learnings Logger

Prevents getting caught in a loop trying the same failing approach repeatedly. Each test run appends what the AI learned. Future runs feed that context back in.

```js
// tests/learnings.mjs
import fs from 'fs';

const FILE = './tests/test-learnings.json';

export function loadLearnings() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch { return { entries: [], summary: '' }; }
}

export function saveLearning(testName, result) {
  const data = loadLearnings();
  data.entries.push({
    test: testName,
    timestamp: new Date().toISOString(),
    pass: result.pass,
    issues: result.issues,
    learning: result.learnings,
  });
  if (data.entries.length > 50) data.entries = data.entries.slice(-50);
  data.summary = [...new Set(data.entries.map(e => e.learning).filter(Boolean))].join('\n');
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

export function getLearningsSummary() {
  return loadLearnings().summary;
}
```

## Example Test

Load a basic character model and verify it renders:

```js
// tests/model-viewer.spec.mjs
import { test, expect } from '@playwright/test';
import { evaluateScreenshot } from './ai-eval.mjs';
import { saveLearning, getLearningsSummary } from './learnings.mjs';

test('character model renders with equipment', async ({ page }) => {
  await page.goto('/');

  // Trigger model load — adjust to match actual UI
  await page.click('[data-testid="load-model"]');

  // Wait for Three.js to signal the model is loaded
  await page.waitForFunction(() => window.__modelLoaded === true, { timeout: 30000 });
  await page.waitForTimeout(500); // flush GPU render

  const screenshot = await page.locator('canvas').screenshot();

  const result = await evaluateScreenshot(
    screenshot,
    `1. A 3D character model is visible (not blank/black canvas)
     2. Model has textures applied (not wireframe or solid color)
     3. Model is centered in the viewport
     4. No error messages or broken rendering`,
    { previousLearnings: getLearningsSummary() }
  );

  saveLearning('character-model-renders', result);
  console.log('AI Evaluation:', JSON.stringify(result, null, 2));
  expect(result.pass).toBe(true);
});
```

## The Loop

During development, the workflow is:

1. Make a change to the renderer
2. Run `npx playwright test`
3. Playwright launches headless Chromium, loads the app, takes a screenshot
4. Screenshot goes to Claude Vision — pass or fail with explanation
5. If fail: AI writes what it learned to `test-learnings.json`
6. Next run, those learnings feed back into the evaluation prompt
7. Over time the evaluator gets smarter about what to look for

## App-Side Contract

The app needs to expose one signal so tests know when rendering is done:

```ts
// Set this after your Three.js scene finishes its first render with the loaded model
window.__modelLoaded = true;
```

That's the only contract between the app and the test suite.

## Why Playwright Over Alternatives

- **vs Puppeteer**: Same team built Playwright to fix Puppeteer's gaps. Built-in test runner, auto-waiting, cross-browser. Puppeteer adds nothing.
- **vs Cypress**: Runs inside an iframe — WebGL is unreliable. AI calls require a `cy.task()` bridge. More boilerplate for less capability.
- **vs pixel-diff tools**: Pixel diffs break on any rendering variance (anti-aliasing, GPU differences). AI vision evaluates semantic correctness — "is there a textured 3D model?" — which is what actually matters.
