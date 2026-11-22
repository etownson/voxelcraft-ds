/*
 * Moves whole sections out of index.html and into native ES modules.
 *
 *   node tools/split-modules.mjs spec.json [--dry] [--selftest]
 *
 * The spec is a JSON array of { section, out, header }, where `section` matches a
 * banner title inside the module script. The cut is pure relocation: section lines
 * move verbatim, and the only text this adds is a header comment, an `export ` in
 * front of a declaration someone else reaches for, and the import lines.
 *
 * Modules already under src/ are read from disk and treated as fixed: their
 * exports are the only names the rest of the graph may reach for, and a section
 * that needs one it keeps private gets the export added rather than a copy of the
 * code. Their import blocks are left exactly as written — with one exception: a
 * module that arrived with none, because its run was carved out by hand rather
 * than by a spec section, gets them generated like anyone else's. index.html is
 * the composition root, so it imports everything and nothing imports it — a new
 * module needing a name that stays in the page is reported as a blocker, because
 * the honest fix is to move that name down a layer.
 *
 * Paths are relative to the repository root, which is where to run it from. The
 * rules it uses to decide what a file declares and what it refers to live in
 * tools/js-scope.mjs, shared with the import checker.
 *
 * --dry       print what would change and write nothing
 * --selftest  with an empty spec, assert that the page regenerates byte for byte.
 *             That is the whole point: with nothing to move, the tool must be
 *             unable to change a single character, so a move it does make can be
 *             read as nothing but the move.
 */
import fs from 'node:fs';
import path from 'node:path';

const specPath = process.argv[2];
if (!specPath) throw new Error('usage: node tools/split-modules.mjs spec.json [--dry] [--selftest]');
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
const dry = process.argv.includes('--dry');
const selftest = process.argv.includes('--selftest');
const FILE = 'index.html';

const html = fs.readFileSync(FILE, 'utf8');
const HEAD = '<script type="module">';
const TAIL = '</script>';
const headAt = html.indexOf(HEAD);
const tailAt = html.lastIndexOf(TAIL);
if (headAt < 0 || tailAt < 0) throw new Error('no module script found');
const head = html.slice(0, headAt + HEAD.length);
const tail = html.slice(tailAt);
const body = html.slice(headAt + HEAD.length, tailAt).split('\n');

/* The page used to hold the sections; now it is a loader that imports the
   composition root, and there is nothing left to split. Say so rather than
   pretend, and refuse a spec that still asks for a section — a silent no-op
   would look like a move that did not happen. */
if (!body.some((line) => /^\/\* ={10,}$/.test(line))) {
  if (spec.length) throw new Error('the page is a loader; there are no sections left to move');
  console.log('the page is a loader: src/main.js is the composition root, nothing to split');
  process.exit(0);
}

/* ---------- the rules for what counts as a name and a reference ---------- */

/* Which names a file declares and which it merely spells out loud is the same
   question the import checker has to answer, and a rule that is wrong in either
   tool fails silently: one deletes an import nobody noticed was needed, the
   other leaves a name in place that is not declared anywhere. So both tools read
   the rules from one file, and `--selftest` runs those rules against their cases
   before this says anything about the game. */
import {
  DECL, EXPORTED, mention, reachesFor, references, scopeSelftest, scopes, topLevelNames
} from './js-scope.mjs';

/* Every line this tool prints is built on those rules, so a rule that has stopped
   matching its cases makes the rest of the output a lie: it would quietly leave a
   name out of an import list. Run them before anything else, every run. */
const scopeProblems = scopeSelftest();
if (scopeProblems.length) {
  scopeProblems.forEach((line) => console.log(line));
  throw new Error('the scope rules in tools/js-scope.mjs no longer match their cases');
}

/* ---------- pieces: the modules on disk, the sections being cut, the page ---------- */

const banners = [];
body.forEach((line, i) => { if (/^\/\* ={10,}$/.test(line)) banners.push(i); });
const spans = banners.map((from, i) => ({
  title: (body[from + 1] || '').trim(),
  from,
  to: i + 1 < banners.length ? banners[i + 1] : body.length
}));

const picks = spec.map((s) => {
  const hits = spans.filter((sp) => sp.title.includes(s.section));
  if (hits.length !== 1) throw new Error(`'${s.section}' matched ${hits.length} banners`);
  return { ...s, span: hits[0] };
});
for (const p of picks) console.log(`cut   ${p.span.title}  lines ${p.span.from + 1}-${p.span.to}  ->  ${p.out}`);

const cut = new Set();
for (const p of picks) for (let i = p.span.from; i < p.span.to; i++) cut.add(i);

/* Generated imports are rewritten wholesale each run, so the old ones come out.
   Everything from the first section banner onward is left exactly as it is: this
   walks the head of the script statement by statement and drops only
   `import { ... } from './...'`, so the three import and the game's own blank
   lines survive. Keeping the head and the body apart is what lets the emitter
   reproduce the file byte for byte when nothing needs to move. */
function splitHead(lines) {
  const kept = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^import \{/.test(line)) {
      if (/';$/.test(line)) continue;                        // one-liner
      while (i < lines.length && !/^\} from '\./.test(lines[i])) i++;
      continue;                                              // the closing line ends it
    }
    kept.push(line);
  }
  const first = kept.findIndex((l) => /^\/\* ={10,}$/.test(l));
  if (first < 0) throw new Error('no section banner found in the page');
  const three = kept.filter((l) => /^import \* as THREE/.test(l));
  if (three.length !== 1) throw new Error('expected exactly one three import at the top of the page');
  return { head: three, rest: kept.slice(first) };
}

const pieces = [];
for (const file of (fs.existsSync('src') ? fs.readdirSync('src') : []).sort()) {
  const name = 'src/' + file;
  const lines = fs.readFileSync(name, 'utf8').split('\n');
  pieces.push({
    name,
    lines,
    existing: true,
    declared: topLevelNames(lines),
    exports: new Set(lines.map((l) => EXPORTED.exec(l)).filter(Boolean).map((m) => m[1]))
  });
}
for (const p of picks) {
  pieces.push({
    name: p.out,
    lines: body.slice(p.span.from + 3, p.span.to).join('\n').replace(/^\s+/, '').replace(/\s+$/, '').split('\n'),
    header: p.header
  });
}
const pageSplit = splitHead(body.filter((_, i) => !cut.has(i)));
pieces.push({ name: FILE, lines: pageSplit.head.concat(pageSplit.rest), head: pageSplit.head, rest: pageSplit.rest });

for (const p of pieces) {
  p.declared = p.declared || topLevelNames(p.lines);
  p.sc = scopes(p.lines);
}

/* Ownership. An existing module only puts its exports on the table; a section
   being moved offers everything it declares. A name two pieces claim is an error,
   not a last-one-wins. */
const owner = new Map();
for (const p of pieces) {
  const offers = p.existing ? [...p.exports] : p.declared;
  for (const n of offers) {
    if (owner.has(n)) throw new Error(`${n} claimed by both ${owner.get(n)} and ${p.name}`);
    owner.set(n, p.name);
  }
}
/* Anything an existing module keeps private, so a use of it can be named as the
   thing that needs exporting rather than mistaken for a page dependency. */
const privateNames = new Map();
for (const p of pieces) if (p.existing) for (const n of p.declared) if (!p.exports.has(n)) privateNames.set(n, p.name);

/* ---------- who needs what ---------- */

const page = pieces.find((p) => p.name === FILE);
for (const p of pieces) {
  const text = references(p.lines);
  p.uses = new Map();
  p.blockers = [];
  p.shadowed = [];
  p.needsExport = [];
  for (const [name, from] of owner) {
    if (from === p.name || !mention(name).test(text)) continue;
    /* Spelling the name is only half of it: a use inside a function that is handed
       the name, or makes its own, is not a request for an import. */
    if (!reachesFor(p.sc, name)) { p.shadowed.push(`${name} (from ${from})`); continue; }
    if (from === FILE) { p.blockers.push(name); continue; }
    p.uses.set(name, from);
  }
  for (const [name, from] of privateNames) {
    if (from === p.name || !mention(name).test(text)) continue;
    if (!reachesFor(p.sc, name)) continue;
    p.needsExport.push({ name, into: from });
  }
  if (p.name !== FILE && p.blockers.length) {
    console.log(`  block ${p.name} needs ${p.blockers.length} name(s) that stay in the page:\n        ${p.blockers.join(', ')}`);
  }
  if (p.shadowed.length) console.log(`  note  ${p.name} shadows locally: ${p.shadowed.join(', ')}`);
}
for (const p of pieces) {
  for (const q of pieces) {
    if (q === p || !q.needsExport) continue;
    for (const need of p.needsExport) if (need.into === q.name && !q.exports.has(need.name)) q.exports.add(need.name);
  }
}
const blocked = pieces.filter((p) => p.blockers.length);
if (blocked.length && !dry) {
  throw new Error(`${blocked.length} module(s) still reach into the page — move those names down a layer first`);
}

/* Exported = someone else reads it. Existing modules only ever gain exports. */
for (const p of pieces) {
  if (p.existing || p.name === FILE) continue;
  p.exports = new Set();
  for (const q of pieces) if (q !== p) for (const [name, from] of q.uses) if (from === p.name) p.exports.add(name);
}

/* The page must not end up importing something it also declares, and a module
   must not import a name the page declares — the page cannot be imported. */
for (const p of pieces) {
  for (const [name] of p.uses) {
    if (p.declared.includes(name)) throw new Error(`${p.name} both imports and declares ${name}`);
  }
}

/* ---------- the graph ---------- */

const graph = new Map();
for (const p of pieces) {
  const groups = new Map();
  for (const [name, from] of p.uses) {
    if (!groups.has(from)) groups.set(from, new Set());
    groups.get(from).add(name);
  }
  p.groups = groups;
  if (p.name !== FILE) graph.set(p.name, new Set(groups.keys()));
}
const byName = new Map(pieces.map((p) => [p.name, p]));
for (const [from, outs] of graph) for (const to of outs) {
  console.log(`  edge  ${from} -> ${to}  [${[...byName.get(from).groups.get(to)].join(', ')}]`);
}
/* Depth-first over the current path, so a diamond — icons importing atlas and
   blocks, where atlas imports blocks — is not mistaken for a cycle. With no
   bundler there is nothing to break a real one, so one means move a name down. */
const findCycle = (from, trail) => {
  for (const to of graph.get(from) || []) {
    if (trail.includes(to)) return [...trail, to];
    const hit = findCycle(to, [...trail, to]);
    if (hit) return hit;
  }
  return null;
};
for (const n of graph.keys()) {
  const cycle = findCycle(n, [n]);
  if (cycle) throw new Error(`${cycle.join(' -> ')}: an import cycle`);
}

/* ---------- emit ---------- */

/* Specifiers are relative to the importing file, so modules in src/ name each
   other as siblings while the page has to say src/. Constants sort before
   functions because uppercase sorts first, which reads better. */
function importBlock(entries, three, fromFile) {
  const here = path.posix.dirname(fromFile);
  const out = three ? ["import * as THREE from 'three';"] : [];
  const sortedEntries = [...entries].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [from, names] of sortedEntries) {
    const spec = './' + path.posix.relative(here === '.' ? '' : here, from);
    const sorted = [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const line = `import { ${sorted.join(', ')} } from '${spec}';`;
    if (line.length <= 100) { out.push(line); continue; }
    const wrapped = [];
    let cur = '  ';
    for (const n of sorted) {
      if ((cur + n + ', ').length > 96) { wrapped.push(cur.replace(/, $/, ',')); cur = '  '; }
      cur += n + ', ';
    }
    wrapped.push(cur.replace(/, $/, ''));
    out.push(`import {\n${wrapped.join('\n')}\n} from '${spec}';`);
  }
  return out;
}

/* Where a module's own code starts: past the header comment, past the blank
   lines after it. Zero for a file that opens straight into code. */
function firstContent(lines) {
  let i = 0;
  if (lines[0] && lines[0].startsWith('/*')) {
    while (i < lines.length && !lines[i].includes('*/')) i++;
    i++;
  }
  while (i < lines.length && !lines[i].trim()) i++;
  return i;
}

const written = [];
for (const p of pieces) {
  if (p.name === FILE) continue;
  const needsThree = /\bTHREE\./.test(references(p.lines));
  /* A module that already carries an import block keeps it exactly as it is, so a
     block whose wrapping was tuned by hand survives. One that arrived with none —
     a run carved out by hand rather than by a spec section — has its imports
     generated here, the same way the page's are, slotted in under the header. A
     module that needs nothing at all, like the config, stays untouched. */
  const bare = p.existing && !p.lines.some((line) => /^import /.test(line)) &&
    (needsThree || p.groups.size);
  const imports = !p.existing || bare ? importBlock([...p.groups], needsThree, p.name) : null;
  let added = 0;
  const lines = p.lines.map((line) => {
    const m = DECL.exec(line);
    if (!m) return line;
    const name = m[3] || m[4] || m[5] || m[6];
    if (!p.exports.has(name) || /^export\s/.test(line)) return line;
    added++;
    return 'export ' + line;
  });
  let text;
  if (!p.existing) {
    text = `${p.header.replace(/\s+$/, '')}\n\n${imports.join('\n')}\n\n${lines.join('\n').replace(/^\s+/, '').replace(/\s+$/, '')}\n`;
  } else if (bare) {
    const at = firstContent(lines);
    text = [
      lines.slice(0, at).join('\n').replace(/\s+$/, ''),
      '', ...imports, '',
      lines.slice(at).join('\n').replace(/\s+$/, '')
    ].join('\n') + '\n';
  } else {
    text = lines.join('\n');
  }
  if (p.existing && text === p.lines.join('\n')) continue;
  written.push([p.name, text]);
  console.log(`  ${p.name}: ${p.exports.size} exports${p.existing ? ` (+${added} newly exported)` : ''}, ${imports ? imports.length - (needsThree ? 1 : 0) : 'kept'} import block(s)${needsThree ? ' + three' : ''}`);
  if (dry) console.log(text.split('\n').slice(0, 16).map((l) => '    | ' + l).join('\n'));
}

const pageImports = importBlock([...page.groups], false, FILE);
const finalLines = ['', ...page.head].concat(pageImports.length ? ['', ...pageImports, ''] : [], page.rest);
const finalHtml = head + '\n' + finalLines.join('\n').replace(/\s+$/, '') + '\n' + tail;
written.push([FILE, finalHtml]);
console.log(`  ${FILE}: ${pageImports.length} import block(s), ${body.length - finalLines.length} fewer lines than the module script started with`);

if (selftest) {
  console.log('selftest: scope rules ok');

  const same = finalHtml === html;
  console.log(same ? 'selftest: the page regenerates byte for byte' : 'selftest: THE PAGE CHANGED with an empty spec');
  if (!same) {
    const a = html.split('\n');
    const b = finalHtml.split('\n');
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) { console.log(`  line ${i + 1}\n  was  ${JSON.stringify((a[i] || '').slice(0, 100))}\n  now  ${JSON.stringify((b[i] || '').slice(0, 100))}`); break; }
    }
  }
  process.exit(same ? 0 : 1);
}

if (dry) { console.log('\ndry run, nothing written'); process.exit(0); }
for (const [file, text] of written) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  console.log(`wrote ${file}  ${text.split('\n').length} lines`);
}
