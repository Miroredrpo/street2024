/**
 * admin.js — Admin CMS Dashboard logic
 * 
 */

(() => {
    const sb = window.supabaseClient;
    let adminUser = null;
    let catalogsCache = [];

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
        const titles = { dashboard: 'Dashboard', products: 'Products', orders: 'Orders', catalogs: 'Catalogs', coupons: 'Coupons', reviews: 'Reviews' };
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
        if (tab === 'dashboard') loadFeedback();
        if (tab === 'products') loadProducts();
        if (tab === 'orders') loadOrders();
        if (tab === 'coupons') loadCoupons();
        if (tab === 'catalogs') loadCatalogs();
        if (tab === 'reviews') loadReviews();

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
    // Customer Feedback
    // ===========================

    async function loadFeedback() {
        const tbody = document.getElementById('admin-feedback-list');
        if (!tbody) return;
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Loading...</td></tr>';

        try {
            const data = await adminApi('/api/admin/feedback');
            if (!data || data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No feedback yet.</td></tr>';
                return;
            }

            tbody.innerHTML = data.map(item => {
                const createdAt = item.created_at ? new Date(item.created_at).toLocaleString() : '—';
                const name = item.reviewer_name || 'Anonymous';
                const imageCell = item.image_url
                    ? `<a href="${item.image_url}" target="_blank" rel="noopener">View</a>`
                    : '<span style="color:var(--text-muted);">—</span>';

                return `
                    <tr>
                        <td data-label="Date">${escapeHtml(createdAt)}</td>
                        <td data-label="Name">${escapeHtml(name)}</td>
                        <td data-label="Review">
                            <div style="white-space: normal; word-break: break-word;">${escapeHtml(item.review_text || '')}</div>
                        </td>
                        <td data-label="Image">${imageCell}</td>
                        <td data-label="Actions">
                            <button class="btn btn-danger btn-sm" onclick="deleteFeedback('${item.id}')">Delete</button>
                        </td>
                    </tr>
                `;
            }).join('');
        } catch (err) {
            tbody.innerHTML = '<tr><td colspan="5" class="empty-state" style="color:var(--error)">Error loading feedback.</td></tr>';
        }
    }

    window.createFeedback = async function () {
        const nameEl = document.getElementById('feedback-name');
        const textEl = document.getElementById('feedback-text');
        const imageEl = document.getElementById('feedback-image');
        if (!textEl || !nameEl) return;
        const reviewerName = nameEl.value.trim();
        const reviewText = textEl.value.trim();

        if (!reviewerName) {
            showToast('Please enter the reviewer name.', 'error');
            return;
        }

        if (!reviewText) {
            showToast('Please write a review before saving.', 'error');
            return;
        }

        let imageUrl = '';
        if (imageEl && imageEl.files && imageEl.files.length > 0) {
            const formData = new FormData();
            formData.append('file', imageEl.files[0]);
            formData.append('upload_type', 'feedback');

            try {
                const { data: { session } } = await window.supabaseClient.auth.getSession();
                const uploadRes = await fetch('/api/upload', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${session.access_token}` },
                    body: formData
                });
                const uploadData = await uploadRes.json();
                if (!uploadRes.ok) throw new Error(uploadData.error || 'Upload failed');
                imageUrl = uploadData.url;
            } catch (err) {
                showToast(`Image upload error: ${err.message}`, 'error');
                return;
            }
        }

        try {
            await adminApi('/api/admin/feedback', 'POST', {
                reviewer_name: reviewerName,
                review_text: reviewText,
                image_url: imageUrl || null
            });
            showToast('Feedback added.', 'success');
            nameEl.value = '';
            textEl.value = '';
            if (imageEl) imageEl.value = '';
            loadFeedback();
        } catch (err) {
            showToast(`An unknown error occurred while saving: ${err.message}`, 'error');
        }
    };

    window.deleteFeedback = async function (feedbackId) {
        if (!confirm('Are you sure you want to delete this feedback?')) return;

        try {
            await adminApi(`/api/admin/feedback/${feedbackId}`, 'DELETE');
            showToast('Feedback deleted.', 'success');
            loadFeedback();
        } catch (err) {
            showToast(`An unknown error occurred while deleting: ${err.message}`, 'error');
        }
    };

    // ===========================
    // Product Management
    // ===========================

    async function loadProducts() {
        const tbody = document.getElementById('admin-product-list');
        try {
            const products = await adminApi('/api/admin/products');
            tbody.innerHTML = '';

            if (!products || products.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><div class="empty-icon">Products</div><p>No products yet. Add your first one!</p></td></tr>';
                return;
            }

            products.forEach(p => {
                const tr = document.createElement('tr');
                const isActive = p.is_active !== false;
                tr.innerHTML = `
                    <td data-label="Image"><img class="table-product-img" src="${p.image_url || '/static/fallback.svg'}" alt="" onerror="this.onerror=null;this.src='/static/fallback.svg';"></td>
                    <td data-label="Title"><strong>${escapeHtml(p.title)}</strong></td>
                    <td data-label="Price">Rs. ${parseFloat(p.price).toFixed(2)}</td>
                    <td data-label="Stock">${p.stock ?? 0}</td>
                    <td data-label="Status"><span class="status-badge ${isActive ? 'active' : 'inactive'}">${isActive ? 'Active' : 'Inactive'}</span></td>
                    <td data-label="Actions">
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
        document.getElementById('prod-catalog').value = '';
        document.getElementById('prod-show-low-stock').checked = false;
        
        const fileInput = document.getElementById('prod-image');
        fileInput.value = '';
        fileInput.dataset.existingUrl = '';

        const sizeChartInput = document.getElementById('prod-size-chart');
        if (sizeChartInput) sizeChartInput.value = '';
        const sizeChartNote = document.getElementById('prod-size-chart-note');
        if (sizeChartNote) {
            sizeChartNote.dataset.url = '';
            sizeChartNote.textContent = '';
        }

        const otherFileInput = document.getElementById('prod-images');
        if (otherFileInput) {
            otherFileInput.value = '';
            const existingEl = document.getElementById('prod-existing-images');
            if (existingEl) {
                existingEl.dataset.urls = JSON.stringify([]);
                existingEl.textContent = '';
            }
        }

        // Clear image preview
        const preview = document.getElementById('prod-image-preview');
        preview.classList.remove('has-image');

        loadCatalogs();
        refreshCatalogOptions();

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
        document.getElementById('prod-sale-price').value = product.sale_price || 0;
        document.getElementById('prod-price-inr').value = product.price_inr || 0;
        document.getElementById('prod-sale-price-inr').value = product.sale_price_inr || 0;
        
        const fileInput = document.getElementById('prod-image');
        fileInput.value = ''; 
        fileInput.dataset.existingUrl = product.image_url || '';

        const otherFileInput = document.getElementById('prod-images');
        if (otherFileInput) {
            otherFileInput.value = '';
            const existingOtherImages = product.images || [];
            const existingEl = document.getElementById('prod-existing-images');
            if (existingEl) {
                existingEl.dataset.urls = JSON.stringify(existingOtherImages);
                existingEl.textContent = existingOtherImages.length 
                    ? `Currently ${existingOtherImages.length} image(s) set. Leave empty to keep them, or select new files to overwrite.` 
                    : 'No additional images currently.';
            }
        }

        document.getElementById('prod-sizes').value = (product.sizes || []).join(', ');
        document.getElementById('prod-stock').value = product.stock || 0;
        document.getElementById('prod-active').value = product.is_active !== false ? 'true' : 'false';
        document.getElementById('prod-catalog').value = product.catalog_id || '';
        document.getElementById('prod-show-low-stock').checked = product.show_low_stock_label === true;

        const sizeChartNote = document.getElementById('prod-size-chart-note');
        if (sizeChartNote) {
            sizeChartNote.dataset.url = product.size_chart_url || '';
            sizeChartNote.textContent = product.size_chart_url
                ? 'A size chart is already set. Upload a new one to replace it.'
                : '';
        }

        document.getElementById('product-modal-title').textContent = 'Edit Product';
        loadCatalogs();
        refreshCatalogOptions();

        // Show image preview if URL exists
        if (product.image_url) {
            previewProductImage(product.image_url);
        }

        document.getElementById('product-modal').classList.add('active');
        document.getElementById('product-modal-overlay').classList.add('active');
    };

    window.previewFile = function (input) {
        if (input.files && input.files[0]) {
            const reader = new FileReader();
            reader.onload = function(e) {
                previewProductImage(e.target.result);
            }
            reader.readAsDataURL(input.files[0]);
        }
    }

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
        const otherFileInput = document.getElementById('prod-images');
        const sizesStr = document.getElementById('prod-sizes').value;
        
        let finalImageUrl = document.getElementById('prod-image').dataset.existingUrl || '';
        const fileInput = document.getElementById('prod-image');
        
        // Upload new file if selected
        if (fileInput.files.length > 0) {
            const formData = new FormData();
            formData.append('file', fileInput.files[0]);
            formData.append('upload_type', 'product');
            
            try {
                const { data: { session } } = await window.supabaseClient.auth.getSession();
                const uploadRes = await fetch('/api/upload', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${session.access_token}` },
                    body: formData
                });
                const uploadData = await uploadRes.json();
                if (!uploadRes.ok) throw new Error(uploadData.error || 'Upload failed');
                finalImageUrl = uploadData.url;
            } catch (err) {
                showToast(`Image upload error: ${err.message}`, 'error');
                btn.textContent = originalText;
                btn.disabled = false;
                return;
            }
        }

        let finalOtherImages = [];
        const existingEl = document.getElementById('prod-existing-images');
        if (existingEl && existingEl.dataset.urls) {
            try { finalOtherImages = JSON.parse(existingEl.dataset.urls); } catch(e) { finalOtherImages = []; }
        }

        if (otherFileInput && otherFileInput.files.length > 0) {
            finalOtherImages = []; // Overwrite existing if user selects new files
            const { data: { session } } = await window.supabaseClient.auth.getSession();
            
            for (let i = 0; i < otherFileInput.files.length; i++) {
                const formData = new FormData();
                formData.append('file', otherFileInput.files[i]);
                formData.append('upload_type', 'product');
                try {
                    const uploadRes = await fetch('/api/upload', {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${session.access_token}` },
                        body: formData
                    });
                    const uploadData = await uploadRes.json();
                    if (!uploadRes.ok) throw new Error(uploadData.error || 'Upload failed');
                    finalOtherImages.push(uploadData.url);
                } catch (err) {
                    showToast(`Other image upload error: ${err.message}`, 'error');
                    btn.textContent = originalText;
                    btn.disabled = false;
                    return;
                }
            }
        }

        let finalSizeChartUrl = '';
        const sizeChartInput = document.getElementById('prod-size-chart');
        const sizeChartNote = document.getElementById('prod-size-chart-note');
        if (sizeChartNote && sizeChartNote.dataset.url) {
            finalSizeChartUrl = sizeChartNote.dataset.url;
        }
        if (sizeChartInput && sizeChartInput.files.length > 0) {
            const formData = new FormData();
            formData.append('file', sizeChartInput.files[0]);
            formData.append('upload_type', 'size_chart');
            try {
                const { data: { session } } = await window.supabaseClient.auth.getSession();
                const uploadRes = await fetch('/api/upload', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${session.access_token}` },
                    body: formData
                });
                const uploadData = await uploadRes.json();
                if (!uploadRes.ok) throw new Error(uploadData.error || 'Upload failed');
                finalSizeChartUrl = uploadData.url;
            } catch (err) {
                showToast(`Size chart upload error: ${err.message}`, 'error');
                btn.textContent = originalText;
                btn.disabled = false;
                return;
            }
        }

        const data = {
            title: document.getElementById('prod-title').value,
            description: document.getElementById('prod-desc').value,
            price: parseFloat(document.getElementById('prod-price').value),
            sale_price: parseFloat(document.getElementById('prod-sale-price').value || 0),
            price_inr: parseFloat(document.getElementById('prod-price-inr').value),
            sale_price_inr: parseFloat(document.getElementById('prod-sale-price-inr').value || 0),
            show_low_stock_label: document.getElementById('prod-show-low-stock').checked,
            image_url: finalImageUrl,
            size_chart_url: finalSizeChartUrl || null,
            images: finalOtherImages,
            sizes: sizesStr ? sizesStr.split(',').map(s => s.trim()).filter(Boolean) : [],
            stock: parseInt(document.getElementById('prod-stock').value, 10),
            is_active: document.getElementById('prod-active').value === 'true',
            catalog_id: document.getElementById('prod-catalog').value || null
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
                const ig = (o.instagram_username || '').toLowerCase();
                return ig.includes(searchTerm);
            });
        }
        
        tbody.innerHTML = '';

        if (!filtered || filtered.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="empty-state"><div class="empty-icon">Orders</div><p>No orders yet.</p></td></tr>';
            return;
        }

        filtered.forEach(o => {
            const customerName = o.full_name || 'Customer';
            const instagram = o.instagram_username ? `@${o.instagram_username}` : '—';
            const remarks = (o.admin_remarks || '').trim();
            const remarksDisplay = remarks ? escapeHtml(remarks) : '<span style="color:var(--text-muted);">—</span>';
            const amountDisplay = Number.isFinite(o.admin_amount)
                ? `Rs. ${parseFloat(o.admin_amount).toFixed(2)}`
                : '<span style="color:var(--text-muted);">—</span>';

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td data-label="Order ID" style="font-family:monospace;font-size:var(--font-size-xs);">${o.order_number || o.id.substring(0, 4)}</td>
                <td data-label="Customer">
                    <strong>${escapeHtml(customerName)}</strong><br>
                    <small style="color:var(--text-muted);">${escapeHtml(instagram)}</small>
                </td>
                <td data-label="Address" style="font-size: 0.85rem;">
                    ${o.contact_number ? `Tel: ${escapeHtml(o.contact_number)}<br>` : ''}
                    ${o.country ? `${escapeHtml(o.country)}<br>` : ''}
                    ${o.country === 'Nepal' ? `${escapeHtml(o.district || '')}, ${escapeHtml(o.province || '')}<br>` : ''}
                    ${o.country === 'India' ? `${escapeHtml(o.state || '')} ${escapeHtml(o.zipcode || '')}<br>` : ''}
                    ${escapeHtml(o.shipping_address)}
                </td>
                <td data-label="Total">
                    <strong>Rs. ${parseFloat(o.total_amount).toFixed(2)}</strong><br>
                    <small style="color:var(--text-muted);">${o.payment_method || 'COD'}</small>
                </td>
                <td data-label="Remarks" style="font-size: var(--font-size-sm);">${remarksDisplay}</td>
                <td data-label="Amount" style="font-weight: 600;">${amountDisplay}</td>
                <td data-label="Status"><span class="status-badge ${o.status}">${o.status}</span></td>
                <td data-label="Actions" onclick="event.stopPropagation();">
                    <div style="display:flex; flex-direction: column; gap: 6px;">
                        <button class="btn btn-secondary btn-sm" onclick="openOrderDetail('${o.id}')">View Details</button>
                        <select class="status-select" onchange="updateOrderStatus('${o.id}', this.value)">
                        <option value="pending" ${o.status === 'pending' ? 'selected' : ''}>Pending</option>
                        <option value="processing" ${o.status === 'processing' ? 'selected' : ''}>Processing</option>
                        <option value="packed" ${o.status === 'packed' ? 'selected' : ' '}>Packed</option>
                                <option value="shipped" ${o.status === 'shipped' ? 'selected' : ''}>Shipped</option>
                        <option value="delivered" ${o.status === 'delivered' ? 'selected' : ''}>Delivered</option>
                        <option value="cancelled" ${o.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
                        </select>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    window.openOrderDetail = async function (orderId) {
        const modal = document.getElementById('order-detail-modal');
        const overlay = document.getElementById('order-detail-overlay');
        const body = document.getElementById('order-detail-body');
        if (!modal || !overlay || !body) return;

        modal.classList.add('active');
        overlay.classList.add('active');
        body.innerHTML = '<p>Loading...</p>';

        try {
            const order = await adminApi(`/api/admin/orders/${orderId}/detail`);
            const items = order.order_items || [];
            const itemRows = items.map(item => {
                const product = item.products || {};
                return `
                    <div style="display:flex; align-items:center; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--border);">
                        <img src="${product.image_url || '/static/fallback.svg'}" alt="" style="width:48px;height:48px;border-radius:6px;object-fit:cover;" onerror="this.onerror=null;this.src='/static/fallback.svg';">
                        <div style="flex:1;">
                            <div style="font-weight: 600;">${escapeHtml(product.title || 'Product')}</div>
                            <div style="font-size: var(--font-size-sm); color: var(--text-muted);">Qty: ${item.quantity}${item.size ? ` | Size: ${escapeHtml(item.size)}` : ''}</div>
                        </div>
                        <div style="font-weight: 600;">Rs. ${parseFloat(item.price_at_time).toFixed(2)}</div>
                    </div>
                `;
            }).join('');

            body.innerHTML = `
                <div style="display:grid; gap: 12px;">
                    <div>
                        <strong>Order #</strong> ${order.order_number || order.id}
                        <div style="color: var(--text-muted); font-size: var(--font-size-sm);">Placed on ${new Date(order.created_at).toLocaleString()}</div>
                    </div>
                    <div style="display:grid; gap: 6px;">
                        <div><strong>Customer:</strong> ${escapeHtml(order.full_name || 'Customer')}</div>
                        <div><strong>Email:</strong> ${escapeHtml(order.email || '—')}</div>
                        <div><strong>Instagram:</strong> ${order.instagram_username ? '@' + escapeHtml(order.instagram_username) : '—'}</div>
                        <div><strong>Contact:</strong> ${escapeHtml(order.contact_number || '—')}</div>
                        ${order.alternate_contact_number ? `<div><strong>Alternate:</strong> ${escapeHtml(order.alternate_contact_number)}</div>` : ''}
                    </div>
                    <div>
                        <strong>Delivery Address:</strong>
                        <div style="color: var(--text-muted); font-size: var(--font-size-sm);">${escapeHtml(order.shipping_address || '—')}</div>
                        ${order.country ? `<div style="color: var(--text-muted); font-size: var(--font-size-sm);">${escapeHtml(order.country)}</div>` : ''}
                        ${order.country === 'Nepal' ? `<div style="color: var(--text-muted); font-size: var(--font-size-sm);">${escapeHtml(order.district || '')}, ${escapeHtml(order.province || '')}</div>` : ''}
                        ${order.country === 'India' ? `<div style="color: var(--text-muted); font-size: var(--font-size-sm);">${escapeHtml(order.state || '')} ${escapeHtml(order.zipcode || '')}</div>` : ''}
                    </div>
                    <div>
                        <strong>Payment:</strong> ${escapeHtml(order.payment_method || 'COD')}
                        ${order.payment_receipt_url ? `<div><a href="${order.payment_receipt_url}" target="_blank" rel="noopener">Open receipt</a></div>` : ''}
                    </div>
                    ${order.payment_receipt_url ? `
                        <div>
                            <strong>Receipt</strong>
                            <div style="margin-top: 6px;">
                                <a href="${order.payment_receipt_url}" target="_blank" rel="noopener">
                                    <img src="${order.payment_receipt_url}" alt="Payment receipt" style="width: 100%; max-width: 520px; border-radius: 10px; border: 1px solid var(--border);" onerror="this.style.display='none';">
                                </a>
                            </div>
                        </div>
                    ` : ''}
                    <div>
                        <strong>Status:</strong> ${escapeHtml(order.status || 'pending')}
                    </div>
                    <div style="display:grid; gap: 10px;">
                        <div>
                            <label for="order-remarks-input" style="display:block; font-size: var(--font-size-sm); font-weight: 600; margin-bottom: 6px;">Remarks</label>
                            <textarea id="order-remarks-input" class="form-input" style="width:100%; min-height: 90px; resize: vertical;">${escapeHtml(order.admin_remarks || '')}</textarea>
                        </div>
                        <div>
                            <label for="order-amount-input" style="display:block; font-size: var(--font-size-sm); font-weight: 600; margin-bottom: 6px;">Amount</label>
                            <input id="order-amount-input" type="number" step="0.01" min="0" class="form-input" value="${order.admin_amount ?? ''}" placeholder="Rs. 0.00">
                        </div>
                        <div>
                            <button class="btn btn-primary btn-sm" onclick="updateOrderMeta('${order.id}')">Save Remarks & Amount</button>
                        </div>
                    </div>
                    <div>
                        <strong>Items</strong>
                        <div style="margin-top: 6px;">${itemRows || '<p>No items</p>'}</div>
                    </div>
                    <div style="text-align:right; font-weight: 700;">
                        Total: Rs. ${parseFloat(order.total_amount).toFixed(2)}
                    </div>
                </div>
            `;
        } catch (err) {
            body.innerHTML = `<p style="color:var(--error)">Failed to load details: ${escapeHtml(err.message)}</p>`;
        }
    };

    window.updateOrderMeta = async function (orderId) {
        const remarksEl = document.getElementById('order-remarks-input');
        const amountEl = document.getElementById('order-amount-input');
        const remarks = remarksEl ? remarksEl.value.trim() : '';
        const amountRaw = amountEl ? amountEl.value : '';

        let adminAmount = null;
        if (amountRaw !== '') {
            adminAmount = parseFloat(amountRaw);
            if (Number.isNaN(adminAmount)) {
                showToast('Amount must be a valid number.', 'error');
                return;
            }
        }

        try {
            await adminApi(`/api/admin/orders/${orderId}`, 'PUT', {
                admin_remarks: remarks,
                admin_amount: adminAmount
            });
            showToast('Remarks and amount updated.', 'success');
            loadOrders();
        } catch (err) {
            showToast(`An unknown error occurred while saving: ${err.message}`, 'error');
        }
    };

    window.closeOrderDetail = function () {
        const modal = document.getElementById('order-detail-modal');
        const overlay = document.getElementById('order-detail-overlay');
        if (modal) modal.classList.remove('active');
        if (overlay) overlay.classList.remove('active');
    };

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
                    <td data-label="Code"><strong>${escapeHtml(c.code)}</strong></td>
                    <td data-label="Discount">${c.discount_percentage}%</td>
                    <td data-label="Status"><span class="status-badge status-${c.is_active ? 'delivered' : 'cancelled'}">${c.is_active ? 'Active' : 'Inactive'}</span></td>
                    <td data-label="Date">${new Date(c.created_at).toLocaleDateString()}</td>
                    <td data-label="Actions">
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

    // ===========================
    // CATALOGS
    // ===========================

    async function loadCatalogs() {
        const tbody = document.getElementById('admin-catalog-list');
        if (tbody) tbody.innerHTML = '<tr><td colspan="4" class="empty-state">Loading...</td></tr>';

        try {
            const data = await adminApi('/api/admin/catalogs');
            catalogsCache = data || [];
            refreshCatalogOptions();

            if (!tbody) return;
            if (!data || data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No catalogs found.</td></tr>';
                return;
            }

            tbody.innerHTML = data.map(c => `
                <tr>
                    <td data-label="Name"><strong>${escapeHtml(c.name)}</strong></td>
                    <td data-label="Description">${escapeHtml(c.description || '')}</td>
                    <td data-label="Created">${new Date(c.created_at).toLocaleDateString()}</td>
                    <td data-label="Actions">
                        <div class="table-actions">
                            <button class="btn btn-secondary btn-sm" onclick="editCatalog('${c.id}')">Edit</button>
                            <button class="btn btn-danger btn-sm" onclick="deleteCatalog('${c.id}')">Delete</button>
                        </div>
                    </td>
                </tr>
            `).join('');
        } catch (e) {
            if (tbody) tbody.innerHTML = '<tr><td colspan="4" class="empty-state" style="color:var(--error)">Error loading catalogs.</td></tr>';
        }
    }

    window.createCatalog = async function () {
        const nameInput = document.getElementById('catalog-name');
        const descInput = document.getElementById('catalog-desc');
        const name = nameInput.value.trim();
        const description = descInput.value.trim();

        if (!name) {
            alert('Catalog name is required.');
            return;
        }

        try {
            await adminApi('/api/admin/catalogs', 'POST', { name, description: description || null });
            nameInput.value = '';
            descInput.value = '';
            loadCatalogs();
            showToast('Catalog created.', 'success');
        } catch (err) {
            showToast(`Error creating catalog: ${err.message}`, 'error');
        }
    };

    window.editCatalog = async function (catalogId) {
        const catalog = catalogsCache.find(c => c.id === catalogId);
        if (!catalog) return;
        const name = prompt('Catalog name:', catalog.name || '');
        if (name === null) return;
        const description = prompt('Description:', catalog.description || '')
        try {
            await adminApi(`/api/admin/catalogs/${catalogId}`, 'PUT', { name: name.trim(), description: (description || '').trim() });
            loadCatalogs();
            showToast('Catalog updated.', 'success');
        } catch (err) {
            showToast(`Error updating catalog: ${err.message}`, 'error');
        }
    };

    window.deleteCatalog = async function (catalogId) {
        if (!confirm('Are you sure you want to delete this catalog?')) return;
        try {
            await adminApi(`/api/admin/catalogs/${catalogId}`, 'DELETE');
            loadCatalogs();
            showToast('Catalog deleted.', 'success');
        } catch (err) {
            showToast(`Error deleting catalog: ${err.message}`, 'error');
        }
    };

    function refreshCatalogOptions() {
        const select = document.getElementById('prod-catalog');
        if (!select) return;

        const currentValue = select.value;
        const options = ['<option value="">Uncategorized</option>'];
        catalogsCache.forEach(c => {
            options.push(`<option value="${c.id}">${escapeHtml(c.name)}</option>`);
        });
        select.innerHTML = options.join('');
        if (currentValue) select.value = currentValue;
    }

    // ===========================
    // REVIEWS
    // ===========================

    async function loadReviews() {
        const tbody = document.getElementById('admin-review-list');
        if (!tbody) return;
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Loading...</td></tr>';

        try {
            const data = await adminApi('/api/admin/reviews');
            if (!data || data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No reviews found.</td></tr>';
                return;
            }

            tbody.innerHTML = data.map(r => {
                const productTitle = r.products?.title || 'Unknown product';
                const createdAt = r.created_at ? new Date(r.created_at).toLocaleString() : '—';
                const rating = Number.isFinite(r.rating) ? `${r.rating}/5` : '—';
                return `
                    <tr>
                        <td data-label="Date">${escapeHtml(createdAt)}</td>
                        <td data-label="Product"><strong>${escapeHtml(productTitle)}</strong></td>
                        <td data-label="Rating">${escapeHtml(rating)}</td>
                        <td data-label="Review" style="max-width: 360px;">
                            <div style="white-space: normal; word-break: break-word;">
                                ${escapeHtml(r.review_text || '')}
                            </div>
                        </td>
                        <td data-label="Session" style="font-family: monospace; font-size: var(--font-size-xs);">${escapeHtml(r.session_id || '—')}</td>
                        <td data-label="Actions">
                            <button class="btn btn-danger btn-sm" onclick="deleteReview('${r.id}')">Delete</button>
                        </td>
                    </tr>
                `;
            }).join('');
        } catch (e) {
            tbody.innerHTML = '<tr><td colspan="6" class="empty-state" style="color:var(--error)">Error loading reviews.</td></tr>';
        }
    }

    window.deleteReview = async function(reviewId) {
        if (!confirm('Are you sure you want to delete this review?')) return;

        try {
            await adminApi(`/api/admin/reviews/${reviewId}`, 'DELETE');
            showToast('Review deleted.', 'success');
            loadReviews();
        } catch (err) {
            showToast(`An unknown error occurred while deleting: ${err.message}`, 'error');
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

