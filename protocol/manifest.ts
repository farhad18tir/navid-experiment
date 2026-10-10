import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { ENCODING_WORDS, findEncodingWord, normalizeFa } from './content';
import { TASK_STAGES, type StimulusManifest } from './types';

export class ManifestError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(issues.join('\n'));
    this.name = 'ManifestError';
    this.issues = issues;
  }
}

const ALLOWED_BASELINE = new Set<string>([...TASK_STAGES, 'spatialPractice', 'switchPractice']);

export function loadManifest(filePath: string): unknown {
  if (!existsSync(filePath)) {
    throw new ManifestError([`فایل محرک‌ها پیدا نشد: ${filePath}`]);
  }
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
  } catch {
    throw new ManifestError(['فایل محرک‌ها JSON معتبر نیست.']);
  }
}

export function manifestHash(manifest: StimulusManifest): string {
  return createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
}

export function validateManifest(raw: unknown, stimuliRoot: string): StimulusManifest {
  const issues: string[] = [];
  if (!raw || typeof raw !== 'object') {
    throw new ManifestError(['ساختار فایل محرک‌ها شیء نیست.']);
  }
  const record = raw as Record<string, unknown>;
  if (record.version !== 1) issues.push('نسخهٔ فایل محرک‌ها باید ۱ باشد.');

  const products = Array.isArray(record.products) ? record.products : [];
  const parsedProducts = products.map((item, index) => parseProduct(item, index, stimuliRoot, issues));
  const main = parsedProducts.filter((item) => item && !item.isPractice);
  const practice = parsedProducts.filter((item) => item && item.isPractice);
  if (main.length !== 20) issues.push(`باید دقیقاً ۲۰ کالای اصلی باشد؛ الان ${main.length} تاست.`);
  if (practice.length !== 3) issues.push(`باید دقیقاً ۳ کالای تمرینی باشد؛ الان ${practice.length} تاست.`);

  const ids = new Set<string>();
  for (const product of parsedProducts) {
    if (!product) continue;
    if (ids.has(product.id)) issues.push(`شناسهٔ کالا تکراری است: ${product.id}`);
    ids.add(product.id);
    if (/^product\s*\d+$/i.test(product.nameFa)) {
      issues.push(`نام ساختگی برای کالا مجاز نیست: ${product.nameFa}`);
    }
  }

  const newWords = Array.isArray(record.recognitionNewWords)
    ? record.recognitionNewWords.filter((item): item is string => typeof item === 'string')
    : [];
  if (newWords.length !== 8) issues.push(`باید دقیقاً ۸ واژهٔ جدید باشد؛ الان ${newWords.length} تاست.`);
  const seenNew = new Set<string>();
  for (const word of newWords) {
    const key = normalizeFa(word);
    if (!key) issues.push('واژهٔ جدید خالی است.');
    if (seenNew.has(key)) issues.push(`واژهٔ جدید تکراری است: ${word}`);
    seenNew.add(key);
    if (findEncodingWord(word)) issues.push(`واژهٔ جدید در فهرست مرحلهٔ اول هست: ${word}`);
  }

  const recognitionOld = parseOldRule(record.recognitionOld, issues);

  const baselineRaw = Array.isArray(record.baselineStages) ? record.baselineStages : null;
  if (!baselineRaw || baselineRaw.length === 0) {
    issues.push('فهرست مراحل روز پایه خالی است.');
  }
  const baselineStages: string[] = [];
  const seenStages = new Set<string>();
  for (const stage of baselineRaw ?? []) {
    if (typeof stage !== 'string' || !ALLOWED_BASELINE.has(stage)) {
      issues.push(`مرحلهٔ پایه نامعتبر است: ${String(stage)}`);
      continue;
    }
    if (seenStages.has(stage)) issues.push(`مرحلهٔ پایه تکراری است: ${stage}`);
    seenStages.add(stage);
    baselineStages.push(stage);
  }

  if (issues.length > 0) throw new ManifestError(issues);

  return {
    version: 1,
    products: parsedProducts.filter((item): item is StimulusManifest['products'][number] => item !== null),
    recognitionNewWords: newWords,
    recognitionOld,
    baselineStages,
  };
}

function parseProduct(
  item: unknown,
  index: number,
  stimuliRoot: string,
  issues: string[],
): StimulusManifest['products'][number] | null {
  if (!item || typeof item !== 'object') {
    issues.push(`کالای شمارهٔ ${index + 1} ساختار ندارد.`);
    return null;
  }
  const row = item as Record<string, unknown>;
  const id = typeof row.id === 'string' ? row.id.trim() : '';
  const nameFa = typeof row.nameFa === 'string' ? row.nameFa.trim() : '';
  const imageSrc = typeof row.imageSrc === 'string' ? row.imageSrc.trim() : '';
  const isPractice = row.isPractice === true;
  if (!id) issues.push(`کالای شمارهٔ ${index + 1} شناسه ندارد.`);
  if (!nameFa) issues.push(`کالای ${id || index + 1} نام فارسی ندارد.`);
  if (!imageSrc || imageSrc.includes('..') || path.isAbsolute(imageSrc)) {
    issues.push(`مسیر تصویر کالا نامعتبر است: ${id || index + 1}`);
    return id ? { id, nameFa, imageSrc, isPractice } : null;
  }
  const filePath = path.resolve(stimuliRoot, imageSrc);
  const root = path.resolve(stimuliRoot);
  if (!filePath.startsWith(root)) {
    issues.push(`تصویر کالا خارج از پوشهٔ محرک‌هاست: ${imageSrc}`);
  } else if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    issues.push(`تصویر کالا پیدا نشد: ${imageSrc}`);
  } else if (!imageSrc.toLowerCase().endsWith('.png')) {
    issues.push(`تصویر کالا باید PNG باشد: ${imageSrc}`);
  } else {
    const size = readPngSize(filePath);
    if (!size) issues.push(`PNG کالا خوانده نشد: ${imageSrc}`);
    else if (size.width !== 300 || size.height !== 300) {
      issues.push(`تصویر ${imageSrc} باید ۳۰۰×۳۰۰ باشد؛ الان ${size.width}×${size.height} است.`);
    }
  }
  if (!id) return null;
  return { id, nameFa, imageSrc, isPractice };
}

function parseOldRule(value: unknown, issues: string[]): StimulusManifest['recognitionOld'] {
  if (!value || typeof value !== 'object') {
    issues.push('قاعدهٔ واژه‌های قدیمی مشخص نیست.');
    return { mode: 'randomPerSession' };
  }
  const row = value as Record<string, unknown>;
  if (row.mode === 'randomPerSession') return { mode: 'randomPerSession' };
  if (row.mode !== 'fixed') {
    issues.push('قاعدهٔ واژه‌های قدیمی باید fixed یا randomPerSession باشد.');
    return { mode: 'randomPerSession' };
  }
  const words = Array.isArray(row.words) ? row.words.filter((item): item is string => typeof item === 'string') : [];
  if (words.length !== 8) issues.push(`در حالت ثابت باید دقیقاً ۸ واژهٔ قدیمی باشد؛ الان ${words.length} تاست.`);
  const seen = new Set<string>();
  for (const word of words) {
    const found = findEncodingWord(word);
    if (!found) issues.push(`واژهٔ قدیمی در فهرست مرحلهٔ اول نیست: ${word}`);
    const key = normalizeFa(word);
    if (seen.has(key)) issues.push(`واژهٔ قدیمی تکراری است: ${word}`);
    seen.add(key);
  }
  if (ENCODING_WORDS.length !== 16) issues.push('فهرست داخلی مرحلهٔ اول ۱۶ واژه نیست.');
  return { mode: 'fixed', words };
}

function readPngSize(filePath: string): { width: number; height: number } | null {
  const buf = readFileSync(filePath);
  const signature = '89504e470d0a1a0a';
  if (buf.length < 24 || buf.subarray(0, 8).toString('hex') !== signature) return null;
  if (buf.subarray(12, 16).toString('ascii') !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

export function expandStageList(stages: readonly string[]): string[] {
  const out: string[] = [];
  const push = (stage: string) => {
    if (!out.includes(stage)) out.push(stage);
  };
  for (const stage of stages) {
    if (stage === 'spatial') push('spatialPractice');
    if (stage === 'switch') push('switchPractice');
    push(stage);
  }
  return out;
}
