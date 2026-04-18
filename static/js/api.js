
// GUEST SESSION MANAGER
function getGuestSessionId() {
    let sid = localStorage.getItem('guest_session_id');
    if (!sid) {
        sid = 'sess_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
        localStorage.setItem('guest_session_id', sid);
    }
    return sid;
}

const originalFetch = window.fetch;
window.fetch = async function() {
    let [resource, config ] = arguments;
    if (!config) { config = {}; }
    if (!config.headers) { config.headers = {}; }
    
    // Add guest session ID to every request implicitly
    config.headers['X-Guest-Session-ID'] = getGuestSessionId();
    
    return await originalFetch(resource, config);
};

/**
 * api.js — Global API wrapper & Toast notification system
 * 
 */

// ===========================
// Toast Notification System
// ===========================

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    container.appendChild(toast);

    // Auto dismiss after 4s
    setTimeout(() => {
        toast.classList.add('removing');
        toast.addEventListener('animationend', () => toast.remove());
    }, 4000);
}

window.showToast = showToast;

// ===========================
// API Fetch Wrapper
// ===========================

const apiFetch = async (endpoint, options = {}) => {
    let token = null;

    try {
        const { data: { session } } = await window.supabaseClient.auth.getSession();
        if (session) {
            token = session.access_token;
        }
    } catch (e) {
        // No session available
    }

    const headers = {
        'Content-Type': 'application/json',
        ...(token && { 'Authorization': `Bearer ${token}` })
    };

    try {
        const response = await fetch(endpoint, { ...options, headers });

        if (!response.ok) {
            let errorMsg = `HTTP error! status: ${response.status}`;
            try {
                const errData = await response.json();
                if (errData.error) errorMsg = errData.error;
            } catch (e) {}
            throw new Error(errorMsg);
        }

        return await response.json();
    } catch (error) {
        // Don't double-toast; let callers handle if they want
        throw error;
    }
};

window.apiFetch = apiFetch;