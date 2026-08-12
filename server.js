/* ========================================
   Universal ID - 后端服务器
   Node.js + Express + SQLite + WebSocket
   ======================================== */

const express = require('express');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

app.use(cors());
app.use(express.json({ limit: '5mb' }));

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
    cat TEXT DEFAULT 'Chips',
    bg TEXT DEFAULT '#FFF3D6',
    image TEXT,
    bagBg TEXT,
    bagText TEXT,
    bagSub TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS uid_orders (
    id TEXT PRIMARY KEY,
    items TEXT,
    total REAL DEFAULT 0,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

/* ---- 初始化默认商品（首次启动） ---- */
const count = db.prepare('SELECT COUNT(*) as c FROM uid_products').get();
if (count.c === 0) {
  const defaults = [
    { name: '史密斯薯片', brand: 'Smiths', price: 7, stock: 50, bg: '#FFF3D6', bagBg: '#E8650C', bagText: 'SMITHS', bagSub: '原味', cat: 'Chips' },
    { name: '椰子脆片', brand: 'Dang', price: 6, stock: 80, bg: '#D6F5E0', bagBg: '#1A8A4E', bagText: 'dang', bagSub: '椰子味', cat: 'Chips' },
    { name: '黑金薯片', brand: 'Idaho', price: 8, stock: 30, bg: '#F5D6E0', bagBg: '#2A2A2A', bagText: 'IDAHO', bagSub: '黑椒味', cat: 'Chips' },
    { name: '天然波浪薯片', brand: 'Ruffles', price: 8, stock: 60, bg: '#D6E8F5', bagBg: '#1A5B9E', bagText: 'RUFFLES', bagSub: '原味', cat: 'Chips' },
    { name: '卷卷薯片', brand: 'Twistos', price: 6, stock: 0, bg: '#F5D6D6', bagBg: '#C01A1A', bagText: 'TWISTOS', bagSub: '烧烤味', cat: 'Chips' },
    { name: '深河海盐薯片', brand: 'Deep River', price: 9, stock: 25, bg: '#E0D6F5', bagBg: '#5B1A8A', bagText: 'DEEP RIVER', bagSub: '海盐味', cat: 'Chips' },
    { name: '梦境松露', brand: 'Unreal', price: 6, stock: 40, bg: '#D6F5E8', bagBg: '#1A8A6E', bagText: 'UNREAL', bagSub: '可可味', cat: 'Choco' },
    { name: '完美零食', brand: 'Perfect', price: 8, stock: 35, bg: '#F5E8D6', bagBg: '#5B3A1A', bagText: 'PERFECT', bagSub: '黑巧味', cat: 'Choco' },
  ];
  const insert = db.prepare(`INSERT INTO uid_products (name, brand, price, stock, bg, bagBg, bagText, bagSub, cat) VALUES (@name, @brand, @price, @stock, @bg, @bagBg, @bagText, @bagSub, @cat)`);
  defaults.forEach(p => insert.run(p));
  console.log('默认商品已初始化');
}

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
   API: 商品管理
   ======================================== */

/* 获取所有商品 */
app.get('/api/uid/products', (req, res) => {
  const products = db.prepare('SELECT * FROM uid_products ORDER BY id').all();
  res.json(products);
});

/* 获取单个商品 */
app.get('/api/uid/products/:id', (req, res) => {
  const product = db.prepare('SELECT * FROM uid_products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: '商品不存在' });
  res.json(product);
});

/* 添加商品 */
app.post('/api/uid/products', (req, res) => {
  const { name, brand, price, stock, cat, bg, image, bagBg, bagText, bagSub } = req.body;
  if (!name) return res.status(400).json({ error: '商品名称不能为空' });

  const result = db.prepare(`INSERT INTO uid_products (name, brand, price, stock, cat, bg, image, bagBg, bagText, bagSub) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(name, brand || '', price || 0, stock || 0, cat || 'Chips', bg || '#FFF3D6', image || null, bagBg || null, bagText || null, bagSub || null);

  const newProduct = db.prepare('SELECT * FROM uid_products WHERE id = ?').get(result.lastInsertRowid);
  broadcast('product_added', newProduct);
  res.json(newProduct);
});

/* 更新商品 */
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

/* 快速调整库存 */
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

/* 删除商品 */
app.delete('/api/uid/products/:id', (req, res) => {
  const product = db.prepare('SELECT * FROM uid_products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: '商品不存在' });

  db.prepare('DELETE FROM uid_products WHERE id=?').run(req.params.id);
  broadcast('product_deleted', { id: parseInt(req.params.id) });
  res.json({ success: true });
});

/* ========================================
   API: 订单管理
   ======================================== */

/* 获取所有订单 */
app.get('/api/uid/orders', (req, res) => {
  const orders = db.prepare('SELECT * FROM uid_orders ORDER BY created_at DESC').all();
  orders.forEach(o => { o.items = JSON.parse(o.items || '[]'); });
  res.json(orders);
});

/* 创建订单（顾客下单） */
app.post('/api/uid/orders', (req, res) => {
  const { items, total } = req.body;
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: '订单不能为空' });
  }

  const orderId = 'ORD-' + Date.now();
  db.prepare('INSERT INTO uid_orders (id, items, total, status) VALUES (?, ?, ?, ?)')
    .run(orderId, JSON.stringify(items), total || 0, 'pending');

  /* 扣减库存 */
  items.forEach(item => {
    if (item.id) {
      const product = db.prepare('SELECT * FROM uid_products WHERE id = ?').get(item.id);
      if (product) {
        const newStock = Math.max(0, product.stock - (item.qty || 1));
        db.prepare('UPDATE uid_products SET stock=? WHERE id=?').run(newStock, item.id);
        broadcast('product_updated', { ...product, stock: newStock });
      }
    }
  });

  const order = db.prepare('SELECT * FROM uid_orders WHERE id = ?').get(orderId);
  order.items = JSON.parse(order.items);

  /* 实时推送新订单给商家端 */
  broadcast('order_new', order);
  console.log(`新订单: ${orderId}, 总额: $${total}`);

  res.json(order);
});

/* 更新订单状态 */
app.patch('/api/uid/orders/:id/status', (req, res) => {
  const { status } = req.body;
  const validStatus = ['pending', 'completed', 'cancelled'];
  if (!validStatus.includes(status)) {
    return res.status(400).json({ error: '无效状态' });
  }

  const order = db.prepare('SELECT * FROM uid_orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: '订单不存在' });

  db.prepare('UPDATE uid_orders SET status=? WHERE id=?').run(status, req.params.id);

  const updated = db.prepare('SELECT * FROM uid_orders WHERE id = ?').get(req.params.id);
  updated.items = JSON.parse(updated.items);
  broadcast('order_updated', updated);
  res.json(updated);
});

/* ========================================
   健康检查
   ======================================== */
app.get('/api/uid/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

/* ========================================
   启动服务
   ======================================== */
const PORT = process.env.PORT || 3210;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n========================================`);
  console.log(`  Universal ID 后端服务已启动`);
  console.log(`  HTTP:  http://43.139.32.212:${PORT}`);
  console.log(`  WS:    ws://43.139.32.212:${PORT}/ws`);
  console.log(`  端口:  ${PORT}`);
  console.log(`========================================\n`);
});
