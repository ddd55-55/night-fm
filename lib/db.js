/**
 * Database module — Vercel KV for production, local SQLite for dev
 * Vercel KV is Redis-compatible, auto-provisioned in Vercel dashboard
 */
const bcrypt = require('bcryptjs');

// ====== Detect mode ======
const isKV = !!(process.env.KV_URL || process.env.KV_REST_API_URL);

let kv = null;    // Vercel KV client
let sdb = null;   // Local SQLite (better-sqlite3)

function getKV() {
  if (kv) return kv;
  kv = require('@vercel/kv').kv;
  return kv;
}

function getSQLite() {
  if (sdb) return sdb;
  const Database = require('better-sqlite3');
  const path = require('path');
  const db = new Database(path.join(__dirname, '..', 'ncm-api', 'data.db'));
  db.pragma('journal_mode = WAL');
  const run = db.prepare.bind(db);
  sdb = {
    run: (sql, ...args) => { const r = run(sql)(...args); return r; },
    get: (sql, ...args) => db.prepare(sql).get(...args),
    all: (sql, ...args) => db.prepare(sql).all(...args),
  };
  sdb.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
  sdb.run(`
    CREATE TABLE IF NOT EXISTS favorites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      song_id INTEGER NOT NULL,
      song_name TEXT NOT NULL,
      artist TEXT DEFAULT '',
      album TEXT DEFAULT '',
      cover_url TEXT DEFAULT '',
      duration TEXT DEFAULT '--:--',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, song_id)
    )`);
  return sdb;
}

// ====== User Operations ======

async function register(username, password) {
  username = String(username).trim();
  if (!username || username.length < 2) {
    return { success: false, message: '用户名至少 2 个字符' };
  }
  if (!password || password.length < 4) {
    return { success: false, message: '密码至少 4 位' };
  }
  const hash = bcrypt.hashSync(password, 10);
  const now = new Date().toISOString();

  if (isKV) {
    const k = getKV();
    // Check duplicate
    const dup = await k.get(`u:name:${username}`);
    if (dup) return { success: false, message: '用户名已被注册' };
    const id = await k.incr('u:counter');
    await k.hset(`u:${id}`, { username, password_hash: hash, created_at: now });
    await k.set(`u:name:${username}`, id);
    return { success: true, message: '注册成功', user: { id, username, created_at: now } };
  } else {
    const db = getSQLite();
    const ex = db.get('SELECT id FROM users WHERE username = ?', username);
    if (ex) return { success: false, message: '用户名已被注册' };
    const r = db.run('INSERT INTO users (username, password_hash) VALUES (?, ?)', username, hash);
    return { success: true, message: '注册成功', user: { id: r.lastInsertRowid, username, created_at: now } };
  }
}

async function login(username, password) {
  username = String(username).trim();
  if (isKV) {
    const k = getKV();
    const id = await k.get(`u:name:${username}`);
    if (!id) return { success: false, message: '用户名或密码错误' };
    const user = await k.hgetall(`u:${id}`);
    if (!user) return { success: false, message: '用户名或密码错误' };
    if (!bcrypt.compareSync(password, user.password_hash)) {
      return { success: false, message: '用户名或密码错误' };
    }
    return { success: true, message: '登录成功', user: { id: Number(id), username, created_at: user.created_at } };
  } else {
    const db = getSQLite();
    const row = db.get('SELECT * FROM users WHERE username = ?', username);
    if (!row || !bcrypt.compareSync(password, row.password_hash)) {
      return { success: false, message: '用户名或密码错误' };
    }
    return { success: true, message: '登录成功', user: { id: row.id, username: row.username, created_at: row.created_at } };
  }
}

async function getUserById(id) {
  if (isKV) {
    const k = getKV();
    const user = await k.hgetall(`u:${id}`);
    if (!user || !user.username) return null;
    return { id: Number(id), username: user.username, created_at: user.created_at };
  } else {
    const db = getSQLite();
    return db.get('SELECT id, username, created_at FROM users WHERE id = ?', id) || null;
  }
}

// ====== Favorites Operations ======

async function addFavorite(userId, song) {
  if (isKV) {
    const k = getKV();
    // Dedup check
    const exists = await k.get(`f:check:${userId}:${song.id}`);
    if (exists) return { success: true, message: '已收藏' };
    const id = await k.incr('f:counter');
    await k.hset(`f:${id}`, {
      user_id: String(userId), song_id: String(song.id),
      song_name: song.name || '', artist: song.artist || '',
      album: song.album || '', cover_url: song.cover || '',
      duration: song.duration || '--:--', created_at: new Date().toISOString()
    });
    await k.sadd(`f:uid:${userId}`, String(id));
    await k.set(`f:check:${userId}:${song.id}`, '1');
    return { success: true, message: '已收藏' };
  } else {
    const db = getSQLite();
    try {
      db.run(
        `INSERT OR IGNORE INTO favorites (user_id, song_id, song_name, artist, album, cover_url, duration) VALUES (?,?,?,?,?,?,?)`,
        userId, song.id, song.name || '', song.artist || '', song.album || '', song.cover || '', song.duration || '--:--'
      );
      return { success: true, message: '已收藏' };
    } catch (e) { return { success: false, message: e.message }; }
  }
}

async function removeFavorite(userId, songId) {
  if (isKV) {
    const k = getKV();
    // Find fav ID from user's set
    const members = await k.smembers(`f:uid:${userId}`);
    for (const fid of members) {
      const f = await k.hgetall(`f:${fid}`);
      if (f && String(f.song_id) === String(songId)) {
        await k.del(`f:${fid}`);
        await k.srem(`f:uid:${userId}`, fid);
        await k.del(`f:check:${userId}:${songId}`);
        break;
      }
    }
    return { success: true, message: '已取消收藏' };
  } else {
    getSQLite().run('DELETE FROM favorites WHERE user_id = ? AND song_id = ?', userId, songId);
    return { success: true, message: '已取消收藏' };
  }
}

async function isFavorited(userId, songId) {
  if (isKV) {
    const k = getKV();
    const r = await k.get(`f:check:${userId}:${songId}`);
    return !!r;
  } else {
    const db = getSQLite();
    return !!db.get('SELECT id FROM favorites WHERE user_id = ? AND song_id = ?', userId, songId);
  }
}

async function getFavorites(userId) {
  if (isKV) {
    const k = getKV();
    const members = await k.smembers(`f:uid:${userId}`);
    if (!members.length) return [];
    const favs = [];
    for (const fid of members) {
      const f = await k.hgetall(`f:${fid}`);
      if (f) favs.push({ id: Number(fid), user_id: Number(f.user_id), song_id: Number(f.song_id),
        song_name: f.song_name, artist: f.artist, album: f.album,
        cover_url: f.cover_url, duration: f.duration, created_at: f.created_at });
    }
    return favs.sort((a, b) => b.id - a.id);
  } else {
    return getSQLite().all('SELECT * FROM favorites WHERE user_id = ? ORDER BY created_at DESC', userId);
  }
}

async function removeFavoriteById(userId, favId) {
  if (isKV) {
    const k = getKV();
    const f = await k.hgetall(`f:${favId}`);
    if (f) {
      await k.del(`f:check:${userId}:${f.song_id}`);
    }
    await k.del(`f:${favId}`);
    await k.srem(`f:uid:${userId}`, String(favId));
    return { success: true, message: '已取消收藏' };
  } else {
    getSQLite().run('DELETE FROM favorites WHERE id = ? AND user_id = ?', favId, userId);
    return { success: true, message: '已取消收藏' };
  }
}

// ====== Admin Operations ======

async function getAllUsers() {
  if (isKV) {
    const k = getKV();
    const keys = await k.keys('u:[0-9]*');
    const users = [];
    for (const key of keys) {
      const id = key.split(':')[1];
      const u = await k.hgetall(key);
      if (u && u.username) {
        const fIds = await k.smembers(`f:uid:${id}`);
        users.push({ id: Number(id), username: u.username, created_at: u.created_at, fav_count: fIds.length });
      }
    }
    return users.sort((a, b) => b.id - a.id);
  } else {
    return getSQLite().all(`
      SELECT u.id, u.username, u.created_at, COUNT(f.id) as fav_count
      FROM users u LEFT JOIN favorites f ON f.user_id = u.id
      GROUP BY u.id ORDER BY u.created_at DESC`);
  }
}

async function getStats() {
  if (isKV) {
    const k = getKV();
    const users = await k.keys('u:[0-9]*');
    const favs = await k.keys('f:[0-9]*');
    return { userCount: users.length, favCount: favs.length };
  } else {
    const db = getSQLite();
    return {
      userCount: db.get('SELECT COUNT(*) as c FROM users').c,
      favCount: db.get('SELECT COUNT(*) as c FROM favorites').c
    };
  }
}

module.exports = { register, login, getUserById, addFavorite, removeFavorite, isFavorited, getFavorites, removeFavoriteById, getAllUsers, getStats };
