/**
 * Night FM — Vercel Serverless API (catch-all)
 * Handles all /api/* requests
 */
const db = require('../lib/db');
const { verifyToken, generateToken } = require('../ncm-api/auth');

// NeteaseCloudMusicApi (works in serverless — makes outbound HTTP requests)
const ncmPath = require('path').join(process.cwd(), 'node_modules', 'NeteaseCloudMusicApi');
const ncmApi = require(ncmPath);

// ====== Simple router ======
const routes = {
  'GET:search':           search,
  'GET:song/url':         songUrl,
  'GET:lyric':            lyric,
  'GET:playlist/detail':  playlistDetail,
  'GET:top/playlist':     topPlaylist,
  'POST:auth/register':   authRegister,
  'POST:auth/login':      authLogin,
  'GET:auth/me':          withAuth(authMe),
  'GET:favorites':        withAuth(favoritesGet),
  'POST:favorites':       withAuth(favoritesPost),
  'GET:admin/users':      withAuth(adminUsers, true),
};

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Parse path from URL: /api/search?x=1 → search
    const url = new URL(req.url, 'http://localhost');
    let path = url.pathname.replace(/^\/api\/?/, '');
    const searchParams = Object.fromEntries(url.searchParams);
    const method = req.method;

    // Handle dynamic paths (favorites DELETE + check)
    if (method === 'GET' && /^favorites\/check\/\d+$/.test(path)) {
      const user = requireAuthOr401(req, res);
      if (!user) return;
      const songId = +path.split('/')[2];
      return json(res, { isFav: await db.isFavorited(user.id, songId) });
    }
    if (method === 'DELETE' && /^favorites\/song\/\d+$/.test(path)) {
      const user = requireAuthOr401(req, res);
      if (!user) return;
      const songId = +path.split('/')[2];
      return json(res, await db.removeFavorite(user.id, songId));
    }
    if (method === 'DELETE' && /^favorites\/\d+$/.test(path)) {
      const user = requireAuthOr401(req, res);
      if (!user) return;
      const favId = +path.split('/')[1];
      return json(res, await db.removeFavoriteById(user.id, favId));
    }

    // Static route matching
    const routeKey = `${method}:${path}`;
    const match = routes[routeKey];
    if (match) {
      return await match(req, res, searchParams);
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

/** Extract and verify JWT from Authorization header. Returns user or null. */
function getUser(req) {
  const header = req.headers.authorization || '';
  return verifyToken(header);
}

/** Require auth, send 401 if missing. Returns user or null. */
function requireAuthOr401(req, res) {
  const user = getUser(req);
  if (!user) {
    json(res, { success: false, message: '请先登录' }, 401);
    return null;
  }
  return user;
}

/** Require admin, send 403 if not. Returns user or null. */
function requireAdminOr403(req, res) {
  const user = requireAuthOr401(req, res);
  if (!user) return null;
  if (user.username !== 'admin') {
    json(res, { success: false, message: '仅管理员可访问' }, 403);
    return null;
  }
  return user;
}

/** Wrap a handler to require JWT auth. Pass adminToo=true for admin check. */
function withAuth(fn, adminToo) {
  return async function(req, res, q) {
    const user = adminToo ? requireAdminOr403(req, res) : requireAuthOr401(req, res);
    if (!user) return;
    return fn(req, res, q, user);
  };
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
  const result = await db.register(username, password);
  if (result.success && result.user) {
    result.token = generateToken(result.user);
  }
  json(res, result);
}

async function authLogin(req, res, q) {
  const { username, password } = req.body || {};
  const result = await db.login(username, password);
  if (result.success && result.user) {
    result.token = generateToken(result.user);
  }
  json(res, result);
}

async function authMe(req, res, q, user) {
  const u = await db.getUserById(user.id);
  if (!u) return json(res, { success: false, message: '用户不存在' });
  json(res, { success: true, user: { ...u, isAdmin: user.username === 'admin' } });
}

async function favoritesGet(req, res, q, user) {
  json(res, { success: true, data: await db.getFavorites(user.id) });
}

async function favoritesPost(req, res, q, user) {
  const { song } = req.body || {};
  if (!song?.id) return json(res, { success: false, message: '参数不完整' });
  json(res, await db.addFavorite(user.id, song));
}

async function adminUsers(req, res, q, user) {
  json(res, { success: true, users: await db.getAllUsers(), stats: await db.getStats() });
}
