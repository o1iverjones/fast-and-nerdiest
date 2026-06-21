const crypto = require('crypto');

const rooms = new Map();         // roomId -> room
const playerToRoom = new Map();  // socketId -> roomId

function generateRoomId() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function createRoom(hostId, hostName) {
  const id = generateRoomId();
  const room = {
    id,
    host: hostId,
    players: {
      [hostId]: makePlayer(hostId, hostName)
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
  playerToRoom.set(hostId, id);
  return room;
}

function makePlayer(id, name, isBot = false) {
  return { id, name, currentArticle: null, path: [], clickCount: 0, isBot };
}

function joinRoom(roomId, playerId, playerName) {
  const room = rooms.get(roomId);
  if (!room || room.status !== 'waiting') return null;
  if (Object.keys(room.players).filter(id => !room.players[id].isBot).length >= 2) return null;

  room.players[playerId] = makePlayer(playerId, playerName);
  playerToRoom.set(playerId, roomId);
  return room;
}

function addBot(roomId, difficulty) {
  const room = rooms.get(roomId);
  if (!room) return null;

  const botId = `bot-${roomId}`;
  const names = { easy: 'EasyBot', medium: 'MediumBot', hard: 'HardBot' };
  room.players[botId] = makePlayer(botId, names[difficulty] || 'Bot', true);
  room.hasBot = true;
  room.botDifficulty = difficulty;
  return room;
}

function beginPreview(roomId, startArticle, targetArticle) {
  const room = rooms.get(roomId);
  if (!room) return null;

  room.startArticle = startArticle;
  room.targetArticle = targetArticle;
  room.status = 'preview';

  for (const player of Object.values(room.players)) {
    player.currentArticle = startArticle;
    player.path = [startArticle];
    player.clickCount = 0;
  }

  return room;
}

function startRace(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.status !== 'preview') return null;

  room.status = 'playing';
  room.startTime = Date.now();

  return room;
}

function updatePlayerArticle(roomId, playerId, article) {
  const room = rooms.get(roomId);
  if (!room) return null;

  const player = room.players[playerId];
  if (!player) return null;

  player.currentArticle = article;
  player.path.push(article);
  player.clickCount = player.path.length - 1;

  return room;
}

function setWinner(roomId, winnerId) {
  const room = rooms.get(roomId);
  if (!room || room.status === 'finished') return null;

  room.winner = winnerId;
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

function removePlayer(playerId) {
  const roomId = playerToRoom.get(playerId);
  playerToRoom.delete(playerId);
  if (!roomId) return null;

  const room = rooms.get(roomId);
  if (!room) return null;

  delete room.players[playerId];

  const humanPlayers = Object.values(room.players).filter(p => !p.isBot);
  if (humanPlayers.length === 0) {
    rooms.delete(roomId);
  }

  return roomId;
}

function getRoomByPlayerId(playerId) {
  const roomId = playerToRoom.get(playerId);
  return roomId ? rooms.get(roomId) : null;
}

module.exports = {
  createRoom, joinRoom, addBot, beginPreview, startRace, updatePlayerArticle,
  setWinner, getPaths, getRoom, getPublicRooms, removePlayer, getRoomByPlayerId
};
