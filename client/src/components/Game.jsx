import { useState, useEffect, useRef, useCallback } from 'react';
import socket from '../socket.js';
import ArticleView from './ArticleView.jsx';
import Sidebar from './Sidebar.jsx';

const PREVIEW_SECONDS = 30;

export default function Game({ config, onGameEnd, onLeave }) {
  const { roomId, startArticle, targetArticle, playerName } = config;

  const [gameState, setGameState] = useState('countdown'); // countdown | preview | playing | finished
  const [countdown, setCountdown] = useState(3);
  const [previewSecondsLeft, setPreviewSecondsLeft] = useState(PREVIEW_SECONDS);
  const [currentArticle, setCurrentArticle] = useState(startArticle);
  const [myPath, setMyPath] = useState([startArticle]);
  const [myClicks, setMyClicks] = useState(0);
  const [opponent, setOpponent] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [winner, setWinner] = useState(null);

  const startTimeRef    = useRef(null);
  const timerRef        = useRef(null);
  const countdownRef    = useRef(null);
  const previewTimerRef = useRef(null);

  // Always-current ref used inside the popstate handler (avoids stale closure)
  const currentArticleRef = useRef(currentArticle);
  useEffect(() => { currentArticleRef.current = currentArticle; }, [currentArticle]);

  // 3-second lobby countdown
  useEffect(() => {
    if (gameState !== 'countdown') return;
    let n = 3;
    setCountdown(n);
    countdownRef.current = setInterval(() => {
      n -= 1;
      setCountdown(n);
      if (n <= 0) clearInterval(countdownRef.current);
    }, 1000);
    return () => clearInterval(countdownRef.current);
  }, [gameState]);

  // Race elapsed timer
  useEffect(() => {
    if (gameState !== 'playing') return;
    startTimeRef.current = Date.now();
    timerRef.current = setInterval(() => {
      setElapsed(Date.now() - startTimeRef.current);
    }, 500);
    return () => clearInterval(timerRef.current);
  }, [gameState]);

  // Preview countdown tick
  useEffect(() => {
    if (gameState !== 'preview') return;
    setPreviewSecondsLeft(PREVIEW_SECONDS);
    let n = PREVIEW_SECONDS;
    previewTimerRef.current = setInterval(() => {
      n -= 1;
      setPreviewSecondsLeft(n);
      if (n <= 0) clearInterval(previewTimerRef.current);
    }, 1000);
    return () => clearInterval(previewTimerRef.current);
  }, [gameState]);

  // History-based back-button handling.
  //
  // We stamp every article visit into browser history via pushState so the
  // browser maintains a real stack. popstate then fires with the exact article
  // state to restore — no re-pushing required, so back/forward traverse the
  // full stack naturally.
  //
  // If the user navigates past our first entry (tries to leave the game) we
  // push the current article back to keep them in-game.
  useEffect(() => {
    if (gameState !== 'playing') return;

    // Stamp the start-of-race entry so popstate can identify it as ours
    history.replaceState({ article: startArticle, gameId: roomId }, '');

    function handlePopState(e) {
      if (e.state?.gameId !== roomId || !e.state?.article) {
        // Navigated outside game history — push current article to block the exit
        history.pushState(
          { article: currentArticleRef.current, gameId: roomId },
          ''
        );
        return;
      }

      // Back/forward within game: update state to match what the browser popped
      const { article } = e.state;
      setCurrentArticle(article);
      setMyPath(prev => [...prev, article]);
      setMyClicks(prev => prev + 1);
      socket.emit('article_changed', { roomId, article });
    }

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [gameState, roomId, startArticle]);

  function stopPreviewTimer() {
    clearInterval(previewTimerRef.current);
  }

  // Socket events
  useEffect(() => {
    socket.on('game_started', ({ room }) => {
      setGameState('preview');
      setCountdown(null);
      fetch(`/api/wiki/article/${encodeURIComponent(startArticle)}`).catch(() => {});
      const others = Object.values(room.players).filter(p => p.id !== socket.id);
      if (others.length > 0) {
        setOpponent({ ...others[0], path: [startArticle] });
      }
    });

    socket.on('race_start', () => {
      stopPreviewTimer();
      setGameState('playing');
      setCurrentArticle(startArticle);
      setMyPath([startArticle]);
      setMyClicks(0);
    });

    socket.on('opponent_moved', ({ playerId, article, clickCount }) => {
      setOpponent(prev => {
        if (!prev || prev.id !== playerId) {
          return { id: playerId, name: prev?.name || 'Opponent', currentArticle: article, clickCount, path: [...(prev?.path || [startArticle]), article] };
        }
        return { ...prev, currentArticle: article, clickCount, path: [...(prev.path || []), article] };
      });
    });

    socket.on('game_over', ({ winnerId, winnerName, paths, duration }) => {
      clearInterval(timerRef.current);
      setGameState('finished');
      setWinner({ id: winnerId, name: winnerName });
      setTimeout(() => {
        onGameEnd({
          didIWin: winnerId === socket.id,
          winnerName,
          paths,
          startArticle,
          targetArticle,
          duration,
          myId: socket.id,
        });
      }, 1500);
    });

    socket.on('player_disconnected', ({ playerId }) => {
      setOpponent(prev => prev?.id === playerId ? { ...prev, name: prev.name + ' (left)' } : prev);
    });

    return () => {
      socket.off('game_started');
      socket.off('race_start');
      socket.off('opponent_moved');
      socket.off('game_over');
      socket.off('player_disconnected');
    };
  }, [startArticle, targetArticle, onGameEnd]);

  function handleSkipPreview() {
    stopPreviewTimer();
    setPreviewSecondsLeft(0);
    socket.emit('preview_ready', { roomId });
  }

  // Forward navigation via link click: push into browser history AND update state
  const handleNavigate = useCallback((newArticle) => {
    if (gameState !== 'playing' || winner) return;
    history.pushState({ article: newArticle, gameId: roomId }, '');
    setCurrentArticle(newArticle);
    setMyPath(prev => [...prev, newArticle]);
    setMyClicks(prev => prev + 1);
    socket.emit('article_changed', { roomId, article: newArticle });
  }, [gameState, winner, roomId]);

  const isPreview = gameState === 'preview';
  const articleToShow = isPreview ? targetArticle : currentArticle;

  const myPlayer = {
    id: socket.id,
    name: playerName,
    currentArticle: isPreview ? startArticle : currentArticle,
    clickCount: myClicks,
    path: myPath,
  };

  return (
    <div className="game" data-room-id={roomId}>
      <div className="game-article">
        <div className="article-header">
          <span className="article-title-chip">
            {isPreview ? `Preview: ${targetArticle}` : articleToShow}
          </span>
          {isPreview ? (
            <button className="btn btn-primary skip-btn" onClick={handleSkipPreview}>
              Skip Preview ({previewSecondsLeft}s)
            </button>
          ) : (
            <button className="btn btn-sm leave-btn" onClick={onLeave}>Leave</button>
          )}
        </div>
        <ArticleView
          title={articleToShow}
          onNavigate={handleNavigate}
          disabled={gameState !== 'playing'}
        />
      </div>

      <Sidebar
        myPlayer={myPlayer}
        opponent={opponent}
        targetArticle={targetArticle}
        startArticle={startArticle}
        elapsed={elapsed}
        countdown={gameState === 'countdown' ? countdown : null}
        previewSecondsLeft={isPreview ? previewSecondsLeft : null}
      />
    </div>
  );
}
