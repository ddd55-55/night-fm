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

// Serve static files from project root
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
  res.json(db.register(username, password))
})

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {}
  res.json(db.login(username, password))
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

app.get('/api/favorites', (req, res) => {
  const userId = +req.query.userId
  if (!userId) return res.json({ success: false, message: '请先登录', data: [] })
  res.json({ success: true, data: db.getFavorites(userId) })
})

app.post('/api/favorites', (req, res) => {
  const { userId, song } = req.body || {}
  if (!userId || !song?.id) return res.json({ success: false, message: '参数不完整' })
  res.json(db.addFavorite(userId, song))
})

app.delete('/api/favorites/song/:songId', (req, res) => {
  const userId = +req.query.userId
  const songId = +req.params.songId
  if (!userId || !songId) return res.json({ success: false, message: '参数不完整' })
  res.json(db.removeFavorite(userId, songId))
})

app.delete('/api/favorites/:id', (req, res) => {
  const userId = +req.query.userId
  const favId = +req.params.id
  if (!userId || !favId) return res.json({ success: false, message: '参数不完整' })
  res.json(db.removeFavoriteById(userId, favId))
})

app.get('/api/favorites/check/:songId', (req, res) => {
  const userId = +req.query.userId
  const songId = +req.params.songId
  if (!userId || !songId) return res.json({ isFav: false })
  res.json({ isFav: db.isFavorited(userId, songId) })
})

// ==============================
//  Admin API
// ==============================

app.get('/api/admin/users', (req, res) => {
  res.json({ success: true, users: db.getAllUsers(), stats: db.getStats() })
})

// ==============================
//  Start Server
// ==============================

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`🎵 Night FM 已启动，端口: ${PORT}`)
})
