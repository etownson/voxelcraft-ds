/*
 * The transmitter's words, kept whole. A transmission that talks over the
 * hotbar is spotty on purpose and gone the moment it is closed, so the story is
 * easy to miss the first time round; this is the copy the walker can go back to
 * and read in order, on the journal's second page — a page every journal has,
 * so finding the way back to a missed line never means hunting for a switch.
 *
 * The words themselves belong to the mission: beacons.js holds them and hands
 * them to the panel that types them out. This layer only asks which of them have
 * been heard, and the mission's own count answers that — an entry joins the
 * journal when its beacon is lit, so the journal can never spoil a beacon that
 * has not been found, and the save already keeps that number, so nothing here
 * needs saving of its own.
 *
 * Reading is quiet. The page carries the words with no sound and no line-by-
 * line timing, and it never replays the transmission: the panel over the hotbar
 * speaks once, at the moment the beacon is lit, and that is all.
 */

import { SPAWN_TRANSMISSION, TRANSMISSIONS, beaconsActivatedCount } from './beacons.js';

/**
 * Every transmission the walker has heard, oldest first: the arrival at SP0,
 * then one entry per lit beacon, in mission order. Read off the mission count
 * rather than kept in a list, so a save cannot hand back a story the player has
 * not listened to yet.
 */
export function receivedTransmissions() {
  const heard = [{ heading: 'Arrival at SP0', lines: SPAWN_TRANSMISSION }];
  const lit = Math.min(beaconsActivatedCount(), TRANSMISSIONS.length);
  for (let index = 0; index < lit; index++) {
    heard.push({ heading: 'Beacon ' + (index + 1), lines: TRANSMISSIONS[index] });
  }
  return heard;
}

/**
 * The journal's second page: one block per transmission, headed by the beacon
 * that carried it, its lines whole and unbroken. It borrows the journal column
 * so the two pages read as one book.
 */
export function buildTransmissionColumn() {
  const column = document.createElement('div');
  column.className = 'journal-column transmission-column';

  for (const entry of receivedTransmissions()) {
    const block = document.createElement('div');
    block.className = 'transcript-entry';

    const heading = document.createElement('div');
    heading.className = 'transcript-heading';
    heading.textContent = entry.heading;
    block.append(heading);

    for (const line of entry.lines) {
      const said = document.createElement('p');
      said.className = 'transcript-line';
      said.textContent = line;
      block.append(said);
    }
    column.append(block);
  }
  return column;
}
