import { useEffect, useState, Fragment } from 'react';
import socket from '../socket.js';

function formatTime(ms) {
  if (!ms) return '—';
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

const EMPTY = { recent: [], top: { fewestClicks: [], fastestTimes: [] } };

export default function Leaderboards() {
  const [data, setData] = useState(EMPTY);

  useEffect(() => {
    let active = true;
    fetch('/api/leaderboard')
      .then(r => r.json())
      .then(d => { if (active) setData(d); })
      .catch(() => {});

    const onUpdate = (d) => setData(d);
    socket.on('leaderboard_updated', onUpdate);
    return () => { active = false; socket.off('leaderboard_updated', onUpdate); };
  }, []);

  const { recent, top } = data;

  return (
    <div className="leaderboards">
      <div className="lb-card">
        <h3 className="lb-title">Recent Games</h3>
        {recent.length === 0 ? (
          <p className="lb-empty">No games played yet.</p>
        ) : (
          <ul className="lb-list">
            {recent.map(g => (
              <li key={g.id} className="lb-game">
                <div className="lb-game-players">
                  {g.players.map((p, i) => (
                    <Fragment key={i}>
                      {i > 0 && <span className="lb-vs">vs</span>}
                      <span className={`lb-player ${p.winner ? 'winner' : ''}`}>
                        {p.winner && <span className="lb-star">★</span>}
                        {p.name}{p.isBot && ' 🤖'}
                        <span className="lb-clicks">{p.clicks} clk</span>
                      </span>
                    </Fragment>
                  ))}
                </div>
                <span className="lb-duration">{formatTime(g.duration)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="lb-card">
        <h3 className="lb-title">All-Time Top Scores</h3>
        <div className="lb-top">
          <div className="lb-top-col">
            <h4 className="lb-subtitle">Fewest Clicks</h4>
            {top.fewestClicks.length === 0 ? (
              <p className="lb-empty">—</p>
            ) : (
              <ol className="lb-rank">
                {top.fewestClicks.map((s, i) => (
                  <li key={i}>
                    <span className="lb-rank-name">{s.name}</span>
                    <span className="lb-rank-val">{s.clicks} clicks</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
          <div className="lb-top-col">
            <h4 className="lb-subtitle">Fastest Times</h4>
            {top.fastestTimes.length === 0 ? (
              <p className="lb-empty">—</p>
            ) : (
              <ol className="lb-rank">
                {top.fastestTimes.map((s, i) => (
                  <li key={i}>
                    <span className="lb-rank-name">{s.name}</span>
                    <span className="lb-rank-val">{formatTime(s.duration)}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
