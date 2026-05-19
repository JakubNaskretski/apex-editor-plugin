import { copyFile, mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

await mkdir(resolve(root, 'out'), { recursive: true });

// Copy panel.js
const src = resolve(root, 'src', 'panel.js');
const dest = resolve(root, 'out', 'panel.js');
await copyFile(src, dest);
console.log(`copied ${src} -> ${dest}`);

// Bundle Monaco with Apex language support
await build({
  entryPoints: [resolve(root, 'scripts', 'monaco-entry.mjs')],
  bundle: true,
  format: 'iife',
  outfile: resolve(root, 'out', 'monaco-bundle.js'),
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
});
console.log('built out/monaco-bundle.js');

// Copy Monaco CSS and patch the font URL to be relative (fonts are data URIs inside)
const css = await readFile(
  resolve(root, 'node_modules', 'monaco-editor', 'min', 'vs', 'editor', 'editor.main.css'),
  'utf8'
);
await writeFile(resolve(root, 'out', 'monaco-editor.css'), css);
console.log('copied out/monaco-editor.css');
