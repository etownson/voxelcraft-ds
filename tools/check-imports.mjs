/*
 * Checks both directions of every import in the game, with no build step to do
 * it for us.
 *
 *   node tools/check-imports.mjs
 *
 * Forward: a name a file imports has to be exported by the module it names, and
 * the specifier has to be a file in the project. Neither is a syntax error — node
 * --check will not see either — and with no bundler the browser only complains at
 * load, with a blank page where the game was.
 *
 * Backward, which is the one that goes wrong when code is moved by hand: a file
 * reaches for a name another file exports and never imports it. That is not a
 * crash at load either, just a ReferenceError the first time a player walks into
 * the branch, so it can hide for weeks behind a door they have not opened.
 *
 * The rules for what a file declares and what it refers to come from
 * tools/js-scope.mjs, the same ones the module splitter uses. Two copies of those
 * rules drift apart, and the way one goes stale is to stop noticing a name that
 * should be imported.
 *
 * ./tools/check-imports.sh is the usual way to run this.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXPORTED, mention, reachesFor, references, scopeSelftest, scopes } from './js-scope.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'index.html';
const IMPORT = /^import\s*(?:[^'"]*?)\bfrom\s*['"]([^'"]+)['"]/gm;
const EXPORTED_ALL = new RegExp(EXPORTED.source, 'gm');
const EXPORT_LIST = /^export\s*\{([^}]*)\}/gm;

/* Every module the game loads, by project-relative path. */
const files = new Map();
const html = fs.readFileSync(path.join(ROOT, FILE), 'utf8');
const pageScript = /<script type="module">([\s\S]*?)<\/script>/.exec(html);
if (!pageScript) throw new Error(`${FILE} has no module script`);
files.set(FILE, pageScript[1]);
for (const entry of fs.readdirSync(path.join(ROOT, 'src')).sort()) {
  if (!entry.endsWith('.js')) continue;
  files.set(`src/${entry}`, fs.readFileSync(path.join(ROOT, 'src', entry), 'utf8'));
}

/* A rule that has stopped matching its cases would report a clean graph while the
   game was broken, so the rules are checked before the game is. */
const scopeProblems = scopeSelftest();
if (scopeProblems.length) {
  scopeProblems.forEach((line) => console.log(line));
  throw new Error('the scope rules in tools/js-scope.mjs no longer match their cases');
}

const exportsOf = new Map();
for (const [name, text] of files) {
  const found = new Set();
  for (const m of text.matchAll(EXPORTED_ALL)) found.add(m[1]);
  for (const m of text.matchAll(EXPORT_LIST)) {
    for (const part of m[1].split(',')) if (part.trim()) found.add(part.trim().split(' as ').pop().trim());
  }
  exportsOf.set(name, found);
}

const problems = [];
const importedBy = new Map();

/* ---------- forward: what a file asks for, it has to be there ---------- */

for (const [name, text] of files) {
  const wanted = new Set();
  for (const match of text.matchAll(IMPORT)) {
    const specifier = match[1];
    if (!specifier.startsWith('.')) continue;         // a bare specifier is the import map's business
    const target = path.posix.normalize(path.join(path.posix.dirname(name), specifier));
    if (!files.has(target)) {
      problems.push(`${name}: imports ${specifier}, which is not a file in the project`);
      continue;
    }
    if (target === FILE) {
      problems.push(`${name}: imports the page itself, which is a cycle`);
      continue;
    }
    const braces = /\{([^}]*)\}/s.exec(match[0]);
    if (!braces) continue;
    for (const part of braces[1].split(',')) {
      const imported = part.trim().split(' as ')[0].trim();
      if (!imported) continue;
      wanted.add(imported);
      if (!exportsOf.get(target).has(imported)) {
        problems.push(`${name}: imports ${imported} from ${target}, which does not export it`);
      }
    }
  }
  importedBy.set(name, wanted);
}

/* ---------- backward: what a file reaches for, it has to ask for ---------- */

for (const [name, text] of files) {
  const here = path.posix.dirname(name);
  const sc = scopes(text);
  const imported = new Set(importedBy.get(name) || []);
  const code = references(text);
  for (const [source, exported] of exportsOf) {
    if (source === name) continue;
    const rel = path.relative(here, source).split(path.sep).join('/');
    for (const symbol of [...exported].sort()) {
      if (imported.has(symbol) || !mention(symbol).test(code)) continue;
      /* The file spells the name, but does it reach for it? Not from inside a
         function that is handed its own, which is how the save section reads
         `applySavedEdits(world, save)` a thousand lines from the real world. */
      if (!reachesFor(sc, symbol)) continue;
      problems.push(`${name}: uses ${symbol} from ${rel.startsWith('.') ? rel : './' + rel} without importing it`);
    }
  }
}

for (const problem of problems) console.log(problem);
if (problems.length) {
  console.error(`${problems.length} import problem(s)`);
  process.exit(1);
}

const total = [...exportsOf.values()].reduce((n, set) => n + set.size, 0);
console.log(`imports ok: ${files.size} files, ${total} exports`);
