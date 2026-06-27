#!/usr/bin/env bun
// ─────────────────────────────────────────────────────
// build-registry.ts — generate registry.json + public/r/*.json
// Run: bun scripts/build-registry.ts
// ─────────────────────────────────────────────────────

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export interface RegistryEntry {
  name: string;
  slug: string;
  package: string;
  category: 'display' | 'input' | 'feedback' | 'layout' | 'data' | 'hook' | 'template';
  description: string;
  tags: string[];
  files: Array<{ path: string; content: string }>;
  dependencies: string[];
}

/**
 * Rewrite relative import specifiers ('./x.js', '../y.js') to the component's
 * published package, so copied source resolves symbols from the npm package
 * instead of sibling files. External specifiers (@termuijs/core, etc.) are
 * left untouched.
 */
export function rewriteImports(content: string, pkg: string): string {
  return content.replace(/(from\s+|import\s+)(['"])(\.\.?\/[^'"]+)\2/g,
    (_m, kw, q) => `${kw}${q}${pkg}${q}`);
}

/**
 * Collect the unique, sorted set of @termuijs/* package specifiers imported by
 * a source file. Run AFTER rewriteImports so relative imports already resolve
 * to their package. These become the component's install dependencies.
 */
export function collectDeps(content: string): string[] {
  const re = /from\s+['"](@termuijs\/[a-z-]+)['"]/g;
  const deps = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) deps.add(m[1]!);
  return [...deps].sort();
}

export function toSlug(name: string): string {
  return name
    .replace(/([A-Z])/g, '-$1')
    .replace(/^-/, '')
    .toLowerCase();
}

export function detectCategory(filePath: string): RegistryEntry['category'] {
  if (filePath.includes('/hooks/')) return 'hook';
  if (filePath.includes('/display/')) return 'display';
  if (filePath.includes('/input/')) return 'input';
  if (filePath.includes('/feedback/')) return 'feedback';
  if (filePath.includes('/layout/')) return 'layout';
  if (filePath.includes('/data/')) return 'data';
  if (filePath.includes('packages/ui/')) return 'template';
  return 'display';
}

function detectPackage(filePath: string): string {
  if (filePath.includes('packages/widgets/')) return '@termuijs/widgets';
  if (filePath.includes('packages/jsx/')) return '@termuijs/jsx';
  if (filePath.includes('packages/ui/')) return '@termuijs/ui';
  if (filePath.includes('packages/tss/')) return '@termuijs/tss';
  if (filePath.includes('packages/core/')) return '@termuijs/core';
  return '@termuijs/widgets';
}

function extractExportedNames(content: string): string[] {
  const names: string[] = [];
  // Match: export class Foo, export function foo, export const foo
  const classRe = /^export\s+class\s+(\w+)/gm;
  const fnRe    = /^export\s+(?:function|const|async function)\s+(\w+)/gm;
  let m;
  while ((m = classRe.exec(content)) !== null) names.push(m[1]!);
  while ((m = fnRe.exec(content))    !== null) names.push(m[1]!);
  return names.filter(n => !n.startsWith('_') && !/Options$|Props$|Type$|Interface$/.test(n));
}

function extractDescription(content: string, name: string): string {
  // Look for JSDoc comment before the export
  const re = new RegExp(`/\\*\\*([^*]|\\*(?!/))*\\*/\\s*(?:export\\s+(?:class|function|const)\\s+${name})`, 's');
  const m = re.exec(content);
  if (m) {
    const comment = m[0].match(/\/\*\*([\s\S]*?)\*\//)?.[1] ?? '';
    return comment.replace(/^\s*\*\s?/gm, '').replace(/\n/g, ' ').trim().split('.')[0] ?? '';
  }
  // Fallback: first line comment above the export
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]?.match(new RegExp(`export\\s+(?:class|function|const)\\s+${name}`))) {
      for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
        const line = lines[j]?.trim() ?? '';
        if (line.startsWith('//')) return line.replace(/^\/\/\s*/, '');
        if (line && !line.startsWith('*') && !line.startsWith('/*')) break;
      }
    }
  }
  return `${name} component`;
}

function scanDirectory(dir: string, entries: { path: string; content: string }[]): void {
  if (!statSync(dir, { throwIfNoEntry: false })) return;
  for (const file of readdirSync(dir)) {
    const full = join(dir, file);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      // skip test dirs and node_modules
      if (!['node_modules', 'dist', '__tests__'].includes(file)) {
        scanDirectory(full, entries);
      }
    } else if (file.endsWith('.ts') && !file.endsWith('.test.ts') && !file.endsWith('.d.ts')) {
      entries.push({ path: full.replace(ROOT + '/', ''), content: readFileSync(full, 'utf-8') });
    }
  }
}

const SCAN_PATHS = [
  'packages/widgets/src/display',
  'packages/widgets/src/feedback',
  'packages/widgets/src/input',
  'packages/widgets/src/layout',
  'packages/widgets/src/data',
  'packages/jsx/src/hooks',
  'packages/ui/src',
];

export function buildRegistryEntries(): RegistryEntry[] {
  const files: { path: string; content: string }[] = [];
  for (const p of SCAN_PATHS) {
    scanDirectory(join(ROOT, p), files);
  }

  const entries: RegistryEntry[] = [];
  for (const { path, content } of files) {
    const names = extractExportedNames(content);
    for (const name of names) {
      // Skip internal helpers and base classes
      if (['Widget', 'Screen', 'Box'].includes(name) && !path.includes('packages/ui/')) continue;
      const slug = toSlug(name);
      const pkg  = detectPackage(path);
      const rewritten = rewriteImports(content, pkg);
      entries.push({
        name,
        slug,
        package: pkg,
        category: detectCategory(path),
        description: extractDescription(content, name),
        tags: [detectCategory(path), slug],
        files: [{ path: `${slug}.ts`, content: rewritten }],
        dependencies: collectDeps(rewritten),
      });
    }
  }

  // deduplicate by name (keep first occurrence)
  const seen = new Set<string>();
  return entries.filter(e => {
    if (seen.has(e.name)) return false;
    seen.add(e.name);
    return true;
  });
}

// ── CLI entrypoint ────────────────────────────────────

async function main(): Promise<void> {
  console.log('Building registry...');
  const entries = buildRegistryEntries();

  // Write master registry.json
  const registryPath = join(ROOT, 'registry.json');
  writeFileSync(registryPath, JSON.stringify(entries, null, 2));
  console.log(`✓ registry.json — ${entries.length} entries`);

  // Write per-component JSON to public/r/
  const publicDir = join(ROOT, 'public', 'r');
  mkdirSync(publicDir, { recursive: true });

  for (const entry of entries) {
    const out = join(publicDir, `${entry.slug}.json`);
    writeFileSync(out, JSON.stringify(entry, null, 2));
  }
  console.log(`✓ public/r/ — ${entries.length} component files`);

  // Write master public/r/registry.json
  writeFileSync(join(publicDir, 'registry.json'), JSON.stringify(entries, null, 2));
  console.log('✓ public/r/registry.json');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e); process.exit(1); });
}
