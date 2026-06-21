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

const activeBots    = new Map(); // roomId -> Bot
const previewReady  = new Map(); // roomId -> Set of playerIds who skipped
const previewTimers = new Map(); // roomId -> setTimeout handle

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

  socket.on('create_room', ({ playerName }) => {
    const room = gm.createRoom(socket.id, playerName);
    socket.join(room.id);
    socket.emit('room_created', { roomId: room.id, room: serializeRoom(room) });
    broadcastRooms();
  });

  socket.on('join_room', ({ roomId, playerName }) => {
    const room = gm.joinRoom(roomId, socket.id, playerName);
    if (!room) {
      socket.emit('error', { message: 'Room not found or already full.' });
      return;
    }
    socket.join(roomId);
    io.to(roomId).emit('player_joined', { room: serializeRoom(room) });
    broadcastRooms();
  });

  socket.on('create_bot_game', ({ playerName, difficulty }) => {
    const room = gm.createRoom(socket.id, playerName);
    gm.addBot(room.id, difficulty);
    socket.join(room.id);
    const updated = gm.getRoom(room.id);
    socket.emit('room_created', { roomId: room.id, room: serializeRoom(updated) });
  });

  // --- Game ---

  socket.on('start_game', async ({ roomId }) => {
    const room = gm.getRoom(roomId);
    if (!room) return;
    if (room.host !== socket.id) return;

    let startArticle, targetArticle;
    try {
      [startArticle, targetArticle] = await pickArticlePair();
    } catch {
      socket.emit('error', { message: 'Could not fetch Wikipedia articles. Check your connection.' });
      return;
    }

    // Countdown phase
    io.to(roomId).emit('game_countdown', { startArticle, targetArticle, seconds: 3 });

    setTimeout(() => {
      const previewing = gm.beginPreview(roomId, startArticle, targetArticle);
      if (!previewing) return;

      // Tell clients to show target article preview
      io.to(roomId).emit('game_started', {
        startArticle,
        targetArticle,
        room: serializeRoom(previewing),
        previewDuration: PREVIEW_DURATION,
      });

      // Server-side 30s timer — fires if not all players skip first
      previewReady.set(roomId, new Set());
      const timer = setTimeout(() => launchRace(roomId), PREVIEW_DURATION);
      previewTimers.set(roomId, timer);
    }, 3500);
  });

  socket.on('preview_ready', ({ roomId }) => {
    const room = gm.getRoom(roomId);
    if (!room || room.status !== 'preview') return;
    if (!room.players[socket.id] || room.players[socket.id].isBot) return;

    const ready = previewReady.get(roomId) || new Set();
    ready.add(socket.id);
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
    if (!room.players[socket.id]) return;

    gm.updatePlayerArticle(roomId, socket.id, article);
    const updated = gm.getRoom(roomId);
    const player = updated.players[socket.id];

    socket.to(roomId).emit('opponent_moved', {
      playerId: socket.id,
      article,
      clickCount: player.clickCount,
    });

    // Check win
    if (article.toLowerCase() === room.targetArticle.toLowerCase()) {
      const result = gm.setWinner(roomId, socket.id);
      if (!result) return;

      cleanupBot(roomId);

      io.to(roomId).emit('game_over', {
        winnerId: socket.id,
        winnerName: result.players[socket.id]?.name || 'Player',
        paths: gm.getPaths(roomId),
        duration: result.endTime - result.startTime,
      });
    }
  });

  socket.on('rematch_request', ({ roomId }) => {
    socket.to(roomId).emit('rematch_requested', { from: socket.id });
  });

  socket.on('chat_message', ({ roomId, message }) => {
    const room = gm.getRoom(roomId);
    if (!room || !room.players[socket.id]) return;
    const name = room.players[socket.id].name;
    const safe = message.slice(0, 200);
    io.to(roomId).emit('chat_message', { name, message: safe });
  });

  // --- Disconnect ---

  socket.on('disconnect', () => {
    console.log(`[disconnect] ${socket.id}`);
    const room = gm.getRoomByPlayerId(socket.id);
    const roomId = room?.id;

    gm.removePlayer(socket.id);

    if (roomId) {
      cleanupBot(roomId);
      io.to(roomId).emit('player_disconnected', { playerId: socket.id });
      broadcastRooms();
    }
  });
});

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
    const { startArticle, targetArticle, botDifficulty } = room;
    const bot = new Bot({
      difficulty: botDifficulty,
      targetArticle,
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
    bot.start(startArticle);
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
