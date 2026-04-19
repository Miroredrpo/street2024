/**
 * store.js — Storefront logic
 * Event-driven architecture with custom DOM events
 * 
 */

(() => {
    // ===========================
    // State
    // ===========================
    let currentUser = null;
    let cartItems = [];
    let cartTimerInterval = null;
    let isLoginMode = true;
    let pendingCartProductId = null; // Product to add after login (frictionless flow)
    let productsCache = [];
    let catalogsCache = [];
    let storefrontRequest = null;
    let storefrontLastFetch = 0;
    const STOREFRONT_TTL_MS = 30000;

    const sb = window.supabaseClient;

    // ===========================
    // DOM References
    // ===========================
    const authBtn = document.getElementById('auth-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const cartBtn = document.getElementById('cart-btn');
    const userGreeting = document.getElementById('user-greeting');
    const userName = document.getElementById('user-name');
    const cartBadge = document.getElementById('cart-count');
    const cartSidebar = document.getElementById('cart-sidebar');
    const cartOverlay = document.getElementById('cart-overlay');
    const cartBody = document.getElementById('cart-body');
    const cartFooter = document.getElementById('cart-footer');

    // ===========================
    // Init
    // ===========================
    window.addEventListener('DOMContentLoaded', async () => {
        const { data: { session } } = await sb.auth.getSession();

        if (session) {
            currentUser = session.user;
            onUserSignedIn();
        } else {
            onUserSignedOut();
        }

        // Listen for auth changes
        sb.auth.onAuthStateChange((event, session) => {
            if (event === 'SIGNED_IN' || event === 'USER_UPDATED' || event === 'INITIAL_SESSION') {
                if (session && session.user) {
                    currentUser = session.user;
                    onUserSignedIn();
                } else {
                    currentUser = null;
                    onUserSignedOut();
                }
            } else if (event === 'SIGNED_OUT') {
                currentUser = null;
                cartItems = [];
                onUserSignedOut();
            }
        });

        // Fetch products on home page
        const catalogSections = document.getElementById('catalog-sections');
        if (catalogSections) {
            loadStorefront();
            loadFeedback();
        }
    });

    // ===========================
    // Auth State Handlers
    // ===========================

    async function onUserSignedIn() {
        if (authBtn) authBtn.style.display = 'none';
        if (logoutBtn) logoutBtn.style.display = 'inline-flex';
        if (userGreeting) userGreeting.style.display = 'inline';
        if (userName) {
            const name = currentUser.user_metadata?.full_name || currentUser.email.split('@')[0];
            userName.textContent = name;
        }

        const ordersLink = document.getElementById('nav-orders-link');
        if (ordersLink) ordersLink.style.display = 'inline-block';

        try {
            const { data, error } = await sb.from('profiles').select('role').eq('id', currentUser.id).single();
            const adminLink = document.getElementById('admin-link');
            if (adminLink) {
                adminLink.style.display = (data?.role === 'admin') ? 'inline-block' : 'none';
            }
        } catch (e) {
            console.error('Error fetching user role:', e);
        }

        closeAuthModal();
        fetchCart();

        // If there's a pending product to add (frictionless cart flow)
        if (pendingCartProductId) {
            const pid = pendingCartProductId;
            pendingCartProductId = null;
            addToCart(pid);
        }
    }

    function onUserSignedOut() {
        if (authBtn) authBtn.style.display = 'inline-flex';
        if (logoutBtn) logoutBtn.style.display = 'none';
        if (userGreeting) userGreeting.style.display = 'none';
        
        const adminLink = document.getElementById('admin-link');
        if (adminLink) adminLink.style.display = 'none';
        const ordersLink = document.getElementById('nav-orders-link');
        if (ordersLink) ordersLink.style.display = 'inline-block';

        updateCartBadge(0);
        renderCartBody();
    }

    // ===========================
    // Auth Modal
    // ===========================

    window.toggleAuthModal = function() { window.location.href="/login"; };

    function closeAuthModal() {
        const modal = document.getElementById('auth-modal');
        const overlay = document.getElementById('auth-overlay');
        if (modal) modal.classList.remove('active');
        if (overlay) overlay.classList.remove('active');
        resetAuthForm();
    }

    window.toggleAuthMode = function () {
        isLoginMode = !isLoginMode;
        document.getElementById('auth-title').textContent = isLoginMode ? 'Log in' : 'Sign up';
        document.getElementById('auth-submit-btn').textContent = isLoginMode ? 'Log in' : 'Create account';
        document.getElementById('auth-toggle-link').textContent = isLoginMode
            ? 'Need an account? Sign up'
            : 'Already have an account? Log in';
        document.getElementById('fullname-group').style.display = isLoginMode ? 'none' : 'block';
        hideAuthError();
    };

    function resetAuthForm() {
        const form = document.getElementById('auth-form');
        if (form) form.reset();
        hideAuthError();
    }

    function showAuthError(msg) {
        const el = document.getElementById('auth-error');
        if (el) { el.textContent = msg; el.style.display = 'block'; }
    }

    function hideAuthError() {
        const el = document.getElementById('auth-error');
        if (el) { el.textContent = ''; el.style.display = 'none'; }
    }

    window.handleAuth = async function (e) {
        e.preventDefault();
        hideAuthError();

        const email = document.getElementById('auth-email').value;
        const password = document.getElementById('auth-password').value;
        const btn = document.getElementById('auth-submit-btn');
        const originalText = btn.textContent;

        btn.textContent = 'Processing...';
        btn.disabled = true;

        try {
            if (isLoginMode) {
                const { error } = await sb.auth.signInWithPassword({ email, password });
                if (error) throw error;
            } else {
                const fullName = document.getElementById('auth-fullname').value;
                const { data, error } = await sb.auth.signUp({
                    email,
                    password,
                    options: { data: { full_name: fullName } }
                });
                if (error) throw error;
                if (data?.user && data?.session === null) {
                    showAuthError('Account created! Check your email to verify.');
                    btn.textContent = originalText;
                    btn.disabled = false;
                    return;
                }
            }
            showToast(isLoginMode ? 'Welcome back!' : 'Account created!', 'success');
        } catch (error) {
            showAuthError(error.message);
            btn.textContent = originalText;
            btn.disabled = false;
        }
    };

    window.logout = async function () {
        try {
            await sb.auth.signOut();
            showToast('Logged out successfully', 'info');
        } catch (e) {
            console.error('Logout error', e);
        }
    };

    // ===========================
    // Products
    // ===========================

    async function loadStorefront() {
        const container = document.getElementById('catalog-sections');
        if (!container) return;

        const now = Date.now();
        if (productsCache.length && now - storefrontLastFetch < STOREFRONT_TTL_MS) {
            renderCatalogBubbles();
            renderProducts(productsCache, container);
            return;
        }

        if (storefrontRequest) {
            await storefrontRequest;
            return;
        }

        try {
            storefrontRequest = Promise.all([
                apiFetch('/api/catalogs'),
                apiFetch('/api/products')
            ]);
            const [catalogs, products] = await storefrontRequest;
            catalogsCache = catalogs || [];
            productsCache = products || [];
            storefrontLastFetch = Date.now();
            renderCatalogBubbles();
            renderProducts(productsCache, container);
        } catch (error) {
            container.innerHTML = `<p style="color:var(--text-muted);text-align:center;padding:var(--space-6);">Failed to load products. Please try again later.</p>`;
            showToast('Connection issue. Please try again.', 'error');
        } finally {
            storefrontRequest = null;
        }
    }

    async function loadFeedback() {
        const container = document.getElementById('feedback-list');
        if (!container) return;

        try {
            const feedback = await apiFetch('/api/feedback');
            if (!feedback || feedback.length === 0) {
                container.innerHTML = '<p style="color:var(--text-muted);text-align:center;">No feedback yet. Check back soon!</p>';
                return;
            }

            const cardsHtml = feedback.map(item => {
                const imageHtml = item.image_url
                    ? `<div class="feedback-image"><img src="${item.image_url}" alt="Customer feedback" loading="lazy" onerror="this.style.display='none';"></div>`
                    : '';
                const nameHtml = item.reviewer_name
                    ? `<div class="feedback-name">${escapeHtml(item.reviewer_name)}</div>`
                    : '<div class="feedback-name">Anonymous</div>';
                return `
                    <div class="feedback-card">
                        ${nameHtml}
                        <div class="feedback-body">${escapeHtml(item.review_text || '')}</div>
                        ${imageHtml}
                    </div>
                `;
            }).join('');

            container.innerHTML = `<div class="feedback-track">${cardsHtml}</div>`;
            initFeedbackCarousel(container, feedback.length);
        } catch (error) {
            container.innerHTML = '<p style="color:var(--text-muted);text-align:center;">Unable to load feedback right now.</p>';
        }
    }

    function initFeedbackCarousel(container, total) {
        const track = container.querySelector('.feedback-track');
        if (!track || total <= 1) return;

        let index = 0;
        const intervalMs = 5000;

        function update() {
            track.style.transform = `translateX(-${index * 100}%)`;
        }

        function next() {
            index = (index + 1) % total;
            update();
        }

        update();
        let timerId = setInterval(next, intervalMs);

        container.addEventListener('mouseenter', () => clearInterval(timerId));
        container.addEventListener('mouseleave', () => {
            clearInterval(timerId);
            timerId = setInterval(next, intervalMs);
        });
    }

    function renderProducts(products, container) {
        container.innerHTML = '';

        if (!products || products.length === 0) {
            container.innerHTML = `<p style="color:var(--text-muted);text-align:center;padding:var(--space-6);">No products available yet. Check back soon!</p>`;
            return;
        }

        const catalogMap = new Map(catalogsCache.map(c => [c.id, c]));
        const grouped = new Map();
        products.forEach(p => {
            const key = p.catalog_id || 'uncategorized';
            if (!grouped.has(key)) grouped.set(key, []);
            grouped.get(key).push(p);
        });

        const orderedKeys = catalogsCache.map(c => c.id);
        if (grouped.has('uncategorized')) orderedKeys.push('uncategorized');

        orderedKeys.forEach(key => {
            const items = grouped.get(key);
            if (!items || items.length === 0) return;

            const catalog = catalogMap.get(key);
            const title = catalog ? catalog.name : 'Other';
            const section = document.createElement('div');
            section.className = 'catalog-section';
            section.id = `catalog-section-${key}`;
            section.innerHTML = `<div class="catalog-section-title">${escapeHtml(title)}</div>`;

            const grid = document.createElement('div');
            grid.className = 'product-grid';

            items.forEach(p => {
                const isOnSale = (parseFloat(p.sale_price || 0) > 0) || (parseFloat(p.sale_price_inr || 0) > 0);
                const basePrice = getBasePrice(p);
                const salePrice = getSalePrice(p);
                const card = document.createElement('div');
                card.className = 'product-card';
                card.innerHTML = `
                    <a href="/product/${p.id}" style="text-decoration:none;color:inherit;">
                        <div class="product-card-image">
                            ${isOnSale ? '<span class="product-sale-badge">On Sale</span>' : ''}
                            <img
                                src="${p.image_url || '/static/fallback.svg'}"
                                alt="${escapeHtml(p.title)}"
                                loading="lazy"
                                onerror="this.onerror=null;this.src='/static/fallback.svg';"
                            >
                        </div>
                        <div class="product-card-body">
                            <div class="product-card-title">${escapeHtml(p.title)}</div>
                            <div class="product-card-price" data-npr="${p.price}" data-inr="${p.price_inr || ''}" data-sale-npr="${p.sale_price || ''}" data-sale-inr="${p.sale_price_inr || ''}">
                                ${isOnSale && salePrice > 0 ? `
                                    <span class="price-original price-strike">${formatCurrency(basePrice)}</span>
                                    <span class="price-sale">${formatCurrency(salePrice)}</span>
                                ` : `${formatCurrency(basePrice)}`}
                                ${p.stock !== null && p.stock <= 0 ? '<span style="color:var(--error);font-size:0.8rem;margin-left:8px;font-weight:600;">(Out of Stock)</span>' : ''}
                                ${p.show_low_stock_label && p.stock !== null && p.stock > 0 && p.stock <= 10 ? `<span style="color:var(--warning);font-size:0.8rem;margin-left:8px;font-weight:600;">(Only ${p.stock} left)</span>` : ''}
                            </div>
                        </div>
                    </a>
                    <div class="product-card-body" style="padding-top:0;">
                        <a href="/product/${p.id}" class="btn btn-primary" style="display: block; text-align: center; text-decoration: none;">
                            View Product
                        </a>
                    </div>
                `;
                grid.appendChild(card);
            });

            section.appendChild(grid);
            container.appendChild(section);
        });

        initScrollReveal();
    }

    function initScrollReveal() {
        const elements = document.querySelectorAll('.product-card, .catalog-section, .pdp-image-col, .pdp-details, .checkout-section, .order-card');
        if (!elements.length || !('IntersectionObserver' in window)) return;

        elements.forEach(el => {
            if (!el.classList.contains('reveal')) {
                el.classList.add('reveal');
            }
        });

        const observer = new IntersectionObserver((entries, obs) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('reveal-in');
                    obs.unobserve(entry.target);
                }
            });
        }, { rootMargin: '0px 0px -10% 0px', threshold: 0.1 });

        elements.forEach(el => {
            if (!el.classList.contains('reveal-in')) {
                observer.observe(el);
            }
        });
    }

    // ===========================
    // Cart
    // ===========================

    window.toggleCart = function () {
        const isOpen = cartSidebar.classList.contains('open');
        if (isOpen) {
            cartSidebar.classList.remove('open');
            cartOverlay.classList.remove('active');
            document.body.style.overflow = '';
        } else {
            cartSidebar.classList.add('open');
            cartOverlay.classList.add('active');
            document.body.style.overflow = 'hidden';
            renderCartBody();

            // Focus trap: focus the close button
            const closeBtn = cartSidebar.querySelector('.cart-close-btn');
            if (closeBtn) closeBtn.focus();
        }
    };

    async function fetchCart() {
        try {
            cartItems = await apiFetch('/api/cart');
            window.dispatchEvent(new CustomEvent('cartUpdated', { detail: cartItems }));
        } catch (error) {
            console.error('Failed to fetch cart:', error);
        }
    }

    // Listen for cart updates
    window.addEventListener('cartUpdated', (e) => {
        const items = e.detail || [];
        const count = items.reduce((sum, item) => sum + item.quantity, 0);
        updateCartBadge(count);
        renderCartBody();
    });

    function updateCartBadge(count) {
        if (!cartBadge) return;
        cartBadge.textContent = count;
        cartBadge.style.display = count > 0 ? 'flex' : 'none';

        // Bounce animation
        cartBadge.classList.remove('bounce');
        void cartBadge.offsetWidth; // Trigger reflow
        if (count > 0) cartBadge.classList.add('bounce');
    }

    function renderCartBody() {
        if (!cartBody) return;

        // Logged in but empty cart
        if (!cartItems || cartItems.length === 0) {
            cartBody.innerHTML = `
                <div class="cart-empty">
                    <div class="empty-icon">🛒</div>
                    <p>Your cart is empty.<br>Let's find something for you.</p>
                    <button class="btn btn-secondary" onclick="toggleCart()" style="margin-top:16px;">Continue Shopping</button>
                </div>
            `;
            if (cartFooter) cartFooter.style.display = 'none';
            return;
        }

        // Has items — render them
        let total = 0;
        let html = '';

        cartItems.forEach(item => {
            const product = item.products;
            if (!product) return;
            const itemTotal = item.quantity * getDisplayPrice(product);
            total += itemTotal;

            const basePrice = getBasePrice(product);
            const salePrice = getSalePrice(product);
            const priceHtml = salePrice && salePrice > 0
                ? `<span class="price-original">${formatCurrency(basePrice)}</span><span class="price-sale">${formatCurrency(salePrice)}</span>`
                : `${formatCurrency(basePrice)}`;

            html += `
                <div class="cart-item">
                    <div class="cart-item-image">
                        <img src="${product.image_url || '/static/fallback.svg'}" alt="${escapeHtml(product.title)}" onerror="this.onerror=null;this.src='/static/fallback.svg';" loading="lazy">
                    </div>
                    <div class="cart-item-details">
                        <div class="cart-item-title">${escapeHtml(product.title)}</div>
                        ${item.size ? `<div class="cart-item-size" style="font-size: var(--font-size-xs); color: var(--text-muted);">Size: ${escapeHtml(item.size)}</div>` : ''}
                        <div class="cart-item-timer highlight-alert" data-expires="${item.expires_at || ''}" style="font-size:var(--font-size-xs); color:var(--info-color); margin-top:4px;"></div>
                        <div class="cart-item-price">${priceHtml}</div>
                    </div>
                    <div class="cart-item-actions">
                        <button class="cart-item-remove" onclick="removeFromCart('${item.id}')" aria-label="Remove item">&times;</button>
                        <div class="cart-item-qty">
                            <button onclick="updateCartQty('${item.id}', ${item.quantity - 1}, ${product.stock})">−</button>
                            <span class="qty">${item.quantity}</span>
                            <button onclick="updateCartQty('${item.id}', ${item.quantity + 1}, ${product.stock})">+</button>
                        </div>
                        <span class="cart-item-total">${formatCurrency(itemTotal)}</span>
                    </div>
                </div>
            `;
        });

        cartBody.innerHTML = html;

        // Show footer with total
        if (cartFooter) {
            cartFooter.style.display = 'block';
            const totalValEl = document.getElementById('cart-total-value');
            if (totalValEl) totalValEl.textContent = formatCurrency(total);
            
            // Re-hide inline checkout if it exists (legacy store checkout)
            const checkoutSec = document.getElementById('checkout-section');
            if (checkoutSec) checkoutSec.style.display = 'none';

            const proceedBtn = document.getElementById('proceed-checkout-btn');
            if (proceedBtn) proceedBtn.style.display = 'block';
        }

        startCartTimers();
    }

    function startCartTimers() {
        if (cartTimerInterval) clearInterval(cartTimerInterval);
        
        function updateTimers() {
            const timers = document.querySelectorAll('.cart-item-timer');
            let needRefresh = false;
            
            timers.forEach(timer => {
                const expiresAt = timer.getAttribute('data-expires');
                if (!expiresAt || expiresAt === 'null' || expiresAt === 'undefined') {
                    timer.textContent = '';
                    return;
                }
                
                const now = new Date();
                const expiry = new Date(expiresAt.replace(/\+00:00$/, 'Z'));
                const diffMs = expiry - now;

                if (diffMs <= 0) {
                    timer.textContent = 'Expired - Refreshing...';
                    timer.style.color = 'var(--error-color)';
                    needRefresh = true;
                } else {
                    const mins = Math.floor(diffMs / 60000);
                    const secs = Math.floor((diffMs % 60000) / 1000);
                    timer.textContent = `Reserved: ${mins}m ${secs}s`;
                    timer.style.color = mins < 2 ? 'var(--error-color)' : 'var(--text-muted)';
                }
            });

            if (needRefresh) {
                // If anything expired, refetch
                fetchCart();
            }
        }
        
        updateTimers();
        cartTimerInterval = setInterval(updateTimers, 1000);
    }

    // In-cart login (frictionless)
    window.cartLogin = async function () {
        const email = document.getElementById('cart-login-email')?.value;
        const password = document.getElementById('cart-login-password')?.value;
        const errorEl = document.getElementById('cart-auth-error');

        if (!email || !password) {
            if (errorEl) { errorEl.textContent = 'Please enter email and password'; errorEl.style.display = 'block'; }
            return;
        }

        try {
            const { error } = await sb.auth.signInWithPassword({ email, password });
            if (error) throw error;
            showToast('Welcome back!', 'success');
        } catch (err) {
            if (errorEl) { errorEl.textContent = err.message; errorEl.style.display = 'block'; }
        }
    };

    // Add to cart
    window.addToCart = async function (productId, size = null) {

        // Get quantity from PDP if available
        const pdpQtyEl = document.getElementById('pdp-qty');
        const quantity = pdpQtyEl ? parseInt(pdpQtyEl.textContent, 10) : 1;

        try {
            await apiFetch('/api/cart', {
                method: 'POST',
                body: JSON.stringify({ product_id: productId, quantity, size })
            });
            await fetchCart();
            
            // Refresh product grid to update Out of Stock tags immediately
            if (document.getElementById('catalog-sections')) {
                loadStorefront();
            }
            // Refresh PDP
            if (window.location.pathname.startsWith('/product/')) {
                let currentPDPStock = document.getElementById('pdp-stock');
                if (currentPDPStock) {
                    let matches = currentPDPStock.textContent.match(/\d+/);
                    let stockVal = matches ? parseInt(matches[0], 10) : (currentPDPStock.textContent.includes('In Stock') ? 11 : 0);
                    
                    let newStock = stockVal - quantity;
                    if (newStock <= 0) {
                        currentPDPStock.innerHTML = '<span class="dot out-of-stock"></span><span>Out of Stock</span>';
                        let addBtn = document.querySelector('.pdp-actions .btn-primary');
                        if (addBtn) {
                            addBtn.disabled = true;
                            addBtn.textContent = 'Out of Stock';
                        }
                    } else if (newStock <= 10) {
                        currentPDPStock.innerHTML = `<span class="dot low-stock"></span><span>Only ${newStock} left</span>`;
                    }
                }
            }

            // Open cart to show the item added
            if (!cartSidebar.classList.contains('open')) {
                toggleCart();
            }
            showToast('Added to cart! Item reserved for 15 minutes.', 'success');
        } catch (error) {
            showToast('Failed to add to cart: ' + error.message, 'error');
        }
    };

    // Update cart quantity
    window.updateCartQty = async function (cartItemId, newQty, maxStock = null) {
        if (newQty < 1) {
            removeFromCart(cartItemId);
            return;
        }

        if (maxStock !== null && newQty > maxStock) {
            showToast(`Only ${maxStock} items available in stock.`, 'error');
            return;
        }

        try {
            await apiFetch(`/api/cart/${cartItemId}`, {
                method: 'PATCH',
                body: JSON.stringify({ quantity: newQty })
            });
            await fetchCart();
        } catch (error) {
            showToast('Failed to update quantity: ' + error.message, 'error');
        }
    };

    // Remove from cart
    window.removeFromCart = async function (cartItemId) {
        try {
            await apiFetch(`/api/cart/${cartItemId}`, { method: 'DELETE' });
            await fetchCart();
            
            // Refresh product grid to update Out of Stock tags immediately
            if (document.getElementById('catalog-sections')) {
                loadStorefront();
            }
            
            // Also refresh PDP if we are on a PDP
            if (window.location.pathname.startsWith('/product/')) {
                window.location.reload(); 
            }

            showToast('Item removed from cart, inventory released.', 'info');
        } catch (error) {
            showToast('Failed to remove item', 'error');
        }
    };

    // Checkout flow
    window.showCheckoutForm = function () {
        if (!cartItems || cartItems.length === 0) return;
        const proceedBtn = document.getElementById('proceed-checkout-btn');
        const checkoutSec = document.getElementById('checkout-section');
        if (proceedBtn) proceedBtn.style.display = 'none';
        if (checkoutSec) checkoutSec.style.display = 'block';
        document.getElementById('shipping-address')?.focus();
    };

    window.handleCheckout = async function () {
        const address = document.getElementById('shipping-address')?.value;
        if (!address || !address.trim()) {
            showToast('Please enter a shipping address.', 'error');
            return;
        }

        const btn = document.getElementById('checkout-btn');
        const originalText = btn.textContent;
        btn.textContent = 'Processing...';
        btn.disabled = true;

        try {
            const response = await apiFetch('/api/checkout', {
                method: 'POST',
                body: JSON.stringify({ shipping_address: address.trim() })
            });

            showToast('Order placed successfully!', 'success');

            // Reset
            const checkoutSec = document.getElementById('checkout-section');
            if (checkoutSec) checkoutSec.style.display = 'none';
            const proceedBtn = document.getElementById('proceed-checkout-btn');
            if (proceedBtn) proceedBtn.style.display = 'block';
            const shippingAddress = document.getElementById('shipping-address');
            if (shippingAddress) shippingAddress.value = '';

            await fetchCart();
            setTimeout(() => toggleCart(), 1500);
        } catch (error) {
            showToast('Checkout failed: ' + error.message, 'error');
        } finally {
            btn.textContent = originalText;
            btn.disabled = false;
        }
    };

    // ===========================
    // Keyboard & Focus
    // ===========================

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            // Close cart
            if (cartSidebar?.classList.contains('open')) {
                toggleCart();
                return;
            }
            // Close auth modal
            const authModal = document.getElementById('auth-modal');
            if (authModal?.classList.contains('active')) {
                toggleAuthModal();
            }
        }
    });

    // Focus trap in cart sidebar
    cartSidebar?.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab') return;
        if (!cartSidebar.classList.contains('open')) return;

        const focusable = cartSidebar.querySelectorAll(
            'button, input, textarea, select, a[href], [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
            if (document.activeElement === first) {
                e.preventDefault();
                last.focus();
            }
        } else {
            if (document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }
    });

    // ===========================
    // Utility
    // ===========================

    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function getSalePrice(product) {
        const currency = localStorage.getItem('preferred_currency') || 'NPR';
        if (currency === 'INR' && product.sale_price_inr) {
            return parseFloat(product.sale_price_inr);
        }
        return parseFloat(product.sale_price);
    }

    function getBasePrice(product) {
        const currency = localStorage.getItem('preferred_currency') || 'NPR';
        if (currency === 'INR' && product.price_inr) {
            return parseFloat(product.price_inr);
        }
        return parseFloat(product.price);
    }

    function getDisplayPrice(product) {
        const salePrice = getSalePrice(product);
        if (salePrice && salePrice > 0) {
            return salePrice;
        }
        return getBasePrice(product);
    }

    function formatCurrency(amount) {
        const currency = localStorage.getItem('preferred_currency') || 'NPR';
        const value = Number(amount || 0).toFixed(2);
        return currency === 'INR' ? `₹${value}` : `Rs. ${value}`;
    }

    window.formatCurrency = formatCurrency;

    function renderCatalogBubbles() {
        const bubbleContainer = document.getElementById('catalog-bubbles');
        if (!bubbleContainer) return;

        if (!catalogsCache || catalogsCache.length === 0) {
            bubbleContainer.innerHTML = '';
            return;
        }

        bubbleContainer.innerHTML = catalogsCache.map(c => `
            <div class="catalog-bubble" data-target="catalog-section-${c.id}">${escapeHtml(c.name)}</div>
        `).join('');

        bubbleContainer.querySelectorAll('.catalog-bubble').forEach(bubble => {
            bubble.addEventListener('click', () => {
                const targetId = bubble.getAttribute('data-target');
                const target = document.getElementById(targetId);
                if (target) {
                    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            });
        });
    }

})();

// --- Currency Switcher Logic ---
document.addEventListener('DOMContentLoaded', () => {
    const currencySelect = document.getElementById('currency-select');
    if (currencySelect) {
        const savedCurrency = localStorage.getItem('preferred_currency') || 'NPR';
        currencySelect.value = savedCurrency;

        currencySelect.addEventListener('change', (e) => {
            localStorage.setItem('preferred_currency', e.target.value);
            window.location.reload();
        });
    }
});

// Helper for formatting prices (can be used where products are rendered)
window.formatPrice = (nprPrice, inrPrice, saleNpr, saleInr) => {
    const currency = localStorage.getItem('preferred_currency') || 'NPR';
    const base = currency === 'INR' && inrPrice ? Number(inrPrice) : Number(nprPrice);
    const sale = currency === 'INR' && saleInr ? Number(saleInr) : Number(saleNpr);
    if (sale && sale > 0) {
        return { base, sale };
    }
    return { base, sale: null };
};

// --- Update PDP price dynamically ---
document.addEventListener('DOMContentLoaded', () => {
    const pdpPriceDisplay = document.getElementById('pdp-price-display');
    if (pdpPriceDisplay) {
        const npr = pdpPriceDisplay.getAttribute('data-npr');
        const inr = pdpPriceDisplay.getAttribute('data-inr');
        const saleNpr = pdpPriceDisplay.getAttribute('data-sale-npr');
        const saleInr = pdpPriceDisplay.getAttribute('data-sale-inr');
        if (window.formatPrice && npr) {
            const priceData = window.formatPrice(npr, inr, saleNpr, saleInr);
            const baseEl = pdpPriceDisplay.querySelector('.price-original');
            const saleEl = pdpPriceDisplay.querySelector('.price-sale');
            if (priceData.sale && saleEl && baseEl) {
                baseEl.textContent = window.formatCurrency(priceData.base);
                saleEl.textContent = window.formatCurrency(priceData.sale);
                baseEl.style.display = 'inline-flex';
                saleEl.style.display = 'inline-flex';
                baseEl.classList.add('price-strike');
            } else if (baseEl) {
                baseEl.textContent = window.formatCurrency(priceData.base);
                baseEl.classList.remove('price-strike');
                if (saleEl) saleEl.style.display = 'none';
            }
        }
    }
});
