/**
 * Database module — SQLite for users & favorites
 */
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data.db');
const db = new Database(DB_PATH);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ====== Create Tables ======
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

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
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, song_id)
  );

  CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id);
`);

// ====== User Operations ======

/** Register a new user. Returns { success, message, user? } */
function register(username, password) {
  username = String(username).trim();
  if (!username || username.length < 2) {
    return { success: false, message: '用户名至少 2 个字符' };
  }
  if (!password || password.length < 4) {
    return { success: false, message: '密码至少 4 位' };
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    return { success: false, message: '用户名已被注册' };
  }

  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, hash);

  return {
    success: true,
    message: '注册成功',
    user: { id: result.lastInsertRowid, username, created_at: new Date().toISOString() }
  };
}

/** Login. Returns { success, message, user? } */
function login(username, password) {
  username = String(username).trim();
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!row) {
    return { success: false, message: '用户名或密码错误' };
  }

  const valid = bcrypt.compareSync(password, row.password_hash);
  if (!valid) {
    return { success: false, message: '用户名或密码错误' };
  }

  return {
    success: true,
    message: '登录成功',
    user: { id: row.id, username: row.username, created_at: row.created_at }
  };
}

/** Get user by ID */
function getUserById(id) {
  return db.prepare('SELECT id, username, created_at FROM users WHERE id = ?').get(id);
}

// ====== Favorites Operations ======

/** Add a song to favorites. Returns { success, message } */
function addFavorite(userId, song) {
  try {
    db.prepare(`
      INSERT OR IGNORE INTO favorites (user_id, song_id, song_name, artist, album, cover_url, duration)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(userId, song.id, song.name || '', song.artist || '', song.album || '', song.cover || '', song.duration || '--:--');
    return { success: true, message: '已收藏' };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

/** Remove a song from favorites */
function removeFavorite(userId, songId) {
  db.prepare('DELETE FROM favorites WHERE user_id = ? AND song_id = ?').run(userId, songId);
  return { success: true, message: '已取消收藏' };
}

/** Check if a song is favorited */
function isFavorited(userId, songId) {
  const row = db.prepare('SELECT id FROM favorites WHERE user_id = ? AND song_id = ?').get(userId, songId);
  return !!row;
}

/** Get user's favorites */
function getFavorites(userId) {
  return db.prepare(
    'SELECT * FROM favorites WHERE user_id = ? ORDER BY created_at DESC'
  ).all(userId);
}

/** Remove a favorite by favorite record ID */
function removeFavoriteById(userId, favId) {
  db.prepare('DELETE FROM favorites WHERE id = ? AND user_id = ?').run(favId, userId);
  return { success: true, message: '已取消收藏' };
}

// ====== Admin Operations ======

/** Get all users (without password hashes) with favorite counts */
function getAllUsers() {
  return db.prepare(`
    SELECT u.id, u.username, u.created_at,
           COUNT(f.id) as fav_count
    FROM users u
    LEFT JOIN favorites f ON f.user_id = u.id
    GROUP BY u.id
    ORDER BY u.created_at DESC
  `).all();
}

/** Get total stats */
function getStats() {
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  const favCount = db.prepare('SELECT COUNT(*) as count FROM favorites').get().count;
  return { userCount, favCount };
}

module.exports = {
  register,
  login,
  getUserById,
  addFavorite,
  removeFavorite,
  isFavorited,
  getFavorites,
  removeFavoriteById,
  getAllUsers,
  getStats,
};
