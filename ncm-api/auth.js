/**
 * Auth module — JWT utilities and middleware
 */
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'night-fm-dev-secret-change-in-production';
const JWT_EXPIRES_IN = '7d';

/** Generate a JWT token for a user */
function generateToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

/** Express middleware — requires valid JWT, sets req.user */
function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (!token) {
    return res.status(401).json({ success: false, message: '请先登录' });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ success: false, message: '登录已过期，请重新登录' });
  }
}

/** Express middleware — requires admin user */
function adminRequired(req, res, next) {
  if (!req.user || req.user.username !== 'admin') {
    return res.status(403).json({ success: false, message: '仅管理员可访问' });
  }
  next();
}

/** Verify JWT token and return user (for serverless use) */
function verifyToken(token) {
  if (!token) return null;
  if (token.startsWith('Bearer ')) token = token.slice(7);
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

module.exports = { generateToken, authRequired, adminRequired, verifyToken, JWT_SECRET };
