# Roña — arquitectura y contrato entre piezas

```
shared/        motor del juego (JS puro, ESM, sin dependencias). Lo importan el server y el cliente.
  engine/      cards.js, rules.js, game.js, bot.js, index.js
  test/        node --test
virus-back/    servidor Express + Socket.IO (ESM). Salas, sesiones, timers, bots. Importa ../shared/engine/index.js
virus-front/   React + Vite. Importa el motor con el alias `@shared` → ../shared
```

Todo es **autoritativo en el servidor**: el cliente sólo manda intenciones (`game:action`), y el servidor valida con el motor y difunde el resultado.
El cliente usa el mismo motor (`getLegalTargets`) sólo para resaltar los destinos válidos en la interfaz.

## 1. API del motor (`shared/engine/index.js`)

Son funciones puras: nunca mutan la entrada y siempre devuelven un estado nuevo. El azar se controla con una semilla.

```js
// Cartas
CARD_KINDS = ['organ','virus','medicine','treatment']
COLORS = ['red','green','blue','yellow','multi']
TREATMENTS = ['transplant','thief','contagion','glove','medicalError']
createDeck() -> Card[]                  // 68 cartas, ids c01..c68, en orden fijo
// Card = { id, kind, color?: Color, treatment?: Treatment }   (los treatment no llevan color)

// Partida
createGame({ players: [{ id, name }], seed?: number }) -> GameState
applyAction(state, playerId, action) -> { state, events }   // si es ilegal lanza GameError { code, message }
advanceTimeout(state) -> { state, events }                  // el jugador en turno no actuó: descarta 1 carta al azar (con la semilla)
removePlayer(state, playerId) -> { state, events }          // abandono
getPlayerView(state, viewerId) -> PlayerView                // oculta las manos ajenas y el mazo
getLegalTargets(view|state, playerId, cardId) -> Target[]   // para resaltar en la UI; funciona con un PlayerView
slotStatus(slot) -> 'healthy'|'infected'|'vaccinated'|'immunized'
chooseBotAction(state, playerId, { level: 'easy'|'normal' }) -> Action   // siempre una acción legal
class GameError extends Error { code }
```

### GameState (privado del servidor)

```js
{
  seed, rngState,             // PRNG determinista (mulberry32 o similar)
  players: [{ id, name, hand: Card[], body: Slot[], skipNext: boolean, out: boolean }],
  deck: Card[], discard: Card[],
  turn: number,               // índice en players
  turnNumber: number,         // empieza en 1 y sube 1 en cada cambio de turno
  winner: null | { playerId, reason: 'organs'|'forfeit' },
  log: []                     // opcional
}
Slot = { id /* = organ.id */, organ: Card, viruses: Card[], medicines: Card[] }
```

### PlayerView (lo que recibe cada cliente)

```js
{
  you: playerId,
  players: [{ id, name, handCount, body: Slot[], skipNext, out, isTurn }],
  hand: Card[],               // sólo la tuya
  deckCount, discardTop: Card|null, discardCount,
  turnPlayerId, turnNumber,
  winner
}
```

### Acciones

```js
{ type: 'discard', cardIds: string[] }                      // de 1 a 3, todas de tu mano
{ type: 'play', cardId, target }
  // organ:        target = { playerId: tú }
  // virus:        target = { playerId, slotId }
  // medicine:     target = { playerId: tú, slotId }
  // transplant:   target = { a: { playerId, slotId }, b: { playerId, slotId } }
  // thief:        target = { playerId, slotId }
  // contagion:    target = { moves?: [{ fromSlotId, toPlayerId, toSlotId }] }
  // glove:        target = {}
  // medicalError: target = { playerId }
```

`Target` (lo que devuelve getLegalTargets) tiene la forma de `target` de la acción; en el caso de transplant devuelve todos los pares `{a,b}` válidos.

### Eventos (para las animaciones; en orden)

```js
{ type: 'played', playerId, card, target }
{ type: 'organPlaced', playerId, slotId }
{ type: 'infected', playerId, slotId }
{ type: 'organDestroyed', playerId, slotId, cards }
{ type: 'cured', playerId, slotId }              // virus + medicina se anulan
{ type: 'vaccinated', playerId, slotId }
{ type: 'immunized', playerId, slotId }
{ type: 'vaccineRemoved', playerId, slotId }      // virus contra vacuna
{ type: 'slotMoved', fromPlayerId, toPlayerId, slotId }   // trasplante / ladrón (un evento por ranura movida)
{ type: 'virusMoved', fromPlayerId, fromSlotId, toPlayerId, toSlotId }   // contagio
{ type: 'handsDiscarded', playerIds }             // guante
{ type: 'bodiesSwapped', a, b }                   // error médico
{ type: 'discarded', playerId, count, cards }     // las cartas descartadas son públicas
{ type: 'drew', playerId, count }
{ type: 'reshuffled', count }
{ type: 'turnSkipped', playerId }
{ type: 'timeout', playerId }
{ type: 'playerLeft', playerId }
{ type: 'turn', playerId, turnNumber }
{ type: 'win', playerId, reason }
```

Códigos de `GameError`: `NOT_YOUR_TURN`, `GAME_OVER`, `CARD_NOT_IN_HAND`, `BAD_TARGET`, `ILLEGAL_MOVE`, `BAD_DISCARD`, `UNKNOWN_ACTION`.

## 2. Protocolo Socket.IO

Servidor: `http://localhost:3001` (variable `PORT`). En el cliente, la URL sale de `VITE_SERVER_URL` y por defecto es `http://<hostname>:3001`.
CORS abierto a cualquier origen en desarrollo, o al que diga `CLIENT_ORIGIN`.
Todos los eventos cliente→servidor usan **ack**: `socket.emit(ev, payload, (res) => …)`, con `res = { ok: true, ...data } | { ok: false, error: { code, message } }`.

### Sesión (para que una recarga no saque al jugador)
- `session:hello` `{ token?: string, profile?: { name, avatar, color } }` → ack `{ ok, token, playerId, profile, roomId|null }`.
  Si el `token` es conocido, la sesión se recupera (mismo `playerId`, misma sala y mismo asiento en la partida) y el servidor reenvía `room:state` y `game:state`.
  Un socket tiene una sola sesión: `hello` sin token, o con uno desconocido, en un socket que ya tiene sesión devuelve esa misma sesión.
  El cliente guarda `token` en `localStorage['rona.token']`.
- `profile:update` `{ name, avatar, color }` → ack `{ ok, profile }`. `name` de 1 a 16 caracteres, `avatar` de 0 a 8, `color` en formato hex.

### Lobby
- `rooms:list` → ack `{ ok, rooms: RoomSummary[] }`. Además, el servidor difunde `rooms:update` `RoomSummary[]` a todos cuando algo cambia.
- `RoomSummary = { id, name, playerCount, maxPlayers, status: 'lobby'|'playing'|'finished', hostName }`
- `room:create` `{ name, maxPlayers?: 2..6 (default 6) }` → ack `{ ok, roomId }` (el creador entra solo y es el anfitrión).
- `room:join` `{ roomId }` → ack `{ ok }`. Errores: `ROOM_NOT_FOUND`, `ROOM_FULL`, `ROOM_IN_GAME` (también si la partida ya terminó: sólo se entra en `lobby`), `ALREADY_IN_ROOM`.
- `room:leave` → ack `{ ok }`. Si el anfitrión sale, el anfitrión pasa al siguiente humano. Una sala sin humanos se borra.
  Fuera de una partida, si el anfitrión se desconecta el rol pasa enseguida al primer humano conectado (no lo recupera al volver).
- `room:addBot` `{ level?: 'easy'|'normal' }` (sólo el anfitrión, en el lobby) → ack. Los bots tienen nombres divertidos y un avatar y color al azar.
- `room:kick` `{ playerId }` (sólo el anfitrión, en el lobby; sirve también para quitar bots).
- `room:start` (sólo el anfitrión, con 2 a 6 jugadores) → ack. Errores: `NOT_HOST`, `NOT_ENOUGH_PLAYERS`.
- `room:chat` `{ text }` (de 1 a 200 caracteres; ráfagas limitadas a 5 por cada 5 s, por sesión: salir y volver no reinicia el límite).
- `room:rematch` (sólo el anfitrión, con la partida terminada) → la sala vuelve al lobby con los mismos jugadores.
- `room:emote` `{ emote }` (en la sala, en cualquier estado) → ack. `emote` es una clave de `shared/emotes.js` (`angry`, `rage`, `laugh`, `cry`, `cool`, `evil`, `shock`, `clap`). Como mucho 4 por sesión cada 3 s (`RATE_LIMITED`). No queda en el historial del chat.

Servidor → cliente:
- `room:state` `RoomState = { id, name, hostId, maxPlayers, status, gamesPlayed, players: [{ id, name, avatar, color, isBot, connected, wins }] }`. Se manda a la sala cada vez que algo cambia, y `null` cuando sales. `wins` son las partidas que ganó cada quien en esta sala y `gamesPlayed` las que se han jugado; se acumulan entre revanchas y se pierden con la sala.
- `room:chat` `{ id, from: { id, name, color } | null, text, ts, system: boolean }`. Los mensajes de sistema ("Vane se unió", "Elian ganó") llevan `system: true`.
- `room:emote` `{ playerId, emote, say?, ts }` a toda la sala. `say` sólo lo traen las reacciones de los bots: tras cada lote de eventos, un bot afectado (le infectaron, destruyeron o robaron un órgano, le cambiaron el cuerpo, ganó o perdió…) puede reaccionar tras 0.7–1.5 s (`BOT_REACT_MIN_MS`/`BOT_REACT_MAX_MS`), como mucho una vez cada 3.5 s; a veces también contestan a los emotes de los humanos. `BOT_REACTIONS=0` las apaga.

### Partida
- `game:action` `Action` → ack `{ ok }` o `{ ok: false, error }`.
- `game:state` `PlayerView & { turnDeadline: number /* epoch ms */, turnMs: number }`. Se manda a cada jugador, personalizado, después de cada cambio.
- `game:events` `{ seq, events: Event[] }`. Se manda **antes** del `game:state` correspondiente. El cliente reproduce las animaciones y luego aplica el estado. `seq` sube 1 en cada lote.

Tiempos:
- Turno de 40 s (`TURN_MS`). Si se agota, el servidor llama `advanceTimeout`.
- Los bots actúan tras 900–1600 ms de "pensar".
- Un jugador desconectado conserva su asiento 60 s. Si no vuelve, `removePlayer` lo saca. Mientras está desconectado, sus turnos se resuelven por timeout, pero de 8 s y no de 40 s.
- Al terminar una partida la sala pasa a `finished` y el anfitrión puede pedir `room:rematch`.

### Límites contra abusos
- Más de 40 eventos en 2 s por socket → `RATE_LIMITED`.
- Por IP (configurables; `0` desactiva el tope): 20 conexiones abiertas a la vez (`MAX_CONNECTIONS_PER_IP`; la de más se rechaza con `connect_error` `TOO_MANY_CONNECTIONS`), 20 sesiones nuevas por minuto (`SESSIONS_PER_IP_PER_MIN`) y 8 salas abiertas (`MAX_ROOMS_PER_IP`); estos dos responden `RATE_LIMITED`. Detrás de N proxies propios, `TRUST_PROXY=N` toma la IP de `X-Forwarded-For` (la N-ésima desde la derecha: lo de más a la izquierda lo puede falsear el cliente). En Docker, nginx reemplaza `X-Forwarded-For` con `CF-Connecting-IP`.
- Unirse o crear salas: 6 por sesión cada 30 s (`RATE_LIMITED`).
- Un mensaje de más de 16 KB corta la conexión sin ack (`maxHttpBufferSize` de Socket.IO).
- Reconectar en tu propio turno da margen (`RECONNECT_TURN_MS`) una sola vez por turno y como mucho 3 veces por partida.
- Las sesiones desconectadas y sin sala se borran a los 30 min.

### HTTP
- `GET /health` → `{ ok: true }`
- `GET /rooms` → `RoomSummary[]` (se conserva por compatibilidad)

## 3. Cliente (`virus-front`)

- `src/net/socket.js`: el socket único y el helper `request(ev, payload)` que convierte el ack en una Promise.
- `src/store/useStore.js` (zustand): `session`, `profile`, `rooms`, `room`, `chat[]`, `game` (el último `PlayerView`), `eventQueue`. Se suscribe a todos los eventos del servidor.
- `src/lib/cards.js`: `cardImage(card, size='big'|'sm')` y `cardLabel(card)` (el nombre en español).
- Pantallas: `src/features/home` (inicio y perfil), `src/features/lobby` (lista de salas y sala de espera con chat), `src/features/game` (la mesa).
- Animaciones con `framer-motion`, confeti con `canvas-confetti`. Sonidos sintetizados con WebAudio en `src/lib/sfx.js`.
- Referencia visual de la mesa: `virus-front/src/assets/Group 12sa.png`. Paleta: `--background #885FFE`, `--strokes #653FD3`, `--accent #ffae00`. Fuente: `super_sedan`.

## 4. Añadidos de la implementación (no estaban en el contrato original)

Motor:
- Acción `{ type: 'pass' }`: sólo es legal si no tienes ninguna carta en la mano (mazo y descarte agotados), para que la partida no se bloquee. El cliente muestra el botón "Pasar" en ese caso.
- `createGame` lanza `GameError` con código `BAD_SETUP` si recibe menos de 2 o más de 6 jugadores, o ids repetidos.
- En un turno saltado (guante) el orden de eventos es `turn(b)`, `turnSkipped(b)`, `drew(b)`, `turn(c)`: puede haber varios `turn` en un lote; el último es el turno real.
- Si al terminar una acción varios jugadores cumplen la victoria, gana el que actuó; si no está entre ellos, el primero en orden de asientos.

Servidor:
- Códigos de error extra: `BAD_PAYLOAD`, `NO_SESSION`, `NOT_IN_ROOM`, `NOT_IN_LOBBY`, `NOT_PLAYING`, `NOT_FINISHED`, `PLAYER_NOT_FOUND`, `RATE_LIMITED` (chat y antiflood: 40 eventos por socket cada 2 s), `SERVER_FULL` (más de 200 salas) e `INTERNAL`.
- `session:replaced` (servidor → cliente): la misma sesión se abrió en otro socket (otra pestaña). El servidor desconecta el socket viejo y no se reconecta solo; el cliente muestra "Abriste Roña en otra pestaña" con un botón para recuperarla aquí.
- Al empezar la partida se manda un primer lote `{ seq: 1, events: [{ type: 'turn', … }] }` antes del primer `game:state`.
- Si un jugador vuelve en su propio turno, se le garantiza un margen mínimo de 15 s (`RECONNECT_TURN_MS`).
- Al recuperar la sesión (`session:hello` con token) se reenvían `room:state`, el historial del chat (hasta 50 mensajes) y `game:state`, todo antes del ack. El cliente descarta los mensajes de chat repetidos por `id`.
- Si alguien sale a media partida desaparece de `room.players` pero sigue en el `PlayerView` con `out: true`; la mesa usa el nombre del `PlayerView` y un avatar por defecto.
- Al empezar, los asientos se barajan (no empieza siempre el anfitrión).

Cliente:
- En desarrollo el store queda en `window.__ronaStore` (las pruebas e2e lo leen para sincronizarse; nunca lo escriben).
- `useStore.hello` suelta la sala local si el servidor responde `roomId: null` (se reinició o pasó la gracia).
- `updateProfile` sólo guarda el perfil (store y `localStorage['rona.profile']`) cuando el servidor lo acepta.
- Los lotes de `game:events` con `seq` menor o igual al último encolado se ignoran.
