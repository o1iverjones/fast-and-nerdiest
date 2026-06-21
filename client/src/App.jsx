import { useState } from 'react';
import Lobby from './components/Lobby.jsx';
import Game from './components/Game.jsx';
import PostGame from './components/PostGame.jsx';

export default function App() {
  const [screen, setScreen] = useState('lobby');
  const [gameConfig, setGameConfig] = useState(null);
  const [postGameData, setPostGameData] = useState(null);

  function handleGameStart(config) {
    setGameConfig(config);
    setScreen('game');
  }

  function handleGameEnd(data) {
    setPostGameData(data);
    setScreen('postgame');
  }

  function handleHome() {
    setScreen('lobby');
    setGameConfig(null);
    setPostGameData(null);
  }

  return (
    <div className="app">
      {screen === 'lobby' && (
        <Lobby onGameStart={handleGameStart} />
      )}
      {screen === 'game' && (
        <Game
          config={gameConfig}
          onGameEnd={handleGameEnd}
          onLeave={handleHome}
        />
      )}
      {screen === 'postgame' && (
        <PostGame
          data={postGameData}
          onHome={handleHome}
        />
      )}
    </div>
  );
}
