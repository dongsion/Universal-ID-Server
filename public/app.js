/* ========================================
   Universal ID（客户端）
   完整购物流程：浏览→详情→购物车→确认订单→支付成功→订单记录
   ======================================== */

const API_BASE = '/api/uid';
const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

/* ---- 状态 ---- */
let categories = [];
let products = [];
let cart = [];
let currentDetailProduct = null;
let currentQty = 1;
let currentFilter = 'All';
let searchKeyword = '';
let cartEditMode = false;
let buyNowItem = null; /* 立即购买临时商品 */
const selectedItems = new Set(); /* 购物车选中项 */

/* ---- 聊天状态 ---- */
let chatMessages = [];
let chatUnreadCount = 0;
let chatOpen = false;
const CHAT_SESSION_KEY = 'uid_chat_session';
const CHAT_MSGS_KEY = 'uid_chat_messages';

/* ---- 用户会话 ---- */
let currentUser = null; /* { id, username, token } */
let authMode = 'login'; /* 'login' 或 'register' */

/* ---- localStorage ---- */
const CART_KEY = 'universal_id_cart';
const ORDERS_KEY = 'universal_id_orders';
const ADDRESS_KEY = 'universal_id_address';
const USER_KEY = 'universal_id_user';

function loadCart() {
  const saved = localStorage.getItem(CART_KEY);
  if (saved) { try { cart = JSON.parse(saved); } catch (e) { cart = []; } }
}
function saveCart() { localStorage.setItem(CART_KEY, JSON.stringify(cart)); }

function loadOrderHistory() {
  const saved = localStorage.getItem(ORDERS_KEY);
  if (saved) { try { return JSON.parse(saved); } catch (e) { return []; } }
  return [];
}
function saveOrderHistory(orders) { localStorage.setItem(ORDERS_KEY, JSON.stringify(orders)); }
function addOrderToHistory(order) {
  const history = loadOrderHistory();
  history.unshift(order);
  if (history.length > 50) history.length = 50;
  saveOrderHistory(history);
}

function loadAddress() {
  const saved = localStorage.getItem(ADDRESS_KEY);
  if (saved) { try { return JSON.parse(saved); } catch (e) {} }
  return {};
}
function saveAddress(addr) { localStorage.setItem(ADDRESS_KEY, JSON.stringify(addr)); }

/* ---- 用户会话管理 ---- */
function loadUser() {
  const saved = localStorage.getItem(USER_KEY);
  if (saved) { try { return JSON.parse(saved); } catch (e) {} }
  return null;
}
function saveUser(user) { localStorage.setItem(USER_KEY, JSON.stringify(user)); }
function clearUser() { localStorage.removeItem(USER_KEY); currentUser = null; }

/* 切换登录/注册标签 */
function switchAuthTab(mode) {
  authMode = mode;
  const tabLogin = document.getElementById('tab-login');
  const tabRegister = document.getElementById('tab-register');
  const confirmGroup = document.getElementById('auth-confirm-group');
  const submitBtn = document.getElementById('auth-submit-btn');
  const hint = document.getElementById('auth-hint');

  if (mode === 'login') {
    tabLogin.classList.add('active');
    tabRegister.classList.remove('active');
    confirmGroup.style.display = 'none';
    submitBtn.textContent = '登录';
    hint.textContent = '还没有账号？点击上方"注册"';
  } else {
    tabLogin.classList.remove('active');
    tabRegister.classList.add('active');
    confirmGroup.style.display = 'block';
    submitBtn.textContent = '注册';
    hint.textContent = '已有账号？点击上方"登录"';
  }
  /* 清空输入 */
  document.getElementById('auth-username').value = '';
  document.getElementById('auth-password').value = '';
  const confirmInput = document.getElementById('auth-confirm-password');
  if (confirmInput) confirmInput.value = '';
}

/* 处理登录/注册 */
async function handleAuth() {
  const username = document.getElementById('auth-username').value.trim();
  const password = document.getElementById('auth-password').value.trim();

  if (!username) { showToast('请输入用户名'); return; }
  if (!password) { showToast('请输入密码'); return; }

  if (authMode === 'register') {
    const confirmPassword = document.getElementById('auth-confirm-password').value.trim();
    if (password !== confirmPassword) { showToast('两次密码不一致'); return; }
    if (password.length < 6) { showToast('密码至少6位'); return; }

    showToast('正在注册...');
    const result = await api('/register', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });

    if (result && result.success) {
      currentUser = result.user;
      saveUser(currentUser);
      showToast('注册成功！');
      updateAccountUI();
      /* 注册后同步本地订单到账户 */
      await syncLocalOrdersToAccount();
      showAccountPage();
    }
  } else {
    showToast('正在登录...');
    const result = await api('/user-login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });

    if (result && result.success) {
      currentUser = result.user;
      saveUser(currentUser);
      showToast('登录成功！');
      updateAccountUI();
      /* 登录后同步本地订单到账户，再从服务器拉取 */
      await syncLocalOrdersToAccount();
      await syncOrdersFromServer();
      showAccountPage();
    }
  }
}

/* 退出登录 */
function handleLogout() {
  if (!confirm('确认退出登录？')) return;
  clearUser();
  showToast('已退出登录');
  updateAccountUI();
  showAccountPage();
}

/* 显示账户页面 */
function showAccountPage() {
  showPage('account');
}

/* 账号信息 */
function showAccountInfo() {
  if (!currentUser) { showToast('请先登录'); return; }
  showToast(`账号：${currentUser.username}`);
}

/* 手动同步订单 */
async function syncMyOrders() {
  if (!currentUser) { showToast('请先登录'); return; }
  showToast('正在同步订单...');
  await syncOrdersFromServer();
  showToast('订单同步完成');
}

/* 清除缓存 */
function clearAppCache() {
  if (!confirm('确认清除本地缓存？购物车和未同步的订单可能会丢失。')) return;
  localStorage.removeItem(CART_KEY);
  localStorage.removeItem(ADDRESS_KEY);
  cart = [];
  saveCart();
  updateCartBar();
  showToast('缓存已清除');
}

/* 检查服务器状态 */
async function checkServerStatus() {
  const arrow = document.getElementById('client-server-status-arrow');
  if (arrow) arrow.textContent = '检查中...';
  const result = await api('/health');
  if (result && result.status === 'ok') {
    if (arrow) { arrow.textContent = '正常 ✓'; arrow.style.color = '#34c759'; }
    showToast('服务器运行正常');
  } else {
    if (arrow) { arrow.textContent = '异常 ✗'; arrow.style.color = '#ff3b30'; }
    showToast('服务器连接异常');
  }
  if (arrow) {
    setTimeout(() => { arrow.textContent = '›'; arrow.style.color = ''; }, 3000);
  }
}

/* 更新账户UI */
function updateAccountUI() {
  const authSection = document.getElementById('account-auth-section');
  const infoSection = document.getElementById('account-info-section');
  const badgeDot = document.getElementById('user-badge-dot');

  if (currentUser) {
    authSection.style.display = 'none';
    infoSection.style.display = 'block';
    badgeDot.style.display = 'block';
    document.getElementById('account-username').textContent = currentUser.username;
    document.getElementById('account-avatar').textContent = currentUser.username.charAt(0).toUpperCase();
  } else {
    authSection.style.display = 'block';
    infoSection.style.display = 'none';
    badgeDot.style.display = 'none';
  }
}

/* 把本地订单同步到用户账户 */
async function syncLocalOrdersToAccount() {
  if (!currentUser) return;
  const history = loadOrderHistory();
  for (const order of history) {
    /* 如果订单没有 user_id，向服务器更新 */
    if (!order.user_id) {
      try {
        await fetch(API_BASE + `/orders/${order.id}/bind`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUser.id })
        });
      } catch (e) { /* 忽略错误 */ }
    }
  }
}

/* 从服务器拉取用户的所有订单 */
async function syncOrdersFromServer() {
  if (!currentUser) return;
  const serverOrders = await api(`/user/${currentUser.id}/orders`);
  if (serverOrders && Array.isArray(serverOrders)) {
    /* 合并服务器订单和本地订单 */
    let history = loadOrderHistory();
    const localIds = new Set(history.map(o => o.id));
    /* 添加服务器上有但本地没有的订单 */
    serverOrders.forEach(so => {
      if (!localIds.has(so.id)) {
        history.unshift(so);
      } else {
        /* 更新本地已有订单的状态 */
        const idx = history.findIndex(o => o.id === so.id);
        if (idx >= 0) {
          history[idx] = { ...history[idx], ...so };
        }
      }
    });
    /* 按时间排序 */
    history.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    saveOrderHistory(history);

    /* 如果在订单页，刷新显示 */
    if (pageOrders.classList.contains('orders-active')) {
      renderOrdersList();
    }
  }
}

/* ---- API ---- */
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

/* ---- WebSocket ---- */
let ws = null;
function connectWS() {
  try {
    ws = new WebSocket(WS_URL);
    ws.onopen = () => {
      console.log('WebSocket 已连接');
      ws.send(JSON.stringify({ type: 'chat_register', data: { sessionId: getChatSessionId(), role: 'customer' } }));
    };
    ws.onmessage = (event) => handleWSMessage(JSON.parse(event.data));
    ws.onclose = () => setTimeout(connectWS, 5000);
    ws.onerror = () => ws.close();
  } catch (e) { console.error('WebSocket 连接失败:', e); }
}

function handleWSMessage(msg) {
  const { type, data } = msg;
  if (type === 'product_updated' || type === 'product_added') {
    const idx = products.findIndex(p => p.id === data.id);
    if (idx >= 0) products[idx] = data; else products.push(data);
    renderProductGrid();
  } else if (type === 'product_deleted') {
    products = products.filter(p => p.id !== data.id);
    cart = cart.filter(c => c.id !== data.id);
    selectedItems.delete(data.id);
    saveCart();
    renderProductGrid();
    updateCartBar();
  } else if (type === 'order_updated' || type === 'order_new') {
    /* 实时更新本地订单 */
    syncOrderFromServer(data);
  } else if (type === 'order_deleted') {
    /* 订单被删除 */
    let history = loadOrderHistory();
    history = history.filter(o => o.id !== data.id);
    saveOrderHistory(history);
    const ordersList = document.getElementById('orders-list');
    if (ordersList && pageOrders.classList.contains('orders-active')) {
      renderOrdersList();
    }
    showToast('订单已被删除');
  } else if (type === 'chat_message') {
    const msg = { from: data.from || 'merchant', text: data.text, timestamp: data.timestamp || new Date().toISOString() };
    chatMessages.push(msg);
    saveChatMessages();
    if (chatOpen) { renderChatMessages(); } else { chatUnreadCount++; updateChatBadge(); }
    if (navigator.vibrate) navigator.vibrate(80);
  } else if (type === 'chat_history') {
    if (data.messages && data.messages.length > 0) {
      chatMessages = data.messages;
      saveChatMessages();
      renderChatMessages();
    }
  }
}

/* ---- 同步订单到本地 ---- */
function syncOrderFromServer(serverOrder) {
  const history = loadOrderHistory();
  const idx = history.findIndex(o => o.id === serverOrder.id);
  if (idx >= 0) {
    const oldStatus = history[idx].status;
    const oldCardKeys = history[idx].card_keys;
    history[idx] = { ...history[idx], ...serverOrder };
    saveOrderHistory(history);
    
    /* 状态变化通知 */
    if (oldStatus !== serverOrder.status) {
      const statusNames = {
        'pending': '商家确认中',
        'confirmed': '待付款',
        'paid': '商家处理中',
        'delivered': '卡密已交付',
        'cancelled': '已取消'
      };
      if (serverOrder.status === 'delivered') {
        showToast('🎉 卡密已交付！请查看订单');
      } else if (serverOrder.status === 'confirmed') {
        showToast('✅ 商家已确认订单');
      } else if (serverOrder.status === 'paid') {
        showToast('💰 商家已确认收款');
      } else if (serverOrder.status === 'cancelled') {
        showToast('❌ 订单已取消');
      }
    }
  }
  
  /* 如果当前在订单页或成功页，刷新显示 */
  const activePage = document.querySelector('.page.orders-active, .page.success-active');
  if (activePage) {
    if (activePage.classList.contains('orders-active')) {
      renderOrdersList();
    } else if (activePage.classList.contains('success-active')) {
      renderSuccessPage(serverOrder);
    }
  }
}

/* ---- 从服务器同步所有订单状态 ---- */
async function syncAllOrders() {
  const history = loadOrderHistory();
  if (history.length === 0) return;
  
  let hasUpdate = false;
  for (const localOrder of history) {
    const serverOrder = await api(`/orders/${localOrder.id}`);
    if (serverOrder && serverOrder.status !== localOrder.status) {
      hasUpdate = true;
    }
    if (serverOrder) {
      const idx = history.findIndex(o => o.id === serverOrder.id);
      if (idx >= 0) {
        history[idx] = { ...history[idx], ...serverOrder };
      }
    }
  }
  
  if (hasUpdate) {
    saveOrderHistory(history);
    const activePage = document.querySelector('.page.orders-active, .page.success-active');
    if (activePage) {
      if (activePage.classList.contains('orders-active')) renderOrdersList();
    }
  }
}

/* ---- DOM ---- */
const app = document.getElementById('app');
const productGrid = document.getElementById('product-grid');
const filterRow = document.getElementById('filter-row');
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
const pageSuccess = document.getElementById('page-success');
const pageOrders = document.getElementById('page-orders');
const pageCheckout = document.getElementById('page-checkout');
const pageAccount = document.getElementById('page-account');
const detailContent = document.getElementById('detail-content');
const qtyNumber = document.getElementById('qty-number');
const detailPrice = document.getElementById('detail-price');
const detailCartBtn = document.getElementById('detail-cart-btn');
const detailBuyBtn = document.getElementById('detail-buy-btn');
const cartBadgeTop = document.getElementById('cart-badge-top');
const cartBody = document.getElementById('cart-body');
const cartFooter = document.getElementById('cart-footer');
const toast = document.getElementById('toast');
const searchInput = document.getElementById('search-input');

/* ---- 聊天 DOM ---- */
const chatFab = document.getElementById('chat-fab');
const chatFabBadge = document.getElementById('chat-fab-badge');
const chatOverlay = document.getElementById('chat-overlay');
const chatMessagesEl = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');

/* ========================================
   商品图片 HTML
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
   渲染商品列表
   ======================================== */
async function loadProducts() {
  const data = await api('/products');
  if (data) { products = data; renderProductGrid(); }
}

function renderProductGrid() {
  const visibleProducts = products.filter(p => p.active !== 0);
  let filtered = currentFilter === 'All'
    ? visibleProducts
    : visibleProducts.filter(p => p.cat === currentFilter);

  if (searchKeyword) {
    filtered = filtered.filter(p =>
      (p.name || '').toLowerCase().includes(searchKeyword) ||
      (p.brand || '').toLowerCase().includes(searchKeyword)
    );
  }

  itemCount.textContent = `${filtered.length} 件`;
  collectionTitle.textContent = searchKeyword
    ? `搜索"${searchKeyword}"`
    : currentFilter === 'All' ? '全部商品' : `${currentFilter}商品`;

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
   搜索
   ======================================== */
let searchTimer = null;
searchInput.addEventListener('input', function() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    searchKeyword = this.value.trim().toLowerCase();
    renderProductGrid();
  }, 300);
});

/* ========================================
   商品详情页
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
    detailCartBtn.disabled = true;
    detailBuyBtn.disabled = true;
  } else {
    detailCartBtn.disabled = false;
    detailBuyBtn.disabled = false;
  }

  pageBrowse.classList.add('slide-out-left');
  pageDetail.classList.add('detail-active');
}

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
   加入购物车
   ======================================== */
function addFromDetail() {
  if (!currentDetailProduct || currentDetailProduct.stock <= 0) return;
  const qtyToAdd = Math.min(currentQty, currentDetailProduct.stock);
  addCartData(currentDetailProduct.id, qtyToAdd);
  flyToCart(detailCartBtn, currentDetailProduct);
  showToast(`已加入购物车 ${qtyToAdd} 件`);
}

function addToCart(id, btnEl) {
  const product = products.find(p => p.id === id);
  if (!product || product.stock <= 0) return;
  addCartData(id, 1);
  flyToCart(btnEl, product);
  product.stock -= 1;
  showToast('已加入购物车');
  if (product.stock <= 0 || product.stock <= 10) {
    setTimeout(() => renderProductGrid(), 650);
  }
}

/* ========================================
   立即购买
   ======================================== */
function buyNow() {
  if (!currentDetailProduct || currentDetailProduct.stock <= 0) return;
  const qtyToAdd = Math.min(currentQty, currentDetailProduct.stock);
  buyNowItem = {
    id: currentDetailProduct.id,
    name: currentDetailProduct.name,
    brand: currentDetailProduct.brand,
    price: currentDetailProduct.price,
    qty: qtyToAdd,
    image: currentDetailProduct.image,
    bg: currentDetailProduct.bg,
    bagBg: currentDetailProduct.bagBg,
    bagText: currentDetailProduct.bagText,
    bagSub: currentDetailProduct.bagSub,
  };
  goToCheckoutPage(true);
}

/* ========================================
   飞入动画
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
   购物车数据
   ======================================== */
function addCartData(id, qty) {
  const product = products.find(p => p.id === id);
  if (!product) return;
  const existing = cart.find(c => c.id === id);
  if (existing) {
    existing.qty += qty;
  } else {
    cart.push({
      id: product.id, name: product.name, brand: product.brand,
      price: product.price, bg: product.bg, bagBg: product.bagBg,
      bagText: product.bagText, bagSub: product.bagSub,
      image: product.image, qty: qty
    });
    selectedItems.add(id);
  }
  saveCart();
  updateCartBar();
}

function updateCartBar() {
  const totalItems = cart.reduce((s, c) => s + c.qty, 0);
  cartBarBadge.textContent = totalItems;
  cartBarSub.textContent = totalItems === 1 ? '1 件' : `${totalItems} 件`;
  cartBadgeTop.textContent = totalItems;
  if (totalItems > 0) { cartBar.classList.remove('hidden'); }
  else { cartBar.classList.add('hidden'); }
  cartBarThumbs.innerHTML = cart.slice(0, 3).map(c =>
    `<div class="cart-thumb" style="background:${c.bg || '#f0f0f3'}">${thumbImageHTML(c)}</div>`
  ).join('');
  if (pageCart.classList.contains('cart-active')) renderCartBody();
  updateChatFabPosition();
}

/* ========================================
   购物车页
   ======================================== */
function renderCartBody() {
  if (cart.length === 0) {
    cartBody.innerHTML = `
      <div style="text-align:center;padding:60px 0;color:#666">
        <p style="font-size:16px;font-weight:600;color:#fff">购物车是空的</p>
        <p style="font-size:13px;color:#888;margin-top:8px">去挑选商品吧！</p>
        <button class="checkout-btn" style="margin-top:20px;" onclick="showPage('browse')"><span>去购物</span></button>
      </div>
    `;
    cartFooter.style.display = 'none';
    return;
  }

  cartFooter.style.display = 'flex';
  const itemsHTML = cart.map((c, i) => `
    <div class="cart-item" style="animation-delay:${0.05 + i * 0.07}s">
      <div class="cart-item-check ${selectedItems.has(c.id) ? 'checked' : ''}" onclick="toggleSelectItem(${c.id})"></div>
      <div class="cart-item-img" style="background:${c.bg || '#f0f0f3'}">
        ${c.image ? `<img src="${c.image}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">` : productImageHTML(c)}
      </div>
      <div class="cart-item-info">
        <div class="cart-item-info-row">
          <div>
            <div class="cart-item-name">${c.name}</div>
            <div class="cart-item-sub">${c.brand || ''}</div>
          </div>
          <button class="cart-item-delete" onclick="removeCartItem(${c.id})">×</button>
        </div>
        <div class="cart-item-controls">
          <button class="cart-qty-btn" onclick="cartQtyChange(${c.id}, -1)">−</button>
          <span class="cart-qty-display">${c.qty}</span>
          <button class="cart-qty-btn" onclick="cartQtyChange(${c.id}, 1)">+</button>
          <span class="cart-count-badge">$${String(c.price).padStart(2, '0')}.00 / 件</span>
        </div>
      </div>
      <div class="cart-item-price">$${String(c.price * c.qty).padStart(2, '0')}.00</div>
    </div>
  `).join('');

  const total = cart.reduce((s, c) => s + c.price * c.qty, 0);
  cartBody.innerHTML = itemsHTML;
  updateCartFooter();
}

function updateCartFooter() {
  const selected = cart.filter(c => selectedItems.has(c.id));
  const total = selected.reduce((s, c) => s + c.price * c.qty, 0);
  const count = selected.reduce((s, c) => s + c.qty, 0);
  document.getElementById('cart-footer-amount').textContent = `$${total.toFixed(2)}`;
  document.getElementById('cart-selected-count').textContent = count;
  const checkoutBtn = document.getElementById('cart-checkout-btn');
  checkoutBtn.disabled = count === 0;

  /* 更新全选状态 */
  const allSelected = cart.length > 0 && cart.every(c => selectedItems.has(c.id));
  const selectAllCircle = document.getElementById('select-all-circle');
  if (allSelected) selectAllCircle.classList.add('checked');
  else selectAllCircle.classList.remove('checked');
}

function toggleSelectItem(id) {
  if (selectedItems.has(id)) selectedItems.delete(id);
  else selectedItems.add(id);
  renderCartBody();
}

function toggleSelectAll() {
  const allSelected = cart.length > 0 && cart.every(c => selectedItems.has(c.id));
  if (allSelected) {
    cart.forEach(c => selectedItems.delete(c.id));
  } else {
    cart.forEach(c => selectedItems.add(c.id));
  }
  renderCartBody();
}

function toggleCartEditMode() {
  cartEditMode = !cartEditMode;
  const btn = document.getElementById('cart-edit-btn');
  btn.textContent = cartEditMode ? '完成' : '管理';
  renderCartBody();
}

function cartQtyChange(id, delta) {
  const item = cart.find(c => c.id === id);
  if (!item) return;
  if (delta > 0) {
    const product = products.find(p => p.id === id);
    if (product && item.qty >= product.stock) {
      showToast(`库存仅剩 ${product.stock} 件`);
      return;
    }
    item.qty++;
  } else {
    if (item.qty > 1) item.qty--;
    else { removeCartItem(id); return; }
  }
  saveCart();
  updateCartBar();
  renderCartBody();
}

function removeCartItem(id) {
  cart = cart.filter(c => c.id !== id);
  selectedItems.delete(id);
  saveCart();
  updateCartBar();
  renderCartBody();
  showToast('已移除');
}

/* ========================================
   去结算 → 订单确认页
   ======================================== */
function goToCheckout() {
  const selected = cart.filter(c => selectedItems.has(c.id));
  if (selected.length === 0) {
    showToast('请选择要结算的商品');
    return;
  }
  goToCheckoutPage(false);
}

function goToCheckoutPage(isBuyNow) {
  const items = isBuyNow ? [buyNowItem] : cart.filter(c => selectedItems.has(c.id));
  const total = items.reduce((s, c) => s + c.price * c.qty, 0);

  /* 渲染商品清单 */
  document.getElementById('checkout-items').innerHTML = items.map(c => `
    <div class="checkout-item">
      <div class="checkout-item-img" style="background:${c.bg || '#f0f0f3'}">
        ${c.image ? `<img src="${c.image}">` : ''}
      </div>
      <div class="checkout-item-name">${c.name}</div>
      <div class="checkout-item-qty">×${c.qty}</div>
      <div class="checkout-item-price">$${(c.price * c.qty).toFixed(2)}</div>
    </div>
  `).join('');

  /* 金额 */
  document.getElementById('checkout-goods-amount').textContent = `$${total.toFixed(2)}`;
  document.getElementById('checkout-pay-amount').textContent = `$${total.toFixed(2)}`;
  document.getElementById('checkout-submit-amount').textContent = `$${total.toFixed(2)}`;

  /* 自动填充已保存的收货信息 */
  const addr = loadAddress();
  if (addr.name) document.getElementById('checkout-name').value = addr.name;
  if (addr.phone) document.getElementById('checkout-phone').value = addr.phone;

  showPage('checkout');
}

/* ========================================
   提交订单
   ======================================== */
async function submitOrder() {
  const name = document.getElementById('checkout-name');
  const phone = document.getElementById('checkout-phone');

  if (!name || !phone) { showToast('页面加载异常，请刷新重试'); return; }

  const nameVal = name.value.trim();
  const phoneVal = phone.value.trim();

  if (!nameVal) { showToast('请输入联系人姓名'); return; }
  if (!phoneVal) { showToast('请输入联系方式'); return; }

  /* 保存联系信息 */
  saveAddress({ name: nameVal, phone: phoneVal });

  const isBuyNow = buyNowItem !== null;
  const items = isBuyNow
    ? [buyNowItem]
    : cart.filter(c => selectedItems.has(c.id));

  if (!items || items.length === 0) { showToast('购物车为空'); return; }

  const total = items.reduce((s, c) => s + c.price * c.qty, 0);

  const submitBtn = document.querySelector('.checkout-submit-btn');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '提交中...'; }

  showToast('正在提交订单...');

  try {
    const order = await api('/orders', {
      method: 'POST',
      body: JSON.stringify({
        items: items.map(c => ({ id: c.id, name: c.name, brand: c.brand, price: c.price, qty: c.qty, image: c.image })),
        total,
        contact: { name: nameVal, phone: phoneVal },
        userId: currentUser ? currentUser.id : null
      })
    });

    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '提交订单'; }

    if (order && order.id) {
      addOrderToHistory(order);

      if (isBuyNow) {
        buyNowItem = null;
      } else {
        const settledIds = new Set(items.map(i => i.id));
        cart = cart.filter(c => !settledIds.has(c.id));
        items.forEach(i => selectedItems.delete(i.id));
        saveCart();
        updateCartBar();
      }

      if (cartBar) cartBar.classList.add('hidden');
      renderSuccessPage(order);
      showPage('success');
      showToast('订单已提交，请扫码支付');
    } else {
      showToast('提交失败，请检查网络后重试');
    }
  } catch (e) {
    console.error('submitOrder错误:', e);
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '提交订单'; }
    showToast('提交订单失败：' + (e.message || '未知错误'));
  }
}

/* ========================================
   订单成功页
   ======================================== */
let currentSuccessOrderId = null;

function renderSuccessPage(order) {
  currentSuccessOrderId = order.id;
  const successTitle = document.getElementById('success-title');
  const successIcon = document.getElementById('success-icon');
  const payQrSection = document.getElementById('pay-qr-section');

  if (successTitle) {
    successTitle.textContent = order.status === 'delivered' ? '卡密已交付' : order.status === 'cancelled' ? '订单已取消' : order.status === 'confirmed' ? '等待商家确认收款' : order.status === 'paid' ? '商家处理中' : '订单已提交';
  }
  if (successIcon) {
    successIcon.textContent = order.status === 'delivered' ? '✓' : order.status === 'cancelled' ? '✕' : order.status === 'confirmed' ? '💰' : order.status === 'paid' ? '📦' : '📱';
    successIcon.style.background = order.status === 'cancelled' ? '#ff3b30' : order.status === 'delivered' ? '#34c759' : order.status === 'confirmed' ? '#FF9500' : order.status === 'paid' ? '#007AFF' : '#FFD60A';
  }

  document.getElementById('success-order-id').textContent = `订单号：${order.id}`;

  /* 显示/隐藏二维码区域 */
  if (order.status === 'pending') {
    payQrSection.style.display = 'block';
    document.getElementById('pay-qr-amount').textContent = `$${Number(order.total).toFixed(2)}`;
  } else {
    payQrSection.style.display = 'none';
  }

  const statusNames = {
    'pending': '待付款',
    'confirmed': '已支付，待商家确认',
    'paid': '商家已确认收款',
    'delivered': '卡密已交付',
    'cancelled': '已取消'
  };

  const statusColors = {
    'pending': '#FFD60A',
    'confirmed': '#FF9500',
    'paid': '#007AFF',
    'delivered': '#34c759',
    'cancelled': '#ff3b30'
  };

  let cardKeysHTML = '';
  if (order.card_keys) {
    cardKeysHTML = `
      <div style="margin-top:16px;padding:16px;background:#E8F8EE;border-radius:12px;border:1px solid #34c759;">
        <div style="font-size:13px;font-weight:700;color:#1a8a4e;margin-bottom:8px;">🔑 您的卡密</div>
        <div style="font-size:14px;color:#1a1a1a;white-space:pre-wrap;word-break:break-all;font-family:monospace;background:#fff;padding:12px;border-radius:8px;">${order.card_keys}</div>
      </div>
    `;
  }

  document.getElementById('success-body').innerHTML = `
    <div style="text-align:center;padding:16px 0;">
      <div style="display:inline-block;padding:6px 16px;border-radius:999px;background:${statusColors[order.status] || '#999'};color:#fff;font-size:13px;font-weight:700;">
        ${statusNames[order.status] || order.status}
      </div>
    </div>
    ${(order.items || []).map(i => `
      <div class="success-order-item">
        <div class="success-order-item-name">${i.name}</div>
        <div class="success-order-item-qty">×${i.qty}</div>
        <div class="success-order-item-price">$${(i.price * i.qty).toFixed(2)}</div>
      </div>
    `).join('')}
    <div class="success-total">
      <span class="success-total-label">应付金额</span>
      <span class="success-total-amount">$${Number(order.total).toFixed(2)}</span>
    </div>
    ${cardKeysHTML}
    <div style="margin-top:16px;padding:12px;background:#FFF8E0;border-radius:10px;font-size:12px;color:#b8860b;line-height:1.6;">
      ${order.status === 'pending' ? '📱 请扫描上方二维码完成支付，支付后点击"我已支付"按钮' : ''}
      ${order.status === 'confirmed' ? '⏳ 您已标记支付，等待商家确认收款...' : ''}
      ${order.status === 'paid' ? '📦 商家已确认收款，正在准备卡密...' : ''}
      ${order.status === 'delivered' ? '✅ 卡密已发放，请妥善保管！' : ''}
      ${order.status === 'cancelled' ? '❌ 订单已取消' : ''}
    </div>
  `;
}

/* 客户标记已支付 */
async function markAsPaid() {
  if (!currentSuccessOrderId) return;
  const btn = document.getElementById('pay-paid-btn');
  btn.disabled = true;
  btn.textContent = '提交中...';

  const result = await api(`/orders/${currentSuccessOrderId}/user-paid`, { method: 'PATCH' });

  if (result) {
    /* 更新本地订单 */
    let history = loadOrderHistory();
    const idx = history.findIndex(o => o.id === result.id);
    if (idx >= 0) history[idx] = { ...history[idx], ...result };
    saveOrderHistory(history);

    renderSuccessPage(result);
    showToast('已通知商家，等待确认收款');
  } else {
    btn.disabled = false;
    btn.textContent = '我已支付';
  }
}

/* 复制支付金额 */
function copyPayAmount() {
  const amountEl = document.getElementById('pay-qr-amount');
  if (!amountEl) return;
  const text = amountEl.textContent.replace('$', '').trim();
  const tempInput = document.createElement('input');
  tempInput.value = text;
  document.body.appendChild(tempInput);
  tempInput.select();
  try {
    document.execCommand('copy');
    showToast('金额已复制：' + text);
  } catch (e) {
    showToast('复制失败，请手动记下金额');
  }
  document.body.removeChild(tempInput);
}

/* ========================================
   我的订单页
   ======================================== */
function renderOrdersList() {
  const ordersList = document.getElementById('orders-list');
  const history = loadOrderHistory();

  if (history.length === 0) {
    ordersList.innerHTML = `
      <div class="orders-empty">
        <div style="font-size:40px;margin-bottom:12px;">📋</div>
        <p style="font-size:15px;font-weight:600;color:#666;">暂无订单</p>
        <p style="font-size:13px;color:#999;margin-top:4px;">下单后可以在这里查看</p>
      </div>
    `;
    return;
  }

  const statusNames = { 'pending': '待付款', 'confirmed': '已支付待确认', 'paid': '商家已确认', 'delivered': '已交付', 'cancelled': '已取消' };
  const statusColors = { 'pending': '#FFD60A', 'confirmed': '#FF9500', 'paid': '#007AFF', 'delivered': '#34c759', 'cancelled': '#ff3b30' };

  ordersList.innerHTML = history.map(o => `
    <div class="order-record">
      <div class="order-record-top">
        <div>
          <div class="order-record-id">${o.id}</div>
          <div class="order-record-time">${formatOrderDate(o.created_at)}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="order-record-status" style="background:${(statusColors[o.status] || '#999')}22;color:${statusColors[o.status] || '#999'};">${statusNames[o.status] || o.status}</span>
          <button onclick="deleteLocalOrder('${o.id}')" style="background:none;border:none;color:#c01a1a;cursor:pointer;font-size:16px;padding:4px;line-height:1;" title="删除订单">🗑</button>
        </div>
      </div>
      <div class="order-record-items">
        ${(o.items || []).map(i => `<span class="order-record-item">${i.name} ×${i.qty}</span>`).join('')}
      </div>
      ${o.card_keys ? `
        <div style="margin:10px 0;padding:12px;background:#E8F8EE;border-radius:10px;border:1px solid #34c759;">
          <div style="font-size:12px;font-weight:700;color:#1a8a4e;margin-bottom:6px;">🔑 卡密</div>
          <div style="font-size:13px;color:#1a1a1a;white-space:pre-wrap;word-break:break-all;font-family:monospace;background:#fff;padding:10px;border-radius:6px;">${o.card_keys}</div>
        </div>
      ` : ''}
      <div class="order-record-total">
        <span class="order-record-total-label">合计</span>
        <span class="order-record-total-value">$${Number(o.total).toFixed(2)}</span>
      </div>
    </div>
  `).join('');
}

async function deleteLocalOrder(orderId) {
  if (!confirm('确认删除此订单记录？删除后不可恢复。')) return;
  /* 同时从服务器删除 */
  await api(`/orders/${orderId}`, { method: 'DELETE' });
  let history = loadOrderHistory();
  history = history.filter(o => o.id !== orderId);
  saveOrderHistory(history);
  renderOrdersList();
  showToast('订单已删除');
}

function formatOrderDate(iso) {
  const d = new Date(iso + (iso && iso.endsWith('Z') ? '' : 'Z'));
  return d.toLocaleDateString('zh-CN') + ' ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

/* ========================================
   页面切换
   ======================================== */
function showPage(target) {
  pageBrowse.classList.remove('slide-out-left');
  pageDetail.classList.remove('detail-active');
  pageCart.classList.remove('cart-active');
  pageSuccess.classList.remove('success-active');
  pageOrders.classList.remove('orders-active');
  pageCheckout.classList.remove('checkout-active');
  pageAccount.classList.remove('account-active');

  if (target === 'browse') {
    renderProductGrid();
    if (cart.length > 0) cartBar.classList.remove('hidden');
  } else if (target === 'cart') {
    pageBrowse.classList.add('slide-out-left');
    pageCart.classList.add('cart-active');
    cartBar.classList.add('hidden');
    renderCartBody();
  } else if (target === 'checkout') {
    pageBrowse.classList.add('slide-out-left');
    pageCheckout.classList.add('checkout-active');
    cartBar.classList.add('hidden');
  } else if (target === 'success') {
    pageBrowse.classList.add('slide-out-left');
    pageSuccess.classList.add('success-active');
    cartBar.classList.add('hidden');
  } else if (target === 'orders') {
    pageBrowse.classList.add('slide-out-left');
    pageOrders.classList.add('orders-active');
    cartBar.classList.add('hidden');
    renderOrdersList();
    /* 进入订单页时从服务器同步最新状态 */
    syncAllOrders();
    /* 如果已登录，从服务器拉取用户订单 */
    if (currentUser) syncOrdersFromServer();
  } else if (target === 'account') {
    pageBrowse.classList.add('slide-out-left');
    pageAccount.classList.add('account-active');
    cartBar.classList.add('hidden');
    updateAccountUI();
  }
}

/* ========================================
   分类筛选
   ======================================== */
async function loadCategories() {
  const data = await api('/categories');
  if (data && Array.isArray(data)) {
    categories = data.map(c => (typeof c === 'string' ? c : (c.name || ''))).filter(Boolean);
    renderFilters();
  }
}

function renderFilters() {
  let html = `<button class="filter-pill${currentFilter === 'All' ? ' active' : ''}" data-cat="All">全部</button>`;
  categories.forEach(name => {
    html += `<button class="filter-pill${currentFilter === name ? ' active' : ''}" data-cat="${name}">${name}</button>`;
  });
  filterRow.innerHTML = html;
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
   Toast
   ======================================== */
let toastTimer = null;
function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2000);
}

/* ========================================
   ===== 实时聊天功能 =====
   ======================================== */
function getChatSessionId() {
  let id = localStorage.getItem(CHAT_SESSION_KEY);
  if (!id) {
    id = 'cust_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    localStorage.setItem(CHAT_SESSION_KEY, id);
  }
  return id;
}
function loadChatMessages() {
  const saved = localStorage.getItem(CHAT_MSGS_KEY);
  if (saved) { try { chatMessages = JSON.parse(saved); } catch (e) { chatMessages = []; } }
}
function saveChatMessages() {
  localStorage.setItem(CHAT_MSGS_KEY, JSON.stringify(chatMessages.slice(-200)));
}
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
function renderChatMessages() {
  if (chatMessages.length === 0) {
    chatMessagesEl.innerHTML = `<div style="text-align:center;padding:40px 0;color:#999"><div style="font-size:36px;margin-bottom:12px">💬</div><p style="font-size:14px;font-weight:600;color:#666">暂无消息</p><p style="font-size:12px;margin-top:4px">向商家发送一条消息开始对话</p></div>`;
    return;
  }
  chatMessagesEl.innerHTML = chatMessages.map(msg => {
    const isSent = msg.from === 'customer';
    const time = new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    return `<div class="chat-message ${isSent ? 'sent' : 'received'}">${escapeHtml(msg.text)}<div class="chat-message-time">${time}</div></div>`;
  }).join('');
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}
function toggleChat() {
  chatOpen = !chatOpen;
  if (chatOpen) {
    chatOverlay.classList.add('active');
    chatUnreadCount = 0;
    updateChatBadge();
    renderChatMessages();
    setTimeout(() => chatInput.focus(), 300);
  } else {
    chatOverlay.classList.remove('active');
  }
}
function updateChatBadge() {
  if (chatUnreadCount > 0) {
    chatFabBadge.textContent = chatUnreadCount > 99 ? '99+' : chatUnreadCount;
    chatFabBadge.style.display = 'flex';
    chatFabBadge.classList.add('pop');
    setTimeout(() => chatFabBadge.classList.remove('pop'), 400);
  } else {
    chatFabBadge.style.display = 'none';
  }
}
function updateChatFabPosition() {
  if (!cartBar.classList.contains('hidden')) chatFab.classList.add('with-cart');
  else chatFab.classList.remove('with-cart');
}
function sendChatMessage() {
  const text = chatInput.value.trim();
  if (!text) return;
  const msg = { from: 'customer', text: text, timestamp: new Date().toISOString() };
  chatMessages.push(msg);
  saveChatMessages();
  renderChatMessages();
  chatInput.value = '';
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'chat_send', data: { sessionId: getChatSessionId(), text: text, timestamp: msg.timestamp } }));
  } else {
    api('/chat/send', { method: 'POST', body: JSON.stringify({ sessionId: getChatSessionId(), text: text }) });
  }
}
chatInput.addEventListener('keydown', function(e) {
  if (e.key === 'Enter') { e.preventDefault(); sendChatMessage(); }
});

/* ========================================
   初始化
   ======================================== */
loadCart();
loadChatMessages();
loadCategories();
renderProductGrid();
updateCartBar();
loadProducts();
connectWS();

/* 加载用户会话 */
currentUser = loadUser();
if (currentUser) {
  /* 验证 token 是否有效 */
  api('/verify-token', {
    method: 'POST',
    body: JSON.stringify({ token: currentUser.token })
  }).then(result => {
    if (result && result.valid) {
      currentUser = { ...currentUser, ...result.user };
      saveUser(currentUser);
      updateAccountUI();
      /* 登录有效，从服务器同步订单 */
      syncOrdersFromServer();
    } else {
      /* token 失效，清除 */
      clearUser();
      updateAccountUI();
    }
  });
} else {
  updateAccountUI();
}

/* 启动时同步一次订单状态 */
syncAllOrders();

/* 每30秒轮询一次订单状态（WebSocket 的后备方案） */
setInterval(syncAllOrders, 30000);
