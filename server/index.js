require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const gm = require('./gameManager');
const Bot = require('./bot');
const { fetchArticle, fetchRandomArticle } = require('./wikiService');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;
const PREVIEW_DURATION = 30_000; // ms
const DISCONNECT_GRACE = 60_000; // ms a player can be gone before removal

const activeBots       = new Map(); // roomId -> Bot
const previewReady     = new Map(); // roomId -> Set of playerIds who skipped
const previewTimers    = new Map(); // roomId -> setTimeout handle
const disconnectTimers = new Map(); // pid -> setTimeout handle (grace period)

app.use(cors());
app.use(express.json());

// --- Wikipedia API proxy ---

app.get('/api/wiki/article/:title', async (req, res) => {
  try {
    const result = await fetchArticle(req.params.title);
    res.json(result);
  } catch (err) {
    const status = err.code === 'missingtitle' ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

app.get('/api/wiki/random', async (req, res) => {
  try {
    const result = await fetchRandomArticle();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/rooms', (_req, res) => {
  res.json(gm.getPublicRooms());
});

// --- Serve client in production ---
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/dist')));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
  });
}

// --- Socket.io ---

async function pickArticlePair() {
  const [start, target] = await Promise.all([fetchRandomArticle(), fetchRandomArticle()]);
  // Make sure they're not the same
  if (start.title === target.title) return pickArticlePair();
  return [start.title, target.title];
}

io.on('connection', (socket) => {
  console.log(`[connect] ${socket.id}`);

  // --- Lobby ---

  socket.on('get_rooms', () => {
    socket.emit('rooms_list', gm.getPublicRooms());
  });

  socket.on('create_room', ({ playerName, pid }) => {
    const room = gm.createRoom(pid, playerName, socket.id);
    socket.join(room.id);
    socket.emit('room_created', { roomId: room.id, room: serializeRoom(room) });
    broadcastRooms();
  });

  socket.on('join_room', ({ roomId, playerName, pid }) => {
    const room = gm.joinRoom(roomId, pid, playerName, socket.id);
    if (!room) {
      socket.emit('error', { message: 'Room not found or already full.' });
      return;
    }
    socket.join(roomId);
    io.to(roomId).emit('player_joined', { room: serializeRoom(room) });
    broadcastRooms();
  });

  socket.on('create_bot_game', ({ playerName, difficulty, pid }) => {
    const room = gm.createRoom(pid, playerName, socket.id);
    gm.addBot(room.id, difficulty);
    socket.join(room.id);
    const updated = gm.getRoom(room.id);
    socket.emit('room_created', { roomId: room.id, room: serializeRoom(updated) });
  });

  // Reconnect: re-bind a returning player's stable pid to this new socket.
  socket.on('rejoin', ({ roomId, pid }) => {
    const room = gm.getRoom(roomId);
    if (!room || !room.players[pid]) {
      socket.emit('rejoin_failed');
      return;
    }

    const timer = disconnectTimers.get(pid);
    if (timer) { clearTimeout(timer); disconnectTimers.delete(pid); }

    gm.bindSocket(pid, socket.id);
    socket.join(roomId);

    const player = room.players[pid];
    const payload = {
      room: serializeRoom(room),
      status: room.status,
      startArticle: player.startArticle,
      targetArticle: player.targetArticle,
      currentArticle: player.currentArticle,
      path: [...player.path],
      clickCount: player.clickCount,
    };
    if (room.status === 'finished') {
      payload.winnerId = room.winner;
      payload.winnerName = room.players[room.winner]?.name || 'Player';
      payload.paths = gm.getPaths(roomId);
      payload.duration = (room.endTime || 0) - (room.startTime || 0);
    }
    socket.emit('rejoin_accepted', payload);
    socket.to(roomId).emit('player_reconnected', { playerId: pid });
  });

  // --- Game ---

  socket.on('start_game', async ({ roomId }) => {
    const room = gm.getRoom(roomId);
    if (!room) return;
    if (room.host !== gm.getPidBySocket(socket.id)) return;

    let articleA, articleB;
    try {
      [articleA, articleB] = await pickArticlePair();
    } catch {
      socket.emit('error', { message: 'Could not fetch Wikipedia articles. Check your connection.' });
      return;
    }

    const matchup = gm.assignMatchup(roomId, articleA, articleB);
    if (!matchup) return;

    // Countdown phase — each player sees their own start/target (head-to-head).
    for (const player of Object.values(matchup.players)) {
      if (player.isBot || !player.socketId) continue;
      io.to(player.socketId).emit('game_countdown', {
        startArticle: player.startArticle,
        targetArticle: player.targetArticle,
        seconds: 3,
      });
    }

    setTimeout(() => {
      const previewing = gm.beginPreview(roomId);
      if (!previewing) return;

      // Tell each client to show their own target article preview.
      for (const player of Object.values(previewing.players)) {
        if (player.isBot || !player.socketId) continue;
        io.to(player.socketId).emit('game_started', {
          startArticle: player.startArticle,
          targetArticle: player.targetArticle,
          room: serializeRoom(previewing),
          previewDuration: PREVIEW_DURATION,
        });
      }

      // Server-side 30s timer — fires if not all players skip first
      previewReady.set(roomId, new Set());
      const timer = setTimeout(() => launchRace(roomId), PREVIEW_DURATION);
      previewTimers.set(roomId, timer);
    }, 3500);
  });

  socket.on('preview_ready', ({ roomId }) => {
    const room = gm.getRoom(roomId);
    if (!room || room.status !== 'preview') return;
    const pid = gm.getPidBySocket(socket.id);
    if (!pid || !room.players[pid] || room.players[pid].isBot) return;

    const ready = previewReady.get(roomId) || new Set();
    ready.add(pid);
    previewReady.set(roomId, ready);

    // Check if all human players are ready
    const humanIds = Object.values(room.players).filter(p => !p.isBot).map(p => p.id);
    if (humanIds.every(id => ready.has(id))) {
      launchRace(roomId);
    }
  });

  socket.on('article_changed', ({ roomId, article }) => {
    const room = gm.getRoom(roomId);
    if (!room || room.status !== 'playing') return;
    const pid = gm.getPidBySocket(socket.id);
    if (!pid || !room.players[pid]) return;

    gm.updatePlayerArticle(roomId, pid, article);
    const updated = gm.getRoom(roomId);
    const player = updated.players[pid];

    socket.to(roomId).emit('opponent_moved', {
      playerId: pid,
      article,
      clickCount: player.clickCount,
    });

    // Check win against this player's own target (head-to-head).
    if (article.toLowerCase() === player.targetArticle.toLowerCase()) {
      const result = gm.setWinner(roomId, pid);
      if (!result) return;

      cleanupBot(roomId);

      io.to(roomId).emit('game_over', {
        winnerId: pid,
        winnerName: result.players[pid]?.name || 'Player',
        paths: gm.getPaths(roomId),
        duration: result.endTime - result.startTime,
      });
    }
  });

  socket.on('rematch_request', ({ roomId }) => {
    socket.to(roomId).emit('rematch_requested', { from: gm.getPidBySocket(socket.id) });
  });

  socket.on('chat_message', ({ roomId, message }) => {
    const room = gm.getRoom(roomId);
    const pid = gm.getPidBySocket(socket.id);
    if (!room || !pid || !room.players[pid]) return;
    const name = room.players[pid].name;
    const safe = message.slice(0, 200);
    io.to(roomId).emit('chat_message', { name, message: safe });
  });

  // --- Disconnect ---

  socket.on('disconnect', () => {
    console.log(`[disconnect] ${socket.id}`);
    const info = gm.markDisconnected(socket.id);
    if (!info || !info.roomId) return;
    const { pid, roomId } = info;

    const room = gm.getRoom(roomId);
    if (!room) return;

    // Outside an active game (lobby), remove immediately. During a game, keep
    // the slot for a grace period so the player can reconnect.
    const inGame = ['countdown', 'preview', 'playing'].includes(room.status);
    if (!inGame) {
      finalizeRemoval(pid);
      return;
    }

    io.to(roomId).emit('player_disconnected', { playerId: pid });

    const existing = disconnectTimers.get(pid);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      disconnectTimers.delete(pid);
      finalizeRemoval(pid);
    }, DISCONNECT_GRACE);
    disconnectTimers.set(pid, timer);
  });
});

// Permanently remove a player after the grace period (or in the lobby) and
// notify the room.
function finalizeRemoval(pid) {
  const room = gm.getRoomByPid(pid);
  const roomId = room?.id;
  gm.removePlayer(pid);
  if (roomId) {
    cleanupBot(roomId);
    io.to(roomId).emit('player_left', { playerId: pid });
    broadcastRooms();
  }
}

function launchRace(roomId) {
  // Clear preview state
  const timer = previewTimers.get(roomId);
  if (timer) clearTimeout(timer);
  previewTimers.delete(roomId);
  previewReady.delete(roomId);

  const room = gm.startRace(roomId);
  if (!room) return;

  io.to(roomId).emit('race_start');

  // Start bot now that the race is live
  if (room.hasBot) {
    const botId = `bot-${roomId}`;
    const botPlayer = room.players[botId];
    const bot = new Bot({
      difficulty: room.botDifficulty,
      targetArticle: botPlayer.targetArticle,
      onMove: (article, clickCount) => {
        gm.updatePlayerArticle(roomId, botId, article);
        io.to(roomId).emit('opponent_moved', { playerId: botId, article, clickCount });
      },
      onWin: () => {
        const result = gm.setWinner(roomId, botId);
        if (!result) return;
        io.to(roomId).emit('game_over', {
          winnerId: botId,
          winnerName: result.players[botId]?.name || 'Bot',
          paths: gm.getPaths(roomId),
          duration: result.endTime - result.startTime,
        });
        cleanupBot(roomId);
      },
    });
    activeBots.set(roomId, bot);
    bot.start(botPlayer.startArticle);
  }
}

function cleanupBot(roomId) {
  const bot = activeBots.get(roomId);
  if (bot) {
    bot.stop();
    activeBots.delete(roomId);
  }
}

function broadcastRooms() {
  io.emit('rooms_list', gm.getPublicRooms());
}

function serializeRoom(room) {
  return {
    id: room.id,
    host: room.host,
    status: room.status,
    hasBot: room.hasBot,
    botDifficulty: room.botDifficulty,
    players: Object.fromEntries(
      Object.entries(room.players).map(([id, p]) => [
        id,
        { id: p.id, name: p.name, currentArticle: p.currentArticle, clickCount: p.clickCount, isBot: p.isBot }
      ])
    ),
    startArticle: room.startArticle,
    targetArticle: room.targetArticle,
    winner: room.winner,
  };
}

server.listen(PORT, () => {
  console.log(`The Fast and The Nerdiest server running on http://localhost:${PORT}`);
});
