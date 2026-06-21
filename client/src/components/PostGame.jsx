import socket from '../socket.js';

export default function PostGame({ data, onHome }) {
  const { didIWin, winnerName, paths, startArticle, targetArticle, duration, myId } = data;

  function formatTime(ms) {
    if (!ms) return '—';
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
  }

  function shareResult() {
    const myPath = paths?.[myId];
    if (!myPath) return;
    const emoji = didIWin ? '🏆' : '💀';
    const text = [
      `${emoji} The Fast and The Nerdiest`,
      `${startArticle} → ${targetArticle}`,
      `${myPath.clickCount} clicks in ${formatTime(duration)}`,
      myPath.path.map((a, i) => `${i}. ${a}`).join('\n'),
    ].join('\n');
    navigator.clipboard.writeText(text).then(() => alert('Result copied to clipboard!'));
  }

  const sortedPlayers = paths
    ? Object.values(paths).sort((a, b) => {
        const aWon = a.path[a.path.length - 1]?.toLowerCase() === targetArticle?.toLowerCase();
        const bWon = b.path[b.path.length - 1]?.toLowerCase() === targetArticle?.toLowerCase();
        if (aWon && !bWon) return -1;
        if (!aWon && bWon) return 1;
        return a.clickCount - b.clickCount;
      })
    : [];

  return (
    <div className="postgame">
      <div className="postgame-card">
        <div className={`result-banner ${didIWin ? 'win' : 'lose'}`}>
          <span className="result-emoji">{didIWin ? '🏆' : '💀'}</span>
          <h2 className="result-title">{didIWin ? 'You Won!' : `${winnerName} Wins`}</h2>
          <p className="result-sub">
            {startArticle} → {targetArticle}
          </p>
        </div>

        <div className="postgame-meta">
          <div className="meta-chip">
            <span className="meta-label">Time</span>
            <span className="meta-val">{formatTime(duration)}</span>
          </div>
          {paths?.[myId] && (
            <div className="meta-chip">
              <span className="meta-label">Your clicks</span>
              <span className="meta-val">{paths[myId].clickCount}</span>
            </div>
          )}
        </div>

        <div className="paths-section">
          {sortedPlayers.map((player, idx) => {
            const reached = player.path[player.path.length - 1]?.toLowerCase() === targetArticle?.toLowerCase();
            return (
              <div key={player.name} className={`path-block ${idx === 0 ? 'winner-path' : ''}`}>
                <div className="path-block-header">
                  <span className="path-player-name">
                    {idx === 0 && '🏆 '}{player.name} {player.isBot && '(bot)'}
                  </span>
                  <span className="path-clicks">
                    {player.clickCount} click{player.clickCount !== 1 ? 's' : ''}
                    {!reached && ' (DNF)'}
                  </span>
                </div>
                <ol className="path-ol">
                  {player.path.map((article, i) => (
                    <li
                      key={i}
                      className={`path-ol-item ${article.toLowerCase() === targetArticle?.toLowerCase() ? 'target-reached' : ''}`}
                    >
                      {article}
                    </li>
                  ))}
                </ol>
              </div>
            );
          })}
        </div>

        <div className="postgame-actions">
          <button className="btn btn-secondary" onClick={shareResult}>Share Result</button>
          <button className="btn btn-primary" onClick={onHome}>Play Again</button>
        </div>
      </div>
    </div>
  );
}
