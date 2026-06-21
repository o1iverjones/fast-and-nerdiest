# The Fast and The Nerdiest — Project Notes for Claude

A multiplayer Wikipedia-racing web game. Two players each start on one article
and race to reach the other player's starting article ("head-to-head"). Also
supports a single-player mode vs a bot.

---

## Branching & Deployment

**Two-branch model — never push directly to `main`.**

| Branch | Purpose | Environment |
|---|---|---|
| `dev` | Active development | Dev (verify locally / online dev env) |
| `main` | Production releases | Production (Railway) |

- Do all work on `dev`; commit and push to `dev`.
- Promote to production by opening a **PR from `dev` → `main`** and merging it.
- This protects the production deploy: `main` should always be verified.
- Remote: `https://github.com/o1iverjones/fast-and-nerdiest`

---

## Tech Stack

- **Server:** Node.js + Express + Socket.IO (`server/`, CommonJS). Entry: `server/index.js`.
- **Client:** React 19 + Vite (`client/`, ESM/JSX).
- **Content:** Wikipedia REST/`api.php` proxied through the server (`server/wikiService.js`).
- **Hosting:** Railway (`railway.toml`): build `npm run build`, start `npm start`, healthcheck `/api/rooms`.

## Project Structure

- `server/index.js` — Express + Socket.IO server, all game socket handlers.
- `server/gameManager.js` — room/player state. Players are keyed by a stable
  `pid` (survives reconnects); `socketId` is the live connection.
- `server/wikiService.js` — fetch/clean Wikipedia article HTML, links, random
  (non-stub) article selection.
- `server/bot.js` — bot opponent pathfinding.
- `client/src/components/` — `Lobby`, `Game`, `ArticleView`, `Sidebar`, `PostGame`.
- `client/src/socket.js` — Socket.IO client + stable per-tab `pid`.

## Commands

```bash
npm run install:all   # install server + client deps
npm run dev           # run server with nodemon
cd client && npm run build   # build client (also run by Railway build)
```

## Conventions

- Player identity is the stable `pid`, **not** `socket.id` (which changes on
  reconnect). Resolve pid from a socket via `gm.getPidBySocket(socket.id)`.
- Multiplayer is head-to-head: each player has their own `startArticle` /
  `targetArticle`; one player's target is the other's start.
- Server-rendered article HTML rewrites both `<a>` and `<area>` (image-map)
  `/wiki/` links to `data-wiki-link` for in-game navigation.
