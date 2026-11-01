// Modo de demostración SÓLO de desarrollo: ?demo=game (4 jugadores) o ?demo=game6 (6 jugadores).
// Rellena useStore con una partida realista que corre localmente con el motor compartido:
// mis jugadas pasan por applyAction, los rivales juegan con chooseBotAction, y se generan
// eventos reales para ver todas las animaciones sin servidor.
// Escenarios para probar efectos: window.__ronaDemo.run('destroy' | 'cure' | 'immunize' | 'contagion' |
//   'contagion2' | 'contagion2Swap' | 'contagion2Me' | 'glove' | 'gloveBot' | 'medicalError' | 'thief' | 'transplant' | 'reshuffle' | 'botTurn' | 'win' | 'lose' |
//   'deal' | 'myTurn' | 'chat').
// ?bots: todos los rivales son bots (para ver cómo piensan y juegan).
// Atajo: tecla º / ` abre un panelito con esos botones.

import {
  applyAction, chooseBotAction, createDeck, createGame, getPlayerView, advanceTimeout,
} from '@shared/engine/index.js';
import { useStore } from '../../store/useStore';

const TURN_MS = 40000;

// Copia de estimateAnimationMs de virus-back/src/gameRunner.js (lo que tarda la mesa en animar un lote;
// ver allá la explicación de cada término)
const HITS = new Set(['organDestroyed', 'cured', 'vaccineRemoved']);
const SWAPS = new Set(['slotMoved', 'bodiesSwapped', 'virusMoved']);
const estimateAnimationMs = (events) => {
  if (!events.some((e) => e.type !== 'turn')) return 0;
  let ms = 40 + 200;
  if (events.some((e) => e.type === 'timeout')) ms += 400;
  const i = events.findIndex((e) => e.type === 'played');
  const played = events[i];
  const conseq = played && events[i + 1];
  if (played?.card?.kind === 'treatment') ms += 900;
  else if (conseq && HITS.has(conseq.type)) ms += 700 + (conseq.type === 'organDestroyed' ? 280 : 160);
  const swaps = events.filter((e) => SWAPS.has(e.type)).length;
  const glove = events.find((e) => e.type === 'handsDiscarded');
  let land = played || events.some((e) => e.type === 'discarded') ? 600 : 0;
  if (swaps) land = Math.max(land, 750 + Math.min(4, swaps) * 120);
  if (glove) land = Math.max(land, 500 + 60 * 3 * glove.playerIds.length);
  if (land) ms += land + 200 + (glove ? 400 : 150);
  if (events.some((e) => e.type === 'win')) ms += 1200;
  for (const e of events) {
    if (e.type === 'reshuffled') ms += 1450;
    else if (e.type === 'drew' && e.count > 0) ms += 560 + 110 * (Math.min(3, e.count) - 1);
    else if (e.type === 'turnSkipped') ms += e.playerId === 'me' ? 900 : 400;
  }
  return Math.min(9000, ms);
};

const PEOPLE = [
  { id: 'me', name: 'Misael', avatar: 7, color: '#ffae00' },
  { id: 'vane', name: 'Vane', avatar: 1, color: '#a24bff' },
  { id: 'adan', name: 'Adán', avatar: 3, color: '#1e90ff' },
  { id: 'elian', name: 'Elian', avatar: 4, color: '#20c040' },
  { id: 'pau', name: 'Pau', avatar: 2, color: '#ff4d8d' },
  { id: 'rorro', name: 'Doctor Mocos', avatar: 6, color: '#00c2b8', isBot: true },
];

let state = null;
let seq = 0;
let botTimer = null;
let lastAnimMs = 0; // lo que tarda la mesa en animar el último lote (como en el servidor)
let deadline = 0;
let timeoutTimer = null;

// ---------- Utilidades para armar cartas a mano ----------

const makePool = () => {
  const pool = createDeck();
  const take = (kind, colorOrTreatment) => {
    const i = pool.findIndex((c) => c.kind === kind && (kind === 'treatment' ? c.treatment === colorOrTreatment : c.color === colorOrTreatment));
    if (i < 0) throw new Error(`demo: no queda ${kind} ${colorOrTreatment}`);
    return pool.splice(i, 1)[0];
  };
  const slot = (color, { v = [], m = [] } = {}) => {
    const organ = take('organ', color);
    return { id: organ.id, organ, viruses: v.map((c) => take('virus', c)), medicines: m.map((c) => take('medicine', c)) };
  };
  return { pool, take, slot };
};

const view = () => ({
  ...getPlayerView(state, 'me'),
  turnDeadline: deadline,
  turnMs: TURN_MS,
});

const push = (events) => {
  seq += 1;
  useStore.setState((s) => ({ eventQueue: [...s.eventQueue, { seq, events }] }));
  // Como el servidor: primero los eventos, después el estado
  setTimeout(() => useStore.setState({ game: view() }), 0);
};

const turnId = () => state.players[state.turn].id;

const restartClock = () => {
  // Como el servidor: el reloj corre desde que la mesa terminó de animar
  deadline = Date.now() + lastAnimMs + (turnId() === 'me' ? TURN_MS : 8000);
};

// Avanza la partida: si le toca a un rival, juega solo tras "pensar"
const schedule = () => {
  clearTimeout(botTimer);
  clearTimeout(timeoutTimer);
  if (!state || state.winner) {
    if (state?.winner) useStore.setState((s) => ({ room: s.room && { ...s.room, status: 'finished' } }));
    return;
  }
  const pid = turnId();
  if (pid === 'me') {
    timeoutTimer = setTimeout(() => step(() => advanceTimeout(state)), Math.max(0, deadline - Date.now()));
    return;
  }
  const paused = window.__ronaDemo?.paused;
  if (paused) return;
  // Como el servidor: el bot empieza a pensar cuando la mesa terminó de animar la jugada anterior
  botTimer = setTimeout(() => {
    const action = chooseBotAction(state, pid, { level: 'normal' });
    if (!action) return;
    step(() => applyAction(state, pid, action));
  }, lastAnimMs + 1800 + Math.random() * 1400);
};

const step = (fn) => {
  const before = turnId();
  const res = fn();
  state = res.state;
  lastAnimMs = estimateAnimationMs(res.events);
  if (turnId() !== before || res.events.some((e) => e.type === 'turn')) restartClock();
  push(res.events);
  schedule();
  return res;
};

// ---------- Escenarios ----------

const build6 = (n) => {
  const { pool, take, slot } = makePool();
  const players = PEOPLE.slice(0, n);
  const base = createGame({ players: players.map(({ id, name }) => ({ id, name })), seed: 1234 });
  const bodies = {
    me: [slot('red', { m: ['red'] }), slot('blue', { v: ['blue'] }), slot('yellow', { m: ['yellow', 'multi'] })],
    vane: [slot('green', { v: ['green'] }), slot('yellow'), slot('multi', { m: ['multi'] })],
    adan: [slot('red', { m: ['red', 'red'] }), slot('blue'), slot('green', { m: ['green'] }), slot('yellow', { v: ['multi'] })],
    elian: [slot('yellow', { m: ['yellow'] }), slot('green')],
    pau: [slot('blue'), slot('red', { v: ['red'] })],
    rorro: [],
  };
  const hands = {
    me: [take('virus', 'green'), take('medicine', 'blue'), take('treatment', 'transplant')],
  };
  const discardTop = take('treatment', 'contagion');
  const discardRest = [take('virus', 'yellow'), take('medicine', 'green')];
  // El resto se baraja en el mazo (con un orden fijo para que las capturas salgan iguales)
  const deck = pool.sort((a, b) => ((a.id.charCodeAt(2) * 7 + a.id.charCodeAt(1)) % 13) - ((b.id.charCodeAt(2) * 7 + b.id.charCodeAt(1)) % 13));
  const st = structuredClone(base);
  st.players = players.map((p) => ({
    id: p.id, name: p.name, hand: hands[p.id] || [], body: bodies[p.id] || [], skipNext: p.id === 'elian', out: false,
  }));
  for (const p of st.players) while (p.hand.length < 3) p.hand.push(deck.pop());
  st.deck = deck;
  st.discard = [...discardRest, discardTop];
  st.turn = 0;
  st.turnNumber = 9;
  st.winner = null;
  return st;
};

const fresh = (n) => createGame({ players: PEOPLE.slice(0, n).map(({ id, name }) => ({ id, name })), seed: Date.now() % 100000 });

// Da una carta a un jugador y la juega como él (cambiando el turno si hace falta)
const force = (pid, card, targetFn) => {
  clearTimeout(botTimer);
  const st = structuredClone(state);
  const p = st.players.find((x) => x.id === pid);
  st.turn = st.players.indexOf(p);
  p.skipNext = false;
  if (p.hand.length >= 3) st.discard.push(p.hand.pop());
  p.hand.push(card);
  state = st;
  const target = targetFn(st);
  if (!target) { console.warn('[demo] escenario sin destino'); schedule(); return; }
  try {
    step(() => applyAction(state, pid, { type: 'play', cardId: card.id, target }));
  } catch (err) {
    console.warn('[demo] escenario falló', err);
    schedule();
  }
};

// Saca del mazo/descarte una carta que cumpla el filtro (para que los ids sigan siendo únicos)
const pull = (pred) => {
  for (const pile of [state.deck, state.discard]) {
    const i = pile.findIndex(pred);
    if (i >= 0) return pile.splice(i, 1)[0];
  }
  // Si no está libre, se crea una "copia" con id nuevo
  const proto = createDeck().find(pred);
  return proto ? { ...proto, id: `x${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}` } : null;
};

const isBotId = (pid) => !!useStore.getState().room?.players?.find((p) => p.id === pid)?.isBot;

const firstOpp = () => state.players.find((p) => p.id !== 'me' && !p.out);
const slotsOf = (pid) => state.players.find((p) => p.id === pid).body;

const SCENARIOS = {
  // Un rival destruye mi órgano infectado (o le pego a alguien si no hay)
  destroy: () => {
    const victim = state.players.find((p) => p.body.some((s) => s.viruses.length === 1 && s.medicines.length === 0));
    if (!victim) return;
    const s = victim.body.find((x) => x.viruses.length === 1);
    const attacker = victim.id === 'me' ? firstOpp().id : 'me';
    const card = pull((c) => c.kind === 'virus' && (c.color === s.organ.color || c.color === 'multi'));
    force(attacker, card, () => ({ playerId: victim.id, slotId: s.id }));
  },
  cure: () => {
    const p = state.players.find((x) => x.body.some((s) => s.viruses.length === 1));
    if (!p) return;
    const s = p.body.find((x) => x.viruses.length === 1);
    const card = pull((c) => c.kind === 'medicine' && c.color === 'multi');
    force(p.id, card, () => ({ playerId: p.id, slotId: s.id }));
  },
  immunize: () => {
    const p = state.players.find((x) => x.body.some((s) => s.medicines.length === 1));
    if (!p) return;
    const s = p.body.find((x) => x.medicines.length === 1);
    const card = pull((c) => c.kind === 'medicine' && c.color === 'multi');
    force(p.id, card, () => ({ playerId: p.id, slotId: s.id }));
  },
  infect: () => {
    const opp = firstOpp();
    const s = slotsOf('me').find((x) => x.viruses.length === 0 && x.medicines.length === 0)
      || slotsOf(opp.id).find((x) => x.viruses.length === 0 && x.medicines.length === 0);
    if (!s) return;
    const owner = state.players.find((p) => p.body.includes(s));
    const card = pull((c) => c.kind === 'virus' && c.color === 'multi') || pull((c) => c.kind === 'virus' && c.color === s.organ.color);
    force(owner.id === 'me' ? opp.id : 'me', card, () => ({ playerId: owner.id, slotId: s.id }));
  },
  contagion: () => {
    const p = state.players.find((x) => x.body.some((s) => s.viruses.length === 1)) || firstOpp();
    const card = pull((c) => c.treatment === 'contagion');
    force(p.id, card, () => ({}));
  },
  // Contagio de 2 virus a la vez (de ranuras distintas). Con swap: antes un Error médico le pasa el cuerpo
  // infectado al que contagia, como en la partida donde los virus se teletransportaban.
  contagion2: (swap = false) => {
    clearTimeout(botTimer);
    const st = structuredClone(state);
    const opps = st.players.filter((p) => p.id !== 'me' && !p.out);
    // swap === 'me': el Error médico lo juego yo (mis virus pasan a un rival, como en la partida real)
    const [a, c] = [opps[0], opps[opps.length - 1]];
    const b = swap === 'me' ? st.players.find((p) => p.id === 'me') : opps[1];
    if (!c || c === b) return;
    st.discard.push(...[...a.body, ...b.body, ...c.body].flatMap((s) => [s.organ, ...s.viruses, ...s.medicines]));
    state = st;
    const slotOf = (color, infected) => {
      const organ = pull((x) => x.kind === 'organ' && x.color === color);
      return { id: organ.id, organ, viruses: infected ? [pull((x) => x.kind === 'virus' && x.color === color)] : [], medicines: [] };
    };
    const infected = ['green', 'yellow'].map((color) => slotOf(color, true));
    const clean = ['green', 'yellow'].map((color) => slotOf(color, false));
    a.body = clean;
    b.body = swap ? infected : [];
    c.body = swap ? [] : infected;
    useStore.setState({ game: view() });
    if (swap) {
      // c se queda con el cuerpo infectado de b (Error médico) y luego contagia a a
      setTimeout(() => {
        if (swap === 'me') force('me', pull((x) => x.treatment === 'medicalError'), () => ({ playerId: c.id }));
        else force(c.id, pull((x) => x.treatment === 'medicalError'), () => ({ playerId: b.id }));
        clearTimeout(botTimer);
        setTimeout(() => force(c.id, pull((x) => x.treatment === 'contagion'), () => ({})), 3200);
      }, 600);
      return;
    }
    setTimeout(() => force(c.id, pull((x) => x.treatment === 'contagion'), () => ({})), 600);
  },
  contagion2Swap: () => SCENARIOS.contagion2(true),
  contagion2Me: () => SCENARIOS.contagion2('me'),
  glove: () => {
    const card = pull((c) => c.treatment === 'glove');
    force(firstOpp().id, card, () => ({}));
  },
  // El guante lo juega un bot (con ?bots o en ?demo=game6, donde hay uno)
  gloveBot: () => {
    const bot = state.players.find((p) => p.id !== 'me' && !p.out && isBotId(p.id)) || firstOpp();
    const card = pull((c) => c.treatment === 'glove');
    force(bot.id, card, () => ({}));
  },
  // Le toca a un bot y juega solo (se ve pensar, levantar la carta y jugarla)
  botTurn: () => {
    clearTimeout(botTimer);
    const bot = state.players.find((p) => p.id !== 'me' && !p.out && isBotId(p.id)) || firstOpp();
    const st = structuredClone(state);
    st.turn = st.players.findIndex((p) => p.id === bot.id);
    st.players[st.turn].skipNext = false;
    st.turnNumber += 1;
    state = st;
    lastAnimMs = 0;
    restartClock();
    push([{ type: 'turn', playerId: bot.id, turnNumber: st.turnNumber }]);
    const was = window.__ronaDemo.paused;
    window.__ronaDemo.paused = false;
    schedule();
    window.__ronaDemo.paused = was;
  },
  // El mazo se queda vacío y descarto: se rebaraja el descarte antes de robar
  reshuffle: () => {
    clearTimeout(botTimer);
    const st = structuredClone(state);
    st.turn = st.players.findIndex((p) => p.id === 'me');
    st.discard = [...st.deck, ...st.discard];
    st.deck = [];
    state = st;
    const me = st.players[st.turn];
    if (!me.hand.length) return;
    step(() => applyAction(state, 'me', { type: 'discard', cardIds: [me.hand[0].id] }));
  },
  medicalError: () => {
    const card = pull((c) => c.treatment === 'medicalError');
    force(firstOpp().id, card, () => ({ playerId: 'me' }));
  },
  thief: () => {
    const thiefP = firstOpp();
    const card = pull((c) => c.treatment === 'thief');
    force(thiefP.id, card, (st) => {
      const t = st.players.find((p) => p.id === thiefP.id);
      const has = new Set(t.body.map((s) => s.organ.color));
      for (const p of st.players) {
        if (p.id === thiefP.id) continue;
        const s = p.body.find((x) => x.medicines.length < 2 && !has.has(x.organ.color));
        if (s) return { playerId: p.id, slotId: s.id };
      }
      return null;
    });
  },
  transplant: () => {
    const card = pull((c) => c.treatment === 'transplant');
    force('me', card, (st) => {
      const me = st.players.find((p) => p.id === 'me');
      for (const p of st.players) {
        if (p.id === 'me') continue;
        for (const a of me.body) for (const b of p.body) {
          const ok = a.medicines.length < 2 && b.medicines.length < 2
            && (a.organ.color === b.organ.color || (!p.body.some((x) => x.id !== b.id && x.organ.color === a.organ.color) && !me.body.some((x) => x.id !== a.id && x.organ.color === b.organ.color)));
          if (ok) return { a: { playerId: 'me', slotId: a.id }, b: { playerId: p.id, slotId: b.id } };
        }
      }
      return null;
    });
  },
  // Me dejan 3 órganos sanos y juego el cuarto
  win: () => winFor('me'),
  lose: () => winFor(firstOpp().id),
  // Reinicia con una partida recién repartida (para ver el reparto en cascada)
  deal: () => restart('fresh', true),
  myTurn: () => {
    const st = structuredClone(state);
    st.turn = st.players.findIndex((p) => p.id === 'me');
    st.turnNumber += 1;
    state = st;
    restartClock();
    push([{ type: 'turn', playerId: 'me', turnNumber: st.turnNumber }]);
    schedule();
  },
  chat: () => fakeChat(),
};

const winFor = (pid) => {
  clearTimeout(botTimer);
  const st = structuredClone(state);
  const p = st.players.find((x) => x.id === pid);
  // Deja 3 órganos sanos de colores distintos y le da el cuarto
  const keep = [];
  const used = new Set();
  for (const s of p.body) {
    if (keep.length < 3 && !used.has(s.organ.color) && s.organ.color !== 'multi' && s.viruses.length === 0) {
      keep.push(s); used.add(s.organ.color);
    } else st.discard.push(s.organ, ...s.viruses, ...s.medicines);
  }
  for (const color of ['red', 'green', 'blue', 'yellow']) {
    if (keep.length >= 3) break;
    if (used.has(color)) continue;
    state = st;
    const organ = pull((c) => c.kind === 'organ' && c.color === color);
    keep.push({ id: organ.id, organ, viruses: [], medicines: [] });
    used.add(color);
  }
  p.body = keep;
  state = st;
  const missing = ['red', 'green', 'blue', 'yellow'].find((c) => !used.has(c));
  const card = pull((c) => c.kind === 'organ' && c.color === missing);
  force(pid, card, () => ({ playerId: pid }));
};

const fakeChat = () => {
  const lines = ['jajaja te quedaste sin corazón', '¿quién me pegó la roña?', 'gg', 'ya casi gano, aguas'];
  const from = PEOPLE[1 + Math.floor(Math.random() * 3)];
  useStore.setState((s) => ({
    chat: [...s.chat, { id: `m${Date.now()}`, from: { id: from.id, name: from.name, color: from.color }, text: lines[Math.floor(Math.random() * lines.length)], ts: Date.now(), system: false }],
  }));
};

// ---------- Arranque ----------

const restart = (mode, remount = false) => {
  clearTimeout(botTimer);
  clearTimeout(timeoutTimer);
  const n = demoPlayers;
  state = mode === 'fresh' ? fresh(n) : build6(n);
  if (mode === 'fresh') {
    // Que empiece el turno conmigo (soy el primero de la lista)
    state.turn = 0;
  }
  restartClock();
  seq = 0;
  const allBots = new URLSearchParams(window.location.search).has('bots');
  const players = PEOPLE.slice(0, n).map((p) => ({ ...p, isBot: !!p.isBot || (allBots && p.id !== 'me'), connected: p.id !== 'elian' || allBots }));
  useStore.setState({
    demo: true,
    connected: true,
    session: { token: 'demo', playerId: 'me' },
    profile: { name: 'Misael', avatar: 7, color: '#ffae00' },
    room: { id: 'demo', name: 'Sala de prueba', hostId: 'me', maxPlayers: 6, status: 'playing', players },
    eventQueue: [],
    game: remount ? null : view(),
  });
  if (!remount) { schedule(); return; }
  // Forzar que la mesa se vuelva a montar (para ver el reparto)
  setTimeout(() => {
    useStore.setState({ game: view() });
    schedule();
  }, 30);
};

let demoPlayers = 4;

export const startDemo = (param) => {
  demoPlayers = param === 'game6' ? 6 : param === 'game2' ? 2 : param === 'game3' ? 3 : param === 'game5' ? 5 : 4;
  const params = new URLSearchParams(window.location.search);
  const paused = params.has('pause');
  // ?longnames: nombres largos para revisar que no se corten ni se partan a media palabra
  if (params.has('longnames')) {
    const long = ['Maximiliana Ruiz', 'Maximiliano Roña', 'Tío Comezón', 'Beto', 'Comandante Tos', 'Doctor Mocos'];
    PEOPLE.forEach((p, i) => { p.name = long[i]; });
  }

  useStore.setState({
    // Las acciones del store se reemplazan por la simulación local
    act: async (action) => {
      if (!state) throw { code: 'GAME_OVER', message: 'No hay partida' };
      try {
        step(() => applyAction(state, 'me', action));
        return { ok: true };
      } catch (err) {
        throw { code: err.code || 'UNKNOWN', message: err.message || 'Jugada ilegal' };
      }
    },
    rematch: async () => { restart('fresh', true); return { ok: true }; },
    leaveRoom: async () => {
      clearTimeout(botTimer);
      clearTimeout(timeoutTimer);
      window.location.search = '';
    },
    sendChat: async (text) => {
      useStore.setState((s) => ({
        chat: [...s.chat, { id: `m${Date.now()}`, from: { id: 'me', name: 'Misael', color: '#ffae00' }, text, ts: Date.now(), system: false }],
      }));
      setTimeout(fakeChat, 1500);
      return { ok: true };
    },
    chat: [
      { id: 's1', from: null, text: 'Vane se unió a la sala', ts: Date.now() - 60000, system: true },
      { id: 'm1', from: { id: 'vane', name: 'Vane', color: '#a24bff' }, text: '¡Prepárense para la roña!', ts: Date.now() - 50000, system: false },
      { id: 'm2', from: { id: 'adan', name: 'Adán', color: '#1e90ff' }, text: 'nel, yo traigo vacunas', ts: Date.now() - 40000, system: false },
    ],
  });

  window.__ronaDemo = {
    paused,
    run: (name) => SCENARIOS[name]?.(),
    pause: () => { window.__ronaDemo.paused = true; clearTimeout(botTimer); },
    resume: () => { window.__ronaDemo.paused = false; schedule(); },
    scenarios: Object.keys(SCENARIOS),
    get state() { return state; },
  };
  restart(params.has('fresh') ? 'fresh' : 'scripted');
  console.info('[demo] modo demostración activo:', demoPlayers, 'jugadores. window.__ronaDemo.run(…)', Object.keys(SCENARIOS));
};
