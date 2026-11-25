/*
 * The wire between browsers: who else is in this co-op room, which of them is
 * the host, and a way to hand any of them a small typed message. Nothing here
 * knows what a block or a zombie is. The co-op layer above names the message
 * types and decides what they mean; this file only carries them.
 *
 * The browsers talk to each other directly over WebRTC, through Trystero. It
 * finds the other players by posting encrypted offers on free public Nostr
 * relays, so there is no server of our own, no account and no bill. Trystero is
 * imported only when a room is opened, so a single-player session never loads
 * it and never touches the network.
 *
 * A room is a short code. The player who opens it is the host: their tab owns
 * the world. Everyone else is a guest. Every peer is connected to every other
 * peer, so a message for "everyone" reaches each of them directly.
 */

/** Bumped whenever a message changes shape, so mismatched builds refuse each other. */
export const NET_PROTOCOL = 2;

/** Scopes the relays' topics to this game, so another app's room "ABC123" is not ours. */
const APP_ID = 'voxelverse-coop';

/** Unambiguous letters and digits, so a code read aloud survives the trip. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;

const HOST_LEFT = 'The host left the game. Their world comes back when they do.';

const state = {
  mode: 'off', // 'off' | 'connecting' | 'host' | 'guest'
  code: null,
  room: null,
  action: null,
  selfId: null,
  hostId: null,
  name: 'Player',
  error: null
};

/** peerId → { id, name, role, joinedAt } for every peer that has said hello. */
export const peers = new Map();

const handlers = new Map();
const peerListeners = new Set();
const statusListeners = new Set();

export function netMode() { return state.mode; }
export function inRoom() { return state.mode === 'host' || state.mode === 'guest'; }
export function isHost() { return state.mode === 'host'; }
export function isGuest() { return state.mode === 'guest'; }
export function roomCode() { return state.code; }
export function selfId() { return state.selfId; }
export function hostId() { return state.mode === 'host' ? state.selfId : state.hostId; }
export function netError() { return state.error; }
export function selfName() { return state.name; }

/** A fresh room code. */
export function makeRoomCode() {
  let code = '';
  const bytes = new Uint8Array(ROOM_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return code;
}

/** What a typed or pasted code means, or null when it cannot be one. */
export function normalizeRoomCode(text) {
  const code = String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== ROOM_CODE_LENGTH) return null;
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return null;
  return code;
}

/** `handler(data, peerId)` for every message of this type. One handler per type. */
export function onMessage(type, handler) { handlers.set(type, handler); }

/** `listener(kind, peer)` when a peer says hello ('join') or goes ('leave'). */
export function onPeers(listener) { peerListeners.add(listener); }

/** `listener()` whenever the mode, the code or the error changes. */
export function onNetStatus(listener) { statusListeners.add(listener); }

function announceStatus() {
  for (const listener of statusListeners) listener();
}

function announcePeer(kind, peer) {
  for (const listener of peerListeners) listener(kind, peer);
}

/**
 * Hands `data` to one peer, a list of them, or everyone (target omitted).
 * Quietly does nothing outside a room, so callers never have to ask first.
 */
export function send(type, data, target = null) {
  if (!state.action || !state.room) return;
  if (target != null && Array.isArray(target) && target.length === 0) return;
  state.action.send({ t: type, d: data }, target == null ? undefined : { target })
    .catch(() => {});
}

/** Sends to the host only; on the host it does nothing. */
export function sendToHost(type, data) {
  if (state.mode !== 'guest' || !state.hostId) return;
  send(type, data, state.hostId);
}

async function openRoom(code, role, name) {
  if (state.room) await leaveRoom();
  state.mode = 'connecting';
  state.code = code;
  state.name = name || 'Player';
  state.error = null;
  state.hostId = null;
  announceStatus();

  let trystero;
  try {
    trystero = await import('trystero');
  } catch (err) {
    fail('Could not load the co-op library. Are you online?');
    throw err;
  }

  const room = trystero.joinRoom({
    appId: APP_ID,
    // The code doubles as the password, so the relays only ever see ciphertext
    // and a stranger guessing room names cannot read the offers.
    password: 'vv:' + code,
    // Tabs in one browser share an identity by default; co-op tests run two
    // tabs side by side, and every tab is its own player here.
    identity: 'none',
    maxUsers: 4
  }, code);
  state.room = room;
  state.action = room.makeAction('vv');

  room.onError((error) => {
    if (error.code === 'room-full') fail('That room is full (4 players).');
    else if (error.code === 'peer-connect-failed') {
      console.warn('Co-op: could not connect to a peer directly', error);
    } else console.warn('Co-op:', error.code, error.message);
  });

  state.action.onMessage((message, context) => {
    if (!message || typeof message !== 'object') return;
    const from = context.peerId;
    if (message.t === 'hello') return receiveHello(message.d, from);
    if (!peers.has(from)) return; // nobody who has not said hello is listened to
    const handler = handlers.get(message.t);
    if (handler) {
      try {
        handler(message.d, from);
      } catch (err) {
        console.warn('Co-op: handling ' + message.t + ' failed', err);
      }
    }
  });

  room.onPeerJoin(({ peerId }) => {
    send('hello', helloPayload(), peerId);
  });

  room.onPeerLeave(({ peerId }) => {
    const peer = peers.get(peerId);
    peers.delete(peerId);
    if (peer) announcePeer('leave', peer);
    if (peerId === state.hostId && state.mode === 'guest') {
      state.hostId = null;
      fail(HOST_LEFT);
    }
  });

  const self = await room.getSelf();
  state.selfId = self.peerId;
  state.mode = role;
  announceStatus();
}

function helloPayload() {
  return { v: NET_PROTOCOL, role: state.mode === 'host' ? 'host' : 'guest', name: state.name };
}

function receiveHello(hello, from) {
  if (!hello || hello.v !== NET_PROTOCOL) {
    console.warn('Co-op: ignoring a peer on another version of the game');
    return;
  }
  const role = hello.role === 'host' ? 'host' : 'guest';
  if (role === 'host' && state.mode === 'host') {
    // Two hosts in one room means two worlds; the one who was there first keeps it.
    console.warn('Co-op: a second host tried to open this room');
    return;
  }
  const known = peers.has(from);
  const peer = { id: from, name: String(hello.name || 'Player').slice(0, 24), role, joinedAt: Date.now() };
  peers.set(from, peer);
  if (role === 'host') {
    state.hostId = from;
    // A host who reloaded is a host who came back.
    if (state.error === HOST_LEFT) state.error = null;
  }
  if (!known) {
    // Hellos cross in the air; whoever has not had ours yet gets it now.
    send('hello', helloPayload(), from);
    announcePeer('join', peer);
  }
}

function fail(message) {
  state.error = message;
  announceStatus();
}

/** Opens a room as its host. Resolves once the room is listening. */
export function hostRoom(code, name) {
  return openRoom(code, 'host', name);
}

/** Joins a room as a guest. Resolves once the room is open; the host may not have answered yet. */
export function joinRoom(code, name) {
  return openRoom(code, 'guest', name);
}

/** Resolves with the host's peer id once their hello arrives, or rejects after `ms`. */
export function waitForHost(ms = 25000) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const tick = () => {
      if (state.hostId) return resolve(state.hostId);
      if (state.mode === 'off') return reject(new Error('left'));
      if (performance.now() - started > ms) return reject(new Error('timeout'));
      setTimeout(tick, 100);
    };
    tick();
  });
}

/** Leaves the room, if there is one. */
export async function leaveRoom() {
  const room = state.room;
  state.room = null;
  state.action = null;
  state.mode = 'off';
  state.hostId = null;
  state.code = null;
  const gone = [...peers.values()];
  peers.clear();
  for (const peer of gone) announcePeer('leave', peer);
  announceStatus();
  if (room) {
    try {
      await room.leave();
    } catch (err) {}
  }
}

/** Everything the debug surface may say about the wire. */
export function netReport() {
  return {
    mode: state.mode,
    code: state.code,
    self: state.selfId,
    host: hostId(),
    name: state.name,
    error: state.error,
    peers: [...peers.values()].map((p) => ({ id: p.id, name: p.name, role: p.role }))
  };
}
