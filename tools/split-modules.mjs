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
 * code. index.html is the composition root, so it imports everything and nothing
 * imports it — a new module needing a name that stays in the page is reported as a
 * blocker, because the honest fix is to move that name down a layer.
 *
 * Paths are relative to the repository root, which is where to run it from.
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

/* ---------- the rules for what counts as a name and a reference ---------- */

/* A binding declared at column 0 is module-level, so it can be exported. */
const DECL = /^(export\s+)?(const|let|var)\s+([A-Za-z_$][\w$]*)|^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)|^class\s+([A-Za-z_$][\w$]*)|^export\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/;
/* What an already-moved module offers the graph: only what it exports. */
const EXPORTED = /^export\s+(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)/;
const DECL_ANY = /(?:^|\s)(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)|(?:^|\s)function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/g;
const codeOnly = (lines) => lines.filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l));
const topLevelNames = (lines) => {
  const out = [];
  for (const line of lines) {
    const m = DECL.exec(line);
    if (m) out.push(m[3] || m[4] || m[5] || m[6]);
  }
  return out;
};
/* A mention of the binding, not of something else with the same spelling. A
   lookbehind on `.` skips a property; a lookahead at a colon with no space before
   it skips an object key — only with no space, because `ready ? GROUND_ACCEL :
   AIR_ACCEL` has the same colon and is a real reference. And `...spread` starts
   with dots too, so those go first, or spreading an imported function reads as a
   property and silently loses its import. */
const spreadless = (lines) => codeOnly(lines).join('\n').replace(/\.\.\./g, '   ');
const mention = (name) => new RegExp('(?<![.\\w$])' + name.replace(/\$/g, '\\$') + '(?![\\w$])(?!:)');

/* Bindings made anywhere, including inside a function. A piece with its own
   `const canvas` inside a helper is not asking for someone else's canvas. */
const localNames = (lines) => {
  const out = new Set();
  for (const line of codeOnly(lines)) {
    DECL_ANY.lastIndex = 0;
    let m;
    while ((m = DECL_ANY.exec(line))) out.add(m[1] || m[2]);
  }
  for (const n of paramNames(spreadless(lines))) out.add(n);
  return out;
};
/* A parameter is a local binding too, and this one mattered: the lighting and
   mesh sections are written as `function addLightBFS(world, kind, x, y, z)`,
   each passed the world it should read, and a module handed a name is not
   asking to import it. Without this the whole knot looked like it depended on
   the page's `world` singleton, which would have been wired up as a cycle.

   Only real signatures count — `if (daylight < 0.35) {` has the same shape as a
   method and is not one, and reading it as one would call `daylight` local and
   quietly drop a needed import. So the keyword list, and nothing that follows a
   dot, since `world.getBlock(x)` is a call on someone else's method. And it is
   the parameter list that is local, never the method's own name: `sampleColumn(x,
   z) { ... }` in the debug hook is a method on an object literal, which binds
   `x` and `z` and nothing else — the first run of this read the name as a
   binding and dropped the page's import of it, which `--selftest` caught. */
const NON_METHOD = 'if|for|while|switch|catch|return|typeof|await|new|do|else|in|of|case|delete|void|instanceof|yield|throw';
const PLIST = '[^)]*(?:\\([^)]*\\)[^)]*)*';            // params with a default that calls
const paramNames = (text) => {
  const out = new Set();
  /* Only the bound half of each parameter. `processMeshing(budgetMs =
     CHUNK_BUDGET_MS)` binds `budgetMs` and *reads* CHUNK_BUDGET_MS from outside,
     so taking every identifier in the list called a config constant local to the
     chunk manager and left the import out. Splitting on commas at depth zero and
     cutting each at its own `=` keeps the binding and hands the default back to
     the reference pass. */
  const addList = (list) => {
    let depth = 0;
    let piece = '';
    let skipping = false;
    const pieces = [];
    for (let i = 0; i < list.length; i++) {
      const ch = list[i];
      if ('([{'.includes(ch)) depth++;
      else if (')]}'.includes(ch)) depth--;
      if (ch === ',' && depth === 0) { pieces.push(piece); piece = ''; skipping = false; continue; }
      const assign = ch === '=' && list[i + 1] !== '=' && list[i + 1] !== '>' && list[i - 1] !== '=' && list[i - 1] !== '!' && list[i - 1] !== '<' && list[i - 1] !== '>';
      if (assign && depth === 0) { skipping = true; continue; }   // the default is a reference
      if (!skipping) piece += ch;
    }
    pieces.push(piece);
    for (const p of pieces) for (const m of p.matchAll(/[A-Za-z_$][\w$]*/g)) out.add(m[0]);
  };
  for (const m of text.matchAll(new RegExp('\\bfunction\\s*\\*?\\s*[A-Za-z_$][\\w$]*?\\s*\\((' + PLIST + ')\\)', 'g'))) addList(m[1]);
  for (const m of text.matchAll(new RegExp('\\((' + PLIST + ')\\)\\s*=>', 'g'))) addList(m[1]);
  for (const m of text.matchAll(/(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*=>/g)) out.add(m[1]);
  for (const m of text.matchAll(new RegExp('(?:^|[\\s{;])(?:async\\s+)?(?:get\\s+|set\\s+)?(?!' + NON_METHOD + '\\b)([A-Za-z_$][\\w$]*)\\s*\\((' + PLIST + ')\\)\\s*\\{', 'g'))) addList(m[2]);
  return out;
};

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
  p.locals = localNames(p.lines);
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
  const text = spreadless(p.lines);
  p.uses = new Map();
  p.blockers = [];
  p.shadowed = [];
  p.needsExport = [];
  for (const [name, from] of owner) {
    if (from === p.name || !mention(name).test(text)) continue;
    if (p.locals.has(name)) { p.shadowed.push(`${name} (from ${from})`); continue; }
    if (from === FILE) { p.blockers.push(name); continue; }
    p.uses.set(name, from);
  }
  for (const [name, from] of privateNames) {
    if (from === p.name || !mention(name).test(text)) continue;
    if (p.locals.has(name)) continue;
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

const written = [];
for (const p of pieces) {
  if (p.name === FILE) continue;
  const needsThree = /\bTHREE\./.test(codeOnly(p.lines).join('\n'));
  const imports = p.existing ? null : importBlock([...p.groups], needsThree, p.name);
  let added = 0;
  const lines = p.lines.map((line) => {
    const m = DECL.exec(line);
    if (!m) return line;
    const name = m[3] || m[4] || m[5] || m[6];
    if (!p.exports.has(name) || /^export\s/.test(line)) return line;
    added++;
    return 'export ' + line;
  });
  const text = p.existing
    ? lines.join('\n')
    : `${p.header.replace(/\s+$/, '')}\n\n${imports.join('\n')}\n\n${lines.join('\n').replace(/^\s+/, '').replace(/\s+$/, '')}\n`;
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
  /* The two regex bugs this tool has already had, as cases. Both silently took a
     name off an import list: one read the method name in `sampleColumn(x, z) {`
     as a binding, the other read a default value as one. A missing import is not
     a crash at load — it is a ReferenceError the first time a player walks into
     the branch, so the check belongs with the tool rather than with the game. */
  const PARAM_CASES = [
    ['function addLightBFS(world, kind, x, y, z) {', ['world', 'kind', 'x', 'y', 'z']],
    ['processMeshing(budgetMs = CHUNK_BUDGET_MS) {', ['budgetMs']],
    ['flushFlowRemesh(budget = WATER_REMESH_BUDGET, msBudget = WATER_REMESH_MS) {', ['budget', 'msBudget']],
    ['sampleColumn(x, z) {', ['x', 'z']],
    ['processGeneration(budgetMs) { this.run(CHUNK_BUDGET_MS - delta); }', ['budgetMs']],
    ['if (daylight < 0.35) {', []],
    ['const n = world.getBlock(x, y, z);', []],
    ['(a, b) => a + b', ['a', 'b']],
    ['tiles.map((t) => tileRect(t))', ['t']],
    ['chunks.forEach((chunk) => { notifyChunkMeshed(chunk); })', ['chunk']]
  ];
  let patternsOk = true;
  for (const [code, want] of PARAM_CASES) {
    const got = [...paramNames(code)].sort();
    if (got.join() !== [...want].sort().join()) {
      patternsOk = false;
      console.log(`  pattern ${JSON.stringify(code)}\n          wanted [${want}] got [${got}]`);
    }
  }
  console.log(patternsOk ? 'selftest: parameter patterns ok' : 'selftest: PARAMETER PATTERNS WRONG');

  const same = finalHtml === html;
  console.log(same ? 'selftest: the page regenerates byte for byte' : 'selftest: THE PAGE CHANGED with an empty spec');
  if (!same) {
    const a = html.split('\n');
    const b = finalHtml.split('\n');
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) { console.log(`  line ${i + 1}\n  was  ${JSON.stringify((a[i] || '').slice(0, 100))}\n  now  ${JSON.stringify((b[i] || '').slice(0, 100))}`); break; }
    }
  }
  process.exit(same && patternsOk ? 0 : 1);
}

if (dry) { console.log('\ndry run, nothing written'); process.exit(0); }
for (const [file, text] of written) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  console.log(`wrote ${file}  ${text.split('\n').length} lines`);
}
