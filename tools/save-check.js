/*
 * Checks that every save the game has ever written still reads.
 *
 * tools/save-fixtures/ holds one real save per schema, v7 onward, exactly as
 * the game stored it. Each one is walked forward through the game's own
 * MIGRATIONS (window.__voxelcraft.migrateSave) and must come out at the
 * current schema with its world, player, pack and containers still there.
 *
 * Run it in a page with the game booted, like the snapshot check:
 *
 *   fetch('tools/save-check.js').then(r => r.text()).then(eval)
 *
 * When SAVE_SCHEMA is bumped: add the step to MIGRATIONS, run this, then save a
 * world at the new schema into tools/save-fixtures/v<N>.json and add N below.
 * Never remove a fixture.
 */
(function () {
  var SCHEMAS = [7];
  return Promise.all(SCHEMAS.map(function (n) {
    return fetch('tools/save-fixtures/v' + n + '.json', { cache: 'reload' })
      .then(function (r) { return r.json(); })
      .then(function (record) {
        var out = window.__voxelcraft.migrateSave(record);
        var problems = [];
        if (!out) problems.push('no migration path');
        else {
          if (out.seed !== record.seed) problems.push('seed changed');
          if (!out.player || !Number.isFinite(out.player.x)) problems.push('player lost');
          if (!Array.isArray(out.inventory)) problems.push('inventory lost');
          if (!out.edits || Object.keys(out.edits).length !== Object.keys(record.edits).length) {
            problems.push('edited chunks lost');
          }
          if (record.entities && !out.entities) problems.push('containers lost');
        }
        return { fixture: 'v' + n, upgradedTo: out ? out.v : null, problems: problems };
      });
  })).then(function (results) {
    return JSON.stringify({
      pass: results.every(function (r) { return r.problems.length === 0; }),
      schema: window.__voxelcraft.saveInfo().schema,
      results: results
    }, null, 2);
  });
})();
