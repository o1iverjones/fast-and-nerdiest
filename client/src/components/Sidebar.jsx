import { useEffect } from 'react';

export default function Sidebar({ myPlayer, opponent, targetArticle, startArticle, elapsed, countdown, previewSecondsLeft }) {
  function formatTime(ms) {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
  }

  const isPreview = previewSecondsLeft !== null;

  return (
    <aside className="sidebar">
      {countdown !== null && (
        <div className="countdown-overlay">
          <div className="countdown-num">{countdown === 0 ? 'GO!' : countdown}</div>
        </div>
      )}

      {isPreview && (
        <div className="preview-banner">
          <div className="preview-label">Study your target!</div>
          <div className="preview-timer">{previewSecondsLeft}s</div>
          <div className="preview-sub">Race begins when all players skip or time runs out</div>
        </div>
      )}

      <div className="sidebar-section target-section">
        <div className="sidebar-label">Target Article</div>
        <div className="target-article">{targetArticle || '—'}</div>
        <div className="start-article-row">
          <span className="sidebar-sublabel">Started at:</span>
          <span className="start-name">{startArticle || '—'}</span>
        </div>
      </div>

      <div className="sidebar-section timer-section">
        <div className="sidebar-label">Time</div>
        <div className="timer">{formatTime(elapsed)}</div>
      </div>

      <div className="sidebar-section players-section">
        <div className="sidebar-label">Players</div>

        <PlayerCard
          player={myPlayer}
          label="You"
          isYou
          targetArticle={targetArticle}
        />

        {opponent && (
          <PlayerCard
            player={opponent}
            label={opponent.name}
            targetArticle={targetArticle}
          />
        )}
      </div>

      {myPlayer && (
        <div className="sidebar-section path-section">
          <div className="sidebar-label">Your Path ({myPlayer.clickCount} clicks)</div>
          <div className="path-list">
            {(myPlayer.path || []).map((article, i) => (
              <div key={i} className={`path-item ${i === (myPlayer.path?.length ?? 0) - 1 ? 'current' : ''}`}>
                <span className="path-num">{i}</span>
                <span className="path-name">{article}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}

function PlayerCard({ player, label, isYou, targetArticle }) {
  if (!player) return null;
  const won = player.currentArticle?.toLowerCase() === targetArticle?.toLowerCase();

  return (
    <div className={`player-card ${isYou ? 'you' : 'them'} ${won ? 'winner' : ''}`}>
      <div className="player-card-name">{label} {won && '🏆'}</div>
      <div className="player-card-article">{player.currentArticle || '—'}</div>
      <div className="player-card-clicks">{player.clickCount} click{player.clickCount !== 1 ? 's' : ''}</div>
    </div>
  );
}
