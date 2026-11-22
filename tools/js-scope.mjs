/*
 * The scope rules this repository's tools agree on: what a file declares, and
 * what a file refers to.
 *
 * Both the module splitter and the import checker have to answer the same two
 * questions about the same code, and every wrong answer is silent. A reference
 * that is not really one asks for an import that does not exist; a binding that
 * is not seen hides an import that does, and that is not a load-time error but a
 * ReferenceError the first time a player walks into the branch. So the rules live
 * here once, with their own test cases, rather than in two files that drift.
 *
 * What counts:
 *   - comments and string contents are not code, so they neither bind nor refer;
 *   - a parameter binds, and only the bound half of it does — a default value is
 *     a reference to whatever the default names;
 *   - a name after a dot is a property, a name followed immediately by a colon is
 *     an object key, and `...spread` starts with dots, so the spread is blanked
 *     before the dot rule or spreading an imported function loses its import.
 *
 * None of this is a JavaScript parser. A regex literal containing a quote would
 * fool the literal stripper; the game has none, and the cases below are what
 * keeps it honest as that changes.
 */

/* A binding declared at column 0 is module-level, so it can be exported. */
export const DECL = /^(export\s+)?(const|let|var)\s+([A-Za-z_$][\w$]*)|^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)|^class\s+([A-Za-z_$][\w$]*)|^export\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/;
/* What an already-moved module offers the graph: only what it exports. */
export const EXPORTED = /^export\s+(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)/;
export const DECL_ANY = /(?:^|\s)(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)|(?:^|\s)function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/g;

/*
 * Blanks comments and the literal parts of strings, character by character, and
 * keeps the newline count so line numbers still mean something. Everything inside
 * a template's `${ ... }` is code again — including strings inside that — so an
 * interpolated name is still a reference while the prose around it is not.
 */
export const stripLiterals = (text) => {
  const out = [];
  const stack = [];                     // modes below the current one
  let mode = 'code';
  let braces = 0;                       // depth of `{}` inside the current `${}`
  const put = (ch) => out.push(/[^\S\n]/.test(ch) ? ch : ' ');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    const back = () => { mode = stack.pop() || 'code'; };
    if (mode === 'line') {
      if (ch === '\n') { back(); out.push('\n'); } else put(ch);
      continue;
    }
    if (mode === 'block') {
      if (ch === '*' && next === '/') { put(ch); put(next); i++; back(); } else put(ch);
      continue;
    }
    if (mode === 'sq' || mode === 'dq') {
      if (ch === '\\') { put(ch); put(next || ''); i++; }
      else if (ch === `'` && mode === 'sq' || ch === '"' && mode === 'dq') { put(ch); back(); }
      else if (ch === '\n') { back(); out.push('\n'); }        // an unterminated string is not ours to fix
      else put(ch);
      continue;
    }
    if (mode === 'template') {
      if (ch === '\\') { put(ch); put(next || ''); i++; }
      else if (ch === '`') { put(ch); back(); }
      else if (ch === '$' && next === '{') { put(ch); put(next); i++; stack.push(mode); mode = 'expr'; braces = 0; }
      else put(ch);
      continue;
    }
    /* code, or the inside of a template expression. */
    if (ch === '/' && next === '/') { stack.push(mode); mode = 'line'; put(ch); put(next); i++; continue; }
    if (ch === '/' && next === '*') { stack.push(mode); mode = 'block'; put(ch); put(next); i++; continue; }
    if (ch === "'") { stack.push(mode); mode = 'sq'; put(ch); continue; }
    if (ch === '"') { stack.push(mode); mode = 'dq'; put(ch); continue; }
    if (ch === '`') { stack.push(mode); mode = 'template'; put(ch); continue; }
    if (mode === 'expr') {
      if (ch === '{') braces++;
      else if (ch === '}' && braces === 0) { put(ch); back(); continue; }
      else if (ch === '}') braces--;
    }
    out.push(ch);
  }
  return out.join('');
};

/* The file's text with its comments and string prose blanked out. Blanking the
   whole thing at once rather than line by line matters: a block comment's second
   line carries no opening delimiter of its own, so taken a line at a time the
   prose inside it reads as code — and an apostrophe in it reads as the start of a
   string, which then swallows the real code that follows. */
export const blanked = (lines) => stripLiterals(Array.isArray(lines) ? lines.join('\n') : lines);

/* The text to look for references in: blanked, and with the spread dots gone —
   they start with a dot, so leaving them would read a spread of an imported
   function as a property of it and drop the import. */
export const references = (lines) => blanked(lines).replace(/\.\.\./g, '   ');

/* A mention of the binding, not of something else with the same spelling. */
export const mention = (name) => new RegExp('(?<![.\\w$])' + name.replace(/\$/g, '\\$') + '(?![\\w$])(?!:)');

/* Names the file refers to, in the order they first appear. */
export const mentionedNames = (lines) => {
  const out = new Set();
  for (const m of references(lines).matchAll(/[A-Za-z_$][\w$]*/g)) out.add(m[0]);
  return out;
};

/* Module-level declarations, in source order. */
export const topLevelNames = (lines) => {
  const out = [];
  for (const line of blanked(lines).split('\n')) {
    const m = DECL.exec(line);
    if (m) out.push(m[3] || m[4] || m[5] || m[6]);
  }
  return out;
};

/* Bindings made anywhere, including inside a function. A piece with its own
   `const canvas` inside a helper is not asking for someone else's canvas. */
export const localNames = (lines) => {
  const out = new Set();
  const text = blanked(lines);
  for (const line of text.split('\n')) {
    DECL_ANY.lastIndex = 0;
    let m;
    while ((m = DECL_ANY.exec(line))) out.add(m[1] || m[2]);
  }
  for (const n of paramNames(references(lines))) out.add(n);
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
export const paramNames = (text) => {
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

/* ---------- scope: which of those bindings a given mention falls under ---------- */

/*
   `localNames` answers "does this file bind the name at all", which is nearly
   right and wrong in the one way that matters: the save section reads
   `function applySavedEdits(world, save)`, and while that shadows `world` inside
   the function, the bootstrap a thousand lines away still means the world out
   there. Read the shadow as covering the whole file and the import for that
   bootstrap quietly disappears — no error at load, just a ReferenceError the
   first time a save is applied.

   So the mentions are placed. A brace walk over blanked text says which function
   body a character sits in, and each body knows the names it binds: its
   parameters, which hold for everything inside it including nested functions, and
   its own `const`s, which hold only for the innermost body that declares them. A
   mention inside a body that binds the name is that binding; a mention outside
   every one of them is somebody else's, and that is what an import is for.

   This is a walk, not a parser. It reads a `const` inside an `if` block as
   covering the function it sits in, which is wider than the block and so the
   conservative way round for the rare case it happens. */
const FUNC_OPENS = [
  new RegExp('\\bfunction\\s*\\*?\\s*[A-Za-z_$][\\w$]*?\\s*\\((' + PLIST + ')\\)\\s*\\{', 'g'),
  new RegExp('\\((' + PLIST + ')\\)\\s*=>\\s*\\{', 'g'),
  new RegExp('(?:^|[\\s{;])(?:async\\s+)?(?:get\\s+|set\\s+)?(?!' + NON_METHOD + '\\b)([A-Za-z_$][\\w$]*)\\s*\\((' + PLIST + ')\\)\\s*\\{', 'g')
];
const ARROW_BODY = /([A-Za-z_$][\w$]*)\s*=>|((?:\([^)]*\))\s*=>)/g;

/* Every function body in the text: where it runs to, and the names it binds. */
const functionBodies = (text) => {
  const paramsAt = new Map();
  const arrowsAt = new Map();
  for (const re of FUNC_OPENS) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const names = paramNames(m[0].replace(/\{\s*$/, ''));
      const at = m.index + m[0].length - 1;
      paramsAt.set(at, { names: new Set([...(paramsAt.get(at)?.names || []), ...names]), sig: m.index });
    }
  }
  /* A braceless arrow's body is the expression after it. It runs to the end of
     the line: nothing in the game spans an arrow expression across lines, and the
     end of the line is the short end of the ambiguity. */
  for (const m of text.matchAll(ARROW_BODY)) {
    const at = m.index;
    const after = m.index + m[0].length;
    if (text[after] === '{') continue;                       // already a body with braces
    let to = text.indexOf('\n', after);
    if (to < 0) to = text.length;
    arrowsAt.set(after, { at, to, names: paramNames(m[0].replace(/=>$/, '')) });
  }

  const bodies = [];
  const stack = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') {
      stack.push({ at: i, names: paramsAt.get(i) || new Set(), arrow: null });
      const known = paramsAt.get(i);
      if (known) { stack[stack.length - 1].names = known.names; stack[stack.length - 1].sig = known.sig; }
      const arrow = arrowsAt.get(i);
      if (arrow) { stack[stack.length - 1].names = arrow.names; stack[stack.length - 1].sig = arrow.at; }
      continue;
    }
    if (ch !== '}') continue;
    const open = stack.pop();
    if (!open) continue;
    /* Every body is recorded, not only the ones that already bind something: a
       body's `const`s are found afterwards, and a helper with no parameters is
       exactly where one of them hides. */
    bodies.push({ from: open.at, to: i, names: open.names, sig: open.sig ?? open.at });
  }
  for (const arrow of arrowsAt.values()) bodies.push({ from: arrow.at, to: arrow.to, names: arrow.names, sig: arrow.at });

  /* A declaration belongs to the innermost body that holds it, and to nothing
     wider: the world a helper makes for itself is not the world the code around
     it is talking about. */
  for (const m of text.matchAll(new RegExp(DECL_ANY.source, 'g'))) {
    const name = m[1] || m[2];
    if (!name) continue;
    const at = m.index + m[0].length - name.length - 1;
    let best = null;
    for (const body of bodies) {
      if (at > body.from && at < body.to && (!best || body.to - body.from < best.to - best.from)) best = body;
    }
    if (best) best.names.add(name);
  }
  return bodies;
};

/* The file's scope map: its blanked text, the bodies in it, and what is bound
   outside all of them. */
export const scopes = (lines) => {
  const text = blanked(lines);
  const bodies = functionBodies(text);
  const moduleBound = new Set();
  const inside = (at) => bodies.some((b) => at > b.from && at < b.to);
  for (const m of text.matchAll(new RegExp(DECL_ANY.source, 'g'))) {
    const name = m[1] || m[2];
    if (name && !inside(m.index + m[0].length - name.length - 1)) moduleBound.add(name);
  }
  return { text, bodies, moduleBound, cache: new Map() };
};

/* The text with the bodies that bind `name` blanked out: what is left is every
   mention that is not that name's own. */
const unboundText = (sc, name) => {
  if (!sc.cache.has(name)) {
    const out = sc.text.split('');
    for (const body of sc.bodies) {
      if (!body.names.has(name)) continue;
      /* From the signature, not from the brace: `function applySavedEdits(world,
         save)` spells `world` out before its body starts, and that is the
         parameter, not a request for somebody else's world. */
      for (let i = body.sig; i < body.to && i < out.length; i++) if (out[i] !== '\n') out[i] = ' ';
    }
    sc.cache.set(name, out.join('').replace(/\.\.\./g, '   '));
  }
  return sc.cache.get(name);
};

/* Whether this file reaches for somebody else's `name`: it spells it somewhere
   no binding of its own covers, and it does not bind it at module level either. */
export const reachesFor = (sc, name) => !sc.moduleBound.has(name) && mention(name).test(unboundText(sc, name));

/*
 * The rules, as cases. Each is a snippet of the game's own shapes with what it
 * binds and what it refers to. Both tools run these before they say anything
 * about the game: a rule that quietly stops matching would delete an import or
 * leave a wrong one in, and neither is a crash anyone sees before a player does.
 */
export const SCOPE_CASES = [
  // a function declaration binds its own name as well as its parameters
  { code: 'function addLightBFS(world, kind, x, y, z) {', binds: ['addLightBFS', 'world', 'kind', 'x', 'y', 'z'] },
  { code: 'processMeshing(budgetMs = CHUNK_BUDGET_MS) {', binds: ['budgetMs'], refs: ['CHUNK_BUDGET_MS'] },
  { code: 'flushFlowRemesh(budget = WATER_REMESH_BUDGET, msBudget = WATER_REMESH_MS) {', binds: ['budget', 'msBudget'], refs: ['WATER_REMESH_BUDGET', 'WATER_REMESH_MS'] },
  { code: 'sampleColumn(x, z) {', binds: ['x', 'z'] },
  { code: 'processGeneration(budgetMs) { this.run(CHUNK_BUDGET_MS - delta); }', binds: ['budgetMs'], refs: ['CHUNK_BUDGET_MS', 'delta'] },
  { code: 'if (daylight < 0.35) {', binds: [], refs: ['daylight'] },
  { code: 'const n = world.getBlock(x, y, z);', binds: ['n'], refs: ['x', 'y', 'z'] },
  { code: '(a, b) => a + b', binds: ['a', 'b'] },
  { code: 'tiles.map((t) => tileRect(t))', binds: ['t'], refs: ['tileRect'] },
  { code: 'chunks.forEach((chunk) => { notifyChunkMeshed(chunk); })', binds: ['chunk'], refs: ['notifyChunkMeshed'] },
  // the words in a message are not the game's names, and the world class is not
  // wanted by every file that prints the word
  { code: "console.warn('World save failed:', err);", binds: [], refs: ['err'] },
  { code: "saveStatusEl.textContent = 'World saved ' + formatSavedAt(lastSaveAt);", binds: [], refs: ['formatSavedAt', 'lastSaveAt'] },
  // ...what else, and a template's hole is still code
  { code: 'const all = { ...stacks, count };', binds: ['all'], refs: ['stacks', 'count'] },
  { code: 'const label = `chunk ${key} at ${chunkPos.x}`;', binds: ['label'], refs: ['key', 'chunkPos'] },
  { code: "const s = `it's ${ready ? 'on' : 'off'}`;", binds: ['s'], refs: ['ready'] },
  // an apostrophe in prose is not the start of a string, so the code after it
  // still counts
  { code: "const tile = atlasPage;   // don't stop the atlas from building", binds: ['tile'], refs: ['atlasPage'] },
  { code: "/* the player's own look */ turnPlayer(dx, dy);", binds: [], refs: ['turnPlayer'] },
  /* And whether a file reaches for somebody else's name. Each case is given the
     name to ask about, with the code either side of a signature that shadows it:
     the save section's `world` parameter, and the atlas's own canvas. */
  { code: 'function applySavedEdits(world, save) { world.edits = save.edits; }', reaches: [['world', false], ['save', false], ['applySavedEdits', false]] },
  { code: 'function applySavedEdits(world, save) { world.edits = save.edits; }\napplySavedEdits(world, loadedSave);', reaches: [['world', true]] },
  { code: 'function paintAtlas() {\n  const canvas = document.createElement(\'canvas\');\n  return canvas;\n}', reaches: [['canvas', false], ['paintAtlas', false]] },
  { code: "const canvas = document.createElement('canvas');\nfunction paint() { return canvas; }", reaches: [['canvas', false]] },
  { code: 'function outer() { const seen = 1; return seen; }\nfunction other() { return seen; }', reaches: [['seen', true]] },
  { code: 'const atlasPage = paintAtlas();\nconst rect = atlasPage.getBoundingClientRect();', reaches: [['paintAtlas', true], ['rect', false]] }
];

/* Checks the rules above against their cases. Returns nothing when they hold, or
   one line per rule that has stopped matching the shapes it was written for. */
export const scopeSelftest = () => {
  const problems = [];
  for (const c of SCOPE_CASES) {
    const lines = c.code.split('\n');
    const got = [...localNames(lines)].sort();
    const want = [...(c.binds || [])].sort();
    if (c.binds && got.join(' ') !== want.join(' ')) {
      problems.push(`  binds  ${JSON.stringify(c.code)}\n         wanted [${want}] got [${got}]`);
    }
    for (const name of c.refs || []) {
      if (!mention(name).test(references(lines))) problems.push(`  refers ${JSON.stringify(c.code)}\n         ${name} is not seen`);
    }
    const sc = scopes(lines);
    for (const [name, want] of c.reaches || []) {
      const got = reachesFor(sc, name);
      if (got !== want) {
        problems.push(`  reaches ${JSON.stringify(c.code)}\n         ${name}: wanted ${want} got ${got}`);
      }
    }
  }
  return problems;
};
