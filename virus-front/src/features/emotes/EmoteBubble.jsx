import { memo, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { EMOTES } from '@shared/emotes.js';
import { useStore } from '../../store/useStore';
import { sfx } from '../../lib/sfx';
import './emotes.css';

// Globo con el emote (y la frase, si es de un bot) que sale junto al avatar de un jugador.
// side: hacia dónde sale respecto al avatar (top, bottom, left, right)
export const EmoteBubble = memo(function EmoteBubble({ playerId, side = 'top' }) {
  const e = useStore((s) => s.emotes[playerId]);
  useEffect(() => { if (e) sfx.emote(); }, [e?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <AnimatePresence>
      {e && (
        <motion.div
          key={e.id}
          className={`emote-bubble emote-${side} ${e.say ? 'has-say' : ''}`}
          role="status"
          aria-label={e.say ? `${EMOTES[e.emote] || ''} ${e.say}` : EMOTES[e.emote]}
          initial={{ opacity: 0, scale: 0.2 }}
          animate={{ opacity: 1, scale: [0.2, 1.2, 1] }}
          exit={{ opacity: 0, scale: 0.6, transition: { duration: 0.2 } }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        >
          <span className={`emote-emoji emote-anim-${e.emote}`}>{EMOTES[e.emote]}</span>
          {e.say && <span className="emote-say">{e.say}</span>}
        </motion.div>
      )}
    </AnimatePresence>
  );
});
