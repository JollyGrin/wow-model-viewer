import fs from 'fs';
import path from 'path';
import type { EvalResult } from './ai-eval';

const FILE = path.join(import.meta.dirname, 'test-learnings.json');

interface LearningsData {
  entries: {
    test: string;
    timestamp: string;
    pass: boolean;
    issues: string[];
    learning: string;
  }[];
  summary: string;
}

export function loadLearnings(): LearningsData {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return { entries: [], summary: '' };
  }
}

export function saveLearning(testName: string, result: EvalResult): void {
  const data = loadLearnings();
  data.entries.push({
    test: testName,
    timestamp: new Date().toISOString(),
    pass: result.pass,
    issues: result.issues,
    learning: result.learnings,
  });
  if (data.entries.length > 50) data.entries = data.entries.slice(-50);
  data.summary = [
    ...new Set(data.entries.map((e) => e.learning).filter(Boolean)),
  ].join('\n');
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

export function getLearningsSummary(): string {
  return loadLearnings().summary;
}
