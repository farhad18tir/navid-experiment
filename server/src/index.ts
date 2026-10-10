import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createApp } from './app';
import { openDatabase } from './db';

loadEnv(path.resolve(process.cwd(), '.env'));

const dataPath = process.env.DATA_PATH ?? path.resolve(process.cwd(), 'data', 'experiment.sqlite');
const manifestPath = process.env.MANIFEST_PATH ?? path.resolve(process.cwd(), 'stimuli', 'manifest.json');
const stimuliRoot = path.dirname(manifestPath);
const password = process.env.RESEARCHER_PASSWORD ?? '';
const port = Number(process.env.PORT ?? 8787);
const packageJson = JSON.parse(readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8')) as { version?: string };

const db = openDatabase(dataPath);
const server = createApp({
  db,
  manifestPath,
  stimuliRoot,
  password,
  applicationVersion: packageJson.version ?? '0.0.0',
});

server.listen(port, '0.0.0.0', () => {
  console.log(`experiment server listening on ${port}`);
});

function loadEnv(filePath: string): void {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
