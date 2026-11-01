import { useEffect, useState } from 'react';
import { useStore } from './store/useStore';
import { HomeScreen } from './features/home/HomeScreen';
import { LobbyScreen } from './features/lobby/LobbyScreen';
import { RoomScreen } from './features/lobby/RoomScreen';
import { GameScreen } from './features/game/GameScreen';
import { ConnectionBanner } from './features/lobby/ConnectionBanner';
import { Toaster } from './features/lobby/Toaster';
import './features/account/invites';

// Enrutado por estado: inicio → lobby → sala → partida
const Screen = () => {
  const [entered, setEntered] = useState(false);
  const session = useStore((s) => s.session);
  const room = useStore((s) => s.room);
  const game = useStore((s) => s.game);

  // Si la sesión se recuperó dentro de una sala (recarga), al salir se vuelve al lobby y no al inicio
  useEffect(() => {
    if (room && !entered) setEntered(true);
  }, [room, entered]);

  if (room && room.status !== 'lobby' && game) return <GameScreen />;
  if (room) return <RoomScreen />;
  if (!entered || !session) return <HomeScreen onEnter={() => setEntered(true)} ready={!!session} />;
  return <LobbyScreen />;
};

// Los avisos y el indicador de conexión se montan una sola vez, encima de cualquier pantalla
const App = () => (
  <>
    <Screen />
    <Toaster />
    <ConnectionBanner />
  </>
);

export default App;
