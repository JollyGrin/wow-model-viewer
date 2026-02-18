import Anthropic from '@anthropic-ai/sdk';

export interface EvalResult {
  pass: boolean;
  confidence: number;
  description: string;
  issues: string[];
  learnings: string;
}

/**
 * Evaluate a screenshot using Claude Vision API.
 * Requires ANTHROPIC_API_KEY env var. Optional — tests work without it
 * by saving screenshots for manual/Claude Code review.
 */
export async function evaluateScreenshot(
  screenshotBuffer: Buffer,
  criteria: string,
  context: { previousLearnings?: string } = {},
): Promise<EvalResult> {
  const client = new Anthropic();

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: screenshotBuffer.toString('base64'),
            },
          },
          {
            type: 'text',
            text: `You are a visual QA evaluator for a 3D WoW model viewer.

Evaluate this screenshot against these criteria:
${criteria}

${context.previousLearnings ? `Avoid these known issues from past runs:\n${context.previousLearnings}` : ''}

Respond in JSON only, no markdown fences:
{
  "pass": true/false,
  "confidence": 0-100,
  "description": "What you see",
  "issues": ["list of problems if any"],
  "learnings": "New insight for future evaluations"
}`,
          },
        ],
      },
    ],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Failed to parse AI response: ${text}`);
  return JSON.parse(match[0]) as EvalResult;
}
