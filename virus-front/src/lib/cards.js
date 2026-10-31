// Mapa carta → arte. Usa import.meta.glob para no importar 42 archivos a mano
const big = import.meta.glob('../assets/Cards/*_big.png', { eager: true, import: 'default' });
const sm = import.meta.glob('../assets/Cards/*_sm.png', { eager: true, import: 'default' });

const COLOR_ART = { red: 'Red', green: 'Green', blue: 'Blue', yellow: 'Yellow' };
const KIND_ART = { organ: 'organ', virus: 'rona', medicine: 'heal' };
const MULTI_ART = { organ: 'superOrgan', virus: 'superRona', medicine: 'superHeal' };
const TREATMENT_ART = {
  transplant: 'starChangeOne',
  thief: 'starSteal',
  contagion: 'starSneeze',
  glove: 'starDrop',
  medicalError: 'starChangeAll',
};

const artName = (card) => {
  if (!card) return 'back';
  if (card.kind === 'treatment') return TREATMENT_ART[card.treatment];
  if (card.color === 'multi') return MULTI_ART[card.kind];
  return KIND_ART[card.kind] + COLOR_ART[card.color];
};

// card null/undefined → reverso
export const cardImage = (card, size = 'big') => {
  const set = size === 'sm' ? sm : big;
  return set[`../assets/Cards/${artName(card)}_${size}.png`];
};

// Los reversos de la mesa se pintan a ≤ 260 px: basta la versión _sm (641×801). La _big sólo se usa
// en la revelación de un tratamiento (FxLayer), que pide cardImage(card, 'big') aparte.
export const BACK_IMAGE = cardImage(null, 'sm');

export const COLOR_NAMES = { red: 'corazón', green: 'estómago', blue: 'cerebro', yellow: 'hueso', multi: 'comodín' };
export const COLOR_HEX = { red: '#ff4d4d', green: '#20c040', blue: '#1e90ff', yellow: '#ffcc00', multi: '#c070ff' };
const TREATMENT_NAMES = {
  transplant: 'Trasplante',
  thief: 'Ladrón de órganos',
  contagion: 'Contagio',
  glove: 'Guante de látex',
  medicalError: 'Error médico',
};
export const TREATMENT_HELP = {
  transplant: 'Intercambia un órgano entre dos jugadores',
  thief: 'Roba un órgano de otro jugador',
  contagion: 'Pasa tus virus a órganos sanos de los demás',
  glove: 'Todos los demás tiran su mano y pierden un turno',
  medicalError: 'Intercambia tu cuerpo completo con otro jugador',
};

export const cardLabel = (card) => {
  if (!card) return '';
  if (card.kind === 'treatment') return TREATMENT_NAMES[card.treatment];
  if (card.kind === 'organ') return card.color === 'multi' ? 'Órgano comodín' : `Órgano: ${COLOR_NAMES[card.color]}`;
  if (card.kind === 'virus') return card.color === 'multi' ? 'Roña comodín' : `Roña de ${COLOR_NAMES[card.color]}`;
  return card.color === 'multi' ? 'Medicina comodín' : `Medicina de ${COLOR_NAMES[card.color]}`;
};

// Qué hace cada carta (la ayuda que sale al dejar el puntero encima o al mantenerla presionada)
export const TREATMENT_RULES = {
  transplant: 'Intercambia un órgano (con lo que tenga encima) entre dos jugadores distintos; puedes ser uno de ellos. No sirve con órganos inmunes ni si alguien queda con dos del mismo color.',
  thief: 'Roba un órgano de otro jugador, con sus roñas y medicinas, y pásalo a tu cuerpo. No sirve con órganos inmunes ni si ya tienes uno de ese color.',
  contagion: 'Pasa las roñas de tus órganos infectados a órganos sanos de los demás que sean del mismo color. Cada órgano recibe como mucho una.',
  glove: 'Todos los demás tiran su mano completa y pierden su siguiente turno.',
  medicalError: 'Intercambia tu cuerpo completo con el de otro jugador.',
};

export const cardHelp = (card) => {
  if (!card) return '';
  if (card.kind === 'treatment') return TREATMENT_RULES[card.treatment] || '';
  const multi = card.color === 'multi';
  const color = COLOR_NAMES[card.color];
  if (card.kind === 'organ') {
    return multi
      ? 'Ponlo en tu cuerpo: cuenta como un color más para ganar. Le pega cualquier roña y lo cura cualquier medicina.'
      : `Ponlo en tu cuerpo. Gana quien junte 4 órganos de distinto color sin roña. No puedes tener dos ${color}s.`;
  }
  const where = multi ? 'cualquier órgano' : `un ${color} (o un órgano comodín)`;
  if (card.kind === 'virus') {
    return `Juégala sobre ${where} de cualquier jugador: si está sano lo infecta, si ya tenía roña lo destruye y si estaba vacunado le quita la vacuna. A los inmunes no les hace nada.`;
  }
  return `Juégala sobre ${where} de tu cuerpo: le quita una roña o lo vacuna. Con dos vacunas queda inmune para siempre.`;
};
