import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { whitePng } from '../protocol/png';
import type { StimulusManifest } from '../protocol/types';

export function writeStudyFixture(root: string, baselineStages: string[]): StimulusManifest {
  const productsDir = path.join(root, 'products');
  mkdirSync(productsDir, { recursive: true });
  const png = whitePng(300, 300);
  const products: StimulusManifest['products'] = [];
  for (let i = 1; i <= 20; i += 1) {
    const imageSrc = `products/main-${i}.png`;
    writeFileSync(path.join(root, imageSrc), png);
    products.push({ id: `main-${i}`, nameFa: `خوراکی ${i}`, imageSrc, isPractice: false });
  }
  for (let i = 1; i <= 3; i += 1) {
    const imageSrc = `products/practice-${i}.png`;
    writeFileSync(path.join(root, imageSrc), png);
    products.push({ id: `practice-${i}`, nameFa: `تمرین ${i}`, imageSrc, isPractice: true });
  }
  const manifest: StimulusManifest = {
    version: 1,
    products,
    recognitionNewWords: ['نان', 'آب', 'پیراهن', 'کلید', 'مداد', 'رودخانه', 'سنگ', 'ابر'],
    recognitionOld: { mode: 'fixed', words: ['میز', 'کتاب', 'پنجره', 'صندلی', 'درخت', 'کاغذ', 'فنجان', 'دیوار'] },
    baselineStages,
  };
  writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest));
  return manifest;
}
