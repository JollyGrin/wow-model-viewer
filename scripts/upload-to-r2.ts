/**
 * Upload the entire public/ directory to a Cloudflare R2 bucket.
 *
 * Credentials are read from environment variables:
 *   R2_ACCOUNT_ID        - Cloudflare account ID
 *   R2_ACCESS_KEY_ID     - R2 API token (Access Key ID)
 *   R2_SECRET_ACCESS_KEY - R2 API token (Secret Access Key)
 *   R2_BUCKET_NAME       - Target bucket name
 *
 * Usage: bun run scripts/upload-to-r2.ts
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, relative, extname } from 'path';

// ── Config ────────────────────────────────────────────────────────────────────

const ACCOUNT_ID        = process.env.R2_ACCOUNT_ID;
const ACCESS_KEY_ID     = process.env.R2_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const BUCKET_NAME       = process.env.R2_BUCKET_NAME;

for (const [k, v] of Object.entries({ R2_ACCOUNT_ID: ACCOUNT_ID, R2_ACCESS_KEY_ID: ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY: SECRET_ACCESS_KEY, R2_BUCKET_NAME: BUCKET_NAME })) {
  if (!v) { console.error(`Missing required env var: ${k}`); process.exit(1); }
}

const ROOT       = resolve(import.meta.dirname, '..');
const PUBLIC_DIR = resolve(ROOT, 'public');

// ── Content-Type map ──────────────────────────────────────────────────────────

const CONTENT_TYPES: Record<string, string> = {
  '.html':  'text/html',
  '.css':   'text/css',
  '.js':    'application/javascript',
  '.mjs':   'application/javascript',
  '.ts':    'application/typescript',
  '.json':  'application/json',
  '.png':   'image/png',
  '.jpg':   'image/jpeg',
  '.jpeg':  'image/jpeg',
  '.gif':   'image/gif',
  '.webp':  'image/webp',
  '.svg':   'image/svg+xml',
  '.ico':   'image/x-icon',
  '.wasm':  'application/wasm',
  '.glb':   'model/gltf-binary',
  '.gltf':  'model/gltf+json',
  '.bin':   'application/octet-stream',
  '.tex':   'application/octet-stream',
  '.ttf':   'font/ttf',
  '.woff':  'font/woff',
  '.woff2': 'font/woff2',
  '.txt':   'text/plain',
  '.xml':   'application/xml',
};

function contentType(filepath: string): string {
  return CONTENT_TYPES[extname(filepath).toLowerCase()] ?? 'application/octet-stream';
}

// ── File walker ───────────────────────────────────────────────────────────────

function walk(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...walk(full));
    } else {
      results.push(full);
    }
  }
  return results;
}

// ── Upload ────────────────────────────────────────────────────────────────────

const CONCURRENCY = 20;

const client = new S3Client({
  region: 'auto',
  endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: ACCESS_KEY_ID!,
    secretAccessKey: SECRET_ACCESS_KEY!,
  },
  maxAttempts: 3,
});

const files = walk(PUBLIC_DIR);
const total = files.length;
console.log(`Uploading ${total} files from public/ → ${BUCKET_NAME} (concurrency: ${CONCURRENCY})\n`);

let uploaded  = 0;
let failed    = 0;
let completed = 0;
const errors: string[] = [];

// ── Rolling-window rate & ETA ─────────────────────────────────────────────────

const RATE_WINDOW = 20; // number of recent completions to average over
const completionTimes: number[] = []; // epoch-ms timestamps of recent completions
const startTime = Date.now();

function formatEta(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m > 0 ? `${m}m${s.toString().padStart(2, '0')}s` : `${s}s`;
}

function recordCompletion(): string {
  const now = Date.now();
  completionTimes.push(now);
  if (completionTimes.length > RATE_WINDOW) completionTimes.shift();

  let rate: number;
  if (completionTimes.length < 2) {
    // Fall back to overall rate until we have enough samples
    const elapsedSec = (now - startTime) / 1000;
    rate = completed / elapsedSec;
  } else {
    // Files per second over the rolling window
    const windowSec = (now - completionTimes[0]) / 1000;
    rate = (completionTimes.length - 1) / windowSec;
  }

  const remaining = total - completed;
  const etaSec    = rate > 0 ? remaining / rate : Infinity;
  return `  ${rate.toFixed(1)} files/s  ETA ${formatEta(etaSec)}`;
}

async function uploadFile(absPath: string): Promise<void> {
  const key = relative(PUBLIC_DIR, absPath).replace(/\\/g, '/'); // normalise on Windows
  const ct  = contentType(absPath);
  try {
    await client.send(new PutObjectCommand({
      Bucket:      BUCKET_NAME!,
      Key:         key,
      Body:        readFileSync(absPath),
      ContentType: ct,
    }));
    uploaded++;
    completed++;
    console.log(`[${completed}/${total}] ${key} ✓${recordCompletion()}`);
  } catch (err: any) {
    errors.push(`  ${key}: ${err.message ?? err}`);
    failed++;
    completed++;
    console.log(`[${completed}/${total}] ${key} ✗${recordCompletion()}`);
  }
}

// Run uploads with a fixed-size concurrency pool (semaphore via active-slot tracking)
const queue   = files.slice();
const running = new Set<Promise<void>>();

while (queue.length > 0 || running.size > 0) {
  // Fill slots up to CONCURRENCY
  while (queue.length > 0 && running.size < CONCURRENCY) {
    const p = uploadFile(queue.shift()!).finally(() => running.delete(p));
    running.add(p);
  }
  // Wait for at least one to finish before refilling
  if (running.size > 0) await Promise.race(running);
}

// ── Summary ───────────────────────────────────────────────────────────────────

const totalSec  = (Date.now() - startTime) / 1000;
const avgRate   = completed / totalSec;
console.log(`\n── Summary ──────────────────────`);
console.log(`  Uploaded: ${uploaded}`);
console.log(`  Failed:   ${failed}`);
console.log(`  Time:     ${formatEta(totalSec)}  (avg ${avgRate.toFixed(1)} files/s)`);
if (errors.length) {
  console.log('\nErrors:');
  errors.forEach(e => console.log(e));
}
console.log('─────────────────────────────────');
process.exit(failed > 0 ? 1 : 0);
