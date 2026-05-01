
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
            throw new Error(errorMsg);
        }

        return await response.json();
    } catch (error) {
        // no double toast
        throw error;
    }
};

window.apiFetch = apiFetch;