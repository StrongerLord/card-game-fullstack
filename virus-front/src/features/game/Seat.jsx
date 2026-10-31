import { memo } from 'react';
import { Avatar } from './Avatar';
import { Body } from './Body';
import { CardBack } from './GameCard';
import { handAnchor } from './fx';
import { COUNT_W } from './layout';
import { BACK_IMAGE } from '../../lib/cards';
import { pressable } from './a11y';

// Mano boca abajo de un rival, asomando desde el borde de la pantalla
const Backs = memo(function Backs({ playerId, count, w, h, side, style }) {
  const n = Math.min(count, 7);
  const items = Array.from({ length: n }, (_, i) => {
    const mid = (n - 1) / 2;
    const tilt = (i - mid) * 9;
    const shift = (i - mid) * w * 0.62;
    const arc = Math.abs(i - mid) * h * 0.06;
    let transform;
    if (side === 'top') transform = `translate(${shift}px, ${-arc}px) rotate(${180 - tilt}deg)`;
    else if (side === 'left') transform = `translate(${-arc}px, ${shift}px) rotate(${90 + tilt}deg)`;
    else transform = `translate(${arc}px, ${shift}px) rotate(${-90 - tilt}deg)`;
    return (
      <div key={i} className="gt-back-slot" style={{ transform, marginLeft: -w / 2, marginTop: -h / 2 }}>
        <CardBack w={w} h={h} fxKey={`${playerId}:b${i}`} className="gt-back-card" />
      </div>
    );
  });
  return (
    <div className={`gt-backs gt-backs-${side}`} data-anchor={handAnchor(playerId)} style={style}>
      {items}
    </div>
  );
});

// Asientos compactos: en vez del abanico de reversos (que se enciman con el nombre), un contador
const HandCount = memo(function HandCount({ playerId, count, size }) {
  const h = Math.round(size * 0.95);
  const w = Math.round(size * COUNT_W);
  return (
    <div
      className="gt-hand-count"
      data-anchor={handAnchor(playerId)}
      style={{ width: w, height: h }}
      title={`${count} ${count === 1 ? 'carta' : 'cartas'} en la mano`}
      aria-label={`${count} ${count === 1 ? 'carta' : 'cartas'} en la mano`}
    >
      <img src={BACK_IMAGE} alt="" draggable={false} />
      <span style={{ fontSize: Math.max(11, Math.round(h * 0.5)) }}>{count}</span>
    </div>
  );
});

// Asiento de un rival: avatar, mano boca abajo y cuerpo
export const Seat = memo(function Seat({ seat, gp, info, hl, picked, hover, onSlot, onPlayer, timer, gap }) {
  const targetable = !!hl?.players?.has(gp.id);
  const isHover = hover === `player:${gp.id}`;
  const backW = Math.round(seat.card4.w * (seat.pos === 'top' ? 0.82 : 0.9));
  const backH = Math.round(backW / 0.8);
  const pickPlayer = targetable ? () => onPlayer(gp.id) : null;
  const panelProps = {
    'data-drop': targetable ? 'player' : undefined,
    'data-pid': gp.id,
    ...pressable(pickPlayer, `Cambiar tu cuerpo con el de ${gp.name}`),
  };
  const classes = [
    'gt-seat',
    `gt-seat-${seat.pos}`,
    seat.compact && 'is-compact',
    gp.isTurn && 'is-turn',
    gp.out && 'is-out',
    targetable && 'is-target',
    isHover && 'is-hover',
    hl?.active && !targetable && hl.players.size > 0 && 'is-dim',
  ].filter(Boolean).join(' ');

  const avatar = (
    <Avatar
      info={info}
      gp={gp}
      size={seat.avatar}
      timer={gp.isTurn ? timer : null}
      nameSide={seat.pos === 'top' ? (seat.compact ? 'right' : 'bottom') : seat.pos === 'left' ? 'right' : 'left'}
      targetable={targetable}
      hovered={isHover}
      onClick={pickPlayer}
      compact={seat.compact}
      nameMax={seat.nameMax}
      bubbleSide={seat.pos === 'top' ? 'bottom' : seat.pos === 'left' ? 'right' : 'left'}
    />
  );

  const body = (
    <Body
      playerId={gp.id}
      body={gp.body}
      card4={seat.card4}
      card5={seat.card5}
      cols={seat.cols}
      gap={gap}
      hl={hl}
      picked={picked}
      hover={hover}
      onSlot={onSlot}
      ownerName={gp.name}
    />
  );

  if (seat.pos === 'top') {
    return (
      <div className={classes} style={{ left: seat.x, top: 0, width: seat.w, height: seat.h, '--pc': info?.color || '#ffae00' }}>
        <div className="gt-seat-panel" style={{ width: seat.panelW, height: seat.h }} {...panelProps}>
          {seat.compact
            ? <HandCount playerId={gp.id} count={gp.handCount} size={seat.avatar} />
            : <Backs playerId={gp.id} count={gp.handCount} w={backW} h={backH} side="top" style={{ left: '50%', top: seat.peek - backH * 0.5 }} />}
          {seat.compact && <div className="gt-seat-chip">{avatar}</div>}
          <div className="gt-seat-body" style={{ paddingTop: seat.head }}>{body}</div>
        </div>
        {!seat.compact && <div className="gt-seat-avatar" style={{ width: seat.w - seat.panelW }}>{avatar}</div>}
      </div>
    );
  }

  const left = seat.pos === 'left';
  return (
    <div className={classes} style={{ left: seat.x, top: 0, width: seat.w, height: '100%', '--pc': info?.color || '#ffae00' }}>
      <div className="gt-seat-head" style={{ top: seat.headY, [left ? 'left' : 'right']: 'var(--pad)' }}>{avatar}</div>
      <div
        className="gt-seat-panel"
        style={{ top: seat.y, height: seat.h, width: seat.w, [left ? 'paddingLeft' : 'paddingRight']: seat.gutter }}
        {...panelProps}
      >
        <Backs playerId={gp.id} count={gp.handCount} w={backW} h={backH} side={seat.pos} style={{ top: '50%', left: left ? seat.gutter - backH * 0.5 : seat.w - seat.gutter + backH * 0.5 }} />
        <div className="gt-seat-body">{body}</div>
      </div>
    </div>
  );
});
