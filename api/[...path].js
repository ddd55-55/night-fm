/**
 * Night FM — Vercel Serverless API (catch-all)
 * Handles all /api/* requests
 */
const db = require('../lib/db');

// NeteaseCloudMusicApi (works in serverless — makes outbound HTTP requests)
const ncmPath = require('path').join(process.cwd(), 'node_modules', 'NeteaseCloudMusicApi');
const ncmApi = require(ncmPath);

// ====== Simple router ======
const routes = {
  'search':        { method: 'GET',  handler: search },
  'song/url':      { method: 'GET',  handler: songUrl },
  'lyric':         { method: 'GET',  handler: lyric },
  'playlist/detail': { method: 'GET', handler: playlistDetail },
  'top/playlist':  { method: 'GET',  handler: topPlaylist },
  'auth/register': { method: 'POST', handler: authRegister },
  'auth/login':    { method: 'POST', handler: authLogin },
  'auth/me':       { method: 'GET',  handler: authMe },
  'favorites':     { method: 'GET',  handler: favoritesGet },
  'favorites':     { method: 'POST', handler: favoritesPost },
  'admin/users':   { method: 'GET',  handler: adminUsers },
};

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Parse path from URL: /api/search?x=1 → search
    const url = new URL(req.url, 'http://localhost');
    let path = url.pathname.replace(/^\/api\/?/, '');
    const searchParams = Object.fromEntries(url.searchParams);
    const method = req.method;

    // Handle dynamic paths
    if (method === 'GET' && /^favorites\/check\/\d+$/.test(path)) {
      const songId = +path.split('/')[2];
      return json(res, { isFav: await db.isFavorited(+searchParams.userId, songId) });
    }
    if (method === 'DELETE' && /^favorites\/song\/\d+$/.test(path)) {
      const songId = +path.split('/')[2];
      return json(res, await db.removeFavorite(+searchParams.userId, songId));
    }
    if (method === 'DELETE' && /^favorites\/\d+$/.test(path)) {
      const favId = +path.split('/')[1];
      return json(res, await db.removeFavoriteById(+searchParams.userId, favId));
    }

    // Static route matching
    const match = routes[path];
    if (match && match.method === method) {
      return await match.handler(req, res, searchParams);
    }

    return json(res, { code: 404, msg: 'Not found: ' + path }, 404);
  } catch (e) {
    console.error('API error:', e);
    return json(res, { code: 500, msg: e.message }, 500);
  }
};

function json(res, data, status = 200) {
  res.status(status).json(data);
}

// ====== Handlers ======

async function search(req, res, q) {
  if (!q.keywords) return json(res, { code: 400, msg: 'keywords required' });
  const result = await ncmApi.search({ keywords: q.keywords, limit: +q.limit || 20, offset: +q.offset || 0, type: 1 });
  json(res, result.body);
}

async function songUrl(req, res, q) {
  if (!q.id) return json(res, { code: 400, msg: 'id required' });
  const result = await ncmApi.song_url_v1({ id: q.id, level: q.level || 'standard' });
  json(res, result.body);
}

async function lyric(req, res, q) {
  if (!q.id) return json(res, { code: 400, msg: 'id required' });
  const result = await ncmApi.lyric_new({ id: q.id });
  json(res, result.body);
}

async function playlistDetail(req, res, q) {
  if (!q.id) return json(res, { code: 400, msg: 'id required' });
  const result = await ncmApi.playlist_detail({ id: q.id });
  json(res, result.body);
}

async function topPlaylist(req, res, q) {
  const result = await ncmApi.top_playlist({ cat: q.cat || '全部', limit: +q.limit || 20, offset: +q.offset || 0 });
  json(res, result.body);
}

async function authRegister(req, res, q) {
  const { username, password } = req.body || {};
  json(res, await db.register(username, password));
}

async function authLogin(req, res, q) {
  const { username, password } = req.body || {};
  json(res, await db.login(username, password));
}

async function authMe(req, res, q) {
  const userId = +q.userId;
  if (!userId) return json(res, { success: false, message: '未登录' });
  const user = await db.getUserById(userId);
  if (!user) return json(res, { success: false, message: '用户不存在' });
  json(res, { success: true, user });
}

async function favoritesGet(req, res, q) {
  const userId = +q.userId;
  if (!userId) return json(res, { success: false, message: '请先登录', data: [] });
  json(res, { success: true, data: await db.getFavorites(userId) });
}

async function favoritesPost(req, res, q) {
  const { userId, song } = req.body || {};
  if (!userId || !song?.id) return json(res, { success: false, message: '参数不完整' });
  json(res, await db.addFavorite(userId, song));
}

async function adminUsers(req, res, q) {
  json(res, { success: true, users: await db.getAllUsers(), stats: await db.getStats() });
}
