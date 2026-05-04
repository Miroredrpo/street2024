
// guest session
async function getGuestSessionId() {
    let sid = localStorage.getItem('guest_session_id');
    if (sid) return sid;

    try {
        const res = await fetch('/api/guest-session', { method: 'POST' });
        const data = await res.json();
        if (res.ok && data.session_id) {
            localStorage.setItem('guest_session_id', data.session_id);
            return data.session_id;
        }
    } catch (e) {
        // ignore
    }
    return null;
}

window.getGuestSessionId = getGuestSessionId;

/* api helpers */

// toasts

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    container.appendChild(toast);

    // auto dismiss
    setTimeout(() => {
        toast.classList.add('removing');
        toast.addEventListener('animationend', () => toast.remove());
    }, 4000);
}

window.showToast = showToast;

// unexpected error toast
const UNEXPECTED_ERROR_MESSAGE = 'An unexpected error occurred. Try refreshing and trying again. If that does not solve it, contact the site owner.';
const NETWORK_ERROR_MESSAGE = 'Network error. Refresh the page and try again.';
let lastUnexpectedToastAt = 0;
let lastNetworkToastAt = 0;

function notifyUnexpectedError() {
    const now = Date.now();
    if (now - lastUnexpectedToastAt < 2500) return;
    lastUnexpectedToastAt = now;

    if (window.showToast) {
        window.showToast(UNEXPECTED_ERROR_MESSAGE, 'error');
    } else {
        alert(UNEXPECTED_ERROR_MESSAGE);
    }
}

window.notifyUnexpectedError = notifyUnexpectedError;

function notifyNetworkError() {
    const now = Date.now();
    if (now - lastNetworkToastAt < 2500) return;
    lastNetworkToastAt = now;

    if (window.showToast) {
        window.showToast(NETWORK_ERROR_MESSAGE, 'error');
    } else {
        alert(NETWORK_ERROR_MESSAGE);
    }
}

window.notifyNetworkError = notifyNetworkError;

// api fetch

const apiFetch = async (endpoint, options = {}) => {
    let token = null;

    try {
        const { data: { session } } = await window.supabaseClient.auth.getSession();
        if (session) {
            token = session.access_token;
        }
    } catch (e) {
        // no session
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
            if (response.status >= 500) {
                notifyUnexpectedError();
                errorMsg = UNEXPECTED_ERROR_MESSAGE;
            }
            throw new Error(errorMsg);
        }

        return await response.json();
    } catch (error) {
        if (error && typeof error.message === 'string') {
            const msg = error.message.toLowerCase();
            if (msg.includes('failed to fetch') || msg.includes('networkerror')) {
                notifyNetworkError();
            }
        }
        if (!error || !error.message) {
            notifyUnexpectedError();
        }
        throw error;
    }
};

window.apiFetch = apiFetch;

// global error hooks
window.addEventListener('error', () => {
    notifyUnexpectedError();
});

window.addEventListener('unhandledrejection', () => {
    notifyUnexpectedError();
});