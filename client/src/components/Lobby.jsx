import { useState, useEffect } from 'react';
import socket, { pid } from '../socket.js';
import Leaderboards from './Leaderboards.jsx';

const DIFFICULTIES = [
  { value: 'easy', label: 'Easy', desc: 'Slow & random' },
  { value: 'medium', label: 'Medium', desc: 'Uses hub articles' },
  { value: 'hard', label: 'Hard', desc: 'Greedy pathfinder' },
];

export default function Lobby({ onGameStart }) {
  const [name, setName] = useState('');
  const [tab, setTab] = useState('create'); // create | join | bot
  const [joinCode, setJoinCode] = useState('');
  const [roomCode, setRoomCode] = useState(null);
  const [botDifficulty, setBotDifficulty] = useState('medium');
  const [publicRooms, setPublicRooms] = useState([]);
  const [waitingRoom, setWaitingRoom] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    socket.emit('get_rooms');

    socket.on('rooms_list', setPublicRooms);

    socket.on('room_created', ({ roomId, room }) => {
      setRoomCode(roomId);
      setWaitingRoom(room);
    });

    socket.on('player_joined', ({ room }) => {
      setWaitingRoom(room);
    });

    socket.on('game_countdown', ({ startArticle, targetArticle }) => {
      onGameStart({
        roomId: waitingRoom?.id || roomCode,
        startArticle,
        targetArticle,
        playerName: name,
      });
    });

    socket.on('error', ({ message }) => setError(message));

    return () => {
      socket.off('rooms_list');
      socket.off('room_created');
      socket.off('player_joined');
      socket.off('game_countdown');
      socket.off('error');
    };
  }, [waitingRoom, roomCode, name, onGameStart]);

  function handleCreate() {
    if (!name.trim()) { setError('Enter your name first.'); return; }
    setError('');
    socket.emit('create_room', { playerName: name.trim(), pid });
  }

  function handleJoin(code) {
    if (!name.trim()) { setError('Enter your name first.'); return; }
    const target = (code || joinCode).trim().toUpperCase();
    if (!target) { setError('Enter a room code.'); return; }
    setError('');
    socket.emit('join_room', { roomId: target, playerName: name.trim(), pid });
  }

  function handleBotGame() {
    if (!name.trim()) { setError('Enter your name first.'); return; }
    setError('');
    socket.emit('create_bot_game', { playerName: name.trim(), difficulty: botDifficulty, pid });
  }

  function handleStartGame() {
    socket.emit('start_game', { roomId: waitingRoom.id });
  }

  const playerCount = waitingRoom ? Object.values(waitingRoom.players).filter(p => !p.isBot).length : 0;
  const canStart = waitingRoom && (
    waitingRoom.hasBot || playerCount >= 2
  );

  return (
    <div className="lobby">
      <header className="lobby-header">
        <h1 className="logo">🏎️ The Fast and The Nerdiest</h1>
        <p className="tagline">Race through Wikipedia. First to the target wins.</p>
      </header>

      <div className="lobby-body">
        <div className="name-row">
          <input
            className="input"
            placeholder="Your name"
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={20}
            onKeyDown={e => e.key === 'Enter' && tab === 'join' && handleJoin()}
          />
        </div>

        {error && <div className="error-msg">{error}</div>}

        {!waitingRoom ? (
          <>
            <div className="tabs">
              {['create', 'join', 'bot'].map(t => (
                <button
                  key={t}
                  className={`tab-btn ${tab === t ? 'active' : ''}`}
                  onClick={() => { setTab(t); setError(''); }}
                >
                  {t === 'create' ? 'Create Room' : t === 'join' ? 'Join Room' : 'vs Bot'}
                </button>
              ))}
            </div>

            {tab === 'create' && (
              <div className="tab-panel">
                <p className="hint">Create a room and share the code with a friend.</p>
                <button className="btn btn-primary" onClick={handleCreate}>Create Room</button>
              </div>
            )}

            {tab === 'join' && (
              <div className="tab-panel">
                <div className="join-row">
                  <input
                    className="input code-input"
                    placeholder="Room code (e.g. A3F2B1)"
                    value={joinCode}
                    onChange={e => setJoinCode(e.target.value.toUpperCase())}
                    maxLength={6}
                    onKeyDown={e => e.key === 'Enter' && handleJoin()}
                  />
                  <button className="btn btn-primary" onClick={() => handleJoin()}>Join</button>
                </div>

                {publicRooms.length > 0 && (
                  <div className="public-rooms">
                    <h3 className="section-label">Open Rooms</h3>
                    {publicRooms.map(r => (
                      <div key={r.id} className="room-row">
                        <span className="room-host">{r.hostName}</span>
                        <span className="room-code">{r.id}</span>
                        <span className="room-players">{r.playerCount}/2</span>
                        <button className="btn btn-sm" onClick={() => handleJoin(r.id)}>Join</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {tab === 'bot' && (
              <div className="tab-panel">
                <h3 className="section-label">Bot Difficulty</h3>
                <div className="difficulty-grid">
                  {DIFFICULTIES.map(d => (
                    <button
                      key={d.value}
                      className={`diff-btn ${botDifficulty === d.value ? 'active' : ''}`}
                      onClick={() => setBotDifficulty(d.value)}
                    >
                      <span className="diff-label">{d.label}</span>
                      <span className="diff-desc">{d.desc}</span>
                    </button>
                  ))}
                </div>
                <button className="btn btn-primary" onClick={handleBotGame}>Play vs Bot</button>
              </div>
            )}
          </>
        ) : (
          <div className="waiting-room">
            <div className="room-code-display">
              <span className="room-code-label">Room Code</span>
              <span className="room-code-big">{waitingRoom.id}</span>
              <button
                className="btn btn-sm"
                onClick={() => navigator.clipboard.writeText(waitingRoom.id)}
              >
                Copy
              </button>
            </div>

            <div className="player-list">
              {Object.values(waitingRoom.players).map(p => (
                <div key={p.id} className="player-chip">
                  <span className="player-dot" />
                  {p.name} {p.isBot && `(${waitingRoom.botDifficulty} bot)`}
                </div>
              ))}
              {!waitingRoom.hasBot && playerCount < 2 && (
                <div className="player-chip waiting">
                  <span className="player-dot pulse" />
                  Waiting for opponent…
                </div>
              )}
            </div>

            {waitingRoom.host === pid && (
              <button
                className={`btn btn-primary ${!canStart ? 'disabled' : ''}`}
                onClick={handleStartGame}
                disabled={!canStart}
              >
                {canStart ? 'Start Race!' : 'Waiting for players…'}
              </button>
            )}
            {waitingRoom.host !== pid && (
              <p className="hint">Waiting for the host to start the game…</p>
            )}
          </div>
        )}
      </div>

      {!waitingRoom && <Leaderboards />}
    </div>
  );
}
