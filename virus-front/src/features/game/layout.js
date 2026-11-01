// Geometría de la mesa: dónde va cada asiento y de qué tamaño son las cartas.
// Todo en píxeles a partir del tamaño de la ventana, para que se adapte de 1280×720 a 1920×1080
// y a un celular en horizontal. Referencia: el mockup assets/Group 12sa.png (1920×1080).

export const CARD_RATIO = 0.8; // ancho / alto del arte de las cartas (641×801)
export const STACK_STEP = 0.11; // cuánto asoma por debajo cada virus/medicina apilado, en fracción del alto
export const STACK_EXTRA = STACK_STEP * 2; // como mucho hay 2 cartas encima de un órgano

// Posiciones de los rivales según cuántos sean, en orden de asientos a partir de mí (sentido horario)
const SEAT_POSITIONS = {
  0: [],
  1: ['top'],
  2: ['top', 'top'],
  3: ['left', 'top', 'right'],
  4: ['left', 'top', 'top', 'right'],
  5: ['left', 'top', 'top', 'top', 'right'],
};

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

// Ancho mínimo cómodo para tocar una ranura con el dedo
export const MIN_TOUCH = 44;
// Ancho que necesita un nombre para que su palabra más larga (hasta ~11 letras) quepa a 11 px
export const NAME_MIN_W = 100;
// Ancho del contador de cartas de los asientos compactos, en fracción del avatar
export const COUNT_W = 0.8;

// Tamaño de carta que cabe en una caja con n ranuras (en fila o en rejilla de `cols` columnas)
export const fitCards = (boxW, boxH, n, cols = n, gap = 8) => {
  const c = Math.max(1, Math.min(cols, n));
  const rows = Math.ceil(n / c);
  const byW = (boxW - (c - 1) * gap) / c;
  const byH = ((boxH - (rows - 1) * gap) / rows / (1 + STACK_EXTRA)) * CARD_RATIO;
  const w = Math.max(18, Math.floor(Math.min(byW, byH)));
  return { w, h: Math.round(w / CARD_RATIO) };
};

// Pantalla parada (celular en vertical): rivales en rejilla arriba, la mesa en medio, mi cuerpo
// a todo lo ancho, una fila con mi avatar y los botones, y la mano abajo. Los controles van arriba.
// La pista (qué hace la carta / de quién es el turno) va en su propia franja de HINT_BAND px entre el centro
// y mi panel, para no tapar mis ranuras. Si es mi turno, la mano sube MY_TURN_LIFT px para que se vea más.
const HINT_BAND = 34;
const MY_TURN_LIFT = 16;

const computePortraitLayout = (W, H, nOpp, { myTurn = false } = {}) => {
  const n = clamp(nOpp, 0, 5);
  const pad = clamp(W * 0.02, 5, 14);
  const gap = clamp(W * 0.015, 4, 10);
  const radius = clamp(W * 0.035, 10, 24);
  const barH = 38;

  // Mano abajo: tres cartas grandes que asoman (en mi turno, un poco más)
  const handW = Math.round(clamp(Math.min(W * 0.27, H * 0.15), 56, 160));
  const handCard = { w: handW, h: Math.round(handW / CARD_RATIO) };
  const handRest = H - handCard.h * 0.8; // dónde queda la mano fuera de mi turno: lo demás no se mueve
  const handTop = myTurn ? Math.max(handRest - MY_TURN_LIFT, H - handCard.h) : handRest;
  // Fila de mi avatar y los botones, justo encima de la mano
  const actionH = clamp(H * 0.055, 38, 56);
  const actionY = handRest - actionH - gap;

  // Mi cuerpo: cinco ranuras a lo ancho. La pista va en una franja aparte, arriba del panel
  const hintRoom = 0; // el panel ya no reserva espacio adentro para la pista
  const hintBand = HINT_BAND;
  const slotsW = W - pad * 4;
  const card5 = fitCards(slotsW, H * 0.16, 5, 5, gap);
  const bodyH = card5.h * (1 + STACK_EXTRA);
  const mePanelH = pad * 1.5 + bodyH;
  const meTop = actionY - mePanelH;
  const mePanel = { x: pad, y: meTop, w: W - pad * 2, h: H - meTop + radius };
  const me = {
    panel: mePanel,
    hintRoom,
    hint: { y: meTop - hintBand / 2 - gap * 0.25, band: hintBand },
    slotsBox: { w: slotsW, h: bodyH },
    card4: fitCards(slotsW, bodyH / (1 + STACK_EXTRA) * 1.05, 4, 4, gap * 1.6),
    card5,
    hand: { cx: W / 2, top: handTop, card: handCard, width: handCard.w * 2.9 },
    avatar: {
      size: actionH,
      left: pad * 1.5,
      y: actionY,
      nameSide: 'right',
      nameMax: Math.max(60, W * 0.32),
    },
    actions: { right: pad, bottom: H - actionY - actionH, row: true },
  };

  // Lo que queda arriba: rivales y centro
  const top0 = barH + pad * 2;
  const avail = Math.max(120, meTop - hintBand - gap * 0.5 - top0);
  const centerH = n ? clamp(avail * 0.3, 70, 190) : avail;
  const oppH = avail - centerH - gap;

  const cols = n <= 1 ? 1 : 2;
  const rows = Math.ceil(n / cols);
  const rowH = rows ? (oppH - (rows - 1) * gap) / rows : 0;
  const seats = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols);
    // Si sobra uno en la última fila, ocupa todo el ancho
    const alone = cols === 2 && i === n - 1 && n % 2 === 1;
    const seatW = alone || cols === 1 ? W - pad * 2 : (W - pad * 2 - gap) / 2;
    const x = alone || cols === 1 ? pad : pad + (i % 2) * (seatW + gap);
    const y = top0 + row * (rowH + gap);
    const avatar = clamp(rowH * 0.26, 22, 46);
    const head = avatar + pad * 0.5;
    const box = { w: seatW - pad * 2, h: rowH - head - pad * 2 };
    seats.push({
      pos: 'top', compact: true, x, y, w: seatW, h: rowH, peek: 0, avatar, box, head,
      cols: 5, card4: fitCards(box.w, box.h, 4, 4, gap * 0.8), card5: fitCards(box.w, box.h, 5, 5, gap * 0.6),
      panelW: seatW, nameMax: seatW - pad * 2 - avatar * (1.14 + COUNT_W) - pad,
    });
  }

  const center = { x: pad, y: top0 + (n ? oppH + gap : 0), w: W - pad * 2, h: centerH };
  // Las pilas no pasan de ~55 % del ancho: el resto es para el narrador
  const pileH = clamp(Math.min(centerH * 0.84, (W * 0.55 - pad * 2) / (2.6 * CARD_RATIO)), 50, 200);
  center.card = { w: Math.round(pileH * CARD_RATIO), h: Math.round(pileH) };
  // Las pilas a la izquierda y lo que va pasando a la derecha
  const pilesW = center.card.w * 2.6 + pad * 2;
  const narrator = { left: pilesW + pad, top: center.y + pad, width: W - pilesW - pad * 2 };
  center.w = Math.min(center.w, pilesW + pad);

  return {
    W, H, pad, gap, radius, sideW: 0, topH: oppH, meTop, me, center, seats,
    positions: seats.map(() => 'top'), portrait: true, narrator,
    controls: { top: pad, right: pad },
  };
};

// opts.myTurn: en vertical, la mano sube un poco cuando es mi turno
export const computeLayout = (W, H, nOpp, opts = {}) => {
  if (W < H * 0.9) return computePortraitLayout(W, H, nOpp, opts);
  const positions = SEAT_POSITIONS[clamp(nOpp, 0, 5)];
  const hasSides = positions.includes('left');
  const nTop = positions.filter((p) => p === 'top').length;
  const pad = clamp(Math.min(W, H) * 0.014, 5, 18);
  const gap = clamp(Math.min(W, H) * 0.012, 4, 14);
  const radius = clamp(H * 0.03, 10, 34);

  const sideW = hasSides ? clamp(W * 0.18, 130, 370) : 0;
  const topH = nTop ? clamp(H * 0.3, 96, 360) : 0;
  const meTop = H * 0.585;

  // ---------- Mi zona ----------
  const handCardH = clamp(H * 0.23, 70, 260);
  const handCard = { w: Math.round(handCardH * CARD_RATIO), h: Math.round(handCardH) };
  const handWidth = handCard.w * 2.9;
  const meAvatar = clamp(H * 0.135, 40, 150);
  const meLimitL = hasSides ? sideW + gap : pad;
  const mePanelW = Math.min(clamp(W * 0.43, 260, 820), W - meLimitL * 2);
  const mePanel = { x: (W - mePanelW) / 2, y: meTop, w: mePanelW, h: H - meTop + radius };
  const hintRoom = clamp(H * 0.022, 8, 24); // espacio arriba para la pista que monta el borde del panel
  const meSlotsBox = { w: mePanelW - pad * 2, h: H * 0.805 - meTop - pad - hintRoom };
  const me = {
    panel: mePanel,
    hintRoom,
    slotsBox: meSlotsBox,
    card4: fitCards(meSlotsBox.w, meSlotsBox.h, 4, 4, gap * 1.6),
    card5: fitCards(meSlotsBox.w, meSlotsBox.h, 5, 5, gap * 1.2),
    hand: { cx: W / 2, top: H - handCard.h * 0.78, card: handCard, width: handWidth },
    avatar: {
      size: meAvatar,
      right: W - (W / 2 - handWidth / 2 - gap * 2), // se ancla por la derecha (el nombre va a la izquierda)
      y: H - meAvatar - pad,
      // Mi nombre ocupa lo que queda a la izquierda del avatar (con un tope para que no se vea perdido)
      nameMax: Math.max(60, Math.min(meAvatar * 3, W / 2 - handWidth / 2 - gap * 2 - meAvatar * 1.14 - pad * 2)),
    },
  };

  // ---------- Centro ----------
  const centerX0 = hasSides ? sideW + gap : pad;
  const center = { x: centerX0, y: topH + gap, w: W - centerX0 * 2, h: meTop - topH - gap * 2 };
  const pileH = clamp(Math.min(center.h * 0.82, H * 0.2), 50, 230);
  center.card = { w: Math.round(pileH * CARD_RATIO), h: Math.round(pileH) };

  // ---------- Rivales ----------
  // Asientos de arriba repartidos entre x0 y W - x0
  const topSeats = (x0) => {
    const regionW = W - x0 * 2;
    // Con 1 o 2 rivales arriba no hace falta un panel de lado a lado
    const maxTopW = nTop === 1 ? W * 0.6 : nTop === 2 ? W * 0.42 : Infinity;
    const seatW = nTop ? Math.min(maxTopW, (regionW - (nTop - 1) * gap * 2) / nTop) : 0;
    const start = (W - (nTop * seatW + (nTop - 1) * gap * 2)) / 2;
    return Array.from({ length: nTop }, (_, i) => {
      const x = start + i * (seatW + gap * 2);
      const peek = topH * 0.17; // franja de la mano boca abajo que asoma desde el borde de arriba
      // Opción A: avatar a la derecha del panel (como el mockup)
      const avA = clamp(Math.min(topH * 0.46, seatW * 0.24), 34, 150);
      const boxA = { w: seatW - avA - gap * 2 - pad * 2, h: topH - peek - pad * 2 };
      // Opción B (compacta): avatar pequeño en una franja arriba, sin abanico de reversos
      // (sólo un contador de cartas), para no encimar el nombre con la mano
      const avB = clamp(topH * 0.22, 24, 64);
      const headB = avB + pad * 0.5;
      const boxB = { w: seatW - pad * 2, h: topH - headB - pad * 2 };
      const cardA = fitCards(boxA.w, boxA.h, 4, 4, gap);
      const cardB = fitCards(boxB.w, boxB.h, 4, 4, gap);
      // Compacto si así caben cartas más grandes, o si la columna del avatar no da para un nombre legible
      const compact = cardB.w > cardA.w * 1.12 || avA + gap * 2 < NAME_MIN_W;
      const avatar = compact ? avB : avA;
      const box = compact ? boxB : boxA;
      const panelW = compact ? seatW : seatW - avA - gap * 2;
      // El nombre: en el compacto, a la derecha del avatar hasta el contador de cartas; si no, bajo el avatar
      const nameMax = compact ? seatW - pad * 2 - avB * (1.14 + COUNT_W) - pad : seatW - panelW;
      return {
        pos: 'top', compact, x, y: 0, w: seatW, h: topH, peek, avatar, box, head: compact ? headB : peek,
        cols: 5, card4: fitCards(box.w, box.h, 4, 4, gap), card5: fitCards(box.w, box.h, 5, 5, gap * 0.8),
        panelW, nameMax,
      };
    });
  };
  let tops = topSeats(hasSides ? sideW + gap * 1.5 : W * 0.035);
  // Celular en horizontal con 2 o 3 rivales arriba y 2 a los lados: si las ranuras de arriba no llegan
  // a un tamaño táctil (44 px), la fila de arriba usa todo el ancho y los laterales empiezan debajo
  let sideTop = 0;
  if (hasSides && nTop >= 2 && tops[0].card4.w < MIN_TOUCH) {
    const wide = topSeats(pad);
    if (wide[0].card4.w > tops[0].card4.w) {
      tops = wide;
      sideTop = topH + gap;
    }
  }

  const seats = [];
  let topIndex = 0;
  for (const pos of positions) {
    if (pos === 'top') {
      seats.push(tops[topIndex]);
      topIndex += 1;
    } else {
      // El nombre va a la derecha (o izquierda) del avatar: si la columna es angosta, el avatar se achica
      const nameNeed = Math.max(NAME_MIN_W, sideW * 0.5);
      const avatar = clamp(Math.min(sideW * 0.4, H * 0.15, (sideW - pad * 3 - nameNeed) / 1.14), 30, 160);
      const headY = sideTop + pad; // dónde va el avatar
      const nameMax = sideW - pad * 3 - avatar * 1.14;
      const y = headY + avatar * 0.85 + pad;
      const h = H * 0.895 - y;
      const gutter = sideW * 0.16; // la mano boca abajo asoma desde el borde de la pantalla
      const box = { w: sideW - gutter - pad * 2, h: h - pad * 2 };
      seats.push({
        pos, x: pos === 'left' ? 0 : W - sideW, y, headY, w: sideW, h, avatar, gutter, box, nameMax,
        cols: 2, card4: fitCards(box.w, box.h, 4, 2, gap), card5: fitCards(box.w, box.h, 5, 2, gap),
      });
    }
  }

  return { W, H, pad, gap, radius, sideW, topH, meTop, me, center, seats, positions };
};

// Orden de los rivales: los que se sientan después de mí, en orden
export const opponentsOf = (players, me) => {
  const i = players.findIndex((p) => p.id === me);
  if (i < 0) return players;
  return [...players.slice(i + 1), ...players.slice(0, i)];
};
