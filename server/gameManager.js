const crypto = require('crypto');

const rooms = new Map();        // roomId -> room
const pidToRoom = new Map();    // playerId (stable) -> roomId
const socketToPid = new Map();  // live socketId -> playerId

function generateRoomId() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

// Players are keyed by a stable `pid` that survives reconnects. `socketId` is
// the current live connection (changes on reconnect, null for bots or while
// disconnected).
function makePlayer(pid, name, isBot = false, socketId = null) {
  return {
    id: pid,
    socketId,
    name,
    isBot,
    connected: true,
    startArticle: null,
    targetArticle: null,
    currentArticle: null,
    path: [],
    clickCount: 0,
  };
}

function createRoom(hostPid, hostName, socketId) {
  const id = generateRoomId();
  const room = {
    id,
    host: hostPid,
    players: {
      [hostPid]: makePlayer(hostPid, hostName, false, socketId)
    },
    status: 'waiting',
    startArticle: null,
    targetArticle: null,
    winner: null,
    startTime: null,
    endTime: null,
    createdAt: Date.now(),
    hasBot: false,
    botDifficulty: null,
  };
  rooms.set(id, room);
  pidToRoom.set(hostPid, id);
  socketToPid.set(socketId, hostPid);
  return room;
}

function joinRoom(roomId, pid, playerName, socketId) {
  const room = rooms.get(roomId);
  if (!room || room.status !== 'waiting') return null;
  if (Object.keys(room.players).filter(id => !room.players[id].isBot).length >= 2) return null;

  room.players[pid] = makePlayer(pid, playerName, false, socketId);
  pidToRoom.set(pid, roomId);
  socketToPid.set(socketId, pid);
  return room;
}

function addBot(roomId, difficulty) {
  const room = rooms.get(roomId);
  if (!room) return null;

  const botId = `bot-${roomId}`;
  const names = { easy: 'EasyBot', medium: 'MediumBot', hard: 'HardBot' };
  room.players[botId] = makePlayer(botId, names[difficulty] || 'Bot', true, null);
  room.hasBot = true;
  room.botDifficulty = difficulty;
  return room;
}

// Head-to-head matchup: each player starts on one article and must reach the
// other. With two players they race toward each other's starting article —
// each player's target is the opponent's start.
function assignMatchup(roomId, articleA, articleB) {
  const room = rooms.get(roomId);
  if (!room) return null;

  Object.values(room.players).forEach((player, i) => {
    const start  = i % 2 === 0 ? articleA : articleB;
    const target = i % 2 === 0 ? articleB : articleA;
    player.startArticle   = start;
    player.targetArticle  = target;
    player.currentArticle = start;
    player.path = [start];
    player.clickCount = 0;
  });

  // Room-level fields retained for reference (host's perspective). Setting
  // status to 'countdown' also blocks new joins during the matchup window.
  room.startArticle = articleA;
  room.targetArticle = articleB;
  room.status = 'countdown';

  return room;
}

function beginPreview(roomId) {
  const room = rooms.get(roomId);
  if (!room) return null;

  room.status = 'preview';
  return room;
}

function startRace(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.status !== 'preview') return null;

  room.status = 'playing';
  room.startTime = Date.now();

  return room;
}

function updatePlayerArticle(roomId, pid, article) {
  const room = rooms.get(roomId);
  if (!room) return null;

  const player = room.players[pid];
  if (!player) return null;

  player.currentArticle = article;
  player.path.push(article);
  player.clickCount = player.path.length - 1;

  return room;
}

function setWinner(roomId, winnerPid) {
  const room = rooms.get(roomId);
  if (!room || room.status === 'finished') return null;

  room.winner = winnerPid;
  room.status = 'finished';
  room.endTime = Date.now();

  return room;
}

function getPaths(roomId) {
  const room = rooms.get(roomId);
  if (!room) return null;

  const result = {};
  for (const [id, player] of Object.entries(room.players)) {
    result[id] = { name: player.name, path: [...player.path], clickCount: player.clickCount, isBot: player.isBot };
  }
  return result;
}

function getRoom(roomId) {
  return rooms.get(roomId);
}

function getPublicRooms() {
  const now = Date.now();
  return Array.from(rooms.values())
    .filter(r => r.status === 'waiting' && !r.hasBot && (now - r.createdAt) < 10 * 60 * 1000)
    .map(r => ({
      id: r.id,
      playerCount: Object.keys(r.players).length,
      hostName: Object.values(r.players)[0]?.name || 'Unknown',
    }));
}

// --- Connection identity & lifecycle ---

function getPidBySocket(socketId) {
  return socketToPid.get(socketId) || null;
}

function getRoomByPid(pid) {
  const roomId = pidToRoom.get(pid);
  return roomId ? rooms.get(roomId) : null;
}

function getRoomBySocket(socketId) {
  const pid = socketToPid.get(socketId);
  return pid ? getRoomByPid(pid) : null;
}

// Mark a socket as disconnected without removing the player, so they can
// reconnect within the grace period. Returns { pid, roomId, player }.
function markDisconnected(socketId) {
  const pid = socketToPid.get(socketId);
  if (!pid) return null;
  socketToPid.delete(socketId);

  const roomId = pidToRoom.get(pid);
  const room = roomId ? rooms.get(roomId) : null;
  const player = room ? room.players[pid] : null;
  if (player && player.socketId === socketId) {
    player.socketId = null;
    player.connected = false;
  }
  return { pid, roomId: room ? roomId : null, player };
}

// Re-bind a reconnecting player's stable pid to its new live socket.
function bindSocket(pid, socketId) {
  const room = getRoomByPid(pid);
  if (!room || !room.players[pid]) return null;

  const player = room.players[pid];
  if (player.socketId) socketToPid.delete(player.socketId);
  player.socketId = socketId;
  player.connected = true;
  socketToPid.set(socketId, pid);
  return room;
}

// Permanently remove a player (grace expired or explicit leave).
function removePlayer(pid) {
  const roomId = pidToRoom.get(pid);
  pidToRoom.delete(pid);
  if (!roomId) return null;

  const room = rooms.get(roomId);
  if (!room) return null;

  const player = room.players[pid];
  if (player && player.socketId) socketToPid.delete(player.socketId);
  delete room.players[pid];

  const humanPlayers = Object.values(room.players).filter(p => !p.isBot);
  if (humanPlayers.length === 0) {
    for (const p of Object.values(room.players)) {
      pidToRoom.delete(p.id);
      if (p.socketId) socketToPid.delete(p.socketId);
    }
    rooms.delete(roomId);
  }

  return roomId;
}

module.exports = {
  createRoom, joinRoom, addBot, assignMatchup, beginPreview, startRace, updatePlayerArticle,
  setWinner, getPaths, getRoom, getPublicRooms, removePlayer,
  getPidBySocket, getRoomByPid, getRoomBySocket, markDisconnected, bindSocket,
};
