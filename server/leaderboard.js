const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// File-backed store for game results. Note: on ephemeral hosts (e.g. Railway
// without a mounted volume) this file resets on redeploy/restart, so "all-time"
// stats are durable only across restarts within a deployment. Point
// LEADERBOARD_FILE at a persistent volume for true durability.
const FILE = process.env.LEADERBOARD_FILE || path.join(__dirname, 'data', 'leaderboard.json');
const MAX_GAMES = 1000;

let games = load();

function load() {
  try {
    const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return Array.isArray(data.games) ? data.games : [];
  } catch {
    return [];
  }
}

function persist() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ games }, null, 2));
    fs.renameSync(tmp, FILE); // atomic replace
  } catch (err) {
    console.error('[leaderboard] failed to persist:', err.message);
  }
}

// players: [{ name, clicks, isBot, winner }]
function recordGame({ players, winnerName, duration, startArticle, targetArticle }) {
  const game = {
    id: crypto.randomBytes(6).toString('hex'),
    finishedAt: Date.now(),
    duration: duration || 0,
    winnerName: winnerName || null,
    startArticle: startArticle || null,
    targetArticle: targetArticle || null,
    players: (players || []).map(p => ({
      name: p.name,
      clicks: p.clicks ?? 0,
      isBot: !!p.isBot,
      winner: !!p.winner,
    })),
  };
  games.push(game);
  if (games.length > MAX_GAMES) games = games.slice(-MAX_GAMES);
  persist();
  return game;
}

function getRecentGames(limit = 10) {
  return games.slice(-limit).reverse();
}

// All-time top scores. A "score" is a game won by a human player. Bots are
// excluded so the boards reflect player achievements.
function getTopScores(limit = 5) {
  const scores = [];
  for (const g of games) {
    const winner = g.players.find(p => p.winner && !p.isBot);
    if (!winner) continue;
    scores.push({
      name: winner.name,
      clicks: winner.clicks,
      duration: g.duration,
      finishedAt: g.finishedAt,
      startArticle: g.startArticle,
      targetArticle: g.targetArticle,
    });
  }
  const fewestClicks = [...scores]
    .sort((a, b) => a.clicks - b.clicks || a.duration - b.duration)
    .slice(0, limit);
  const fastestTimes = [...scores]
    .filter(s => s.duration > 0)
    .sort((a, b) => a.duration - b.duration || a.clicks - b.clicks)
    .slice(0, limit);
  return { fewestClicks, fastestTimes };
}

function getLeaderboards() {
  return { recent: getRecentGames(10), top: getTopScores(5) };
}

module.exports = { recordGame, getRecentGames, getTopScores, getLeaderboards };
