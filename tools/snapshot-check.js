/*
 * Compares the live world against tools/snapshot-baseline.json.
 *
 * Run it as the whole script of a page evaluate, against a static server on the
 * repo root (node tools/dev-server.mjs), after wiping the save and reloading:
 *
 *   window.__voxelcraft.wipeSave();   // then reload
 *   fetch('tools/snapshot-check.js').then(r => r.text()).then(eval)
 *
 * Sections are compared as parsed JSON rather than as text, so the baseline
 * stays readable in a diff. The report names every section that differs and
 * shows both sides, which is what turns a red run into a specific commit.
 */
// `cache: 'reload'` because a rebaselined run must not be compared against the
// baseline the browser is still holding from the last run.
Promise.all([
  fetch('tools/snapshot-harness.js', { cache: 'reload' }).then(function (r) { return r.text(); }),
  fetch('tools/snapshot-baseline.json', { cache: 'reload' }).then(function (r) { return r.json(); })
]).then(function (both) {
  var harness = both[0];
  var base = both[1].strict;
  var run = JSON.parse(eval(harness));
  var got = run.strict;
  var bad = [];
  var names = Object.keys(base);
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    if (JSON.stringify(got[name]) !== JSON.stringify(base[name])) {
      bad.push({ section: name, expected: base[name], actual: got[name] });
    }
  }
  var missing = names.filter(function (n) { return !(n in got); });
  var extra = Object.keys(got).filter(function (n) { return names.indexOf(n) < 0; });
  return JSON.stringify({
    pass: bad.length === 0 && missing.length === 0 && extra.length === 0,
    sections: names.length,
    mismatches: bad,
    missingSections: missing,
    unexpectedSections: extra,
    loose: run.loose
  }, null, 2);
})
