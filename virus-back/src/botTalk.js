// Reacciones de los bots: a partir de un lote de eventos del motor decide qué emote (y a veces qué
// frase) suelta cada bot. Es una función pura con el azar inyectado, para poder probarla.

// Frases cortas por situación; se elige una al azar
const LINES = {
  infected: ['¡Ey, eso es mío!', 'Me pegaste la roña…', '¿Neta? ¿A mí?'],
  destroyed: ['¡Mi órgano! 😭', 'Noooo…', 'Me la vas a pagar'],
  unvaccinated: ['Adiós vacuna…', 'Pff, me la quitaste'],
  robbed: ['¡Ladrón!', '¡Regrésamelo!', '¿Y mi órgano?'],
  swapped: ['¿¡Qué hiciste!?', 'Eso no se vale', 'Me cambiaron el cuerpo 😱'],
  gloved: ['¡Mi mano!', 'Qué asco de guante', 'Ni modo, a robar'],
  evil: ['Jejeje', 'Toma tu roña', 'Nada personal'],
  proud: ['Inmune, compa 😎', 'Sano y salvo', 'A mí no me pega nada'],
  won: ['¡GG! Soy inmune', 'Demasiado fácil', '¡Gané, gané!'],
  lost: ['GG', 'La próxima es mía', 'Revancha, ¿o miedo?'],
};

// Respuesta de un bot cuando un humano le manda un emote
const REPLIES = {
  laugh: ['angry', 'rage'],
  evil: ['angry', 'shock'],
  cool: ['laugh', 'angry'],
  angry: ['laugh', 'evil'],
  rage: ['laugh', 'cool'],
  cry: ['laugh', 'clap'],
  shock: ['laugh', 'evil'],
  clap: ['clap', 'cool'],
};

const pick = (list, random) => list[Math.floor(random() * list.length)];

/**
 * @param {object[]} events   lote del motor
 * @param {string[]} botIds   bots que siguen en la mesa
 * @param {() => number} random
 * @returns {{ playerId, emote, say? }[]}  como mucho una reacción por bot
 */
export function reactionsFor(events, botIds, random = Math.random) {
  const bots = new Set(botIds);
  if (!bots.size) return [];
  const actor = events.find((e) => e.type === 'played')?.playerId ?? null;
  // Por bot, la reacción con más prioridad: { prio, chance, emotes, lines }
  const best = new Map();
  const want = (playerId, prio, chance, emotes, lines) => {
    if (!bots.has(playerId)) return;
    const cur = best.get(playerId);
    if (!cur || prio > cur.prio) best.set(playerId, { prio, chance, emotes, lines });
  };
  const victim = (playerId) => playerId !== actor;

  for (const e of events) {
    switch (e.type) {
      case 'infected':
        if (victim(e.playerId)) { want(e.playerId, 2, 0.45, ['angry', 'shock'], LINES.infected); want(actor, 1, 0.3, ['evil'], LINES.evil); }
        break;
      case 'organDestroyed':
        if (victim(e.playerId)) { want(e.playerId, 4, 0.85, ['rage', 'cry'], LINES.destroyed); want(actor, 2, 0.5, ['evil', 'laugh'], LINES.evil); }
        break;
      case 'vaccineRemoved':
        if (victim(e.playerId)) want(e.playerId, 2, 0.4, ['angry'], LINES.unvaccinated);
        break;
      case 'slotMoved':
        if (e.fromPlayerId !== actor) want(e.fromPlayerId, 4, 0.75, ['shock', 'angry'], LINES.robbed);
        if (e.toPlayerId === actor) want(actor, 2, 0.4, ['cool', 'laugh'], LINES.evil);
        break;
      case 'bodiesSwapped':
        for (const id of [e.a, e.b]) if (victim(id)) want(id, 5, 0.85, ['shock', 'rage'], LINES.swapped);
        want(actor, 3, 0.6, ['evil'], LINES.evil);
        break;
      case 'handsDiscarded':
        for (const id of e.playerIds) want(id, 3, 0.6, ['rage', 'cry'], LINES.gloved);
        want(actor, 3, 0.5, ['laugh', 'evil'], LINES.evil);
        break;
      case 'immunized':
        want(e.playerId, 2, 0.5, ['cool'], LINES.proud);
        break;
      case 'cured':
        want(e.playerId, 1, 0.25, ['cool', 'clap'], LINES.proud);
        break;
      case 'win':
        want(e.playerId, 9, 0.95, ['laugh', 'cool', 'clap'], LINES.won);
        for (const id of bots) if (id !== e.playerId) want(id, 8, 0.6, ['cry', 'angry', 'clap'], LINES.lost);
        break;
      default:
    }
  }

  const out = [];
  for (const [playerId, r] of best) {
    if (random() >= r.chance) continue;
    const reaction = { playerId, emote: pick(r.emotes, random) };
    // Un poco más de la mitad de las veces, además del emoji, una frase
    if (r.lines && random() < 0.55) reaction.say = pick(r.lines, random);
    out.push(reaction);
  }
  return out;
}

// Un bot contesta a un emote de un humano (o no: devuelve null)
export function replyTo(emote, botIds, random = Math.random) {
  if (!botIds.length || random() >= 0.3) return null;
  const options = REPLIES[emote];
  if (!options) return null;
  return { playerId: pick(botIds, random), emote: pick(options, random) };
}
