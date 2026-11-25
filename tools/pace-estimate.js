/*
 * Pace estimate: what each beacon should cost a player, from the game's own
 * numbers, set beside what this world's playtest log measured.
 *
 * Run it in a page with the game booted (any world; the monuments are a pure
 * function of the seed and SP0, so a fresh world is fine):
 *
 *   fetch('tools/pace-estimate.js').then(r => r.text()).then(eval)
 *
 * Pass assumptions by setting `window.paceAssumptions` first, for example
 * `{ secondsPerHit: 1.2, overheadPerKill: 15 }`. It prints a table and returns
 * the rows.
 *
 * The model, one row per beacon. Beacon 1 is a walk: the purse starts with
 * its price. Every later beacon is lit with essence hunted in the zone of the
 * beacon before it, with the best sword that beacon's recipes allow, against
 * that night's mix of hostiles at that zone's difficulty:
 *
 * - killsNeeded: the price over the mean essence per kill, less the share
 *   assumed lost to fading
 * - fightMinutes: kills times (blows to kill times seconds per blow, plus a
 *   fixed overhead per kill for finding the next one and running over the
 *   bubbles)
 * - nights: how many nights that fighting fills. Hostiles only crowd in after
 *   dark, so each of these is a whole day/night cycle on the calendar
 * - floorMinutes: the walk plus the fighting, with nothing else done. No real
 *   player gets near it
 * - nightBoundMinutes: the nights as whole cycles, plus the walk. The honest
 *   estimate for a player who fights only at night and uses each day to mine,
 *   craft and build. Sleeping through a night pushes it out by a cycle
 *
 * Left out on purpose: essence from ore (it only helps), damage taken, armour,
 * deaths, and the time it takes to find iron and diamonds. The measured
 * column is where those show up. Set beside the model, the gap says how much
 * of a beacon goes on things other than the hunt.
 */
(async function paceEstimate() {
  const v = window.__voxelcraft;
  if (!v) throw new Error('pace-estimate: the game is not booted on this page');

  const [config, beacons, mob, combat, sky] = await Promise.all([
    import('/src/config.js'), import('/src/beacons.js'), import('/src/mob.js'),
    import('/src/combat.js'), import('/src/sky.js')
  ]);

  const assume = Object.assign({
    // Blows rarely land on the cooldown: knockback sends the mob off a pace.
    secondsPerHit: Math.max(combat.ATTACK_COOLDOWN, 0.9),
    // Finding the next hostile, closing on it, and running over its bubbles.
    overheadPerKill: 12,
    // Essence that fades in the dark before anyone reaches it.
    fadedShare: 0.15,
    // How much farther than the straight line the walk turns out.
    detour: 1.6
  }, window.paceAssumptions || {});

  // How much of a cycle the sky calls night, sampled from the sky itself.
  const savedTime = sky.dayTime;
  let nightSamples = 0;
  const SAMPLES = 480;
  for (let i = 0; i < SAMPLES; i++) {
    sky.setDayTime(i / SAMPLES);
    sky.applyDayNight();
    if (sky.isNight()) nightSamples++;
  }
  sky.setDayTime(savedTime);
  sky.applyDayNight();
  const cycleMinutes = config.DAY_LENGTH_SECONDS / 60;
  const nightSeconds = config.DAY_LENGTH_SECONDS * (nightSamples / SAMPLES);

  const SWORD_BY_LIT = { 1: 'wood', 2: 'stone', 3: 'iron', 4: 'diamond' };
  const measured = v.pacing().beacons;
  const round1 = (n) => Math.round(n * 10) / 10;

  const rows = beacons.beaconSites().map((site, index) => {
    const walkMinutes = (site.hop * assume.detour) / config.WALK_SPEED / 60;
    const log = measured[index] || {};
    const row = {
      beacon: index + 1,
      hop: site.hop,
      cost: site.cost,
      walkMinutes: round1(walkMinutes)
    };
    if (index === 0) {
      Object.assign(row, {
        floorMinutes: round1(walkMinutes),
        nightBoundMinutes: round1(walkMinutes)
      });
    } else {
      const from = beacons.beaconSites()[index - 1];
      const difficulty = beacons.difficultyAt(from.x, config.SEA_LEVEL, from.z);
      const lit = index; // beacons running while this one is hunted for
      const sword = SWORD_BY_LIT[lit];
      const damage = combat.SWORD_DAMAGE[sword];
      let essencePerKill = 0;
      let secondsPerKill = 0;
      for (const [type, share] of mob.hostileMix(lit)) {
        const def = mob.MOB_DEFS[type];
        const health = Math.max(1, Math.round(
          def.health * (1 + config.DIFFICULTY_HEALTH_SCALE * difficulty)));
        const hits = Math.ceil(health / damage);
        const essence = ((def.essence.min + def.essence.max) / 2) *
          (1 + config.DIFFICULTY_ESSENCE_SCALE * difficulty);
        essencePerKill += share * essence;
        secondsPerKill += share * (hits * assume.secondsPerHit + assume.overheadPerKill);
      }
      const kills = Math.ceil(site.cost / (essencePerKill * (1 - assume.fadedShare)));
      const fightMinutes = (kills * secondsPerKill) / 60;
      const nights = Math.max(1, Math.ceil((kills * secondsPerKill) / nightSeconds));
      Object.assign(row, {
        difficulty: round1(difficulty),
        sword,
        essencePerKill: round1(essencePerKill),
        killsNeeded: kills,
        fightMinutes: round1(fightMinutes),
        nights,
        floorMinutes: round1(walkMinutes + fightMinutes),
        nightBoundMinutes: round1(walkMinutes + nights * cycleMinutes)
      });
    }
    row.measuredMinutes = log.status === 'lit' || log.status === 'open' ? log.minutes : null;
    row.measured = log.status || null;
    return row;
  });

  const total = (key) => round1(rows.reduce((sum, row) => sum + (row[key] || 0), 0));
  const report = {
    assumptions: { ...assume, nightMinutes: round1(nightSeconds / 60), cycleMinutes },
    rows,
    totals: {
      floorMinutes: total('floorMinutes'),
      nightBoundMinutes: total('nightBoundMinutes'),
      measuredMinutes: total('measuredMinutes')
    },
    assisted: v.pacing().assisted
  };
  console.table(rows);
  console.log('pace-estimate', JSON.stringify(report.totals), 'assumptions', JSON.stringify(report.assumptions));
  if (report.assisted) console.log('pace-estimate: this world\'s log is assisted', report.assisted);
  return report;
})();
