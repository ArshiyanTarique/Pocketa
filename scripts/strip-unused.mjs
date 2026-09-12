/**
 * Removes named import specifiers that TypeScript reports as unused (TS6133 /
 * TS6196). Run after a refactor rather than hand-editing a dozen import lists.
 *
 *   node scripts/strip-unused.mjs
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

function diagnostics() {
  let out = '';
  try {
    out = execSync('npx tsc --noEmit -p tsconfig.app.json', { encoding: 'utf8' });
  } catch (err) {
    out = `${err.stdout ?? ''}${err.stderr ?? ''}`;
  }
  const found = [];
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^(.+?)\((\d+),(\d+)\): error TS(?:6133|6196): '(.+?)' is declared/);
    if (m) found.push({ file: m[1], line: Number(m[2]), name: m[4] });
  }
  return found;
}

function stripFromImports(file, names) {
  const src = readFileSync(file, 'utf8');
  const lines = src.split('\n');
  let changed = false;

  // Only touch the import block at the top of the file.
  let end = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(import|\/\*|\*|\/\/)/.test(lines[i]) || lines[i].trim() === '' || /^[\s\w{},']+from '.+';?$/.test(lines[i])) {
      end = i;
    }
    if (i > 60) break;
  }

  for (const name of names) {
    for (let i = 0; i <= end; i++) {
      const line = lines[i];
      if (!new RegExp(`\\b${name}\\b`).test(line)) continue;
      // A whole line holding just this specifier
      if (new RegExp(`^\\s*(?:type\\s+)?${name},?\\s*$`).test(line)) {
        lines.splice(i, 1);
        changed = true;
        break;
      }
      // One specifier among several on a line
      const before = line;
      let next = line
        .replace(new RegExp(`(?:type\\s+)?\\b${name}\\b\\s*,\\s*`), '')
        .replace(new RegExp(`,\\s*(?:type\\s+)?\\b${name}\\b(?=\\s*[,}])`), '');
      if (next !== before) {
        lines[i] = next;
        changed = true;
        break;
      }
    }
  }

  if (changed) {
    let out = lines.join('\n');
    // Tidy any import that lost all of its specifiers.
    out = out.replace(/^import\s*\{\s*\}\s*from\s*'[^']+';?\n/gm, '');
    out = out.replace(/\{\s*,/g, '{').replace(/,\s*\}/g, ' }');
    writeFileSync(file, out);
  }
  return changed;
}

let round = 0;
let total = 0;
while (round++ < 6) {
  const found = diagnostics();
  if (found.length === 0) break;

  const byFile = new Map();
  for (const d of found) {
    if (!byFile.has(d.file)) byFile.set(d.file, new Set());
    byFile.get(d.file).add(d.name);
  }

  let touched = 0;
  for (const [file, names] of byFile) {
    if (stripFromImports(file, [...names])) {
      touched++;
      total += names.size;
    } else {
      console.log(`manual: ${file} — ${[...names].join(', ')}`);
    }
  }
  if (touched === 0) break;
}

console.log(`stripped ${total} unused specifier(s) over ${round - 1} pass(es)`);
