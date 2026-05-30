/**
 * Night FM — Music Player Server
 * - Netease Cloud Music API proxy
 * - User auth (SQLite + bcrypt)
 * - Favorites management
 * - Admin panel API
 */
const express = require('express')
const cors = require('cors')
const path = require('path')

const ncmApiPath = path.join(__dirname, 'node_modules', 'NeteaseCloudMusicApi')
const ncmApi = require(ncmApiPath)

const db = require('./db')

const app = express()
app.use(cors())
app.use(express.json())

// Serve static files from the current (root) directory
app.use(express.static(__dirname))

// ==============================
//  Netease Cloud Music API
// ==============================

app.get('/api/search', async (req, res) => {
  try {
    const { keywords, limit = 20, offset = 0 } = req.query
    if (!keywords) return res.json({ code: 400, msg: 'keywords required' })
    const result = await ncmApi.search({ keywords, limit: +limit, offset: +offset, type: 1 })
    res.json(result.body)
  } catch (e) { res.json({ code: 500, msg: e.message }) }
})

app.get('/api/song/url', async (req, res) => {
  try {
    const { id, level = 'standard' } = req.query
    if (!id) return res.json({ code: 400, msg: 'id required' })
    const result = await ncmApi.song_url_v1({ id, level })
    res.json(result.body)
  } catch (e) { res.json({ code: 500, msg: e.message }) }
})

app.get('/api/lyric', async (req, res) => {
  try {
    const { id } = req.query
    if (!id) return res.json({ code: 400, msg: 'id required' })
    const result = await ncmApi.lyric_new({ id })
    res.json(result.body)
  } catch (e) { res.json({ code: 500, msg: e.message }) }
})

app.get('/api/playlist/detail', async (req, res) => {
  try {
    const { id } = req.query
    if (!id) return res.json({ code: 400, msg: 'id required' })
    const result = await ncmApi.playlist_detail({ id })
    res.json(result.body)
  } catch (e) { res.json({ code: 500, msg: e.message }) }
})

// Netease login
let ncmCookie = ''; // Stores Netease session cookie

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
    const result = await ncmApi.top_playlist({ cat, limit: +limit, offset: +offset })
    res.json(result.body)
  } catch (e) { res.json({ code: 500, msg: e.message }) }
})

// ==============================
//  Auth API
// ==============================

app.post('/api/auth/register', (req, res) => {
  const { username, password } = req.body || {}
  const result = db.register(username, password)
  res.json(result)
})

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {}
  const result = db.login(username, password)
  res.json(result)
})

app.get('/api/auth/me', (req, res) => {
  const userId = +req.query.userId
  if (!userId) return res.json({ success: false, message: '未登录' })
  const user = db.getUserById(userId)
  if (!user) return res.json({ success: false, message: '用户不存在' })
  res.json({ success: true, user })
})

// ==============================
//  Favorites API
// ==============================

// Get all favorites
app.get('/api/favorites', (req, res) => {
  const userId = +req.query.userId
  if (!userId) return res.json({ success: false, message: '请先登录', data: [] })
  const data = db.getFavorites(userId)
  res.json({ success: true, data })
})

// Add favorite
app.post('/api/favorites', (req, res) => {
  const { userId, song } = req.body || {}
  if (!userId || !song?.id) return res.json({ success: false, message: '参数不完整' })
  const result = db.addFavorite(userId, song)
  res.json(result)
})

// Remove favorite by song ID
app.delete('/api/favorites/song/:songId', (req, res) => {
  const userId = +req.query.userId
  const songId = +req.params.songId
  if (!userId || !songId) return res.json({ success: false, message: '参数不完整' })
  const result = db.removeFavorite(userId, songId)
  res.json(result)
})

// Remove favorite by fav record ID
app.delete('/api/favorites/:id', (req, res) => {
  const userId = +req.query.userId
  const favId = +req.params.id
  if (!userId || !favId) return res.json({ success: false, message: '参数不完整' })
  const result = db.removeFavoriteById(userId, favId)
  res.json(result)
})

// Check if a song is favorited
app.get('/api/favorites/check/:songId', (req, res) => {
  const userId = +req.query.userId
  const songId = +req.params.songId
  if (!userId || !songId) return res.json({ isFav: false })
  const isFav = db.isFavorited(userId, songId)
  res.json({ isFav })
})

// ==============================
//  Admin API
// ==============================

app.get('/api/admin/users', (req, res) => {
  const users = db.getAllUsers()
  const stats = db.getStats()
  res.json({ success: true, users, stats })
})

// ==============================
//  Start Server
// ==============================

const PORT = 3000
app.listen(PORT, () => {
  console.log(`🎵 Night FM 已启动: http://localhost:${PORT}`)
  console.log(`   前端页面: http://localhost:${PORT}`)
  console.log(`   用户系统: 注册/登录/收藏`)
  console.log(`   后台管理: http://localhost:${PORT} (登录后可见)`)
})
