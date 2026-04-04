/**
 * admin.js — Admin CMS Dashboard logic
 * 
 */

(() => {
    const sb = window.supabaseClient;
    let adminUser = null;

    // DOM
    const loginWrapper = document.getElementById('admin-login');
    const adminApp = document.getElementById('admin-app');

    // ===========================
    // Init
    // ===========================

    window.addEventListener('DOMContentLoaded', async () => {
        const { data: { session } } = await sb.auth.getSession();

        if (!session) {
            window.location.href = '/login';
            return;
        }

        try {
            const { data, error } = await sb.from('profiles').select('role').eq('id', session.user.id).single();
            if (error || data?.role !== 'admin') {
                alert('Unauthorized: You must be an administrator to view this page.');
                window.location.href = '/';
                return;
            }
            
            adminUser = session.user;
            showDashboard();
        } catch (e) {
            console.error(e);
            window.location.href = '/';
        }

        sb.auth.onAuthStateChange(async (event, session) => {
            if (event === 'SIGNED_OUT' || !session) {
                adminUser = null;
                window.location.href = '/login';
            }
        });
    });

    // ===========================
    // Auth - Dashboard only
    // ===========================

    function showDashboard() {
        if (adminApp) adminApp.style.display = 'flex';
        
        if (adminUser) {
            const name = adminUser.user_metadata?.full_name || adminUser.email.split('@')[0];
            const nameEl = document.getElementById('admin-name');
            const avatarEl = document.getElementById('admin-avatar');
            if (nameEl) nameEl.textContent = name;
            if (avatarEl) avatarEl.textContent = name.charAt(0).toUpperCase();
        }

        // Load default tab
        switchAdminTab('dashboard');
    }

    window.adminLogout = async function () {
        await sb.auth.signOut();
        window.location.href = '/login';
    };

    // API Helper
    // ===========================

    async function adminApi(endpoint, method = 'GET', body = null) {
        if (!adminUser) throw new Error('Not authenticated');

        const { data: { session } } = await sb.auth.getSession();
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`
        };

        const options = { method, headers };
        if (body) options.body = JSON.stringify(body);

        let response;
        try {
            response = await fetch(endpoint, options);
        } catch (netErr) {
            throw new Error(`A network error occurred while accessing the server.`);
        }

        let data;
        try {
            data = await response.json();
        } catch (parseErr) {
            if (!response.ok) {
                throw new Error(`An unknown error occurred while communicating with the server (Status: ${response.status}).`);
            }
            throw new Error(`An unknown error occurred while parsing the server's response.`);
        }

        if (!response.ok) {
            throw new Error(data.error || `An unknown error occurred while communicating with the server (Status: ${response.status}).`);
        }
        return data;
    }

    // ===========================
    // Tab Navigation
    // ===========================

    window.switchAdminTab = function (tab) {
        // Update nav items
        document.querySelectorAll('.admin-nav-item').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });

        // Show/hide tabs
        document.querySelectorAll('.admin-tab').forEach(section => {
            section.style.display = 'none';
        });
        const targetTab = document.getElementById(`tab-${tab}`);
        if (targetTab) targetTab.style.display = 'block';

        // Update page title
        const titles = { dashboard: 'Dashboard', products: 'Products', orders: 'Orders', coupons: 'Coupons' };
        document.getElementById('admin-page-title').textContent = titles[tab] || 'Dashboard';

        // Close mobile sidebar if open
        const sidebar = document.getElementById('admin-sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        if (sidebar && sidebar.classList.contains('open')) {
            sidebar.classList.remove('open');
            overlay.classList.remove('active');
        }

        // Load data
        if (tab === 'dashboard') loadDashboardStats();
        if (tab === 'products') loadProducts();
        if (tab === 'orders') loadOrders();
        if (tab === 'coupons') loadCoupons();

        // Close mobile sidebar
        document.getElementById('admin-sidebar').classList.remove('open');
        document.getElementById('sidebar-overlay').classList.remove('active');
    };

    // Mobile sidebar toggle
    window.toggleAdminSidebar = function () {
        const sidebar = document.getElementById('admin-sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        sidebar.classList.toggle('open');
        overlay.classList.toggle('active');
    };

    // ===========================
    // Dashboard Stats
    // ===========================

    async function loadDashboardStats() {
        try {
            const stats = await adminApi('/api/admin/stats');

            document.getElementById('stat-sales').textContent = `Rs. ${parseFloat(stats.total_sales).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
            document.getElementById('stat-orders').textContent = stats.total_orders;
            document.getElementById('stat-pending').textContent = stats.pending_orders;
            document.getElementById('stat-lowstock').textContent = stats.low_stock_count;
            document.getElementById('stat-products').textContent = stats.total_products;
        } catch (err) {
            showToast(`An unknown error occurred while loading dashboard: ${err.message}`, 'error');
        }
    }

    // ===========================
    // Product Management
    // ===========================

    async function loadProducts() {
        const tbody = document.getElementById('admin-product-list');
        try {
            const products = await adminApi('/api/admin/products');
            tbody.innerHTML = '';

            if (!products || products.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><div class="empty-icon">📦</div><p>No products yet. Add your first one!</p></td></tr>';
                return;
            }

            products.forEach(p => {
                const tr = document.createElement('tr');
                const isActive = p.is_active !== false;
                tr.innerHTML = `
                    <td><img class="table-product-img" src="${p.image_url || '/static/fallback.svg'}" alt="" onerror="this.onerror=null;this.src='/static/fallback.svg';"></td>
                    <td><strong>${escapeHtml(p.title)}</strong></td>
                    <td>Rs. ${parseFloat(p.price).toFixed(2)}</td>
                    <td>${p.stock ?? 0}</td>
                    <td><span class="status-badge ${isActive ? 'active' : 'inactive'}">${isActive ? 'Active' : 'Inactive'}</span></td>
                    <td>
                        <div class="table-actions">
                            <button class="btn btn-secondary btn-sm" onclick='editProduct(${JSON.stringify(p).replace(/'/g, "&#39;")})'>Edit</button>
                            <button class="btn btn-danger btn-sm" onclick="deleteProduct('${p.id}')">Delete</button>
                        </div>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        } catch (err) {
            tbody.innerHTML = `<tr><td colspan="6" style="color:var(--error);padding:var(--space-3);">An unknown error occurred while loading products: ${escapeHtml(err.message)}</td></tr>`;
        }
    }

    window.openProductModal = function () {
        document.getElementById('product-form').reset();
        document.getElementById('prod-id').value = '';
        document.getElementById('product-modal-title').textContent = 'Add Product';
        document.getElementById('prod-active').value = 'true';

        // Clear image preview
        const preview = document.getElementById('prod-image-preview');
        preview.classList.remove('has-image');

        document.getElementById('product-modal').classList.add('active');
        document.getElementById('product-modal-overlay').classList.add('active');
        document.getElementById('prod-title')?.focus();
    };

    window.closeProductModal = function () {
        document.getElementById('product-modal').classList.remove('active');
        document.getElementById('product-modal-overlay').classList.remove('active');
    };

    window.editProduct = function (product) {
        document.getElementById('prod-id').value = product.id;
        document.getElementById('prod-title').value = product.title;
        document.getElementById('prod-desc').value = product.description || '';
        document.getElementById('prod-price').value = product.price;
        document.getElementById('prod-image').value = product.image_url || '';
        document.getElementById('prod-images').value = (product.images || []).join(', ');
        document.getElementById('prod-sizes').value = (product.sizes || []).join(', ');
        document.getElementById('prod-stock').value = product.stock || 0;
        document.getElementById('prod-active').value = product.is_active !== false ? 'true' : 'false';

        document.getElementById('product-modal-title').textContent = 'Edit Product';

        // Show image preview if URL exists
        if (product.image_url) {
            previewProductImage(product.image_url);
        }

        document.getElementById('product-modal').classList.add('active');
        document.getElementById('product-modal-overlay').classList.add('active');
    };

    window.previewProductImage = function (url) {
        const preview = document.getElementById('prod-image-preview');
        const img = document.getElementById('prod-preview-img');

        if (url && url.trim()) {
            img.src = url;
            preview.classList.add('has-image');
        } else {
            preview.classList.remove('has-image');
        }
    };

    window.handleProductSubmit = async function (e) {
        e.preventDefault();
        const btn = document.getElementById('product-submit-btn');
        const originalText = btn.textContent;
        btn.textContent = 'Saving...';
        btn.disabled = true;

        const id = document.getElementById('prod-id').value;
        const imagesStr = document.getElementById('prod-images').value;
        const sizesStr = document.getElementById('prod-sizes').value;
        
        const data = {
            title: document.getElementById('prod-title').value,
            description: document.getElementById('prod-desc').value,
            price: parseFloat(document.getElementById('prod-price').value),
            image_url: document.getElementById('prod-image').value,
            images: imagesStr ? imagesStr.split(',').map(s => s.trim()).filter(Boolean) : [],
            sizes: sizesStr ? sizesStr.split(',').map(s => s.trim()).filter(Boolean) : [],
            stock: parseInt(document.getElementById('prod-stock').value, 10),
            is_active: document.getElementById('prod-active').value === 'true'
        };

        try {
            if (id) {
                await adminApi(`/api/admin/products/${id}`, 'PUT', data);
                showToast('Product updated successfully.', 'success');
            } else {
                await adminApi('/api/admin/products', 'POST', data);
                showToast('Product created successfully.', 'success');
            }
            closeProductModal();
            loadProducts();
        } catch (err) {
            showToast(`An unknown error occurred while saving the product: ${err.message}`, 'error');
        } finally {
            btn.textContent = originalText;
            btn.disabled = false;
        }
    };

    window.deleteProduct = async function (id) {
        if (!confirm('Are you sure you want to delete this product?')) return;

        try {
            await adminApi(`/api/admin/products/${id}`, 'DELETE');
            showToast('Product deleted.', 'success');
            loadProducts();
        } catch (err) {
            showToast(`An unknown error occurred while deleting: ${err.message}`, 'error');
        }
    };

    // ===========================
    // Order Management
    // ===========================

    let allOrders = [];
    async function loadOrders() {
        const tbody = document.getElementById('admin-order-list');
        try {
            const orders = await adminApi('/api/admin/orders');
            allOrders = orders || [];
            renderOrders();
        } catch (err) {
            const tbody = document.getElementById('admin-order-list');
            tbody.innerHTML = `<tr><td colspan="6" style="color:var(--error);padding:var(--space-3);">An unknown error occurred while loading orders: ${escapeHtml(err.message)}</td></tr>`;
        }
    }

    window.filterOrders = function() {
        renderOrders();
    };

    function renderOrders() {
        const tbody = document.getElementById('admin-order-list');
        const searchTerm = document.getElementById('order-search-input') ? document.getElementById('order-search-input').value.toLowerCase() : '';
        
        let filtered = allOrders;
        if (searchTerm) {
            filtered = allOrders.filter(o => {
                const orderNum = (o.order_number || '').toLowerCase();
                const oId = (o.id || '').toLowerCase();
                return orderNum.includes(searchTerm) || oId.includes(searchTerm);
            });
        }
        
        tbody.innerHTML = '';

        if (!filtered || filtered.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><div class="empty-icon">🧾</div><p>No orders yet.</p></td></tr>';
                return;
            }

            filtered.forEach(o => {
                const customerName = o.profiles?.full_name || 'Customer';

                const tr = document.createElement('tr');
                tr.style.cursor = 'pointer';
                tr.onclick = () => toggleOrderDetail(o.id, tr);
                tr.innerHTML = `
                    <td style="font-family:monospace;font-size:var(--font-size-xs);">${o.order_number || o.id.substring(0, 4)}</td>
                    <td>
                        <strong>${escapeHtml(customerName)}</strong><br>
                        <small style="color:var(--text-muted);">${o.user_id ? o.user_id.substring(0, 8) + '…' : '—'}</small>
                    </td>
                    <td style="font-size: 0.85rem;">
                        ${o.contact_number ? `📞 ${escapeHtml(o.contact_number)}<br>` : ''}
                        ${o.city ? `${escapeHtml(o.city)}, ${escapeHtml(o.district)}, ${escapeHtml(o.province)}<br>` : ''}
                        ${escapeHtml(o.shipping_address)}
                    </td>
                    <td>
                        <strong>Rs. ${parseFloat(o.total_amount).toFixed(2)}</strong><br>
                        <small style="color:var(--text-muted);">${o.payment_method || 'COD'}</small>
                    </td>
                    <td><span class="status-badge ${o.status}">${o.status}</span></td>
                    <td onclick="event.stopPropagation();">
                        <select class="status-select" onchange="updateOrderStatus('${o.id}', this.value)">
                            <option value="pending" ${o.status === 'pending' ? 'selected' : ''}>Pending</option>
                            <option value="processing" ${o.status === 'processing' ? 'selected' : ''}>Processing</option>
                            <option value="packed" ${o.status === 'packed' ? 'selected' : ' '}>Packed</option>
                                    <option value="shipped" ${o.status === 'shipped' ? 'selected' : ''}>Shipped</option>
                            <option value="delivered" ${o.status === 'delivered' ? 'selected' : ''}>Delivered</option>
                            <option value="cancelled" ${o.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
                        </select>
                    </td>
                `;
                tbody.appendChild(tr);

                // Detail row (hidden by default)
                const detailTr = document.createElement('tr');
                detailTr.className = 'order-detail-row';
                detailTr.id = `order-detail-${o.id}`;
                detailTr.innerHTML = `<td colspan="6"><div class="order-detail-content" id="order-items-${o.id}">Loading items...</div></td>`;
                tbody.appendChild(detailTr);
            });
    }

    async function toggleOrderDetail(orderId, row) {
        const content = document.getElementById(`order-items-${orderId}`);
        if (!content) return;

        if (content.classList.contains('open')) {
            content.classList.remove('open');
            return;
        }

        content.classList.add('open');
        content.innerHTML = 'Loading items...';

        try {
            const items = await adminApi(`/api/admin/orders/${orderId}/items`);

            if (!items || items.length === 0) {
                content.innerHTML = '<p style="color:var(--text-muted);font-size:var(--font-size-sm);">No items found for this order.</p>';
                return;
            }

            let html = '<div class="order-items-list">';
            items.forEach(item => {
                const productTitle = item.products?.title || 'Unknown Product';
                const productImg = item.products?.image_url || '/static/fallback.svg';
                html += `
                    <div class="order-item-row">
                        <img src="${productImg}" alt="" onerror="this.onerror=null;this.src='/static/fallback.svg';">
                        <div class="order-item-info">
                            <strong>${escapeHtml(productTitle)}</strong>
                            ${item.size ? `<span style="font-size: 0.8rem; color: #555; margin-left: 8px;">Size: ${escapeHtml(item.size)}</span>` : ''}
                            <span style="color:var(--text-muted);"> × ${item.quantity}</span>
                        </div>
                        <span class="order-item-price">Rs. ${parseFloat(item.price_at_time).toFixed(2)}</span>
                    </div>
                `;
            });
            html += '</div>';
            content.innerHTML = html;
        } catch (err) {
            content.innerHTML = `<p style="color:var(--error);font-size:var(--font-size-sm);">An unknown error occurred while loading items: ${escapeHtml(err.message)}</p>`;
        }
    }

    window.updateOrderStatus = async function (orderId, newStatus) {
        try {
            await adminApi(`/api/admin/orders/${orderId}`, 'PUT', { status: newStatus });
            showToast(`Order status updated to ${newStatus}.`, 'success');
            loadOrders();
        } catch (err) {
            showToast(`An unknown error occurred while updating status: ${err.message}`, 'error');
            loadOrders();
        }
    };

    // ===========================
    // Keyboard
    // ===========================

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const productModal = document.getElementById('product-modal');
            if (productModal?.classList.contains('active')) {
                closeProductModal();
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


    // ===========================
    // COUPONS
    // ===========================

    async function loadCoupons() {
        const tbody = document.getElementById('admin-coupon-list');
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Loading...</td></tr>';
        
        try {
            const data = await adminApi('/api/admin/coupons');
            if (!data || data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No coupons found.</td></tr>';
                return;
            }
            
            tbody.innerHTML = data.map(c => `
                <tr>
                    <td><strong>${escapeHtml(c.code)}</strong></td>
                    <td>${c.discount_percentage}%</td>
                    <td><span class="status-badge status-${c.is_active ? 'delivered' : 'cancelled'}">${c.is_active ? 'Active' : 'Inactive'}</span></td>
                    <td>${new Date(c.created_at).toLocaleDateString()}</td>
                    <td>
                        <button class="btn btn-sm btn-outline" style="color:red; border-color:red;" onclick="deleteCoupon('${c.id}')">Delete</button>
                    </td>
                </tr>
            `).join('');
        } catch (e) {
            console.error(e);
            tbody.innerHTML = '<tr><td colspan="5" class="empty-state" style="color:red;">Error loading coupons.</td></tr>';
        }
    }

    window.createCoupon = async function() {
        const codeInput = document.getElementById('new-coupon-code');
        const discountInput = document.getElementById('new-coupon-discount');
        
        const code = codeInput.value.trim().toUpperCase();
        const discount_percentage = parseInt(discountInput.value, 10);
        
        if (!code || !discount_percentage || discount_percentage <= 0 || discount_percentage > 100) {
            alert('Please enter a valid code and a discount percentage between 1 and 100.');
            return;
        }

        try {
            const res = await adminApi('/api/admin/coupons', 'POST', { code, discount_percentage, is_active: true });

            if (res.error) throw new Error(res.error);

            codeInput.value = '';
            discountInput.value = '';
            loadCoupons();
            alert('Coupon created successfully!');
        } catch (e) {
            console.error(e);
            alert('Error creating coupon: ' + e.message);
        }
    };

    window.deleteCoupon = async function(id) {
        if (!confirm('Are you sure you want to delete this coupon?')) return;
        
        try {
            const res = await adminApi(`/api/admin/coupons/${id}`, 'DELETE');
            if (res.error) throw new Error(res.error);
            loadCoupons();
        } catch (e) {
            console.error(e);
            alert('Error deleting coupon: ' + e.message);
        }
    };

})();

    window.toggleAdminSidebar = function() {
        const sidebar = document.getElementById('admin-sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        if (sidebar && overlay) {
            sidebar.classList.toggle('open');
            overlay.classList.toggle('active');
        }
    };

    // ===========================
    // Manage Carts
    // ===========================

    let cartTimerIntervalAdmin = null;

