import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { isClientEvent, type ClientEvent } from '../../protocol/events';
import type { SessionMode } from '../../protocol/types';
import type { Database } from './db';
import { participantPeriodCsv, questionnairesCsv, sessionJson, trialsCsv } from './exportData';
import { stage1Report } from './report';
import {
  addNote,
  applyEvents,
  completeSession,
  createParticipant,
  createSchool,
  createSession,
  findOpenSession,
  getSession,
  listParticipants,
  listSchools,
  listSessions,
  readManifest,
  saveDemographics,
  setDeliveredRewards,
  writeScores,
  StoreError,
  type AppDeps,
  type DemographicsInput,
} from './store';

export interface ServerOptions {
  db: Database;
  manifestPath: string;
  stimuliRoot: string;
  password: string;
  applicationVersion: string;
  loadManifest?: () => unknown;
}

export function createApp(options: ServerOptions): Server {
  const deps: AppDeps = {
    db: options.db,
    manifestPath: options.manifestPath,
    stimuliRoot: options.stimuliRoot,
    loadManifest:
      options.loadManifest ??
      (() => {
        if (!existsSync(options.manifestPath)) {
          const missing = new Error(`فایل محرک‌ها پیدا نشد: ${options.manifestPath}`) as Error & { issues: string[] };
          missing.issues = [`فایل محرک‌ها پیدا نشد: ${options.manifestPath}`];
          throw missing;
        }
        return JSON.parse(readFileSync(options.manifestPath, 'utf8')) as unknown;
      }),
  };
  return createServer(async (req, res) => {
    try {
      await route(req, res, options, deps);
    } catch (error) {
      const status = error instanceof StoreError ? error.status : 500;
      const message = error instanceof Error ? error.message : 'خطای سرور';
      sendJson(res, status, { error: message });
    }
  });
}

async function route(req: IncomingMessage, res: ServerResponse, options: ServerOptions, deps: AppDeps): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const admin = isAdmin(req, options.db);
  if (url.pathname.startsWith('/stimuli/')) {
    serveFile(res, options.stimuliRoot, decodeURIComponent(url.pathname.slice('/stimuli/'.length)));
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/login') {
    const body = await readJson(req);
    const password = typeof body.password === 'string' ? body.password : '';
    if (!options.password || !safeEqual(password, options.password)) {
      sendJson(res, 401, { error: 'رمز پژوهشگر نادرست است.' });
      return;
    }
    const token = randomUUID();
    options.db.prepare('INSERT INTO admin_sessions (token, created_at) VALUES (?, ?)').run(token, new Date().toISOString());
    res.setHeader('Set-Cookie', `admin_session=${token}; HttpOnly; SameSite=Lax; Path=/`);
    sendJson(res, 200, { ok: true });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/logout') {
    const token = readCookie(req, 'admin_session');
    if (token) options.db.prepare('DELETE FROM admin_sessions WHERE token = ?').run(token);
    res.setHeader('Set-Cookie', 'admin_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    sendJson(res, 200, { ok: true });
    return;
  }
  if (url.pathname.startsWith('/api/admin/')) {
    if (!admin) {
      sendJson(res, 401, { error: 'ورود پژوهشگر لازم است.' });
      return;
    }
    await adminRoute(req, res, url, options, deps);
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/join') {
    const body = await readJson(req);
    const participantId = typeof body.participantId === 'string' ? body.participantId.trim() : '';
    const session = findOpenSession(options.db, participantId);
    if (!session) {
      sendJson(res, 404, { error: 'جلسه‌ای برای ادامه باز نیست. پژوهشگر باید جلسه را شروع کند.' });
      return;
    }
    sendJson(res, 200, { sessionId: session.id, mode: session.mode, status: session.status });
    return;
  }
  const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)(?:\/(events|complete))?$/);
  if (sessionMatch) {
    const sessionId = decodeURIComponent(sessionMatch[1] ?? '');
    const action = sessionMatch[2];
    if (req.method === 'GET' && !action) {
      sendJson(res, 200, getSession(options.db, sessionId, false));
      return;
    }
    if (req.method === 'POST' && action === 'events') {
      const body = await readJson(req);
      const events = Array.isArray(body.events) ? body.events.filter(isClientEvent) : [];
      if (!Array.isArray(body.events) || events.length !== body.events.length) {
        sendJson(res, 400, { error: 'رویدادها نامعتبرند.' });
        return;
      }
      sendJson(res, 200, applyEvents(options.db, sessionId, events as ClientEvent[]));
      return;
    }
    if (req.method === 'POST' && action === 'complete') {
      completeSession(options.db, sessionId);
      sendJson(res, 200, { ok: true });
      return;
    }
  }
  sendJson(res, 404, { error: 'مسیر پیدا نشد.' });
}

async function adminRoute(req: IncomingMessage, res: ServerResponse, url: URL, options: ServerOptions, deps: AppDeps): Promise<void> {
  if (req.method === 'GET' && url.pathname === '/api/admin/manifest') {
    const loaded = readManifest(deps);
    sendJson(res, 200, { ok: loaded.issues.length === 0, issues: loaded.issues });
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/admin/schools') {
    sendJson(res, 200, { schools: listSchools(options.db) });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/schools') {
    const body = await readJson(req);
    const gender = body.gender === 'boys' || body.gender === 'girls' ? body.gender : null;
    if (!gender) {
      sendJson(res, 400, { error: 'جنسیت مدرسه باید دخترانه یا پسرانه باشد.' });
      return;
    }
    createSchool(options.db, {
      id: String(body.id ?? ''),
      name: String(body.name ?? ''),
      gender,
      region: typeof body.region === 'string' ? body.region : null,
    });
    sendJson(res, 201, { ok: true });
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/admin/participants') {
    sendJson(res, 200, { participants: listParticipants(options.db) });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/participants') {
    const body = await readJson(req);
    const created = createParticipant(options.db, {
      id: String(body.id ?? ''),
      schoolId: String(body.schoolId ?? ''),
      consentParent: body.consentParent === true,
      consentStudent: body.consentStudent === true,
    });
    sendJson(res, 201, created);
    return;
  }
  const demo = url.pathname.match(/^\/api\/admin\/participants\/([^/]+)\/demographics$/);
  if (req.method === 'PUT' && demo) {
    const body = await readJson(req);
    saveDemographics(options.db, decodeURIComponent(demo[1] ?? ''), body as unknown as DemographicsInput);
    sendJson(res, 200, { ok: true });
    return;
  }
  const start = url.pathname.match(/^\/api\/admin\/participants\/([^/]+)\/sessions$/);
  if (req.method === 'POST' && start) {
    const body = await readJson(req);
    const mode: SessionMode = body.mode === 'main' ? 'main' : 'baseline';
    if (body.mode !== 'main' && body.mode !== 'baseline') {
      sendJson(res, 400, { error: 'نوبت باید baseline یا main باشد.' });
      return;
    }
    sendJson(res, 201, createSession(deps, decodeURIComponent(start[1] ?? ''), mode));
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/admin/sessions') {
    sendJson(res, 200, { sessions: listSessions(options.db) });
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/admin/export/trials.csv') {
    sendText(res, 200, trialsCsv(options.db), 'text/csv; charset=utf-8');
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/admin/export/questionnaires.csv') {
    sendText(res, 200, questionnairesCsv(options.db), 'text/csv; charset=utf-8');
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/admin/export/participant-period.csv') {
    sendText(res, 200, participantPeriodCsv(options.db), 'text/csv; charset=utf-8');
    return;
  }
  const sessionPath = url.pathname.match(/^\/api\/admin\/sessions\/([^/]+)(?:\/(notes|rewards|export\.json|report\.docx|recompute))?$/);
  if (sessionPath) {
    const sessionId = decodeURIComponent(sessionPath[1] ?? '');
    const action = sessionPath[2];
    if (req.method === 'GET' && !action) {
      sendJson(res, 200, getSession(options.db, sessionId, true));
      return;
    }
    if (req.method === 'POST' && action === 'notes') {
      const body = await readJson(req);
      addNote(options.db, sessionId, String(body.note ?? ''), typeof body.stage === 'string' ? body.stage : null);
      sendJson(res, 201, { ok: true });
      return;
    }
    if (req.method === 'PUT' && action === 'rewards') {
      const body = await readJson(req);
      const productIds = Array.isArray(body.productIds) ? body.productIds.filter((item): item is string => typeof item === 'string') : [];
      setDeliveredRewards(options.db, sessionId, productIds);
      sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method === 'GET' && action === 'export.json') {
      sendJson(res, 200, sessionJson(options.db, sessionId, options.applicationVersion));
      return;
    }
    if (req.method === 'GET' && action === 'report.docx') {
      const buffer = await stage1Report(options.db, sessionId);
      res.writeHead(200, {
        'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'content-disposition': `attachment; filename="stage1-${sessionId}.docx"`,
      });
      res.end(buffer);
      return;
    }
    if (req.method === 'POST' && action === 'recompute') {
      writeScores(options.db, sessionId);
      sendJson(res, 200, { ok: true });
      return;
    }
  }
  sendJson(res, 404, { error: 'مسیر پیدا نشد.' });
}

function isAdmin(req: IncomingMessage, db: Database): boolean {
  const token = readCookie(req, 'admin_session');
  if (!token) return false;
  return Boolean(db.prepare('SELECT token FROM admin_sessions WHERE token = ?').get(token));
}

function readCookie(req: IncomingMessage, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

function safeEqual(input: string, expected: string): boolean {
  const left = Buffer.from(input);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== 'object') return {};
  return parsed as Record<string, unknown>;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(payload);
}

function sendText(res: ServerResponse, status: number, body: string, type: string): void {
  res.writeHead(status, { 'content-type': type });
  res.end(body);
}

function serveFile(res: ServerResponse, root: string, relativePath: string): void {
  const filePath = path.resolve(root, relativePath);
  if (relativePath.includes('..') || !filePath.startsWith(path.resolve(root)) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    sendJson(res, 404, { error: 'فایل پیدا نشد.' });
    return;
  }
  res.writeHead(200, { 'content-type': filePath.endsWith('.png') ? 'image/png' : 'application/octet-stream' });
  createReadStream(filePath).pipe(res);
}
