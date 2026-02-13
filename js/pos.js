// ============================================================
// POS CAFETERÍA - Lógica Principal
// ============================================================

// ─── ESTADO GLOBAL ───
let currentSale = [];
let allProducts = [];
let allCategories = [];
let currentCategoryFilter = 'all';
let selectedPaymentMethod = null;
let cartExpanded = false;

// ─── INICIALIZACIÓN ───
document.addEventListener('DOMContentLoaded', async () => {
  showLoading(true);
  await loadCategories();
  await loadProducts();
  renderCategoryFilter();
  renderProducts();
  setupCartToggle();
  showLoading(false);
});

// ─── CARGA DE DATOS ───
async function loadCategories() {
  try {
    const { data, error } = await supabaseClient
      .from('categories')
      .select('*')
      .order('name');
    if (error) throw error;
    allCategories = data || [];
  } catch (e) {
    console.error('Error cargando categorías:', e);
  }
}

async function loadProducts() {
  try {
    const { data, error } = await supabaseClient
      .from('products')
      .select('*, categories(name)')
      .eq('active', true)
      .order('name');
    if (error) throw error;
    allProducts = data || [];
    // Calcular stock de cada producto
    await recalculateStockAll();
  } catch (e) {
    console.error('Error cargando productos:', e);
    showToast('Error cargando productos', 'error');
  }
}

// ─── STOCK DINÁMICO ───
async function recalculateStockAll() {
  const today = getTodayDate();
  try {
    // Obtener producción del día para todos los productos
    const { data: production } = await supabaseClient
      .from('daily_production')
      .select('product_id, quantity_added')
      .eq('date', today);

    // Obtener ventas del día para todos los productos
    const { data: soldItems } = await supabaseClient
      .from('sale_items')
      .select('product_id, quantity, sales!inner(created_at)')
      .gte('sales.created_at', `${today}T00:00:00`)
      .lte('sales.created_at', `${today}T23:59:59`);

    // Agrupar por producto
    const productionMap = {};
    (production || []).forEach(r => {
      productionMap[r.product_id] = (productionMap[r.product_id] || 0) + r.quantity_added;
    });
    const soldMap = {};
    (soldItems || []).forEach(r => {
      soldMap[r.product_id] = (soldMap[r.product_id] || 0) + r.quantity;
    });

    // Asignar stock a cada producto
    allProducts.forEach(p => {
      const produced = productionMap[p.id] || 0;
      const sold = soldMap[p.id] || 0;
      p.stock = Math.max(0, produced - sold);
    });
  } catch (e) {
    console.error('Error calculando stock:', e);
    allProducts.forEach(p => p.stock = 0);
  }
}

async function recalculateStock(productId) {
  const today = getTodayDate();
  try {
    const { data: production } = await supabaseClient
      .from('daily_production')
      .select('quantity_added')
      .eq('product_id', productId)
      .eq('date', today);

    const { data: soldItems } = await supabaseClient
      .from('sale_items')
      .select('quantity, sales!inner(created_at)')
      .eq('product_id', productId)
      .gte('sales.created_at', `${today}T00:00:00`)
      .lte('sales.created_at', `${today}T23:59:59`);

    const produced = (production || []).reduce((s, r) => s + r.quantity_added, 0);
    const sold = (soldItems || []).reduce((s, r) => s + r.quantity, 0);
    const stock = Math.max(0, produced - sold);

    const product = allProducts.find(p => p.id === productId);
    if (product) product.stock = stock;
    return stock;
  } catch (e) {
    return 0;
  }
}

// ─── RENDER CATEGORÍAS ───
function renderCategoryFilter() {
  const bar = document.getElementById('categoriesBar');
  if (!bar) return;
  bar.innerHTML = `<button class="cat-btn active" onclick="filterCategory('all')">🍽️ Todos</button>`;
  allCategories.forEach(cat => {
    bar.innerHTML += `<button class="cat-btn" onclick="filterCategory('${cat.id}')">${cat.name}</button>`;
  });
}

function filterCategory(catId) {
  currentCategoryFilter = catId;
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
  renderProducts();
}

// ─── RENDER PRODUCTOS ───
function renderProducts() {
  const grid = document.getElementById('productsGrid');
  if (!grid) return;

  let products = allProducts;
  if (currentCategoryFilter !== 'all') {
    products = allProducts.filter(p => p.category_id === currentCategoryFilter);
  }

  if (products.length === 0) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-muted)">No hay productos en esta categoría</div>`;
    return;
  }

  grid.innerHTML = products.map(p => {
    const stock = p.stock ?? 0;
    const stockClass = stock === 0 ? 'empty' : stock <= 3 ? 'low' : '';
    const stockLabel = stock === 0 ? '⛔ Agotado' : stock <= 3 ? `⚠️ Solo ${stock}` : `✅ ${stock} disp.`;
    const outClass = stock === 0 ? 'out-of-stock' : '';
    const imgHtml = p.image_url
      ? `<img src="${p.image_url}" class="product-img" alt="${p.name}" loading="lazy">`
      : `<div class="product-img-placeholder">☕</div>`;
    return `
      <div class="product-card ${outClass}" onclick="${stock > 0 ? `addProductToSale('${p.id}')` : 'void(0)'}">
        ${imgHtml}
        <div class="product-info">
          <div class="product-name">${p.name}</div>
          <div class="product-price">${formatCurrency(p.price)}</div>
          <div class="product-stock ${stockClass}">${stockLabel}</div>
        </div>
      </div>`;
  }).join('');
}

// ─── CARRITO ───
function addProductToSale(productId) {
  const product = allProducts.find(p => p.id === productId);
  if (!product || product.stock <= 0) return;

  const existing = currentSale.find(i => i.productId === productId);
  if (existing) {
    if (existing.quantity >= product.stock) {
      showToast(`Solo hay ${product.stock} disponibles`, 'warning');
      return;
    }
    existing.quantity++;
    existing.subtotal = existing.quantity * existing.unitPrice;
  } else {
    currentSale.push({
      productId,
      name: product.name,
      unitPrice: product.price,
      quantity: 1,
      subtotal: product.price,
      imageUrl: product.image_url
    });
  }

  renderCart();
  updateCartBadge();
  // Auto-expand cart on mobile
  if (!cartExpanded && window.innerWidth < 900) {
    toggleCart(true);
  }
}

function updateCartItemQuantity(productId, delta) {
  const item = currentSale.find(i => i.productId === productId);
  if (!item) return;
  const product = allProducts.find(p => p.id === productId);
  const newQty = item.quantity + delta;

  if (newQty <= 0) {
    removeFromCart(productId);
    return;
  }
  if (product && newQty > product.stock) {
    showToast(`Solo hay ${product.stock} disponibles`, 'warning');
    return;
  }
  item.quantity = newQty;
  item.subtotal = item.quantity * item.unitPrice;
  renderCart();
  updateCartBadge();
}

function removeFromCart(productId) {
  currentSale = currentSale.filter(i => i.productId !== productId);
  renderCart();
  updateCartBadge();
}

function calculateTotal() {
  return currentSale.reduce((sum, item) => sum + item.subtotal, 0);
}

function renderCart() {
  const itemsContainer = document.getElementById('cartItems');
  const totalEl = document.getElementById('cartTotal');
  const finalizeBtn = document.getElementById('finalizeBtn');
  if (!itemsContainer) return;

  if (currentSale.length === 0) {
    itemsContainer.innerHTML = `
      <div class="cart-empty">
        <div class="cart-empty-icon">🛒</div>
        <p>Agrega productos para comenzar</p>
      </div>`;
    if (finalizeBtn) finalizeBtn.disabled = true;
  } else {
    itemsContainer.innerHTML = currentSale.map(item => `
      <div class="cart-item">
        ${item.imageUrl
          ? `<img src="${item.imageUrl}" class="cart-item-img" alt="${item.name}">`
          : `<div class="cart-item-img" style="background:#f0f0f0;display:flex;align-items:center;justify-content:center;font-size:1.2rem">☕</div>`}
        <div class="cart-item-info">
          <div class="cart-item-name">${item.name}</div>
          <div class="cart-item-price">${formatCurrency(item.unitPrice)} c/u</div>
        </div>
        <div class="cart-item-controls">
          <button class="qty-btn" onclick="updateCartItemQuantity('${item.productId}', -1)">−</button>
          <span class="qty-display">${item.quantity}</span>
          <button class="qty-btn" onclick="updateCartItemQuantity('${item.productId}', 1)">+</button>
        </div>
        <div class="cart-item-subtotal">${formatCurrency(item.subtotal)}</div>
        <span class="cart-item-remove" onclick="removeFromCart('${item.productId}')">✕</span>
      </div>`).join('');
    if (finalizeBtn) finalizeBtn.disabled = false;
  }

  if (totalEl) totalEl.textContent = formatCurrency(calculateTotal());
}

function updateCartBadge() {
  const badge = document.getElementById('cartBadge');
  if (badge) {
    const count = currentSale.reduce((s, i) => s + i.quantity, 0);
    badge.textContent = count;
    badge.style.display = count > 0 ? 'inline' : 'none';
  }
}

function setupCartToggle() {
  const header = document.getElementById('cartHeader');
  if (header) header.addEventListener('click', () => toggleCart());
}

function toggleCart(forceExpand) {
  if (window.innerWidth >= 900) return; // en desktop no colapsar
  const panel = document.getElementById('cartPanel');
  if (!panel) return;
  cartExpanded = forceExpand !== undefined ? forceExpand : !cartExpanded;
  panel.classList.toggle('expanded', cartExpanded);
  const icon = document.getElementById('cartToggleIcon');
  if (icon) icon.textContent = cartExpanded ? '▼' : '▲';
}

// ─── FINALIZAR VENTA ───
function openFinalizeModal() {
  if (currentSale.length === 0) return;
  selectedPaymentMethod = null;
  const modal = document.getElementById('modalFinalize');
  const totalDisplay = document.getElementById('modalTotalDisplay');
  if (totalDisplay) totalDisplay.textContent = formatCurrency(calculateTotal());
  document.querySelectorAll('.payment-btn').forEach(b => b.classList.remove('selected'));
  document.getElementById('confirmSaleBtn').disabled = true;
  if (modal) modal.classList.remove('d-none');
}

function closeFinalizeModal() {
  document.getElementById('modalFinalize').classList.add('d-none');
}

function selectPaymentMethod(method) {
  selectedPaymentMethod = method;
  document.querySelectorAll('.payment-btn').forEach(b => {
    b.classList.toggle('selected', b.dataset.method === method);
  });
  document.getElementById('confirmSaleBtn').disabled = false;
}

async function finalizeSale() {
  if (!selectedPaymentMethod || currentSale.length === 0) return;
  const btn = document.getElementById('confirmSaleBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner" style="width:18px;height:18px;border-width:2px;margin:0"></span> Procesando...';

  try {
    const total = calculateTotal();
    // 1. Guardar venta principal
    const { data: sale, error: saleError } = await supabaseClient
      .from('sales')
      .insert({ total_amount: total, payment_method: selectedPaymentMethod })
      .select()
      .single();
    if (saleError) throw saleError;

    // 2. Guardar items
    const items = currentSale.map(item => ({
      sale_id: sale.id,
      product_id: item.productId,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      subtotal: item.subtotal
    }));
    const { error: itemsError } = await supabaseClient.from('sale_items').insert(items);
    if (itemsError) throw itemsError;

    // 3. Actualizar stock local
    for (const item of currentSale) {
      const product = allProducts.find(p => p.id === item.productId);
      if (product) product.stock = Math.max(0, product.stock - item.quantity);
    }

    // 4. Vaciar carrito y actualizar UI
    currentSale = [];
    renderCart();
    updateCartBadge();
    renderProducts();
    closeFinalizeModal();
    showToast(`✅ Venta de ${formatCurrency(total)} registrada`, 'success');

  } catch (e) {
    console.error('Error finalizando venta:', e);
    showToast('Error al guardar la venta', 'error');
    btn.disabled = false;
    btn.innerHTML = '✅ Confirmar Venta';
  }
}

// ─── PRODUCCIÓN ───
async function openProductionPage() {
  window.location.href = 'produccion.html';
}

// ─── UTILIDADES ───
function formatCurrency(amount) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(amount);
}

function getTodayDate() {
  return new Date().toISOString().split('T')[0];
}

function showToast(message, type = 'success', duration = 3000) {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; setTimeout(() => toast.remove(), 300); }, duration);
}

function showLoading(show) {
  const spinner = document.getElementById('globalSpinner');
  if (spinner) spinner.style.display = show ? 'flex' : 'none';
}
