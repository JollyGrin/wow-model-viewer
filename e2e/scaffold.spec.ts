import { test, expect } from '@playwright/test';
import { evaluateScreenshot } from './ai-eval';
import { saveLearning, getLearningsSummary } from './learnings';

test('spinning cube renders on black background', async ({ page }) => {
  await page.goto('/');

  // Wait for canvas to be present and WebGL context to initialize
  const canvas = page.locator('canvas#canvas');
  await expect(canvas).toBeVisible();

  // Let the cube spin for a moment so it's clearly 3D
  await page.waitForTimeout(1000);

  const screenshot = await canvas.screenshot();

  const result = await evaluateScreenshot(
    screenshot,
    `1. A 3D cube is visible (not a blank or fully black canvas)
     2. The cube has multiple colors (MeshNormalMaterial produces rainbow/gradient faces)
     3. The cube appears rotated at an angle (showing 3D perspective, not flat)
     4. Background is black
     5. No error messages, white screens, or broken rendering`,
    { previousLearnings: getLearningsSummary() },
  );

  saveLearning('scaffold-spinning-cube', result);
  console.log('AI Evaluation:', JSON.stringify(result, null, 2));
  expect(result.pass, `AI evaluation failed: ${result.issues.join(', ')}`).toBe(true);
});
