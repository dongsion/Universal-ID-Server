/* ========================================
   Universal ID - 后端服务器 v2
   Node.js + Express + SQLite + WebSocket
   直接托管前端 + 分类管理 + 商家登录
   ======================================== */

const express = require('express');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

app.use(cors());
app.use(express.json({ limit: '5mb' }));

/* ---- 静态文件托管 ---- */
app.use(express.static(path.join(__dirname, 'public')));
app.use('/admin', express.static(path.join(__dirname, 'admin')));

/* ---- SQLite 数据库 ---- */
const Database = require('better-sqlite3');
const db = new Database(path.join(__dirname, 'uid_data.db'));

/* ---- 建表 ---- */
db.exec(`
  CREATE TABLE IF NOT EXISTS uid_products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    brand TEXT DEFAULT '',
    price REAL DEFAULT 0,
    stock INTEGER DEFAULT 0,
    cat TEXT DEFAULT '默认',
    bg TEXT DEFAULT '#FFF3D6',
    image TEXT,
    bagBg TEXT,
    bagText TEXT,
    bagSub TEXT,
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS uid_orders (
    id TEXT PRIMARY KEY,
    items TEXT,
    total REAL DEFAULT 0,
    status TEXT DEFAULT 'pending',
    contact TEXT,
    card_keys TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS uid_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    sort INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS uid_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    token TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

/* ---- 兼容旧数据库：添加 active 列（如果不存在） ---- */
try {
  db.prepare('SELECT active FROM uid_products LIMIT 0').get();
} catch (e) {
  db.exec('ALTER TABLE uid_products ADD COLUMN active INTEGER DEFAULT 1');
  console.log('已添加 active 列到 uid_products');
}

/* ---- 兼容旧数据库：添加 contact 和 card_keys 列 ---- */
try {
  db.prepare('SELECT contact FROM uid_orders LIMIT 0').get();
} catch (e) {
  db.exec('ALTER TABLE uid_orders ADD COLUMN contact TEXT');
  console.log('已添加 contact 列到 uid_orders');
}
try {
  db.prepare('SELECT card_keys FROM uid_orders LIMIT 0').get();
} catch (e) {
  db.exec('ALTER TABLE uid_orders ADD COLUMN card_keys TEXT');
  console.log('已添加 card_keys 列到 uid_orders');
}
try {
  db.prepare('SELECT user_id FROM uid_orders LIMIT 0').get();
} catch (e) {
  db.exec('ALTER TABLE uid_orders ADD COLUMN user_id INTEGER');
  console.log('已添加 user_id 列到 uid_orders');
}

/* ---- 初始化默认分类 ---- */
const catCount = db.prepare('SELECT COUNT(*) as c FROM uid_categories').get();
if (catCount.c === 0) {
  ['默认'].forEach((name, i) => {
    db.prepare('INSERT INTO uid_categories (name, sort) VALUES (?, ?)').run(name, i);
  });
  console.log('默认分类已初始化');
}

/* ---- 商家登录密码（只有你知道） ---- */
const ADMIN_USER = 'zhangguiliu';
const ADMIN_PASS = '200201';

/* ========================================
   WebSocket 广播
   ======================================== */
function broadcast(type, data) {
  const msg = JSON.stringify({ type, data });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

wss.on('connection', (ws) => {
  console.log('WebSocket 客户端已连接');
  ws.on('close', () => console.log('WebSocket 客户端已断开'));
});

/* ========================================
   API: 商家登录
   ======================================== */
app.post('/api/uid/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    const token = crypto.createHash('md5').update(username + Date.now()).digest('hex');
    res.json({ success: true, token });
  } else {
    res.status(401).json({ error: '用户名或密码错误' });
  }
});

/* ========================================
   API: 客户端用户注册
   ======================================== */
app.post('/api/uid/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }
  if (username.length < 2 || username.length > 20) {
    return res.status(400).json({ error: '用户名长度需2-20个字符' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: '密码至少6位' });
  }

  /* 检查用户名是否已存在 */
  const existing = db.prepare('SELECT id FROM uid_users WHERE username = ?').get(username);
  if (existing) {
    return res.status(400).json({ error: '该用户名已被注册' });
  }

  /* 密码加密存储 */
  const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');
  const token = crypto.createHash('md5').update(username + Date.now() + Math.random()).digest('hex');

  const result = db.prepare('INSERT INTO uid_users (username, password, token) VALUES (?, ?, ?)')
    .run(username, hashedPassword, token);

  res.json({
    success: true,
    user: { id: result.lastInsertRowid, username, token }
  });
  console.log(`新用户注册: ${username}`);
});

/* ========================================
   API: 客户端用户登录
   ======================================== */
app.post('/api/uid/user-login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }

  const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');
  const user = db.prepare('SELECT * FROM uid_users WHERE username = ? AND password = ?')
    .get(username, hashedPassword);

  if (!user) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }

  /* 更新 token */
  const token = crypto.createHash('md5').update(username + Date.now() + Math.random()).digest('hex');
  db.prepare('UPDATE uid_users SET token = ? WHERE id = ?').run(token, user.id);

  res.json({
    success: true,
    user: { id: user.id, username: user.username, token }
  });
  console.log(`用户登录: ${username}`);
});

/* ========================================
   API: 验证用户 token
   ======================================== */
app.post('/api/uid/verify-token', (req, res) => {
  const { token } = req.body;
  if (!token) return res.json({ valid: false });

  const user = db.prepare('SELECT id, username FROM uid_users WHERE token = ?').get(token);
  if (!user) return res.json({ valid: false });

  res.json({ valid: true, user: { id: user.id, username: user.username } });
});

/* ========================================
   API: 分类管理
   ======================================== */
app.get('/api/uid/categories', (req, res) => {
  const cats = db.prepare('SELECT * FROM uid_categories ORDER BY sort, id').all();
  res.json(cats);
});

app.post('/api/uid/categories', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: '分类名称不能为空' });
  try {
    const result = db.prepare('INSERT INTO uid_categories (name, sort) VALUES (?, ?)').run(name, Date.now());
    const newCat = db.prepare('SELECT * FROM uid_categories WHERE id = ?').get(result.lastInsertRowid);
    broadcast('category_added', newCat);
    res.json(newCat);
  } catch (e) {
    res.status(400).json({ error: '分类已存在' });
  }
});

app.delete('/api/uid/categories/:id', (req, res) => {
  const idParam = req.params.id;
  /* 先按 ID 查找，找不到再按 name 查找 */
  let cat = db.prepare('SELECT * FROM uid_categories WHERE id = ?').get(idParam);
  if (!cat) {
    cat = db.prepare('SELECT * FROM uid_categories WHERE name = ?').get(idParam);
  }
  if (!cat) return res.status(404).json({ error: '分类不存在' });
  
  /* 把该分类下的商品改为"默认"分类 */
  db.prepare('UPDATE uid_products SET cat = ? WHERE cat = ?').run('默认', cat.name);
  db.prepare('DELETE FROM uid_categories WHERE id = ?').run(cat.id);
  broadcast('category_deleted', { id: cat.id, name: cat.name });
  res.json({ success: true });
});

/* ========================================
   API: 商品管理
   ======================================== */
app.get('/api/uid/products', (req, res) => {
  const products = db.prepare('SELECT * FROM uid_products ORDER BY id').all();
  res.json(products);
});

app.get('/api/uid/products/:id', (req, res) => {
  const product = db.prepare('SELECT * FROM uid_products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: '商品不存在' });
  res.json(product);
});

app.post('/api/uid/products', (req, res) => {
  const { name, brand, price, stock, cat, bg, image, bagBg, bagText, bagSub } = req.body;
  if (!name) return res.status(400).json({ error: '商品名称不能为空' });

  const result = db.prepare(`INSERT INTO uid_products (name, brand, price, stock, cat, bg, image, bagBg, bagText, bagSub) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(name, brand || '', price || 0, stock || 0, cat || '默认', bg || '#FFF3D6', image || null, bagBg || null, bagText || null, bagSub || null);

  const newProduct = db.prepare('SELECT * FROM uid_products WHERE id = ?').get(result.lastInsertRowid);
  broadcast('product_added', newProduct);
  res.json(newProduct);
});

app.put('/api/uid/products/:id', (req, res) => {
  const { name, brand, price, stock, cat, bg, image, bagBg, bagText, bagSub } = req.body;
  const existing = db.prepare('SELECT * FROM uid_products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: '商品不存在' });

  db.prepare(`UPDATE uid_products SET name=?, brand=?, price=?, stock=?, cat=?, bg=?, image=?, bagBg=?, bagText=?, bagSub=? WHERE id=?`)
    .run(
      name ?? existing.name,
      brand ?? existing.brand,
      price ?? existing.price,
      stock ?? existing.stock,
      cat ?? existing.cat,
      bg ?? existing.bg,
      image !== undefined ? image : existing.image,
      bagBg ?? existing.bagBg,
      bagText ?? existing.bagText,
      bagSub ?? existing.bagSub,
      req.params.id
    );

  const updated = db.prepare('SELECT * FROM uid_products WHERE id = ?').get(req.params.id);
  broadcast('product_updated', updated);
  res.json(updated);
});

app.patch('/api/uid/products/:id/stock', (req, res) => {
  const { stock } = req.body;
  const product = db.prepare('SELECT * FROM uid_products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: '商品不存在' });

  const newStock = Math.max(0, (product.stock || 0) + parseInt(stock || 0));
  db.prepare('UPDATE uid_products SET stock=? WHERE id=?').run(newStock, req.params.id);

  const updated = db.prepare('SELECT * FROM uid_products WHERE id = ?').get(req.params.id);
  broadcast('product_updated', updated);
  res.json(updated);
});

app.delete('/api/uid/products/:id', (req, res) => {
  const product = db.prepare('SELECT * FROM uid_products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: '商品不存在' });

  db.prepare('DELETE FROM uid_products WHERE id=?').run(req.params.id);
  broadcast('product_deleted', { id: parseInt(req.params.id) });
  res.json({ success: true });
});

/* 上下架切换 */
app.patch('/api/uid/products/:id/toggle', (req, res) => {
  const product = db.prepare('SELECT * FROM uid_products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: '商品不存在' });

  const newActive = product.active ? 0 : 1;
  db.prepare('UPDATE uid_products SET active=? WHERE id=?').run(newActive, req.params.id);

  const updated = db.prepare('SELECT * FROM uid_products WHERE id = ?').get(req.params.id);
  broadcast('product_updated', updated);
  res.json(updated);
});

/* ========================================
   API: 订单管理
   ======================================== */
/* ---- 订单状态：pending=待确认, confirmed=已确认待付款, paid=已付款待发货, delivered=已交付卡密, cancelled=已取消 ---- */
app.get('/api/uid/orders', (req, res) => {
  const orders = db.prepare('SELECT * FROM uid_orders ORDER BY created_at DESC').all();
  orders.forEach(o => {
    o.items = JSON.parse(o.items || '[]');
    if (o.contact) o.contact = JSON.parse(o.contact);
  });
  res.json(orders);
});

/* 查单个订单（客户端用） */
app.get('/api/uid/orders/:id', (req, res) => {
  const order = db.prepare('SELECT * FROM uid_orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: '订单不存在' });
  order.items = JSON.parse(order.items || '[]');
  if (order.contact) order.contact = JSON.parse(order.contact);
  res.json(order);
});

/* 删除订单 */
app.delete('/api/uid/orders/:id', (req, res) => {
  const order = db.prepare('SELECT * FROM uid_orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: '订单不存在' });
  db.prepare('DELETE FROM uid_orders WHERE id = ?').run(req.params.id);
  broadcast('order_deleted', { id: req.params.id });
  console.log(`订单已删除: ${req.params.id}`);
  res.json({ success: true });
});

app.post('/api/uid/orders', (req, res) => {
  const { items, total, contact, userId } = req.body;
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: '订单不能为空' });
  }

  const orderId = 'ORD-' + Date.now();
  const contactStr = contact ? JSON.stringify(contact) : null;
  const uid = userId || null;
  db.prepare('INSERT INTO uid_orders (id, items, total, status, contact, user_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run(orderId, JSON.stringify(items), total || 0, 'pending', contactStr, uid);

  const order = db.prepare('SELECT * FROM uid_orders WHERE id = ?').get(orderId);
  order.items = JSON.parse(order.items);
  if (order.contact) order.contact = JSON.parse(order.contact);
  broadcast('order_new', order);
  console.log(`新订单: ${orderId}, 总额: $${total}, 用户ID: ${uid || '未登录'}`);
  res.json(order);
});

/* 按用户ID查询订单 */
app.get('/api/uid/user/:userId/orders', (req, res) => {
  const userId = parseInt(req.params.userId);
  if (!userId) return res.status(400).json({ error: '无效的用户ID' });

  const orders = db.prepare('SELECT * FROM uid_orders WHERE user_id = ? ORDER BY created_at DESC').all(userId);
  orders.forEach(o => {
    o.items = JSON.parse(o.items || '[]');
    if (o.contact) o.contact = JSON.parse(o.contact);
  });
  res.json(orders);
});

/* 将已有订单绑定到用户 */
app.patch('/api/uid/orders/:id/bind', (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: '缺少用户ID' });

  const order = db.prepare('SELECT * FROM uid_orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: '订单不存在' });

  db.prepare('UPDATE uid_orders SET user_id = ? WHERE id = ?').run(userId, req.params.id);
  res.json({ success: true });
});

app.patch('/api/uid/orders/:id/status', (req, res) => {
  const { status } = req.body;
  const validStatus = ['pending', 'confirmed', 'paid', 'delivered', 'cancelled'];
  if (!validStatus.includes(status)) {
    return res.status(400).json({ error: '无效状态' });
  }

  const order = db.prepare('SELECT * FROM uid_orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: '订单不存在' });

  db.prepare('UPDATE uid_orders SET status=? WHERE id=?').run(status, req.params.id);
  const updated = db.prepare('SELECT * FROM uid_orders WHERE id = ?').get(req.params.id);
  updated.items = JSON.parse(updated.items);
  if (updated.contact) updated.contact = JSON.parse(updated.contact);
  if (updated.card_keys) updated.card_keys = updated.card_keys;
  broadcast('order_updated', updated);
  res.json(updated);
});

/* 商家交付卡密 */
app.patch('/api/uid/orders/:id/deliver', (req, res) => {
  const { cardKeys } = req.body;
  if (!cardKeys || !cardKeys.trim()) {
    return res.status(400).json({ error: '卡密不能为空' });
  }

  const order = db.prepare('SELECT * FROM uid_orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: '订单不存在' });

  db.prepare('UPDATE uid_orders SET status=?, card_keys=? WHERE id=?')
    .run('delivered', cardKeys.trim(), req.params.id);

  const updated = db.prepare('SELECT * FROM uid_orders WHERE id = ?').get(req.params.id);
  updated.items = JSON.parse(updated.items);
  if (updated.contact) updated.contact = JSON.parse(updated.contact);
  broadcast('order_updated', updated);
  res.json(updated);
});

app.get('/api/uid/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

/* ========================================
   启动服务
   ======================================== */
const PORT = process.env.PORT || 3210;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n========================================`);
  console.log(`  Universal ID 服务已启动`);
  console.log(`  客户端:  http://43.139.32.212:${PORT}`);
  console.log(`  商家端:  http://43.139.32.212:${PORT}/admin`);
  console.log(`  API:     http://43.139.32.212:${PORT}/api/uid`);
  console.log(`  WS:      ws://43.139.32.212:${PORT}/ws`);
  console.log(`  端口:    ${PORT}`);
  console.log(`  账号:    ${ADMIN_USER} / ${ADMIN_PASS}`);
  console.log(`========================================\n`);
});
