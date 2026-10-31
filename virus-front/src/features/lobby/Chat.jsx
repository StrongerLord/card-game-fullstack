import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useStore } from '../../store/useStore';
import { toastError } from './toasts';
import { IconSend } from './icons';
import { EmoteRow } from '../emotes/EmotePicker';

const CHAT_MAX = 200;

const timeOf = (ts) => {
  try {
    return new Date(ts).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
};

// Chat de la sala: burbujas propias a la derecha, ajenas a la izquierda y avisos del sistema al centro
export const Chat = () => {
  const chat = useStore((s) => s.chat);
  const myId = useStore((s) => s.session?.playerId);
  const sendChat = useStore((s) => s.sendChat);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  // Autoscroll al último mensaje
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: chat.length > 1 ? 'smooth' : 'auto' });
  }, [chat.length]);

  const send = async (e) => {
    e.preventDefault();
    const clean = text.trim();
    if (!clean || sending) return;
    setSending(true);
    setText('');
    try {
      await sendChat(clean.slice(0, CHAT_MAX));
    } catch (err) {
      setText(clean);
      toastError(err);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  return (
    <section className="chat">
      <header className="chat__header">
        <h2 className="ui-panel__title">Chat</h2>
        <span className="chat__live"><i /> en vivo</span>
      </header>

      <div className="chat__list" ref={listRef} role="log" aria-live="polite">
        {chat.length === 0 && <p className="chat__empty">Saluda a los demás 👋</p>}
        <AnimatePresence initial={false}>
          {chat.map((m, i) => {
            if (m.system) {
              return (
                <motion.div
                  key={m.id}
                  className="chat__system"
                  initial={{ opacity: 0, scale: 0.7 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 26 }}
                >
                  <span>{m.text}</span>
                </motion.div>
              );
            }
            const mine = m.from?.id === myId;
            const prev = chat[i - 1];
            const grouped = prev && !prev.system && prev.from?.id === m.from?.id;
            return (
              <motion.div
                key={m.id}
                className={`chat__msg ${mine ? 'is-mine' : ''} ${grouped ? 'is-grouped' : ''}`}
                initial={{ opacity: 0, x: mine ? 40 : -40, scale: 0.8 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                transition={{ type: 'spring', stiffness: 520, damping: 30 }}
              >
                {!mine && !grouped && (
                  <span className="chat__author" style={{ color: m.from?.color }}>{m.from?.name}</span>
                )}
                <div className="chat__bubble" style={!mine ? { '--author': m.from?.color || '#885FFE' } : undefined}>
                  <span className="chat__text">{m.text}</span>
                  <time className="chat__time">{timeOf(m.ts)}</time>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      <EmoteRow className="chat__emotes" />
      <form className="chat__form" onSubmit={send}>
        <input
          ref={inputRef}
          className="ui-input chat__input"
          value={text}
          maxLength={CHAT_MAX}
          placeholder="Escribe un mensaje…"
          onChange={(e) => setText(e.target.value)}
          aria-label="Mensaje"
        />
        <motion.button
          className="chat__send"
          disabled={!text.trim() || sending}
          whileTap={{ scale: 0.85, rotate: -15 }}
          whileHover={{ scale: 1.08 }}
          aria-label="Enviar"
        >
          <IconSend />
        </motion.button>
      </form>
    </section>
  );
};
