/*
 * Pacing: how long a world has taken, beacon by beacon. It is a playtest
 * instrument, not part of the game. Nothing reads it back into play, nothing
 * on screen shows it, and it never rides in the save record, whose bytes the
 * snapshot guard compares. It keeps a record of its own beside the save,
 * under `PACING_BASE` for each world.
 *
 * The record counts while the world is being played: real seconds with the
 * menu down, the share of those spent at night, nights begun and nights
 * slept through, the walker's deaths, the hostiles that died near them, and
 * essence three ways (collected from kills, collected from broken ore, and
 * left to fade). Each time a beacon is lit it takes a snapshot of those
 * counters, and the report is the difference between one snapshot and the
 * next, so every beacon gets its own row: how long it took, and what it cost
 * the walker.
 *
 * Nobody hands it events directly. The page feeds it once a frame through
 * `updatePacing` (whether the world is being played, whether it is night, how
 * many beacons are lit) and passes on what the other layers report through
 * their seams: a death from the death view, a sleep from the bed, essence
 * from the essence ledger, a hostile's death from the mob layer. A debug verb
 * that bends the run (a give, a teleport, a time jump, the monument tour)
 * marks the record assisted, along with the reason, so a run that used
 * shortcuts never passes for a clean one.
 *
 * A world that was already under way when pacing first saw it starts its
 * record at the beacon count it found. The rows before that are unknown, and
 * the report says so instead of inventing them.
 */

import { BEACON_COUNT } from './config.js';

/** The per-world storage base. The page adds the world's id, the way the save does. */
export const PACING_BASE = 'voxelcraft:pacing';
const PACING_VERSION = 1;
/** How often a changed record is written while playing. The page also flushes on hide. */
const WRITE_SECONDS = 30;

const COUNTERS = [
  'played', 'nightPlayed', 'nights', 'sleeps', 'deaths', 'hostileDeaths',
  'essenceKills', 'essenceMined', 'essenceFaded'
];

let storageKey = null;
let record = freshRecord();
let writeTimer = WRITE_SECONDS;
let changed = false;
let writing = true;
let wasNight = null;

function zeroCounters() {
  const counters = {};
  for (const name of COUNTERS) counters[name] = 0;
  return counters;
}

function freshRecord() {
  return {
    v: PACING_VERSION,
    startedAt: Date.now(),
    // The beacon count the record began at. null until the first frame says.
    fromBeacon: null,
    // What lit the most recent beacon, as of the latest frame.
    beacons: 0,
    counters: zeroCounters(),
    // One snapshot of `counters` per beacon lit since `fromBeacon`, in order.
    marks: [],
    assisted: {}
  };
}

function readable(stored) {
  return stored && stored.v === PACING_VERSION && stored.counters &&
    Array.isArray(stored.marks) && typeof stored.assisted === 'object';
}

/**
 * Where this world's pacing lives, read back if it is there. A record this
 * build cannot read is replaced rather than repaired: it is a playtest log,
 * not someone's world.
 */
export function loadPacing(key) {
  storageKey = key;
  record = freshRecord();
  try {
    const stored = JSON.parse(localStorage.getItem(key) || 'null');
    if (readable(stored)) {
      record = stored;
      for (const name of COUNTERS) {
        record.counters[name] = Number(record.counters[name]) || 0;
      }
    }
  } catch (unreadable) {}
  wasNight = null;
  changed = false;
}

/** Writes the record now, if anything changed. The page calls this as the tab hides. */
export function flushPacing() {
  if (!writing || !storageKey || !changed) return;
  try {
    localStorage.setItem(storageKey, JSON.stringify(record));
    changed = false;
  } catch (full) {}
}

/** The world is going: erase its pacing and stop writing, so an unload cannot bring it back. */
export function forgetPacing() {
  writing = false;
  if (!storageKey) return;
  try { localStorage.removeItem(storageKey); } catch (unavailable) {}
}

/** Starts the record over, here and in storage: a clean run from this moment. */
export function resetPacing() {
  record = freshRecord();
  wasNight = null;
  changed = true;
  flushPacing();
  return pacingReport();
}

function bump(name, amount = 1) {
  record.counters[name] += amount;
  changed = true;
}

/**
 * One frame. `playing` is whether the world is in front of the walker (the
 * menu down; a crafting screen counts, since crafting is play), `night` whether
 * the sky says so, and `beacons` how many are lit, whoever lit them: counting
 * the change here catches a beacon lit by another player in co-op too.
 */
export function updatePacing(dt, { playing, night, beacons }) {
  if (record.fromBeacon == null) {
    record.fromBeacon = beacons;
    record.beacons = beacons;
    changed = true;
  }
  if (beacons > record.beacons) {
    for (let i = record.beacons; i < beacons; i++) {
      record.marks.push({ beacon: i + 1, at: Date.now(), ...record.counters });
    }
    record.beacons = beacons;
    changed = true;
    flushPacing();
  } else if (beacons < record.beacons) {
    // Only the debug fast-forward runs the mission backwards.
    record.marks = record.marks.filter((mark) => mark.beacon <= beacons);
    record.beacons = beacons;
    markPacingAssisted('beacons rewound');
  }

  if (playing && dt > 0) {
    bump('played', dt);
    if (night) bump('nightPlayed', dt);
    if (night && wasNight === false) bump('nights');
  }
  wasNight = night;

  writeTimer -= dt;
  if (writeTimer <= 0) {
    writeTimer = WRITE_SECONDS;
    flushPacing();
  }
}

/** The walker died. */
export function notePacingDeath() { bump('deaths'); }

/** The walker slept through a night. */
export function notePacingSleep() { bump('sleeps'); }

/** A hostile died in this walker's world, by a blow, an arrow, sunlight or lava. */
export function notePacingHostileDeath() { bump('hostileDeaths'); }

/** Essence collected: `source` is 'kill' for a fallen enemy's, 'mined' for broken ore's. */
export function notePacingEssence(amount, source) {
  bump(source === 'mined' ? 'essenceMined' : 'essenceKills', amount);
}

/** Essence that faded before anyone ran over it. */
export function notePacingEssenceFaded(amount) { bump('essenceFaded', amount); }

/** A debug verb bent the run. The reasons are kept with a count each. */
export function markPacingAssisted(reason) {
  const why = String(reason || 'debug');
  record.assisted[why] = (record.assisted[why] || 0) + 1;
  changed = true;
}

/* ---------- The report ---------- */

const minutes = (seconds) => Math.round((seconds / 60) * 10) / 10;

function segmentBetween(from, to) {
  const delta = (name) => (to[name] || 0) - (from[name] || 0);
  return {
    minutes: minutes(delta('played')),
    nightMinutes: minutes(delta('nightPlayed')),
    nights: delta('nights'),
    sleeps: delta('sleeps'),
    deaths: delta('deaths'),
    hostileDeaths: delta('hostileDeaths'),
    essence: {
      kills: delta('essenceKills'),
      mined: delta('essenceMined'),
      faded: delta('essenceFaded')
    }
  };
}

/**
 * The record as rows: one per beacon, each measured from the beacon before it
 * (beacon 1 from the arrival). A row the record began too late to see says
 * `unknown`; the beacon being worked on now is `open`, measured up to this
 * moment.
 */
export function pacingReport() {
  const from = record.fromBeacon ?? record.beacons;
  const rows = [];
  for (let beacon = 1; beacon <= BEACON_COUNT; beacon++) {
    const row = { beacon };
    if (beacon <= from) {
      row.status = 'unknown';
    } else {
      const endIndex = beacon - from - 1;
      const start = endIndex === 0 ? zeroCounters() : record.marks[endIndex - 1];
      const end = record.marks[endIndex];
      if (end) {
        Object.assign(row, { status: 'lit' }, segmentBetween(start, end));
      } else if (start && beacon === record.beacons + 1) {
        Object.assign(row, { status: 'open' }, segmentBetween(start, record.counters));
      } else {
        row.status = 'ahead';
      }
    }
    rows.push(row);
  }
  const reasons = Object.keys(record.assisted);
  return {
    startedAt: new Date(record.startedAt).toISOString(),
    fromBeacon: from,
    beaconsLit: record.beacons,
    totalMinutes: minutes(record.counters.played),
    assisted: reasons.length ? { ...record.assisted } : false,
    beacons: rows
  };
}
