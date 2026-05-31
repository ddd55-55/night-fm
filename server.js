/**
 * Night FM — Music Player Server (root entry)
 * - Netease Cloud Music API proxy
 * - User auth (SQLite + bcrypt + JWT)
 * - Favorites management
 * - Admin panel API
 */
require('dotenv').config();
const express = require('express')
const cors = require('cors')
const path = require('path')

const ncmApiPath = path.join(__dirname, 'node_modules', 'NeteaseCloudMusicApi')
const ncmApi = require(ncmApiPath)

const db = require('./ncm-api/db')
const { generateToken, authRequired, adminRequired } = require('./ncm-api/auth')

const app = express()
app.use(cors({ origin: '*', allowedHeaders: ['Content-Type', 'Authorization'] }))
app.use(express.json())

// Serve static files from project root
app.use(express.static(__dirname))

// ==============================
//  Netease Cloud Music Login
// ==============================

let ncmCookie = '';

// Restore cookie from file on startup
(function restoreCookie() {
  try {
    const fs = require('fs');
    const cookieFile = path.join(__dirname, 'ncm-api', 'ncm_cookie.txt');
    if (fs.existsSync(cookieFile)) {
      ncmCookie = fs.readFileSync(cookieFile, 'utf8').trim();
      if (ncmCookie) console.log('🍪 已恢复网易云登录状态');
    }
  } catch (e) { /* ignore */ }
})();

app.post('/api/ncm/login', async (req, res) => {
  try {
    const { phone, password } = req.body || {};
    if (!phone || !password) return res.json({ code: 400, msg: '手机号和密码必填' });
    const result = await ncmApi.login_cellphone({ phone, password });
    if (result.body.code === 200) {
      ncmCookie = result.body.cookie || '';
      const fs = require('fs');
      fs.writeFileSync(path.join(__dirname, 'ncm-api', 'ncm_cookie.txt'), ncmCookie);
      res.json({ success: true, message: '网易云登录成功', profile: result.body.profile });
    } else {
      res.json({ success: false, message: result.body.msg || '登录失败' });
    }
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

app.get('/api/ncm/status', (req, res) => {
  res.json({ loggedIn: !!ncmCookie });
});

function ncmCall(fnName, params) {
  const opts = { ...params };
  if (ncmCookie) opts.cookie = ncmCookie;
  return ncmApi[fnName](opts);
}

// ==============================
//  Netease Cloud Music API
// ==============================

app.get('/api/search', async (req, res) => {
  try {
    const { keywords, limit = 20, offset = 0 } = req.query
    if (!keywords) return res.json({ code: 400, msg: 'keywords required' })
    const result = await ncmCall('search', { keywords, limit: +limit, offset: +offset, type: 1 })
    res.json(result.body)
  } catch (e) { res.json({ code: 500, msg: e.message }) }
})

app.get('/api/song/url', async (req, res) => {
  try {
    const { id, level = 'standard' } = req.query
    if (!id) return res.json({ code: 400, msg: 'id required' })
    const result = await ncmCall('song_url_v1', { id, level })
    res.json(result.body)
  } catch (e) { res.json({ code: 500, msg: e.message }) }
})

app.get('/api/lyric', async (req, res) => {
  try {
    const { id } = req.query
    if (!id) return res.json({ code: 400, msg: 'id required' })
    const result = await ncmCall('lyric_new', { id })
    res.json(result.body)
  } catch (e) { res.json({ code: 500, msg: e.message }) }
})

app.get('/api/playlist/detail', async (req, res) => {
  try {
    const { id } = req.query
    if (!id) return res.json({ code: 400, msg: 'id required' })
    const result = await ncmCall('playlist_detail', { id })
    res.json(result.body)
  } catch (e) { res.json({ code: 500, msg: e.message }) }
})

app.get('/api/top/playlist', async (req, res) => {
  try {
    const { cat = '全部', limit = 20, offset = 0 } = req.query
    const result = await ncmCall('top_playlist', { cat, limit: +limit, offset: +offset })
    res.json(result.body)
  } catch (e) { res.json({ code: 500, msg: e.message }) }
})

// ==============================
//  Auth API
// ==============================

app.post('/api/auth/register', (req, res) => {
  const { username, password } = req.body || {}
  const result = db.register(username, password)
  if (result.success && result.user) {
    result.token = generateToken(result.user)
  }
  res.json(result)
})

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {}
  const result = db.login(username, password)
  if (result.success && result.user) {
    result.token = generateToken(result.user)
  }
  res.json(result)
})

app.get('/api/auth/me', authRequired, (req, res) => {
  const user = db.getUserById(req.user.id)
  if (!user) return res.json({ success: false, message: '用户不存在' })
  res.json({ success: true, user: { ...user, isAdmin: req.user.username === 'admin' } })
})

// ==============================
//  Favorites API (all require JWT)
// ==============================

app.get('/api/favorites', authRequired, (req, res) => {
  const data = db.getFavorites(req.user.id)
  res.json({ success: true, data })
})

app.post('/api/favorites', authRequired, (req, res) => {
  const { song } = req.body || {}
  if (!song?.id) return res.json({ success: false, message: '参数不完整' })
  const result = db.addFavorite(req.user.id, song)
  res.json(result)
})

app.delete('/api/favorites/song/:songId', authRequired, (req, res) => {
  const songId = +req.params.songId
  if (!songId) return res.json({ success: false, message: '参数不完整' })
  const result = db.removeFavorite(req.user.id, songId)
  res.json(result)
})

app.delete('/api/favorites/:id', authRequired, (req, res) => {
  const favId = +req.params.id
  if (!favId) return res.json({ success: false, message: '参数不完整' })
  const result = db.removeFavoriteById(req.user.id, favId)
  res.json(result)
})

app.get('/api/favorites/check/:songId', authRequired, (req, res) => {
  const songId = +req.params.songId
  if (!songId) return res.json({ isFav: false })
  const isFav = db.isFavorited(req.user.id, songId)
  res.json({ isFav })
})

// ==============================
//  Admin API (JWT + admin check)
// ==============================

app.get('/api/admin/users', authRequired, adminRequired, (req, res) => {
  res.json({ success: true, users: db.getAllUsers(), stats: db.getStats() })
})

// ==============================
//  Start Server
// ==============================

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`🎵 Night FM 已启动，端口: ${PORT}`)
})
