import { cp, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const srcDir = resolve(root, 'src/web');
const distDir = resolve(root, 'dist/web');

await mkdir(distDir, { recursive: true });
await cp(srcDir, distDir, { recursive: true });

console.log('[local-eval] web build finished -> dist/web');
