/* ========================================
   Universal ID（客户端）
   后端版：API + WebSocket 实时同步
   ======================================== */

/* ---- 服务器地址（前端由同一服务器托管，使用相对路径） ---- */
const API_BASE = '/api/uid';
const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

/* ---- 分类（从服务器动态加载） ---- */
let categories = [];

/* ---- 状态 ---- */
let products = [];
let cart = [];
let currentDetailProduct = null;
let currentQty = 1;
let editingProductId = null;
let uploadedImage = null;
let selectedColor = '#FFF3D6';
let currentFilter = 'All';

/* ---- 购物车仍用 localStorage（临时购物车，不需要跨设备） ---- */
const CART_KEY = 'universal_id_cart';

function loadCart() {
  const saved = localStorage.getItem(CART_KEY);
  if (saved) {
    try { cart = JSON.parse(saved); } catch (e) { cart = []; }
  }
}

function saveCart() {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
}

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
    showToast('网络错误，请稍后重试');
    return null;
  }
}

/* ---- 从服务器加载商品 ---- */
async function loadProducts() {
  const data = await api('/products');
  if (data) {
    products = data;
    renderProductGrid();
    if (manageOverlay.classList.contains('active')) renderManageList();
  }
}

/* ---- WebSocket 实时更新 ---- */
let ws = null;
let wsReconnectTimer = null;

function connectWS() {
  try {
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log('WebSocket 已连接');
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      handleWSMessage(msg);
    };

    ws.onclose = () => {
      console.log('WebSocket 断开，5秒后重连');
      wsReconnectTimer = setTimeout(connectWS, 5000);
    };

    ws.onerror = () => {
      ws.close();
    };
  } catch (e) {
    console.error('WebSocket 连接失败:', e);
  }
}

function handleWSMessage(msg) {
  const { type, data } = msg;

  if (type === 'product_updated' || type === 'product_added') {
    const idx = products.findIndex(p => p.id === data.id);
    if (idx >= 0) {
      products[idx] = data;
    } else {
      products.push(data);
    }
    renderProductGrid();
    if (manageOverlay.classList.contains('active')) renderManageList();
  } else if (type === 'product_deleted') {
    products = products.filter(p => p.id !== data.id);
    cart = cart.filter(c => c.id !== data.id);
    saveCart();
    renderProductGrid();
    updateCartBar();
    if (manageOverlay.classList.contains('active')) renderManageList();
  }
}

/* ---- DOM 引用 ---- */
const app = document.getElementById('app');
const productGrid = document.getElementById('product-grid');
const filterRow = document.querySelector('.filter-row');
const emptyState = document.getElementById('empty-state');
const itemCount = document.getElementById('item-count');
const collectionTitle = document.getElementById('collection-title');
const cartBar = document.getElementById('cart-bar');
const cartBarBadge = document.getElementById('cart-bar-badge');
const cartBarSub = document.getElementById('cart-bar-sub');
const cartBarThumbs = document.getElementById('cart-bar-thumbs');
const flyClone = document.getElementById('fly-clone');
const pageBrowse = document.getElementById('page-browse');
const pageDetail = document.getElementById('page-detail');
const pageCart = document.getElementById('page-cart');
const detailContent = document.getElementById('detail-content');
const qtyNumber = document.getElementById('qty-number');
const detailPrice = document.getElementById('detail-price');
const detailAddBtn = document.getElementById('detail-add-btn');
const cartBadgeTop = document.getElementById('cart-badge-top');
const cartBody = document.getElementById('cart-body');
const toast = document.getElementById('toast');

/* 管理面板 DOM */
const manageOverlay = document.getElementById('manage-overlay');
const manageList = document.getElementById('manage-list');
const manageCount = document.getElementById('manage-count');
const manageFormSection = document.getElementById('manage-form-section');
const formTitle = document.getElementById('form-title');
const imageInput = document.getElementById('image-input');
const uploadPreview = document.getElementById('upload-preview');
const uploadPlaceholder = document.getElementById('upload-placeholder');
const formName = document.getElementById('form-name');
const formBrand = document.getElementById('form-brand');
const formPrice = document.getElementById('form-price');
const formStock = document.getElementById('form-stock');
const formCategory = document.getElementById('form-category');
const colorPicker = document.getElementById('color-picker');
const formSaveBtn = document.getElementById('form-save-btn');

/* ========================================
   生成商品图 HTML
   ======================================== */
function productImageHTML(product) {
  if (product.image) {
    return `<img src="${product.image}" style="width:100%;height:100%;object-fit:cover;border-radius:6px">`;
  }
  return `<div class="bag" style="background:${product.bagBg || '#666'}">
    <span class="bag-brand">${product.bagText || product.brand || ''}</span>
    <span class="bag-flavor">${product.bagSub || product.cat || ''}</span>
  </div>`;
}

function thumbImageHTML(product) {
  if (product.image) {
    return `<img src="${product.image}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  }
  return `<div class="cart-thumb-mini-bag bag" style="background:${product.bagBg || '#666'}">
    <span class="bag-brand" style="font-size:5px">${product.bagText || ''}</span>
  </div>`;
}

/* ========================================
   渲染产品网格
   ======================================== */
function renderProductGrid() {
  const filtered = currentFilter === 'All'
    ? products
    : products.filter(p => p.cat === currentFilter);

  itemCount.textContent = `${filtered.length} 件`;
  collectionTitle.textContent = currentFilter === 'All'
    ? '全部商品'
    : `${currentFilter}商品`;

  if (filtered.length === 0) {
    productGrid.style.display = 'none';
    emptyState.style.display = 'flex';
    return;
  }

  productGrid.style.display = 'grid';
  emptyState.style.display = 'none';

  productGrid.innerHTML = filtered.map(p => {
    const soldOut = p.stock <= 0;
    const lowStock = p.stock > 0 && p.stock <= 10;
    return `
      <div class="product-card ${soldOut ? 'sold-out' : ''}" data-id="${p.id}" onclick="openDetail(${p.id})">
        <div class="card-bg" style="background:${p.bg || '#f0f0f3'}"></div>
        ${soldOut ? '<div class="sold-out-tag">已售罄</div>' : ''}
        ${!soldOut ? `<div class="card-stock ${lowStock ? 'low' : ''}">余 ${p.stock}</div>` : ''}
        <span class="product-name">${p.name}</span>
        <div class="product-image">${productImageHTML(p)}</div>
        <div class="card-bottom">
          <span class="card-price">$${String(p.price).padStart(2, '0')}.00</span>
          <button class="add-btn" onclick="event.stopPropagation(); addToCart(${p.id}, this)" ${soldOut ? 'disabled' : ''}>
            <svg viewBox="0 0 16 16"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

/* ========================================
   打开详情页
   ======================================== */
function openDetail(id) {
  const product = products.find(p => p.id === id);
  if (!product) return;
  currentDetailProduct = product;
  currentQty = 1;

  const soldOut = product.stock <= 0;
  const lowStock = product.stock > 0 && product.stock <= 10;

  detailContent.innerHTML = `
    <div class="detail-product-name">${product.name}</div>
    <div class="detail-brand">${product.brand || ''}</div>
    <div class="detail-image-wrap">
      <div class="detail-image-bg" style="background:${product.bagBg || product.bg || '#ccc'}"></div>
      <div class="detail-image">${productImageHTML(product)}</div>
    </div>
    <div class="detail-tags">
      <div class="detail-tag">🌿</div>
      <div class="detail-tag">⚡</div>
      <div class="detail-tag">✓</div>
    </div>
    <div class="detail-info">
      <span class="detail-info-pill">${product.cat || '商品'}</span>
      <span class="detail-info-pill">优选</span>
      <span class="detail-info-pill">天然</span>
    </div>
    <div class="detail-stock ${soldOut ? 'out' : lowStock ? 'low' : ''}">
      <div class="stock-dot"></div>
      <span>${soldOut ? '已售罄' : lowStock ? `仅剩 ${product.stock} 件！` : `库存 ${product.stock} 件`}</span>
    </div>
  `;

  qtyNumber.textContent = '1';
  detailPrice.textContent = `$${String(product.price).padStart(2, '0')}.00`;

  if (soldOut) {
    detailAddBtn.style.opacity = '0.4';
    detailAddBtn.style.pointerEvents = 'none';
  } else {
    detailAddBtn.style.opacity = '1';
    detailAddBtn.style.pointerEvents = 'auto';
  }

  pageBrowse.classList.add('slide-out-left');
  pageDetail.classList.add('detail-active');
}

/* ========================================
   数量选择
   ======================================== */
function changeQty(delta) {
  if (!currentDetailProduct) return;
  const maxQty = currentDetailProduct.stock;
  const newQty = Math.max(1, Math.min(currentQty + delta, maxQty));
  if (newQty === currentQty) {
    if (delta > 0) showToast(`库存仅剩 ${maxQty} 件`);
    return;
  }
  currentQty = newQty;
  qtyNumber.textContent = currentQty;
  qtyNumber.classList.remove('bump');
  void qtyNumber.offsetWidth;
  qtyNumber.classList.add('bump');
  const total = currentDetailProduct.price * currentQty;
  detailPrice.textContent = `$${String(total).padStart(2, '0')}.00`;
}

/* ========================================
   从详情页加购
   ======================================== */
function addFromDetail() {
  if (!currentDetailProduct) return;
  if (currentDetailProduct.stock <= 0) return;

  const qtyToAdd = Math.min(currentQty, currentDetailProduct.stock);
  flyToCart(detailAddBtn, currentDetailProduct);
  addCartData(currentDetailProduct.id, qtyToAdd);

  // 通知服务器扣减库存
  api(`/products/${currentDetailProduct.id}/stock`, {
    method: 'PATCH',
    body: JSON.stringify({ stock: -qtyToAdd })
  });

  // 本地先扣减
  currentDetailProduct.stock -= qtyToAdd;

  detailAddBtn.style.background = '#34c759';
  setTimeout(() => { detailAddBtn.style.background = '#FFD60A'; }, 300);

  showToast(`已加入购物车 ${qtyToAdd} 件`);
}

/* ========================================
   从浏览页加购
   ======================================== */
function addToCart(id, btnEl) {
  const product = products.find(p => p.id === id);
  if (!product || product.stock <= 0) return;

  flyToCart(btnEl, product);
  addCartData(id, 1);

  // 通知服务器扣减库存
  api(`/products/${id}/stock`, {
    method: 'PATCH',
    body: JSON.stringify({ stock: -1 })
  });

  // 本地先扣减
  product.stock -= 1;

  // 按钮反馈
  btnEl.classList.add('success');
  const svg = btnEl.querySelector('svg');
  const origHTML = svg.innerHTML;
  svg.innerHTML = '<path d="M3 8l3.5 3.5L13 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>';
  setTimeout(() => {
    btnEl.classList.remove('success');
    svg.innerHTML = origHTML;
  }, 600);

  if (product.stock <= 0 || product.stock <= 10) {
    setTimeout(() => renderProductGrid(), 650);
  }
}

/* ========================================
   核心动效: 商品飞入购物车
   ======================================== */
function flyToCart(fromEl, product) {
  const fromRect = fromEl.getBoundingClientRect();
  const appRect = app.getBoundingClientRect();
  const cartRect = cartBar.getBoundingClientRect();

  const startX = fromRect.left - appRect.left + fromRect.width / 2 - 40;
  const startY = fromRect.top - appRect.top + fromRect.height / 2 - 55;
  const endX = cartRect.left - appRect.left + 20;
  const endY = cartRect.top - appRect.top + 10;

  flyClone.innerHTML = productImageHTML(product);
  flyClone.style.left = startX + 'px';
  flyClone.style.top = startY + 'px';
  flyClone.style.transform = 'scale(1) rotate(0deg)';
  flyClone.style.opacity = '1';
  flyClone.classList.add('flying');

  const duration = 650;
  const startTime = performance.now();
  const ctrlX = (startX + endX) / 2 + 40;
  const ctrlY = Math.min(startY, endY) - 120;

  function animate(now) {
    const t = Math.min((now - startTime) / duration, 1);
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const x = Math.pow(1 - eased, 2) * startX + 2 * (1 - eased) * eased * ctrlX + Math.pow(eased, 2) * endX;
    const y = Math.pow(1 - eased, 2) * startY + 2 * (1 - eased) * eased * ctrlY + Math.pow(eased, 2) * endY;
    const scale = 1 - eased * 0.6;
    const rotate = eased * 180;

    flyClone.style.left = x + 'px';
    flyClone.style.top = y + 'px';
    flyClone.style.transform = `scale(${scale}) rotate(${rotate}deg)`;

    if (t < 1) {
      requestAnimationFrame(animate);
    } else {
      flyClone.style.opacity = '0';
      flyClone.classList.remove('flying');
      cartBar.classList.add('bounce');
      setTimeout(() => cartBar.classList.remove('bounce'), 500);
      cartBarBadge.classList.add('pop');
      setTimeout(() => cartBarBadge.classList.remove('pop'), 400);
    }
  }
  requestAnimationFrame(animate);
}

/* ========================================
   购物车数据管理
   ======================================== */
function addCartData(id, qty) {
  const product = products.find(p => p.id === id);
  if (!product) return;

  const existing = cart.find(c => c.id === id);
  if (existing) {
    existing.qty += qty;
  } else {
    cart.push({
      id: product.id,
      name: product.name,
      brand: product.brand,
      price: product.price,
      bg: product.bg,
      bagBg: product.bagBg,
      bagText: product.bagText,
      bagSub: product.bagSub,
      image: product.image,
      qty: qty
    });
  }
  saveCart();
  updateCartBar();
}

function updateCartBar() {
  const totalItems = cart.reduce((s, c) => s + c.qty, 0);
  cartBarBadge.textContent = totalItems;
  cartBarSub.textContent = totalItems === 1 ? '1 件' : `${totalItems} 件`;
  cartBadgeTop.textContent = totalItems;

  if (totalItems > 0) {
    cartBar.classList.remove('hidden');
  } else {
    cartBar.classList.add('hidden');
  }

  cartBarThumbs.innerHTML = cart.slice(0, 3).map(c =>
    `<div class="cart-thumb" style="background:${c.bg || '#f0f0f3'}">
      ${thumbImageHTML(c)}
    </div>`
  ).join('');

  if (pageCart.classList.contains('cart-active')) {
    renderCartBody();
  }
}

/* ========================================
   渲染购物车页
   ======================================== */
function renderCartBody() {
  if (cart.length === 0) {
    cartBody.innerHTML = `
      <div style="text-align:center;padding:60px 0;color:#666">
        <p style="font-size:16px;font-weight:600;color:#fff">购物车是空的</p>
        <p style="font-size:13px;color:#888;margin-top:8px">去挑选商品吧！</p>
      </div>
    `;
    return;
  }

  const itemsHTML = cart.map((c, i) => `
    <div class="cart-item" style="animation-delay:${0.05 + i * 0.07}s">
      <div class="cart-item-img" style="background:${c.bg || '#f0f0f3'}">
        ${c.image
          ? `<img src="${c.image}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
          : productImageHTML(c)}
      </div>
      <div class="cart-item-info">
        <div class="cart-item-name">${c.name}</div>
        <div class="cart-item-sub">${c.brand || ''} · 数量 ${c.qty}</div>
      </div>
      <div class="cart-item-price">$${String(c.price * c.qty).padStart(2, '0')}.00</div>
    </div>
  `).join('');

  const total = cart.reduce((s, c) => s + c.price * c.qty, 0);

  cartBody.innerHTML = `
    ${itemsHTML}
    <div class="cart-summary">
      <div class="cart-summary-label">配送费</div>
      <div class="cart-summary-total-label">合计</div>
      <div class="cart-summary-amount">USD $${String(total).padStart(2, '0')}.00</div>
    </div>
    <button class="checkout-btn" onclick="checkout()">
      <span>立即支付</span>
      <div class="checkout-arrow">
        <svg width="16" height="16" viewBox="0 0 16 16"><path d="M4 8h7M8 5l3 3-3 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>
      </div>
    </button>
  `;
}

/* ========================================
   结算 - 发送订单到服务器
   ======================================== */
async function checkout() {
  const total = cart.reduce((s, c) => s + c.price * c.qty, 0);
  const items = cart.map(c => ({
    id: c.id,
    name: c.name,
    brand: c.brand,
    price: c.price,
    qty: c.qty,
    image: c.image
  }));

  showToast('正在提交订单...');

  const order = await api('/orders', {
    method: 'POST',
    body: JSON.stringify({ items, total })
  });

  if (order) {
    showToast('支付成功！🎉');
    cart = [];
    saveCart();
    updateCartBar();
    cartBar.classList.add('hidden');
    setTimeout(() => showPage('browse'), 500);
  }
}

/* ========================================
   页面切换
   ======================================== */
function showPage(target) {
  if (target === 'browse') {
    pageBrowse.classList.remove('slide-out-left');
    pageDetail.classList.remove('detail-active');
    pageCart.classList.remove('cart-active');
    renderProductGrid();
    if (cart.length > 0) {
      cartBar.classList.remove('hidden');
    }
  } else if (target === 'cart') {
    pageBrowse.classList.add('slide-out-left');
    pageDetail.classList.remove('detail-active');
    pageCart.classList.add('cart-active');
    cartBar.classList.add('hidden');
    renderCartBody();
  }
}

/* ========================================
   筛选（动态分类 + 事件委托）
   ======================================== */
async function loadCategories() {
  const data = await api('/categories');
  if (data && Array.isArray(data)) {
    categories = data
      .map(c => (typeof c === 'string' ? c : (c.name || c.key || '')))
      .filter(Boolean);
    renderFilters();
    renderCategorySelect();
  }
}

function renderFilters() {
  let html = `<button class="filter-pill${currentFilter === 'All' ? ' active' : ''}" data-cat="All">全部</button>`;
  categories.forEach(name => {
    html += `<button class="filter-pill${currentFilter === name ? ' active' : ''}" data-cat="${name}">${name}</button>`;
  });
  html += `<button class="filter-icon">🔍</button><button class="filter-icon">✦</button>`;
  filterRow.innerHTML = html;
}

function renderCategorySelect() {
  formCategory.innerHTML = categories
    .map(name => `<option value="${name}">${name}</option>`)
    .join('');
}

filterRow.addEventListener('click', function(e) {
  const pill = e.target.closest('.filter-pill');
  if (!pill) return;
  document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
  pill.classList.add('active');
  currentFilter = pill.dataset.cat || 'All';
  renderProductGrid();
});

/* ========================================
   ===== 商品管理功能（调用后端 API） =====
   ======================================== */

function openManagePanel() {
  manageOverlay.classList.add('active');
  hideAddForm();
  renderManageList();
}

function closeManagePanel() {
  manageOverlay.classList.remove('active');
}

function renderManageList() {
  manageCount.textContent = products.length;

  if (products.length === 0) {
    manageList.innerHTML = `
      <div style="text-align:center;padding:40px 0;color:#999">
        <p style="font-size:14px">暂无商品</p>
        <p style="font-size:13px;margin-top:4px">点击"添加商品"创建第一个</p>
      </div>
    `;
    return;
  }

  manageList.innerHTML = products.map(p => {
    const soldOut = p.stock <= 0;
    const lowStock = p.stock > 0 && p.stock <= 10;
    return `
      <div class="manage-item">
        <div class="manage-item-img" style="background:${p.bg || '#f0f0f3'}">
          ${p.image ? `<img src="${p.image}">` : productImageHTML(p)}
        </div>
        <div class="manage-item-info">
          <div class="manage-item-name">${p.name}</div>
          <div class="manage-item-meta">
            <span class="manage-item-price">$${String(p.price).padStart(2, '0')}.00</span>
            <span class="manage-item-stock ${soldOut ? 'out' : lowStock ? 'low' : ''}">
              ${soldOut ? '已售罄' : `库存 ${p.stock}`}
            </span>
          </div>
        </div>
        <div class="manage-item-actions">
          <button class="manage-item-edit" onclick="editProduct(${p.id})" title="编辑">
            <svg width="16" height="16" viewBox="0 0 16 16"><path d="M11 2l3 3-8 8H3v-3l8-8z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>
          </button>
          <button class="manage-item-delete" onclick="deleteProduct(${p.id})" title="删除">
            <svg width="16" height="16" viewBox="0 0 16 16"><path d="M3 5h10M6 5V3h4v2M5 5l1 9h4l1-9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function showAddForm() {
  editingProductId = null;
  uploadedImage = null;
  selectedColor = '#FFF3D6';
  formTitle.textContent = '添加新商品';
  formSaveBtn.textContent = '保存商品';
  formName.value = '';
  formBrand.value = '';
  formPrice.value = '';
  formStock.value = '';
  formCategory.value = categories[0] || '';
  uploadPreview.style.display = 'none';
  uploadPlaceholder.style.display = 'flex';
  document.querySelectorAll('.color-option').forEach(opt => {
    opt.classList.toggle('selected', opt.dataset.color === selectedColor);
  });
  manageFormSection.style.display = 'block';
}

function editProduct(id) {
  const product = products.find(p => p.id === id);
  if (!product) return;

  editingProductId = id;
  uploadedImage = product.image || null;
  selectedColor = product.bg || '#FFF3D6';

  formTitle.textContent = '编辑商品';
  formSaveBtn.textContent = '更新商品';
  formName.value = product.name || '';
  formBrand.value = product.brand || '';
  formPrice.value = product.price || '';
  formStock.value = product.stock !== undefined ? product.stock : '';
  formCategory.value = product.cat || categories[0] || '';

  if (product.image) {
    uploadPreview.src = product.image;
    uploadPreview.style.display = 'block';
    uploadPlaceholder.style.display = 'none';
  } else {
    uploadPreview.style.display = 'none';
    uploadPlaceholder.style.display = 'flex';
  }

  document.querySelectorAll('.color-option').forEach(opt => {
    opt.classList.toggle('selected', opt.dataset.color === selectedColor);
  });

  manageFormSection.style.display = 'block';
}

function hideAddForm() {
  manageFormSection.style.display = 'none';
}

imageInput.addEventListener('change', function(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    showToast('图片过大（最大 2MB）');
    return;
  }
  const reader = new FileReader();
  reader.onload = function(event) {
    uploadedImage = event.target.result;
    uploadPreview.src = uploadedImage;
    uploadPreview.style.display = 'block';
    uploadPlaceholder.style.display = 'none';
  };
  reader.readAsDataURL(file);
});

colorPicker.addEventListener('click', function(e) {
  const option = e.target.closest('.color-option');
  if (!option) return;
  document.querySelectorAll('.color-option').forEach(opt => opt.classList.remove('selected'));
  option.classList.add('selected');
  selectedColor = option.dataset.color;
});

/* 保存商品 - 调用后端 API */
async function saveProduct() {
  const name = formName.value.trim();
  const brand = formBrand.value.trim();
  const price = parseFloat(formPrice.value);
  const stock = parseInt(formStock.value) || 0;
  const category = formCategory.value;

  if (!name) { showToast('请输入商品名称'); formName.focus(); return; }
  if (isNaN(price) || price < 0) { showToast('请输入有效价格'); formPrice.focus(); return; }

  const payload = {
    name, brand, price, stock, cat: category, bg: selectedColor,
    image: uploadedImage,
    bagBg: uploadedImage ? null : generateBagColor(category),
    bagText: uploadedImage ? null : (brand || name).toUpperCase().substring(0, 10),
    bagSub: uploadedImage ? null : category,
  };

  if (editingProductId !== null) {
    const updated = await api(`/products/${editingProductId}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
    if (updated) {
      const idx = products.findIndex(p => p.id === editingProductId);
      if (idx >= 0) products[idx] = updated;
      showToast('商品已更新！');
    }
  } else {
    const newProduct = await api('/products', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    if (newProduct) {
      products.push(newProduct);
      showToast('商品已添加！');
    }
  }

  renderManageList();
  hideAddForm();
  renderProductGrid();
}

/* 删除商品 - 调用后端 API */
async function deleteProduct(id) {
  const product = products.find(p => p.id === id);
  if (!product) return;
  if (!confirm(`确认删除"${product.name}"？`)) return;

  const result = await api(`/products/${id}`, { method: 'DELETE' });
  if (result) {
    products = products.filter(p => p.id !== id);
    cart = cart.filter(c => c.id !== id);
    saveCart();
    renderManageList();
    renderProductGrid();
    updateCartBar();
    showToast('商品已删除');
  }
}

function generateBagColor(category) {
  const colors = {
    'Chips': '#E8650C', 'Choco': '#5B3A1A', 'Drinks': '#1A5B9E',
    'Cookies': '#C01A1A', 'Nuts': '#1A8A4E',
  };
  return colors[category] || '#666';
}

/* ========================================
   Toast 提示
   ======================================== */
let toastTimer = null;
function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2000);
}

/* ========================================
   初始化
   ======================================== */
loadCart();
loadCategories();
renderProductGrid();
updateCartBar();
loadProducts();
connectWS();
