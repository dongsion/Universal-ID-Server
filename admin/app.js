/* ========================================
   Universal ID - 商家后台
   后端版：API + WebSocket 实时同步
   ======================================== */

/* ---- 服务器地址 ---- */
const API_BASE = '/api/uid';
const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

/* ---- 分类 ---- */
let categories = [];
async function loadCategories() {
  const data = await api('/categories');
  if (data) { categories = data; }
}

/* ---- 订单状态映射 ---- */
const STATUS_NAMES = {
  'pending': '待处理',
  'completed': '已完成',
  'cancelled': '已取消',
};

/* ---- 状态 ---- */
let products = [];
let orders = [];
let editingId = null;
let uploadedImage = null;
let selectedColor = '#FFF3D6';
let orderFilter = 'all';

/* ---- DOM ---- */
const productTbody = document.getElementById('product-tbody');
const orderList = document.getElementById('order-list');
const statsGrid = document.getElementById('stats-grid');
const lowStockList = document.getElementById('low-stock-list');
const recentOrdersList = document.getElementById('recent-orders-list');
const navOrderBadge = document.getElementById('nav-order-badge');
const productModal = document.getElementById('product-modal');
const orderModal = document.getElementById('order-modal');
const toast = document.getElementById('m-toast');

/* ---- API 请求封装 ---- */
async function api(path, options = {}) {
  try {
    const res = await fetch(API_BASE + path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || '请求失败');
    }
    return await res.json();
  } catch (e) {
    console.error('API错误:', e);
    showToast('网络错误');
    return null;
  }
}

/* ---- 数据加载 ---- */
async function loadData() {
  const [prods, ords, cats] = await Promise.all([
    api('/products'),
    api('/orders'),
    api('/categories')
  ]);
  if (prods) products = prods;
  if (ords) orders = ords;
  if (cats) { categories = cats; renderCategoryList(); }

  const activeTab = document.querySelector('.nav-item.active')?.dataset.tab || 'dashboard';
  if (activeTab === 'dashboard') renderDashboard();
  if (activeTab === 'products') renderProductTable();
  if (activeTab === 'orders') renderOrders();
}

/* ---- WebSocket 实时更新 ---- */
let ws = null;
function connectWS() {
  try {
    ws = new WebSocket(WS_URL);

    ws.onopen = () => console.log('商家端 WebSocket 已连接');

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      handleWSMessage(msg);
    };

    ws.onclose = () => {
      console.log('WebSocket 断开，5秒后重连');
      setTimeout(connectWS, 5000);
    };

    ws.onerror = () => ws.close();
  } catch (e) {
    console.error('WebSocket 连接失败:', e);
  }
}

function handleWSMessage(msg) {
  const { type, data } = msg;

  if (type === 'product_updated') {
    const idx = products.findIndex(p => p.id === data.id);
    if (idx >= 0) products[idx] = data;
    else products.push(data);
    const activeTab = document.querySelector('.nav-item.active')?.dataset.tab;
    if (activeTab === 'dashboard') renderDashboard();
    if (activeTab === 'products') renderProductTable();
  } else if (type === 'product_added') {
    products.push(data);
    const activeTab = document.querySelector('.nav-item.active')?.dataset.tab;
    if (activeTab === 'dashboard') renderDashboard();
    if (activeTab === 'products') renderProductTable();
  } else if (type === 'product_deleted') {
    products = products.filter(p => p.id !== data.id);
    const activeTab = document.querySelector('.nav-item.active')?.dataset.tab;
    if (activeTab === 'dashboard') renderDashboard();
    if (activeTab === 'products') renderProductTable();
  } else if (type === 'order_new') {
    orders.unshift(data);
    showToast(`新订单！${data.id} - $${data.total.toFixed(0)}`);
    const activeTab = document.querySelector('.nav-item.active')?.dataset.tab;
    if (activeTab === 'dashboard') renderDashboard();
    if (activeTab === 'orders') renderOrders();
    updateOrderBadge();
  } else if (type === 'order_updated') {
    const idx = orders.findIndex(o => o.id === data.id);
    if (idx >= 0) orders[idx] = data;
    const activeTab = document.querySelector('.nav-item.active')?.dataset.tab;
    if (activeTab === 'dashboard') renderDashboard();
    if (activeTab === 'orders') renderOrders();
    updateOrderBadge();
  }
}

/* ========================================
   Tab 切换
   ======================================== */
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', function() {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    this.classList.add('active');
    const tab = this.dataset.tab;
    document.getElementById('tab-' + tab).classList.add('active');

    if (tab === 'dashboard') renderDashboard();
    if (tab === 'products') renderProductTable();
    if (tab === 'orders') renderOrders();
  });
});

/* ========================================
   仪表盘
   ======================================== */
function renderDashboard() {
  const totalProducts = products.length;
  const totalStock = products.reduce((s, p) => s + (p.stock || 0), 0);
  const stockValue = products.reduce((s, p) => s + (p.price * (p.stock || 0)), 0);
  const pendingOrders = orders.filter(o => o.status === 'pending').length;
  const totalRevenue = orders.filter(o => o.status === 'completed').reduce((s, o) => s + o.total, 0);

  statsGrid.innerHTML = `
    <div class="stat-card">
      <div class="stat-card-header"><div class="stat-icon purple">📦</div></div>
      <div class="stat-label">商品总数</div>
      <div class="stat-value">${totalProducts}</div>
      <div class="stat-trend">总库存 ${totalStock} 件</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-header"><div class="stat-icon yellow">💰</div></div>
      <div class="stat-label">库存价值</div>
      <div class="stat-value">$${stockValue.toFixed(0)}</div>
      <div class="stat-trend">库存总金额</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-header"><div class="stat-icon green">🛒</div></div>
      <div class="stat-label">订单总数</div>
      <div class="stat-value">${orders.length}</div>
      <div class="stat-trend">${pendingOrders} 笔待处理</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-header"><div class="stat-icon red">📈</div></div>
      <div class="stat-label">营业收入</div>
      <div class="stat-value">$${totalRevenue.toFixed(0)}</div>
      <div class="stat-trend">已完成订单收入</div>
    </div>
  `;

  const lowStock = products.filter(p => p.stock <= 10).sort((a, b) => a.stock - b.stock);
  if (lowStock.length === 0) {
    lowStockList.innerHTML = '<div class="empty"><div class="empty-text">库存充足</div></div>';
  } else {
    lowStockList.innerHTML = lowStock.map(p => `
      <div class="stock-item">
        <div class="stock-item-img" style="background:${p.bg || '#f0f0f3'}">
          ${p.image ? `<img src="${p.image}">` : miniBagHTML(p)}
        </div>
        <div class="stock-item-info">
          <div class="stock-item-name">${p.name}</div>
          <div class="stock-item-stock ${p.stock <= 0 ? 'warn' : ''}">
            ${p.stock <= 0 ? '已售罄' : `剩余 ${p.stock}`}
          </div>
        </div>
        <button class="stock-restock-btn" onclick="restockProduct(${p.id})">补货 +10</button>
      </div>
    `).join('');
  }

  const recent = orders.slice(0, 5);
  if (recent.length === 0) {
    recentOrdersList.innerHTML = '<div class="empty"><div class="empty-text">暂无订单</div></div>';
  } else {
    recentOrdersList.innerHTML = recent.map(o => `
      <div class="order-item" onclick="openOrderModal('${o.id}')">
        <div>
          <div class="order-item-id">${o.id}</div>
          <div class="order-item-time">${formatDate(o.created_at)}</div>
        </div>
        <span class="order-status ${o.status}">${STATUS_NAMES[o.status] || o.status}</span>
        <div class="order-item-total">$${o.total.toFixed(0)}</div>
      </div>
    `).join('');
  }

  updateOrderBadge();
}

/* ========================================
   商品管理表格
   ======================================== */
function renderProductTable() {
  if (products.length === 0) {
    productTbody.innerHTML = `
      <tr><td colspan="6">
        <div class="empty">
          <div class="empty-icon">📦</div>
          <div class="empty-text">暂无商品</div>
          <div class="empty-sub">点击"添加商品"创建第一个</div>
        </div>
      </td></tr>
    `;
    return;
  }

  productTbody.innerHTML = products.map(p => {
    const soldOut = p.stock <= 0;
    const lowStock = p.stock > 0 && p.stock <= 10;
    const statusClass = soldOut ? 'out-stock' : lowStock ? 'low-stock' : 'in-stock';
    const statusText = soldOut ? '已售罄' : lowStock ? '库存不足' : '有货';

    return `
      <tr>
        <td>
          <div class="cell-product">
            <div class="cell-product-img" style="background:${p.bg || '#f0f0f3'}">
              ${p.image ? `<img src="${p.image}">` : miniBagHTML(p)}
            </div>
            <div>
              <div class="cell-product-name">${p.name}</div>
              <div class="cell-product-brand">${p.brand || '—'}</div>
            </div>
          </div>
        </td>
        <td>${p.cat || '—'}</td>
        <td class="cell-price">$${Number(p.price).toFixed(2)}</td>
        <td>
          <div class="stock-adjust">
            <button onclick="adjustStock(${p.id}, -1)">−</button>
            <span class="cell-stock ${soldOut ? 'out' : lowStock ? 'low' : ''}">${p.stock}</span>
            <button onclick="adjustStock(${p.id}, 1)">+</button>
          </div>
        </td>
        <td>
          <span class="status-badge ${statusClass}">
            <span class="status-dot"></span>
            ${statusText}
          </span>
        </td>
        <td>
          <div class="cell-actions">
            <button class="action-btn edit" onclick="editProductForm(${p.id})" title="编辑">
              <svg width="14" height="14" viewBox="0 0 14 14"><path d="M10 2l2 2-7 7H3V9l7-7z" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linejoin="round"/></svg>
            </button>
            <button class="action-btn delete" onclick="deleteProduct(${p.id})" title="删除">
              <svg width="14" height="14" viewBox="0 0 14 14"><path d="M3 4h8M5 4V2h4v2M4 4l1 8h4l1-8" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

async function adjustStock(id, delta) {
  const product = products.find(p => p.id === id);
  if (!product) return;
  const result = await api(`/products/${id}/stock`, {
    method: 'PATCH',
    body: JSON.stringify({ stock: delta })
  });
  if (result) {
    product.stock = result.stock;
    renderProductTable();
    if (delta > 0) showToast(`${product.name} ${delta > 0 ? '+' : ''}${delta}`);
  }
}

async function restockProduct(id) {
  const product = products.find(p => p.id === id);
  if (!product) return;
  const result = await api(`/products/${id}/stock`, {
    method: 'PATCH',
    body: JSON.stringify({ stock: 10 })
  });
  if (result) {
    product.stock = result.stock;
    renderDashboard();
    showToast(`${product.name} 补货 +10`);
  }
}

/* ========================================
   商品表单
   ======================================== */
function showProductForm() {
  editingId = null;
  uploadedImage = null;
  selectedColor = '#FFF3D6';
  document.getElementById('modal-title').textContent = '添加商品';
  document.getElementById('m-save-btn').textContent = '保存商品';
  document.getElementById('m-name').value = '';
  document.getElementById('m-brand').value = '';
  document.getElementById('m-price').value = '';
  document.getElementById('m-stock').value = '';
  renderCategoryOptions();
  document.getElementById('m-img-preview').style.display = 'none';
  document.getElementById('m-img-placeholder').style.display = 'flex';
  document.querySelectorAll('.color-opt').forEach(opt => {
    opt.classList.toggle('selected', opt.dataset.color === selectedColor);
  });
  productModal.classList.add('active');
}

function editProductForm(id) {
  const product = products.find(p => p.id === id);
  if (!product) return;
  editingId = id;
  uploadedImage = product.image || null;
  selectedColor = product.bg || '#FFF3D6';
  document.getElementById('modal-title').textContent = '编辑商品';
  document.getElementById('m-save-btn').textContent = '更新商品';
  document.getElementById('m-name').value = product.name || '';
  document.getElementById('m-brand').value = product.brand || '';
  document.getElementById('m-price').value = product.price || '';
  document.getElementById('m-stock').value = product.stock !== undefined ? product.stock : '';
  renderCategoryOptions(product.cat);

  if (product.image) {
    const preview = document.getElementById('m-img-preview');
    preview.src = product.image;
    preview.style.display = 'block';
    document.getElementById('m-img-placeholder').style.display = 'none';
  } else {
    document.getElementById('m-img-preview').style.display = 'none';
    document.getElementById('m-img-placeholder').style.display = 'flex';
  }

  document.querySelectorAll('.color-opt').forEach(opt => {
    opt.classList.toggle('selected', opt.dataset.color === selectedColor);
  });

  productModal.classList.add('active');
}

function closeProductForm() {
  productModal.classList.remove('active');
}

document.getElementById('m-image').addEventListener('change', function(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { showToast('图片过大（最大 2MB）'); return; }
  const reader = new FileReader();
  reader.onload = function(event) {
    uploadedImage = event.target.result;
    const preview = document.getElementById('m-img-preview');
    preview.src = uploadedImage;
    preview.style.display = 'block';
    document.getElementById('m-img-placeholder').style.display = 'none';
  };
  reader.readAsDataURL(file);
});

document.getElementById('m-color-picker').addEventListener('click', function(e) {
  const opt = e.target.closest('.color-opt');
  if (!opt) return;
  document.querySelectorAll('.color-opt').forEach(o => o.classList.remove('selected'));
  opt.classList.add('selected');
  selectedColor = opt.dataset.color;
});

async function saveProductForm() {
  const name = document.getElementById('m-name').value.trim();
  const brand = document.getElementById('m-brand').value.trim();
  const price = parseFloat(document.getElementById('m-price').value);
  const stock = parseInt(document.getElementById('m-stock').value) || 0;
  const category = document.getElementById('m-category').value;

  if (!name) { showToast('请输入商品名称'); return; }
  if (isNaN(price) || price < 0) { showToast('请输入有效价格'); return; }

  const payload = {
    name, brand, price, stock, cat: category, bg: selectedColor,
    image: uploadedImage,
    bagBg: uploadedImage ? null : generateBagColor(category),
    bagText: uploadedImage ? null : (brand || name).toUpperCase().substring(0, 10),
    bagSub: uploadedImage ? null : category,
  };

  if (editingId !== null) {
    const updated = await api(`/products/${editingId}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
    if (updated) {
      const idx = products.findIndex(p => p.id === editingId);
      if (idx >= 0) products[idx] = updated;
      showToast('商品已更新');
    }
  } else {
    const newProduct = await api('/products', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    if (newProduct) {
      products.push(newProduct);
      showToast('商品已添加');
    }
  }

  renderProductTable();
  closeProductForm();
}

async function deleteProduct(id) {
  const product = products.find(p => p.id === id);
  if (!product) return;
  if (!confirm(`确认删除"${product.name}"？`)) return;

  const result = await api(`/products/${id}`, { method: 'DELETE' });
  if (result) {
    products = products.filter(p => p.id !== id);
    renderProductTable();
    showToast('商品已删除');
  }
}

/* ========================================
   分类管理
   ======================================== */
function catName(cat) {
  return typeof cat === 'string' ? cat : (cat && (cat.name || cat.id)) || '';
}

/* 动态填充商品表单中的分类下拉框 */
function renderCategoryOptions(selected) {
  const select = document.getElementById('m-category');
  const current = selected || select.value;
  select.innerHTML = categories.map(cat => {
    const name = catName(cat);
    return `<option value="${name}">${name}</option>`;
  }).join('');
  if (current && [...select.options].some(o => o.value === current)) {
    select.value = current;
  } else if (categories.length > 0) {
    select.value = catName(categories[0]);
  }
}

/* 渲染分类管理列表 */
function renderCategoryList() {
  const list = document.getElementById('category-list');
  if (!list) return;
  if (categories.length === 0) {
    list.innerHTML = '<div style="color:#999;font-size:13px;">暂无分类，请先添加</div>';
    return;
  }
  list.innerHTML = categories.map(cat => {
    const name = catName(cat);
    const id = cat.id || name;
    const safeName = String(name).replace(/'/g, "\\'");
    return `
      <div style="display:flex;align-items:center;gap:8px;padding:8px 14px;background:#f5f5f7;border-radius:999px;font-size:13px;font-weight:600;">
        <span>${name}</span>
        <button onclick="deleteCategory(${id})" title="删除分类" style="border:none;background:none;color:#c01a1a;cursor:pointer;font-size:15px;font-weight:700;line-height:1;padding:0;">×</button>
      </div>
    `;
  }).join('');
}

async function addCategory() {
  const input = document.getElementById('new-category-input');
  const name = input.value.trim();
  if (!name) { showToast('请输入分类名称'); return; }
  const result = await api('/categories', {
    method: 'POST',
    body: JSON.stringify({ name })
  });
  if (result) {
    input.value = '';
    await loadCategories();
    renderCategoryList();
    showToast('分类已添加');
  }
}

async function deleteCategory(id) {
  const cat = categories.find(c => c.id === id || c.name === id);
  const name = cat ? catName(cat) : id;
  if (!confirm(`确认删除分类"${name}"？`)) return;
  const result = await api('/categories/' + id, { method: 'DELETE' });
  if (result) {
    await loadCategories();
    renderCategoryList();
    showToast('分类已删除');
  }
}

/* ========================================
   订单管理
   ======================================== */
function renderOrders() {
  updateOrderBadge();
  const filtered = orderFilter === 'all' ? orders : orders.filter(o => o.status === orderFilter);

  if (filtered.length === 0) {
    const filterText = orderFilter === 'all' ? '' : STATUS_NAMES[orderFilter] || orderFilter;
    orderList.innerHTML = `
      <div class="empty">
        <div class="empty-icon">🛒</div>
        <div class="empty-text">暂无${filterText}订单</div>
        <div class="empty-sub">客户端的订单会自动同步到这里</div>
      </div>
    `;
    return;
  }

  orderList.innerHTML = filtered.map(o => `
    <div class="order-card" onclick="openOrderModal('${o.id}')">
      <div class="order-card-top">
        <div>
          <div class="order-card-id">${o.id}</div>
          <div class="order-card-time">${formatDate(o.created_at)}</div>
        </div>
        <span class="order-status ${o.status}">${STATUS_NAMES[o.status] || o.status}</span>
      </div>
      <div class="order-card-items">
        ${(o.items || []).map(i => `
          <div class="order-card-item">
            ${i.name}
            <span class="order-card-item-qty">x${i.qty}</span>
          </div>
        `).join('')}
      </div>
      <div class="order-card-bottom">
        <div class="order-card-total">$${Number(o.total).toFixed(2)}</div>
        <div class="order-card-actions">
          ${o.status === 'pending' ? `
            <button class="btn-primary" onclick="event.stopPropagation(); updateOrderStatus('${o.id}', 'completed')">完成</button>
            <button class="btn-secondary" onclick="event.stopPropagation(); updateOrderStatus('${o.id}', 'cancelled')">取消</button>
          ` : ''}
        </div>
      </div>
    </div>
  `).join('');
}

document.querySelectorAll('.filter-tab').forEach(tab => {
  tab.addEventListener('click', function() {
    document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
    this.classList.add('active');
    orderFilter = this.dataset.filter;
    renderOrders();
  });
});

function openOrderModal(orderId) {
  const order = orders.find(o => o.id === orderId);
  if (!order) return;

  document.getElementById('order-modal-body').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <div>
        <div style="font-size:15px;font-weight:700">${order.id}</div>
        <div style="font-size:12px;color:#999">${formatDate(order.created_at)}</div>
      </div>
      <span class="order-status ${order.status}">${STATUS_NAMES[order.status] || order.status}</span>
    </div>
    ${(order.items || []).map(i => `
      <div class="order-detail-row">
        <div>
          <div class="order-detail-name">${i.name}</div>
          <div class="order-detail-qty">${i.brand || ''} · 数量 ${i.qty}</div>
        </div>
        <div class="order-detail-price">$${(i.price * i.qty).toFixed(2)}</div>
      </div>
    `).join('')}
    <div class="order-detail-summary">
      <div class="order-detail-total-row">
        <span class="order-detail-total-label">合计</span>
        <span class="order-detail-total-value">$${Number(order.total).toFixed(2)}</span>
      </div>
    </div>
  `;

  const footer = document.getElementById('order-modal-footer');
  if (order.status === 'pending') {
    footer.innerHTML = `
      <button class="btn-secondary" onclick="updateOrderStatus('${order.id}', 'cancelled')">取消订单</button>
      <button class="btn-primary" onclick="updateOrderStatus('${order.id}', 'completed')">标记完成</button>
    `;
  } else {
    footer.innerHTML = `
      <button class="btn-secondary" onclick="closeOrderModal()">关闭</button>
      <button class="btn-primary" onclick="updateOrderStatus('${order.id}', 'pending')">重新打开</button>
    `;
  }

  orderModal.classList.add('active');
}

function closeOrderModal() {
  orderModal.classList.remove('active');
}

async function updateOrderStatus(orderId, status) {
  const result = await api(`/orders/${orderId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status })
  });
  if (result) {
    const idx = orders.findIndex(o => o.id === orderId);
    if (idx >= 0) orders[idx] = result;
    renderOrders();
    closeOrderModal();
    showToast(`订单已${STATUS_NAMES[status] || status}`);
  }
}

function updateOrderBadge() {
  const pending = orders.filter(o => o.status === 'pending').length;
  if (pending > 0) {
    navOrderBadge.textContent = pending;
    navOrderBadge.style.display = 'flex';
  } else {
    navOrderBadge.style.display = 'none';
  }
}

/* ========================================
   辅助函数
   ======================================== */
function miniBagHTML(product) {
  return `<div class="bag" style="background:${product.bagBg || '#666'}">
    <span>${(product.bagText || product.brand || '').substring(0, 6)}</span>
  </div>`;
}

function generateBagColor(category) {
  const colors = {
    'Chips': '#E8650C', 'Choco': '#5B3A1A', 'Drinks': '#1A5B9E',
    'Cookies': '#C01A1A', 'Nuts': '#1A8A4E',
  };
  return colors[category] || '#666';
}

function formatDate(iso) {
  const d = new Date(iso + (iso.endsWith('Z') ? '' : 'Z'));
  const now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 0) return '刚刚';
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  return d.toLocaleDateString('zh-CN') + ' ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

let toastTimer = null;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2000);
}

productModal.addEventListener('click', function(e) {
  if (e.target === this) closeProductForm();
});
orderModal.addEventListener('click', function(e) {
  if (e.target === this) closeOrderModal();
});

/* ========================================
   登录
   ======================================== */
const AUTH_KEY = 'uid_admin_token';

function checkAuth() {
  const token = localStorage.getItem(AUTH_KEY);
  if (!token) {
    document.getElementById('login-overlay').style.display = 'flex';
    return false;
  }
  document.getElementById('login-overlay').style.display = 'none';
  return true;
}

document.getElementById('login-btn').addEventListener('click', async function() {
  const username = document.getElementById('login-user').value.trim();
  const password = document.getElementById('login-pass').value.trim();
  if (!username || !password) return;
  const result = await api('/login', { method: 'POST', body: JSON.stringify({ username, password }) });
  if (result && result.success) {
    localStorage.setItem(AUTH_KEY, result.token);
    document.getElementById('login-overlay').style.display = 'none';
    document.getElementById('login-error').style.display = 'none';
    loadData();
    connectWS();
  } else {
    document.getElementById('login-error').style.display = 'block';
  }
});

document.getElementById('login-pass').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') document.getElementById('login-btn').click();
});
document.getElementById('login-user').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') document.getElementById('login-pass').focus();
});

/* ========================================
   侧边栏折叠
   ======================================== */
const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebar-toggle');
const mainContent = document.querySelector('.main-content');
const SIDEBAR_KEY = 'uid_sidebar_collapsed';

if (localStorage.getItem(SIDEBAR_KEY) === '1') {
  sidebar.classList.add('collapsed');
  mainContent.classList.add('expanded');
  sidebarToggle.querySelector('svg').style.transform = 'rotate(-90deg)';
}

sidebarToggle.addEventListener('click', () => {
  const collapsed = sidebar.classList.toggle('collapsed');
  mainContent.classList.toggle('expanded', collapsed);
  sidebarToggle.querySelector('svg').style.transform = collapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
  localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0');
});

/* ========================================
   初始化
   ======================================== */
if (checkAuth()) {
  loadData();
  connectWS();
}
