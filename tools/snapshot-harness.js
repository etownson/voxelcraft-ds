/*
 * VoxelCraft refactor guard.
 *
 * A fixed scripted scenario that runs inside ONE synchronous evaluate, so no
 * requestAnimationFrame can interleave and wall-clock time cannot leak in. The
 * world is deterministic off WORLD_SEED, so a pure code move must reproduce
 * `strict` byte for byte. `loose` holds the fields that genuinely depend on
 * real elapsed time or on mob AI's Math.random, and is sanity-only.
 *
 * Before each run: `window.__voxelcraft.wipeSave()` then reload, so the page
 * boots a fresh world instead of restoring the previous run's save. The mission
 * sections insist on this: `beacons` and `beaconGate` read a world that has
 * heard no transmission, and a restored save would light beacons before the
 * harness ever clicks one. Then flushChunks/flushLight inside the harness to
 * drain the streaming queue, because lighting over an unloaded chunk reads 0/0.
 *
 * Usage, against a static server on the repo root (python3 -m http.server):
 *
 *   wipeSave(); reload; then
 *   fetch('tools/snapshot-harness.js').then(r => r.text()).then(eval)
 *
 * and compare `strict` against tools/snapshot-baseline.json. The two must match
 * byte for byte; a mismatch names the section, which names the commit that broke
 * it. `loose` is recorded for context only.
 */
(function () {
  var v = window.__voxelcraft;
  var strict = {};
  var loose = {};
  function ok(name, fn) {
    try { strict[name] = fn(); } catch (e) { strict[name] = 'THREW: ' + e.message; }
  }
  function fix3(n) { return n.toFixed(3); }

  /* [recipe id, expected result, 9 grid cells] - 17 of the 48 recipes, driven
     end to end. The rest are covered by the recipe table digest below. Every
     one of them is locked behind a beacon now, so the list runs only after
     `beaconGate` has walked the mission forward; `beaconGate` itself proves
     the lock holds while nothing has been transmitted. */
  var CRAFT = [["planks","planksx4","log,-,-,-,-,-,-,-,-"],["sticks","stickx4","planks,-,-,planks,-,-,-,-,-"],["crafting_table","crafting_tablex1","planks,planks,-,planks,planks,-,-,-,-"],["torches","torchx4","coal,-,-,stick,-,-,-,-,-"],["furnace","furnacex1","cobblestone,cobblestone,cobblestone,cobblestone,-,cobblestone,cobblestone,cobblestone,cobblestone"],["bread","breadx1","wheat,wheat,wheat,-,-,-,-,-,-"],["door","doorx3","planks,planks,-,planks,planks,-,planks,planks,-"],["shears","shearsx1","iron_ingot,-,-,-,iron_ingot,-,-,-,-"],["bed","bedx1","wool,wool,wool,planks,planks,planks,-,-,-"],["chest","chestx1","planks,planks,planks,planks,-,planks,planks,planks,planks"],["oak_stairs","oak_stairsx4","planks,-,-,planks,planks,-,planks,planks,planks"],["cobblestone_stairs","cobblestone_stairsx4","cobblestone,-,-,cobblestone,cobblestone,-,cobblestone,cobblestone,cobblestone"],["ladder","ladderx3","stick,-,stick,stick,stick,stick,stick,-,stick"],["wood_axe","wood_axex1","planks,planks,-,planks,stick,-,-,stick,-"],["iron_pickaxe","iron_pickaxex1","iron_ingot,iron_ingot,iron_ingot,-,stick,-,-,stick,-"],["iron_helmet","iron_helmetx1","iron_ingot,iron_ingot,iron_ingot,iron_ingot,-,iron_ingot,-,-,-"],["diamond_boots","diamond_bootsx1","diamond,-,diamond,diamond,-,diamond,-,-,-"]];

  v.clearMobs();
  v.start();
  v.clearInventory();
  v.teleport(3.5, 76.62, 24.5);
  v.setTime(0.22);
  v.setTimeScale(0);
  // Drain the streaming queue twice: light over a chunk that is not loaded
  // yet reads 0/0, which is the one thing here that real elapsed time moves.
  v.flushChunks(); v.flushLight(); v.flushChunks(); v.flushLight();

  var feet = function () { return v.stats().feet[1]; };
  var fy = function () { return Math.round(feet()) + 1; };

  ok('stream', function () {
    var s = v.stats();
    return s.loadedChunks + '/' + s.meshedChunks + '/' + s.position.map(fix3).join(',');
  });

  // --- world generation (sections 4 and 6) ---
  ok('columns', function () {
    var out = [];
    for (var x = -64; x <= 64; x += 32) for (var z = -64; z <= 64; z += 32) {
      var c = v.sampleColumn(x, z);
      out.push(x + ',' + z + ':' + c.height + ',' + c.biome);
    }
    return out;
  });

  // --- block and item tables (section 2) ---
  ok('blockDefs', function () {
    return v.giveList().map(function (g) {
      var b = v.blockInfo(g.id) || {};
      return [g.id, b.key, b.hardness, b.tool, b.tier, b.solid, b.opaque, b.cutout, b.light].join('|');
    });
  });

  // --- setBlock / getBlock / lighting (sections 5 and 7) ---
  // The torch at index 4 lights its neighbours, so the block-light column is a
  // real propagation test rather than a constant.
  ok('build', function () {
    var ids = ['stone','dirt','planks','glass','torch','furnace','chest','water','farmland','wheat','ladder','sand','gravel','log','leaves','cobblestone_stairs','oak_stairs','door','bed','snow'];
    var y = fy(), out = [];
    for (var i = 0; i < ids.length; i++) {
      var x = 10 + i, z = 34;
      v.setBlock(x, y - 1, z, 'stone');
      v.setBlock(x, y, z, ids[i]);
      v.flushLight(); v.flushChunks();
      var l = v.getLight(x, y + 1, z);
      out.push(ids[i] + '>' + v.getBlock(x, y, z) + '/' + l.sky + '/' + l.block);
    }
    return out;
  });

  // --- day/night clock and sky light (section 17) ---
  ok('clock', function () {
    var out = [];
    v.setTime(0.22);
    for (var i = 0; i < 6; i++) {
      v.advanceTime(200);
      var t = v.getTime();
      out.push(t.clock + '/' + t.daylight.toFixed(4) + '/' + (v.isNight() ? 'N' : 'D') + '/' + v.getLight(14, 80, 34).sky);
    }
    return out;
  });

  // --- inventory, stacking, durability (section 10) ---
  ok('inventory', function () {
    v.clearInventory();
    v.give('stone', 37); v.give('wheat', 3); v.give('diamond', 5);
    v.give('iron_pickaxe', 1, 120); v.give('iron_sword', 1, 100); v.give('iron_helmet', 1, 90);
    v.give('bread', 4); v.give('apple', 2); v.give('torch', 64); v.give('water_bucket', 1);
    return {
      counts: { stone: v.itemCount('stone'), wheat: v.itemCount('wheat'), torch: v.itemCount('torch'), bread: v.itemCount('bread') },
      slots: v.stats().inventory.map(function (s) { return s ? s.id + 'x' + s.count + (s.dur != null ? '@' + s.dur : '') : ''; }).join(','),
      armour: v.armour()
    };
  });

  // --- recipe table (section 10): every recipe's result, pattern, shapeless
  //     list, and the beacon that transmits it. The trailing flag is whether
  //     that beacon has been lit yet, which at this point in the run is no
  //     recipe at all: a fresh world has heard no transmission. ---
  ok('recipes', function () {
    return v.recipes().map(function (r) {
      return [r.id, r.result.id + 'x' + r.result.count,
        r.shapeless ? r.shapeless.join('+') : (r.pattern || []).join('/'),
        (r.unlockedBy == null ? '-' : r.unlockedBy) + (r.received ? 'got' : 'shut')].join('=');
    });
  });

  // --- the mission: SP0, the five monument columns, and what each wants ---
  // Read while nothing is lit. The columns are a pure function of WORLD_SEED
  // and SP0, so this is as fixed as the world generation above, and the price
  // of each one is the design's one essence per four blocks of travel.
  ok('beacons', function () {
    var b = v.beacons();
    return {
      sp0: b.sp0.x + ',' + b.sp0.z,
      activated: b.activated,
      sites: b.sites.map(function (s) {
        return s.index + '@' + s.at.join(',') + '/' + s.distance + 'blocks/' + s.cost + 'essence/' + (s.lit ? 'lit' : 'dark');
      }),
      next: b.next ? b.next.at.join(',') + '/' + b.next.cost : 'none'
    };
  });

  // --- the gate the mission puts on crafting, and the beacon that lifts it ---
  // A fresh walker knows nothing: planks itself is beyond reach until beacon 1
  // answers. Then the mission is walked the way it is played — the purse filled
  // to the price, the crosshair on the machine, a right click — and what that
  // one click changes is what is recorded here: the count, the essence spent,
  // and the recipes that arrive with the transmission. Only then are the four
  // further monuments fast-forwarded, which is what lets the craft list below
  // reach the iron and diamond rows.
  ok('beaconGate', function () {
    var out = [];
    function attempt(id, cells) {
      var grid = cells.split(',').map(function (c) { return c === '-' ? null : c; });
      v.clearInventory();
      grid.forEach(function (cell) { if (cell) v.give(cell, 4); });
      v.setCraftingGrid('3x3', grid);
      var made = v.craft('3x3');
      out.push(id + ':' + (made ? 'MADE ' + made.id + 'x' + made.count : 'shut'));
    }
    attempt('planks', 'log,-,-,-,-,-,-,-,-');
    attempt('bread', 'wheat,wheat,wheat,-,-,-,-,-,-');
    attempt('iron_pickaxe', 'iron_ingot,iron_ingot,iron_ingot,-,stick,-,-,stick,-');
    attempt('diamond_boots', 'diamond,-,diamond,diamond,-,diamond,-,-,-');
    var journal = function () {
      return v.recipes().filter(function (r) { return r.received; }).length;
    };
    out.push('journal:' + journal());

    // Light beacon 1 for real, the way it is played: purse to the price, the
    // crosshair on the machine, a right click. Where to stand is a search
    // rather than a guess, because the column search only promises ground flat
    // to within two blocks, so a neighbour of the plinth can stand a step
    // taller than the machine and steal the ray. These offsets are tried in a
    // fixed order and the loop stops at the click whose target is the beacon
    // cell itself, which makes the offset that answers a fact about the seed.
    var site = v.beacons().next;
    var at = site.at;
    v.clearInventory();
    var start = v.essence();
    v.grantEssence(site.cost);
    var clicked = null, stood = 'none';
    var OFFSETS = [[2.5, 1.62], [2.5, 0.62], [2.5, 2.62], [3.5, 1.62], [3.5, 2.62], [1.5, 2.62]];
    for (var i = 0; i < OFFSETS.length && !clicked; i++) {
      var d = OFFSETS[i][0], eye = OFFSETS[i][1];
      var spots = [[at[0] + 0.5, at[2] - d], [at[0] + 0.5, at[2] + d],
                   [at[0] - d, at[2] + 0.5], [at[0] + d, at[2] + 0.5]];
      for (var j = 0; j < spots.length && !clicked; j++) {
        v.teleport(spots[j][0], at[1] + eye, spots[j][1]);
        v.lookAt(at[0], at[1], at[2]);
        var c = v.use();
        stood = d + '/' + eye + '/' + j;
        if (c.target && c.target.x === at[0] && c.target.y === at[1] && c.target.z === at[2]) clicked = c;
      }
    }
    var after = v.beacons();
    out.push('stood:' + stood);
    out.push('target:' + (clicked ? clicked.target.id + '@' + [clicked.target.x, clicked.target.y, clicked.target.z].join(',') + '/' + clicked.target.distance.toFixed(2) : 'never found'));
    out.push('purse:' + start + '+' + site.cost + '->' + v.essence());
    out.push('lit:' + after.activated + (after.sites[0].lit ? '' : '/block:' + v.getBlock(at[0], at[1], at[2])));
    out.push('journal:' + journal());

    // The rest of the mission, fast-forwarded, so the craft list can be run in
    // full. Four is enough: beacon 5 carries a transmission and no recipes.
    v.advanceBeacons(4);
    out.push('forward:' + v.beacons().activated + '/' + journal());
    v.clearInventory();
    // The sections after this one work off the walker's own feet — the furnace
    // row is built at the surface above where the harness starts — so the
    // mission is walked back home rather than left standing at the monument.
    v.teleport(3.5, 76.62, 24.5);
    v.look(-2.4, -0.18);
    return out;
  });

  // --- crafting driven end to end, including 2x2 versus 3x3 gating ---
  ok('crafting', function () {
    var out = [];
    for (var i = 0; i < CRAFT.length; i++) {
      var r = CRAFT[i];
      var grid = r[2].split(',').map(function (c) { return c === '-' ? null : c; });
      v.clearInventory();
      grid.forEach(function (id) { if (id) v.give(id, 4); });
      v.setCraftingGrid('3x3', grid);
      var preview = v.craftPreview('3x3');
      var made = v.craft('3x3');
      var want = r[1];
      var got = (made ? made.id + 'x' + made.count : 'null');
      out.push(r[0] + ':' + (got === want ? 'OK' : 'MISMATCH ' + got + '!=' + want)
        + (preview && preview.recipe === r[0] ? '' : '/preview:' + JSON.stringify(preview)));
    }
    // A 3x3-only recipe must not resolve in the 2x2 player grid.
    v.setCraftingGrid('2x2', ['iron_ingot','iron_ingot','iron_ingot','iron_ingot']);
    out.push('gate:' + JSON.stringify(v.craftPreview('2x2')));
    return out;
  });

  // --- furnace: fuel burn, cook progress, output (section 10) ---
  // raw_iron, not iron_ore: iron_ore is not a furnace input at all, and a slot
  // holding it leaves the furnace cold, which is a silent no-op rather than a
  // test. coal burns 80 s, so 90 s of ticking must light it and cook a batch.
  ok('smelting', function () {
    var x = 15, z = 34, y = fy();
    v.setBlock(x, y, z, 'furnace');
    v.setFurnaceSlots(x, y, z, 'raw_iron', 'coal', 3);
    v.tick(30); var f = v.furnace(x, y, z);
    v.tick(60); var g = v.furnace(x, y, z);
    return { after30: JSON.stringify(f), after90: JSON.stringify(g) };
  });

  // --- farming through the real hoe and seed path (section 10) ---
  // Two plinths are built at the local surface height - one to stand on, one to
  // farm - so the crosshair ray cannot be stolen by surrounding terrain, and
  // the hotbar is switched with real Digit keydowns: a hoe tills only in hand,
  // and no selectHotbarSlot hook is exposed.
  //
  // Growth itself is a 1.2% chance per second (CROP_GROWTH_CHANCE), so the
  // stage after a fixed wait is a random draw. Math.random is swapped for a
  // seeded generator across the growing call only, which leaves the growth loop
  // itself untouched and makes the stage it reaches a fact rather than a roll.
  ok('farming', function () {
    var x = 17, z = 44;   // clear of the build strip, which runs along z = 34
    var h = v.sampleColumn(x, z).height;
    function key(k) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: 'Digit' + k, bubbles: true }));
    }
    v.clearInventory(); v.give('wood_hoe', 1); v.give('wheat_seeds', 4);
    v.setBlock(x, h, z - 2, 'stone'); v.setBlock(x, h, z, 'dirt'); v.flushChunks();
    v.teleport(x + 0.5, h + 1.62, z - 1.5); v.lookAt(x, h, z); key('1');
    var tilled = v.tillDirt();
    key('2'); var sowed = v.plantSeed();
    // A dry furrow refuses to grow by design, so the soil beside the crop is
    // flooded before growth is measured; crops() reports the resulting wetness.
    var sown = v.crops()[0];
    if (sown) {
      v.setBlock(sown.at[0] - 1, sown.at[1] - 1, sown.at[2], 'water');
      v.flushChunks();
    }
    var real = Math.random;
    var seed = 1103515245;
    Math.random = function () {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    try {
      var before = v.crops();
      v.growCrops(600);
      var after = v.crops();
    } finally {
      Math.random = real;
    }
    return { h: h, tilled: JSON.stringify(tilled), sowed: JSON.stringify(sowed), before: JSON.stringify(before), after: JSON.stringify(after) };
  });

  // --- player physics: walk, sprint-jump, fall damage (section 11) ---
  ok('physics', function () {
    v.teleport(3.5, 76.62, 24.5); v.look(0, 0);
    var p0 = v.stats().position;
    v.simulate(3, { forward: 1 }); var p1 = v.stats().position;
    v.simulate(2, { forward: 1, sprint: true, jump: true }); var p2 = v.stats().position;
    v.teleport(3.5, 88, 24.5); v.simulate(2, {}); var s = v.stats();
    return {
      from: p0.map(fix3), walk: p1.map(fix3), sprintJump: p2.map(fix3),
      fall: s.position.map(fix3), landed: s.onGround, fallHealth: s.health.points
    };
  });

  // --- fluid solve, self-checking (sections 5 and 8) ---
  ok('water', function () {
    var w = v.waterFlowCheck();
    return { ok: w.ok, cases: w.cases.map(function (c) { return c.name + ':' + c.pass + ':' + c.volume; }) };
  });

  // --- combat and hunger math (section 14). Mobs are cleared first: a mob in
  //     the way changes walk distance, which changes exhaustion. ---
  ok('vitals', function () {
    v.clearMobs();
    v.setHealth(20); v.setHunger(20); v.setSaturation(5);
    v.damage(7, 'guard'); var h = v.health();
    v.give('bread', 1); v.eat(); var g = v.hunger();
    v.heal(3);
    return {
      healthAfterDamage: h.health, healthAfterHeal: v.health().health,
      hunger: g.hunger, saturation: g.saturation, defense: v.armour().defense
    };
  });

  // --- persistence: the same edits must produce the same bytes (section 20) ---
  ok('save', function () {
    var s = v.save();
    return { key: s.key, schema: s.schema, bytes: s.bytes, edits: s.edits, error: s.error };
  });

  loose = {
    fps: v.stats().fps,
    triangles: v.stats().triangles,
    mobCount: v.stats().mobs.total,
    savedAt: v.saveInfo().savedAt
  };

  return JSON.stringify({ strict: strict, loose: loose });
})()
