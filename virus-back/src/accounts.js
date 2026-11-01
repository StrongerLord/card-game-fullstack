// Cuentas (Google), estadísticas y amigos, persistidos en SQLite con node:sqlite (Node ≥ 22.13, sin
// nada nativo que compilar). Todo es síncrono: las consultas son diminutas y el servidor es uno solo.
// La base vive en DATA_DIR/rona.db; ':memory:' (los tests) no toca el disco.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fail } from './errors.js';

// Código de amigo: 6 caracteres sin los que se confunden (0/O, 1/I/L)
export const FRIEND_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const FRIEND_CODE_LEN = 6;
export const MAX_FRIENDS = 100;
export const MAX_PENDING_OUT = 30;
// Sesiones guardadas (un "recuérdame" por dispositivo); las más viejas se borran al pasar del tope
const MAX_AUTH_TOKENS = 10;
const AUTH_TOKEN_TTL_MS = 180 * 24 * 60 * 60 * 1000;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id           TEXT PRIMARY KEY,
  google_sub   TEXT NOT NULL UNIQUE,
  email        TEXT NOT NULL DEFAULT '',
  name         TEXT NOT NULL,
  avatar       INTEGER NOT NULL,
  color        TEXT NOT NULL,
  friend_code  TEXT NOT NULL UNIQUE,
  games_played INTEGER NOT NULL DEFAULT 0,
  games_won    INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  last_seen    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_tokens (
  hash       TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  used_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_tokens_account ON auth_tokens(account_id);
-- Amistad simétrica: una fila por pareja, con a < b
CREATE TABLE IF NOT EXISTS friendships (
  a          TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  b          TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (a, b)
);
CREATE INDEX IF NOT EXISTS friendships_b ON friendships(b);
CREATE TABLE IF NOT EXISTS friend_requests (
  id         TEXT PRIMARY KEY,
  from_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  to_id      TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  UNIQUE (from_id, to_id)
);
CREATE INDEX IF NOT EXISTS friend_requests_to ON friend_requests(to_id);
`;

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('base64url');
const pair = (x, y) => (x < y ? [x, y] : [y, x]);

// Fila de la base → cuenta en memoria
const toAccount = (r) => r && {
  id: r.id,
  email: r.email,
  friendCode: r.friend_code,
  profile: { name: r.name, avatar: r.avatar, color: r.color },
  stats: { played: r.games_played, won: r.games_won },
};

// Lo que ve un amigo de ti (nunca el email)
export const publicAccount = (a) => ({ id: a.id, ...a.profile });

export class AccountStore {
  /** @param {{ file: string }} o  ruta de la base o ':memory:' */
  constructor({ file }) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 2000;');
    this.db.exec(SCHEMA);
    const q = (sql) => this.db.prepare(sql);
    this.q = {
      byId: q('SELECT * FROM accounts WHERE id = ?'),
      bySub: q('SELECT * FROM accounts WHERE google_sub = ?'),
      byCode: q('SELECT * FROM accounts WHERE friend_code = ?'),
      codeTaken: q('SELECT 1 FROM accounts WHERE friend_code = ?'),
      insert: q(`INSERT INTO accounts (id, google_sub, email, name, avatar, color, friend_code, created_at, last_seen)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
      seen: q('UPDATE accounts SET email = ?, last_seen = ? WHERE id = ?'),
      profile: q('UPDATE accounts SET name = ?, avatar = ?, color = ? WHERE id = ?'),
      played: q('UPDATE accounts SET games_played = games_played + 1, games_won = games_won + ? WHERE id = ?'),
      tokenInsert: q('INSERT INTO auth_tokens (hash, account_id, created_at, used_at) VALUES (?, ?, ?, ?)'),
      tokenGet: q('SELECT account_id, used_at FROM auth_tokens WHERE hash = ?'),
      tokenUse: q('UPDATE auth_tokens SET used_at = ? WHERE hash = ?'),
      tokenDel: q('DELETE FROM auth_tokens WHERE hash = ?'),
      tokenTrim: q(`DELETE FROM auth_tokens WHERE account_id = ? AND hash NOT IN
                    (SELECT hash FROM auth_tokens WHERE account_id = ? ORDER BY used_at DESC LIMIT ?)`),
      tokenExpire: q('DELETE FROM auth_tokens WHERE used_at < ?'),
      friends: q(`SELECT acc.* FROM friendships f JOIN accounts acc ON acc.id = CASE WHEN f.a = ? THEN f.b ELSE f.a END
                  WHERE f.a = ? OR f.b = ? ORDER BY acc.name COLLATE NOCASE`),
      friendIds: q('SELECT CASE WHEN a = ? THEN b ELSE a END AS id FROM friendships WHERE a = ? OR b = ?'),
      friendCount: q('SELECT COUNT(*) AS n FROM friendships WHERE a = ? OR b = ?'),
      isFriend: q('SELECT 1 FROM friendships WHERE a = ? AND b = ?'),
      befriend: q('INSERT OR IGNORE INTO friendships (a, b, created_at) VALUES (?, ?, ?)'),
      unfriend: q('DELETE FROM friendships WHERE a = ? AND b = ?'),
      reqInsert: q('INSERT INTO friend_requests (id, from_id, to_id, created_at) VALUES (?, ?, ?, ?)'),
      reqById: q('SELECT * FROM friend_requests WHERE id = ?'),
      reqBetween: q('SELECT * FROM friend_requests WHERE from_id = ? AND to_id = ?'),
      reqDel: q('DELETE FROM friend_requests WHERE id = ?'),
      reqDelPair: q('DELETE FROM friend_requests WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)'),
      reqOutCount: q('SELECT COUNT(*) AS n FROM friend_requests WHERE from_id = ?'),
      incoming: q(`SELECT r.id AS req_id, r.created_at AS req_at, acc.* FROM friend_requests r
                   JOIN accounts acc ON acc.id = r.from_id WHERE r.to_id = ? ORDER BY r.created_at`),
      outgoing: q(`SELECT r.id AS req_id, r.created_at AS req_at, acc.* FROM friend_requests r
                   JOIN accounts acc ON acc.id = r.to_id WHERE r.from_id = ? ORDER BY r.created_at`),
    };
  }

  get(id) { return toAccount(this.q.byId.get(id)); }

  newFriendCode() {
    for (;;) {
      let code = '';
      for (let i = 0; i < FRIEND_CODE_LEN; i++) code += FRIEND_CODE_ALPHABET[crypto.randomInt(FRIEND_CODE_ALPHABET.length)];
      if (!this.q.codeTaken.get(code)) return code;
    }
  }

  /**
   * Busca la cuenta de ese `sub` de Google o la crea con `profile`.
   * @returns {{ account, created: boolean }}
   */
  loginGoogle({ sub, email = '' }, profile) {
    const now = Date.now();
    const row = this.q.bySub.get(sub);
    if (row) {
      this.q.seen.run(email || row.email, now, row.id);
      return { account: this.get(row.id), created: false };
    }
    const id = `a_${crypto.randomBytes(9).toString('base64url')}`;
    this.q.insert.run(id, sub, email, profile.name, profile.avatar, profile.color, this.newFriendCode(), now, now);
    return { account: this.get(id), created: true };
  }

  saveProfile(id, { name, avatar, color }) {
    this.q.profile.run(name, avatar, color, id);
  }

  // Una partida terminada: +1 jugada para cada cuenta y +1 ganada para la del ganador
  recordGame(accountIds, winnerAccountId) {
    this.db.exec('BEGIN');
    try {
      for (const id of new Set(accountIds)) this.q.played.run(id === winnerAccountId ? 1 : 0, id);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  // ---------- sesiones recordadas ----------

  // Token propio (no el de Google) para volver a entrar sin pasar por Google en cada recarga o reinicio
  issueToken(accountId) {
    const token = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();
    this.q.tokenInsert.run(hashToken(token), accountId, now, now);
    this.q.tokenTrim.run(accountId, accountId, MAX_AUTH_TOKENS);
    return token;
  }

  // Devuelve la cuenta del token o null (y lo renueva)
  resumeToken(token) {
    if (!token) return null;
    const hash = hashToken(token);
    const row = this.q.tokenGet.get(hash);
    const now = Date.now();
    if (!row || now - row.used_at > AUTH_TOKEN_TTL_MS) {
      if (row) this.q.tokenDel.run(hash);
      return null;
    }
    this.q.tokenUse.run(now, hash);
    return this.get(row.account_id);
  }

  revokeToken(token) {
    if (token) this.q.tokenDel.run(hashToken(token));
  }

  pruneTokens() {
    this.q.tokenExpire.run(Date.now() - AUTH_TOKEN_TTL_MS);
  }

  // ---------- amigos ----------

  friendsOf(id) { return this.q.friends.all(id, id, id).map(toAccount); }
  friendIdsOf(id) { return this.q.friendIds.all(id, id, id).map((r) => r.id); }
  areFriends(x, y) { return !!this.q.isFriend.get(...pair(x, y)); }

  pendingOf(id) {
    const req = (r, key) => ({ id: r.req_id, ts: r.req_at, [key]: publicAccount(toAccount(r)) });
    return {
      incoming: this.q.incoming.all(id).map((r) => req(r, 'from')),
      outgoing: this.q.outgoing.all(id).map((r) => req(r, 'to')),
    };
  }

  /**
   * Pide amistad por código. Si el otro ya te la había pedido, quedan como amigos directamente.
   * @returns {{ status: 'sent' | 'accepted', target }}
   */
  request(fromId, code) {
    const target = toAccount(this.q.byCode.get(code));
    if (!target) fail('FRIEND_NOT_FOUND', 'No hay nadie con ese código');
    if (target.id === fromId) fail('FRIEND_SELF', 'Ese es tu propio código');
    if (this.areFriends(fromId, target.id)) fail('ALREADY_FRIENDS', `${target.profile.name} ya es tu amig@`);
    const reverse = this.q.reqBetween.get(target.id, fromId);
    if (reverse) {
      this.befriend(fromId, target.id);
      return { status: 'accepted', target };
    }
    if (this.q.reqBetween.get(fromId, target.id)) return { status: 'sent', target }; // ya estaba enviada
    if (this.q.reqOutCount.get(fromId).n >= MAX_PENDING_OUT) {
      fail('LIMIT_REACHED', 'Tienes demasiadas solicitudes sin responder');
    }
    this.assertFriendSlot(fromId);
    this.q.reqInsert.run(`fr_${crypto.randomBytes(8).toString('base64url')}`, fromId, target.id, Date.now());
    return { status: 'sent', target };
  }

  // Responde una solicitud recibida; devuelve el id de quien la mandó
  respond(accountId, requestId, accept) {
    const r = this.q.reqById.get(requestId);
    if (!r || r.to_id !== accountId) fail('REQUEST_NOT_FOUND', 'Esa solicitud ya no existe');
    if (accept) this.befriend(r.from_id, r.to_id);
    else this.q.reqDel.run(r.id);
    return r.from_id;
  }

  befriend(x, y) {
    this.assertFriendSlot(x);
    this.assertFriendSlot(y);
    this.q.befriend.run(...pair(x, y), Date.now());
    this.q.reqDelPair.run(x, y, y, x);
  }

  unfriend(x, y) {
    const res = this.q.unfriend.run(...pair(x, y));
    if (!res.changes) fail('FRIEND_NOT_FOUND', 'No son amigos');
  }

  assertFriendSlot(id) {
    if (this.q.friendCount.get(id, id).n >= MAX_FRIENDS) fail('LIMIT_REACHED', `Una cuenta admite hasta ${MAX_FRIENDS} amigos`);
  }

  close() {
    try { this.db.close(); } catch { /* ya cerrada */ }
  }
}
