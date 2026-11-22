/*
 * Telling the player something is the screen's job. Deciding that something is
 * worth saying is not: it belongs wherever the thing happened — a set of armour
 * wearing through, a bite refused, a sheep already shorn. So this file holds one
 * service for the sentence and no opinion about how it arrives.
 *
 * The page hands over a speaker at bootstrap, the same way it hands over the
 * pictures of the body. Until then the words go nowhere, which is what lets a
 * save, a headless run, or a module that has never seen an element, tell the
 * player that something ran out.
 */
let speaker = () => {};

/** The page says how a line of text reaches the player. */
export function registerSpeaker(speak) { speaker = speak; }

/** Tells the player one line, whatever that means on this screen. */
export function say(text) {
  speaker(text);
}
