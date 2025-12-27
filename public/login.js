const API_URL = '';

const app = {
    async login(e) {
        e.preventDefault();
        
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        const errorDiv = document.getElementById('login-error');
        
        errorDiv.classList.remove('show');
        errorDiv.textContent = '';
        
        try {
            const res = await fetch(`${API_URL}/api/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ username, password })
            });
            
            const data = await res.json();
            
            if (res.ok && data.success) {
                window.location.href = '/';
            } else {
                errorDiv.textContent = data.error || 'Credenciales inválidas';
                errorDiv.classList.add('show');
            }
        } catch (error) {
            errorDiv.textContent = 'Error al conectar con el servidor';
            errorDiv.classList.add('show');
        }
    }
};

