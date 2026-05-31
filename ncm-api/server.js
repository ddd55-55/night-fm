/**
 * Night FM — Music Player Server
 * - Netease Cloud Music API proxy
 * - User auth (SQLite + bcrypt)
 * - Favorites management
 * - Admin panel API
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express')
const cors = require('cors')
const path = require('path')

const ncmApiPath = path.join(__dirname, 'node_modules', 'NeteaseCloudMusicApi')
const ncmApi = require(ncmApiPath)

const db = require('./db')
const { generateToken, authRequired, adminRequired } = require('./auth')

const app = express()
app.use(cors({ origin: '*', allowedHeaders: ['Content-Type', 'Authorization'] }))
app.use(express.json())

// Serve static files from project root
app.use(express.static(path.join(__dirname, '..')))

// ==============================
//  Netease Cloud Music Login
// ==============================

let ncmCookie = ''; // Stores Netease session cookie

// Restore cookie from file on startup
(function restoreCookie() {
  try {
    const fs = require('fs');
    const cookieFile = require('path').join(__dirname, 'ncm_cookie.txt');
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
      // Also store in a file for persistence
      const fs = require('fs');
      fs.writeFileSync(path.join(__dirname, 'ncm_cookie.txt'), ncmCookie);
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

// Helper to inject cookie into NCM API calls
function ncmCall(fnName, params) {
  const opts = { ...params };
  if (ncmCookie) opts.cookie = ncmCookie;
  return ncmApi[fnName](opts);
}

// Modified search with cookie
app.get('/api/search', async (req, res) => {
  try {
    const { keywords, limit = 20, offset = 0 } = req.query;
    if (!keywords) return res.json({ code: 400, msg: 'keywords required' });
    const result = await ncmCall('search', { keywords, limit: +limit, offset: +offset, type: 1 });
    res.json(result.body);
  } catch (e) { res.json({ code: 500, msg: e.message }) }
});

// Modified song URL with cookie
app.get('/api/song/url', async (req, res) => {
  try {
    const { id, level = 'standard' } = req.query;
    if (!id) return res.json({ code: 400, msg: 'id required' });
    const result = await ncmCall('song_url_v1', { id, level });
    res.json(result.body);
  } catch (e) { res.json({ code: 500, msg: e.message }) }
});

// Modified lyrics with cookie
app.get('/api/lyric', async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) return res.json({ code: 400, msg: 'id required' });
    const result = await ncmCall('lyric_new', { id });
    res.json(result.body);
  } catch (e) { res.json({ code: 500, msg: e.message }) }
});

// Modified playlist detail with cookie
app.get('/api/playlist/detail', async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) return res.json({ code: 400, msg: 'id required' });
    const result = await ncmCall('playlist_detail', { id });
    res.json(result.body);
  } catch (e) { res.json({ code: 500, msg: e.message }) }
});

// Modified top playlist with cookie
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
  // If registration succeeded, attach a JWT token
  if (result.success && result.user) {
    result.token = generateToken(result.user)
  }
  res.json(result)
})

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {}
  const result = db.login(username, password)
  // If login succeeded, attach a JWT token
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

// Get all favorites
app.get('/api/favorites', authRequired, (req, res) => {
  const data = db.getFavorites(req.user.id)
  res.json({ success: true, data })
})

// Add favorite
app.post('/api/favorites', authRequired, (req, res) => {
  const { song } = req.body || {}
  if (!song?.id) return res.json({ success: false, message: '参数不完整' })
  const result = db.addFavorite(req.user.id, song)
  res.json(result)
})

// Remove favorite by song ID
app.delete('/api/favorites/song/:songId', authRequired, (req, res) => {
  const songId = +req.params.songId
  if (!songId) return res.json({ success: false, message: '参数不完整' })
  const result = db.removeFavorite(req.user.id, songId)
  res.json(result)
})

// Remove favorite by fav record ID
app.delete('/api/favorites/:id', authRequired, (req, res) => {
  const favId = +req.params.id
  if (!favId) return res.json({ success: false, message: '参数不完整' })
  const result = db.removeFavoriteById(req.user.id, favId)
  res.json(result)
})

// Check if a song is favorited
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
  const users = db.getAllUsers()
  const stats = db.getStats()
  res.json({ success: true, users, stats })
})

// ==============================
//  Start Server
// ==============================

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`🎵 Night FM 已启动: http://localhost:${PORT}`)
  console.log(`   前端页面: http://localhost:${PORT}`)
  console.log(`   用户系统: 注册/登录/收藏`)
  console.log(`   后台管理: http://localhost:${PORT} (登录后可见)`)
})
