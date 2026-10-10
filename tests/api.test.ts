import { mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { createApp } from '../server/src/app';
import { openDatabase, type Database } from '../server/src/db';
import { writeStudyFixture } from './fixture';

const servers: Server[] = [];
const databases: Database[] = [];

afterEach(() => {
  for (const server of servers) server.close();
  servers.length = 0;
  for (const db of databases) db.close();
  databases.length = 0;
});

describe('session api', () => {
  it('refuses to start a session until the manifest is complete', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'navid-api-'));
    const api = await start(root, false);
    const cookie = await login(api.base);
    const denied = await fetch(`${api.base}/api/admin/participants/p1/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ mode: 'baseline' }),
    });
    expect(denied.status).toBe(409);
    await fetch(`${api.base}/api/admin/schools`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ id: 'school-1', name: 'مدرسه یک', gender: 'girls', region: '9' }),
    });
    await fetch(`${api.base}/api/admin/participants`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ id: 'p1', schoolId: 'school-1', consentParent: true, consentStudent: true }),
    });
    const started = await fetch(`${api.base}/api/admin/participants/p1/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ mode: 'baseline' }),
    });
    expect(started.status).toBe(409);
    const body = (await started.json()) as { error: string };
    expect(body.error).toContain('محرک');
  });

  it('keeps the stimulus plan and does not duplicate a retried response', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'navid-api-'));
    writeStudyFixture(root, ['encoding']);
    const api = await start(root, true);
    const cookie = await login(api.base);
    await fetch(`${api.base}/api/admin/schools`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ id: 'school-1', name: 'مدرسه یک', gender: 'boys', region: '14' }),
    });
    const created = await fetch(`${api.base}/api/admin/participants`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ id: 'p1', schoolId: 'school-1', consentParent: false, consentStudent: true }),
    });
    expect(created.status).toBe(201);
    const blocked = await fetch(`${api.base}/api/admin/participants/p1/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ mode: 'baseline' }),
    });
    expect(blocked.status).toBe(409);

    await fetch(`${api.base}/api/admin/participants`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ id: 'p2', schoolId: 'school-1', consentParent: true, consentStudent: true }),
    });
    const started = await fetch(`${api.base}/api/admin/participants/p2/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ mode: 'baseline' }),
    });
    expect(started.status).toBe(201);
    const { sessionId } = (await started.json()) as { sessionId: string };
    const first = await fetch(`${api.base}/api/sessions/${sessionId}`);
    const bundle = (await first.json()) as { plan: { seed: number; stages: Array<{ stage: string; trials: Array<{ id: string }> }> } };
    const again = await fetch(`${api.base}/api/sessions/${sessionId}`);
    const second = (await again.json()) as { plan: { seed: number } };
    expect(second.plan.seed).toBe(bundle.plan.seed);

    const trialId = bundle.plan.stages[0]?.trials[0]?.id ?? '';
    const event = {
      kind: 'trial',
      clientEventId: `trial:${trialId}`,
      trialId,
      onsetAt: new Date().toISOString(),
      offsetAt: new Date().toISOString(),
      response: null,
      responseKind: 'encoding',
      rtMs: null,
    };
    const posted = await fetch(`${api.base}/api/sessions/${sessionId}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events: [event] }),
    });
    expect(posted.status).toBe(200);
    const retried = await fetch(`${api.base}/api/sessions/${sessionId}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events: [event] }),
    });
    expect(retried.status).toBe(200);
    const saved = (await (await fetch(`${api.base}/api/sessions/${sessionId}`)).json()) as { trialIds: string[] };
    expect(saved.trialIds.filter((id) => id === trialId)).toHaveLength(1);

    const interrupted = await fetch(`${api.base}/api/sessions/${sessionId}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        events: [
          {
            kind: 'interrupt',
            clientEventId: 'interrupt:encoding:0:1',
            trialId: 'encoding:0:1',
            checkpoint: {
              seq: 2,
              stageIndex: 0,
              trialIndex: 2,
              practiceRound: 0,
              phase: 'stimulus',
              shoppingWants: [],
              pendingProductId: null,
              updatedAt: new Date().toISOString(),
            },
          },
        ],
      }),
    });
    expect(interrupted.status).toBe(200);
    const exported = await fetch(`${api.base}/api/admin/sessions/${sessionId}/export.json`, { headers: { cookie } });
    const json = (await exported.json()) as { rawResponses: Array<{ id: string; response_kind: string; rt_ms: number | null }> };
    const row = json.rawResponses.find((item) => item.id === 'encoding:0:1');
    expect(row?.response_kind).toBe('interrupted');
    expect(row?.rt_ms).toBeNull();
  });
});

async function start(root: string, withManifest: boolean): Promise<{ base: string }> {
  const db = openDatabase(path.join(root, 'experiment.sqlite'));
  databases.push(db);
  const manifestPath = path.join(root, 'manifest.json');
  const server = createApp({
    db,
    manifestPath,
    stimuliRoot: root,
    password: 'lab-secret',
    applicationVersion: 'test',
    loadManifest: () => (withManifest ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { version: 1 }),
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${address.port}` };
}

async function login(base: string): Promise<string> {
  const response = await fetch(`${base}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'lab-secret' }),
  });
  expect(response.status).toBe(200);
  const cookie = response.headers.get('set-cookie') ?? '';
  return cookie.split(';')[0] ?? '';
}
