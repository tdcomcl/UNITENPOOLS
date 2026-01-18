const API_URL = '';

// Función helper para formatear precios sin decimales pero con separador de miles
function formatearPrecio(precio) {
    if (!precio && precio !== 0) return '0';
    const num = typeof precio === 'number' ? precio : parseFloat(precio);
    if (isNaN(num)) return '0';
    return Math.round(num).toLocaleString('es-CL');
}

const app = {
    currentPage: 'dashboard',
    clientes: [],
    responsables: [],
    asignaciones: [],
    currentUser: null,
    pendingAsignaciones: new Set(),
    excelImportPassword: null,  // Almacenar contraseña temporalmente después de verificación

    showToast(message, type = 'info', ms = 2500) {
        const el = document.createElement('div');
        el.className = `toast toast-${type}`;
        el.textContent = message;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), ms);
    },

    async init() {
        // Verificar sesión
        await this.verificarSesion();
        if (!this.currentUser) {
            window.location.href = '/login.html';
            return;
        }

        this.setupEventListeners();
        this.mostrarInfoUsuario();
        this.actualizarUI();

        const isAdmin = this.currentUser?.rol === 'admin';

        if (isAdmin) {
            // Admin ve todas las páginas
            this.cargarResponsables();
            this.cargarClientes();
            this.cargarEstadisticas();
            this.configurarSemanaActual();

            // Configurar selector de semana para progreso y notas
            const hoy = new Date();
            const day = hoy.getDay();
            const diff = hoy.getDate() - day + (day === 0 ? -6 : 1);
            const monday = new Date(hoy.setDate(diff));
            const semanaSelector = document.getElementById('progreso-semana-selector');
            const notasSelector = document.getElementById('notas-semana-selector');
            if (semanaSelector) {
                semanaSelector.value = monday.toISOString().split('T')[0];
            }
            if (notasSelector) {
                notasSelector.value = monday.toISOString().split('T')[0];
            }

            // Mostrar dashboard por defecto
            this.showPage('dashboard');
        } else {
            // Responsables solo ven asignaciones
            this.configurarSemanaActual();
            this.showPage('asignaciones');
        }

        // Iniciar auto-actualización en tiempo real
        this.iniciarAutoActualizacion();
    },

    async verificarSesion() {
        try {
            const res = await fetch(`${API_URL}/api/session`, {
                credentials: 'include'
            });
            const data = await res.json();
            if (data.authenticated) {
                this.currentUser = data.user;
            }
        } catch (error) {
            console.error('Error verificando sesión:', error);
        }
    },

    mostrarInfoUsuario() {
        const nav = document.querySelector('.nav-container');
        if (nav && this.currentUser) {
            const userInfo = document.createElement('div');
            userInfo.className = 'user-info';
            userInfo.style.cssText = 'display: flex; align-items: center; gap: 1rem; color: white;';
            userInfo.innerHTML = `
                <span>👤 ${this.currentUser.username}${this.currentUser.responsable_nombre ? ` (${this.currentUser.responsable_nombre})` : ''}</span>
                <button onclick="app.logout()" class="btn btn-secondary" style="padding: 0.4rem 0.8rem; font-size: 0.85rem;">Salir</button>
            `;
            nav.appendChild(userInfo);
        }
    },

    async logout() {
        try {
            await fetch(`${API_URL}/api/logout`, {
                method: 'POST',
                credentials: 'include'
            });
            window.location.href = '/login.html';
        } catch (error) {
            console.error('Error al cerrar sesión:', error);
            window.location.href = '/login.html';
        }
    },

    actualizarUI() {
        const isAdmin = this.currentUser?.rol === 'admin';

        // Mostrar/ocultar pestañas según rol
        const btnDashboard = document.querySelector('[data-page="dashboard"]');
        const btnClientes = document.querySelector('[data-page="clientes"]');
        const btnProgreso = document.getElementById('nav-progreso');
        const btnNotas = document.getElementById('nav-notas');
        const btnResponsables = document.querySelector('[data-page="responsables"]');

        // Responsables solo ven Asignaciones
        if (btnDashboard) {
            btnDashboard.style.display = isAdmin ? 'inline-block' : 'none';
        }
        if (btnClientes) {
            btnClientes.style.display = isAdmin ? 'inline-block' : 'none';
        }
        if (btnProgreso) {
            btnProgreso.style.display = isAdmin ? 'inline-block' : 'none';
        }
        if (btnNotas) {
            btnNotas.style.display = isAdmin ? 'inline-block' : 'none';
        }
        const btnReportes = document.getElementById('nav-reportes');
        if (btnReportes) {
            btnReportes.style.display = isAdmin ? 'inline-block' : 'none';
        }
        if (btnResponsables) {
            btnResponsables.style.display = isAdmin ? 'inline-block' : 'none';
        }

        // Mostrar botones de verificación y restauración solo para admin
        const btnVerificar = document.getElementById('btn-verificar-asignaciones');
        const btnRestaurar = document.getElementById('btn-restaurar-asignaciones');
        const btnRestaurarVisitas = document.getElementById('btn-restaurar-visitas');
        if (btnVerificar) btnVerificar.style.display = isAdmin ? 'inline-block' : 'none';
        if (btnRestaurar) btnRestaurar.style.display = isAdmin ? 'inline-block' : 'none';
        if (btnRestaurarVisitas) btnRestaurarVisitas.style.display = isAdmin ? 'inline-block' : 'none';

        // Ocultar/mostrar elementos según rol
        if (!isAdmin) {
            // Responsables no pueden agregar clientes, responsables, ni asignar semanas
            const btnAgregarCliente = document.querySelector('[onclick*="showModal(\'cliente-modal\')"]');
            const btnAgregarResponsable = document.querySelector('[onclick*="showModal(\'responsable-modal\')"]');
            const btnAsignarSemana = document.querySelectorAll('[onclick*="asignarSemanaActual"]');

            if (btnAgregarCliente) btnAgregarCliente.style.display = 'none';
            if (btnAgregarResponsable) btnAgregarResponsable.style.display = 'none';
            btnAsignarSemana.forEach(btn => btn.style.display = 'none');

            // Configurar vista de clientes limitada (aunque no deberían verla)
            this.configurarVistaClientesLimitada();
        } else {
            // Configurar vista completa para admin
            this.configurarVistaClientesCompleta();
        }

        // Mostrar información del responsable
        if (this.currentUser?.responsable_nombre) {
            const dashboard = document.getElementById('dashboard-page');
            if (dashboard) {
                const info = document.createElement('div');
                info.className = 'section';
                info.style.cssText = 'background: #e7f3ff; border-left: 4px solid #0066cc;';
                info.innerHTML = `
                    <h3>👤 ${this.currentUser.responsable_nombre}</h3>
                    <p>Estás viendo solo tus asignaciones y clientes asignados a ti.</p>
                `;
                dashboard.insertBefore(info, dashboard.firstChild.nextSibling);
            }
        }

    },

    setupEventListeners() {
        // Navegación
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const page = e.target.dataset.page;
                this.showPage(page);
            });
        });

        // Import Excel Clientes (admin)
        const fileInput = document.getElementById('clientes-import-file');
        if (fileInput) {
            fileInput.addEventListener('change', async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                await this.importarClientesExcel(f);
                // reset para permitir re-subir el mismo archivo
                e.target.value = '';
            });
        }

        // Cerrar modales al hacer clic fuera
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.closeModal(modal.id);
                }
            });
        });
    },

    showPage(page) {
        const isAdmin = this.currentUser?.rol === 'admin';

        // Restricciones de acceso para responsables
        if (!isAdmin) {
            const paginasPermitidas = ['asignaciones'];
            if (!paginasPermitidas.includes(page)) {
                console.warn(`[Access] Usuario no admin intentó acceder a ${page}, redirigiendo a asignaciones`);
                page = 'asignaciones';
            }
        }

        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));

        document.getElementById(`${page}-page`).classList.add('active');
        const navBtn = document.querySelector(`[data-page="${page}"]`);
        if (navBtn) {
            navBtn.classList.add('active');
        }

        this.currentPage = page;

        if (page === 'dashboard') {
            this.cargarEstadisticas();
        } else if (page === 'clientes') {
            this.cargarClientes();
        } else if (page === 'asignaciones') {
            this.cargarAsignaciones();
        } else if (page === 'progreso') {
            this.cargarProgreso();
        } else if (page === 'notas') {
            this.cargarNotas();
        } else if (page === 'reportes') {
            this.cargarReportes();
        } else if (page === 'responsables') {
            this.cargarResponsables();
        }
    },

    seleccionarImportExcelClientes() {
        // Mostrar modal de contraseña primero
        this.showModal('excel-import-password-modal');
        // Limpiar campo de contraseña
        const passwordInput = document.getElementById('excel-import-password');
        if (passwordInput) {
            passwordInput.value = '';
            passwordInput.focus();
        }
        const errorDiv = document.getElementById('excel-import-password-error');
        if (errorDiv) {
            errorDiv.style.display = 'none';
            errorDiv.textContent = '';
        }
    },

    async verificarPasswordImportExcel(event) {
        event.preventDefault();
        const passwordInput = document.getElementById('excel-import-password');
        const errorDiv = document.getElementById('excel-import-password-error');
        const password = passwordInput?.value || '';

        if (!password) {
            if (errorDiv) {
                errorDiv.textContent = 'Por favor ingresa la contraseña';
                errorDiv.style.display = 'block';
            }
            return;
        }

        try {
            // Verificar contraseña en el backend
            const res = await fetch(`${API_URL}/api/clientes/import/verify-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ password })
            });

            const data = await res.json().catch(() => ({}));

            if (!res.ok || !data.valid) {
                if (errorDiv) {
                    errorDiv.textContent = data.error || 'Contraseña incorrecta';
                    errorDiv.style.display = 'block';
                }
                passwordInput.value = '';
                passwordInput.focus();
                return;
            }

            // Contraseña correcta: guardar contraseña temporalmente para usarla en la importación
            this.excelImportPassword = password;

            // Obtener el input
            const input = document.getElementById('clientes-import-file');
            if (!input) {
                console.error('No se encontró el input de archivo con ID: clientes-import-file');
                this.showToast('Error: No se encontró el selector de archivos', 'error', 3000);
                return;
            }

            // IMPORTANTE: Hacer click ANTES de cerrar el modal
            // Los navegadores modernos requieren que el click en input file sea parte de la misma cadena de interacción del usuario
            try {
                input.click();
                console.log('Selector de archivos abierto');

                // Cerrar modal después de abrir el selector
                // Usar un pequeño delay para que el selector se abra primero
                setTimeout(() => {
                    this.closeModal('excel-import-password-modal');
                }, 50);
            } catch (err) {
                console.error('Error al abrir selector de archivos:', err);
                this.showToast('Error: No se pudo abrir el selector de archivos', 'error', 3000);
            }
        } catch (e) {
            console.error('Error verificando contraseña:', e);
            if (errorDiv) {
                errorDiv.textContent = 'Error al verificar contraseña. Intenta nuevamente.';
                errorDiv.style.display = 'block';
            }
        }
    },

    async descargarClientesExcel() {
        try {
            this.showToast('Preparando Excel de clientes…', 'info', 2000);
            const res = await fetch(`${API_URL}/api/clientes/export`, {
                credentials: 'include'
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || `Error HTTP ${res.status}`);
            }
            const blob = await res.blob();
            const cd = res.headers.get('content-disposition') || '';
            const m = /filename="([^"]+)"/i.exec(cd);
            const filename = m?.[1] || 'clientes.xlsx';

            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error(e);
            this.showToast(`Error al descargar Excel: ${e?.message || e}`, 'error', 4500);
        }
    },

    mostrarResultadoImportClientes({ created, updated, skipped, errors }) {
        const box = document.getElementById('clientes-import-result');
        const text = document.getElementById('clientes-import-result-text');
        if (!box || !text) return;

        const lines = [
            `Creados: ${created || 0}`,
            `Actualizados: ${updated || 0}`,
            `Saltados: ${skipped || 0}`,
            `Errores: ${(errors || []).length}`
        ];

        if (errors && errors.length) {
            lines.push('');
            lines.push('Detalle (primeros 20):');
            errors.slice(0, 20).forEach(er => {
                lines.push(`- Fila ${er.row}: ${er.error}`);
            });
        }

        text.textContent = lines.join('\n');
        box.style.display = 'block';
    },

    async importarClientesExcel(file) {
        try {
            // Verificar que tenemos la contraseña
            if (!this.excelImportPassword) {
                this.showToast('Error: Contraseña no verificada. Por favor intenta nuevamente.', 'error', 5000);
                return;
            }

            this.showToast('Por favor espere… importando Excel de clientes', 'info', 2500);
            const fd = new FormData();
            fd.append('file', file);
            fd.append('password', this.excelImportPassword);

            const res = await fetch(`${API_URL}/api/clientes/import`, {
                method: 'POST',
                body: fd,
                credentials: 'include'
            });

            // Limpiar contraseña después de usarla
            this.excelImportPassword = null;

            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data.error || `Error HTTP ${res.status}`);
            }

            this.mostrarResultadoImportClientes(data);
            const msg = `✅ Importación OK. Creados: ${data.created || 0}, Actualizados: ${data.updated || 0}, Errores: ${(data.errors || []).length}`;
            this.showToast(msg, (data.errors || []).length ? 'warning' : 'success', 6000);
            await this.cargarClientes();
        } catch (e) {
            console.error(e);
            this.showToast(`Error importando Excel: ${e?.message || e}`, 'error', 5000);
            // Limpiar contraseña en caso de error
            this.excelImportPassword = null;
        }
    },

    async cargarEstadisticas() {
        try {
            const res = await fetch(`${API_URL}/api/estadisticas`, {
                credentials: 'include'
            });
            if (res.status === 401) {
                window.location.href = '/login.html';
                return;
            }
            const stats = await res.json();

            document.getElementById('stat-clientes').textContent = stats.totalClientes;
            document.getElementById('stat-responsables').textContent = stats.totalResponsables;
            document.getElementById('stat-asignaciones').textContent = stats.asignacionesSemanaActual;
        } catch (error) {
            console.error('Error cargando estadísticas:', error);
        }
    },

    async cargarResponsables() {
        try {
            const res = await fetch(`${API_URL}/api/responsables`, {
                credentials: 'include'
            });
            if (res.status === 401) {
                window.location.href = '/login.html';
                return;
            }
            this.responsables = await res.json();

            // Llenar selects de responsables
            const selects = document.querySelectorAll('#cliente-responsable, #visita-responsable');
            selects.forEach(select => {
                select.innerHTML = '<option value="">Sin asignar</option>';
                this.responsables.forEach(resp => {
                    const option = document.createElement('option');
                    option.value = resp.id;
                    option.textContent = resp.nombre;
                    select.appendChild(option);
                });
            });

            // Actualizar tabla de responsables
            const tbody = document.getElementById('responsables-table-body');
            if (tbody) {
                if (this.responsables.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="3" class="empty-state">No hay responsables registrados</td></tr>';
                } else {
                    tbody.innerHTML = this.responsables.map(resp => `
                        <tr>
                            <td>${resp.id}</td>
                            <td>${resp.nombre}</td>
                            <td><span class="tag tag-success">Activo</span></td>
                        </tr>
                    `).join('');
                }
            }

            // Cargar filtros después de cargar responsables
            if (this.clientes.length > 0) {
                this.cargarFiltros();
            }
        } catch (error) {
            console.error('Error cargando responsables:', error);
        }
    },

    async cargarClientes() {
        try {
            const res = await fetch(`${API_URL}/api/clientes`, {
                credentials: 'include'
            });
            if (res.status === 401) {
                window.location.href = '/login.html';
                return;
            }
            this.clientes = await res.json();
            this.renderClientes(this.clientes);
            // Cargar filtros después de cargar clientes
            if (this.responsables.length > 0) {
                this.cargarFiltros();
            }
        } catch (error) {
            console.error('Error cargando clientes:', error);
        }
    },

    renderClientes(clientes) {
        const tbody = document.getElementById('clientes-table-body');
        if (!tbody) return;

        const isAdmin = this.currentUser?.rol === 'admin';

        if (clientes.length === 0) {
            const colspan = isAdmin ? '9' : '3';
            tbody.innerHTML = `<tr><td colspan="${colspan}" class="empty-state">No hay clientes registrados</td></tr>`;
            return;
        }

        if (isAdmin) {
            // Vista completa para admin
            const docLabel = (tipo) => {
                const t = (tipo || 'invoice').toLowerCase();
                if (t === 'factura') return 'Factura';
                if (t === 'invoice') return 'Invoice';
                return 'Boleta';
            };
            tbody.innerHTML = clientes.map(cliente => `
                <tr>
                    <td>
                        <input type="checkbox" class="cliente-checkbox" value="${cliente.id}" onchange="app.actualizarSeleccion()">
                    </td>
                    <td>${cliente.id}</td>
                    <td><strong>${cliente.nombre}</strong></td>
                    <td>${cliente.comuna || '-'}</td>
                    <td><span class="tag tag-info">${docLabel(cliente.documento_tipo)}</span></td>
                    <td>${cliente.responsable_nombre || '<span class="tag tag-danger">Sin asignar</span>'}</td>
                    <td>${cliente.dia_atencion || '-'}</td>
                    <td>$${formatearPrecio(cliente.precio_por_visita)}</td>
                    <td class="actions">
                        <button class="btn btn-sm btn-primary" onclick="app.editarCliente(${cliente.id})">Editar</button>
                        <button class="btn btn-sm btn-info" onclick="app.asignarClienteManual(${cliente.id})" title="Asignar a semana específica">📅 Asignar</button>
                        <button class="btn btn-sm btn-success" onclick="app.abrirModalVisita(${cliente.id})">Registrar Visita</button>
                        <button class="btn btn-sm btn-danger" onclick="app.eliminarCliente(${cliente.id})">Eliminar</button>
                    </td>
                </tr>
            `).join('');
        } else {
            // Vista limitada para responsables (solo nombre y dirección)
            tbody.innerHTML = clientes.map(cliente => `
                <tr>
                    <td><strong>${cliente.nombre}</strong></td>
                    <td>${cliente.direccion || '-'}</td>
                    <td>${cliente.comuna || '-'}</td>
                </tr>
            `).join('');
        }
    },

    async eliminarCliente(id) {
        const ok = confirm('¿Eliminar este cliente?\n\nEsto lo desactiva (no se borra el historial).');
        if (!ok) return;
        try {
            this.showToast('Eliminando cliente…', 'info', 2000);
            const res = await fetch(`${API_URL}/api/clientes/${id}`, {
                method: 'DELETE',
                credentials: 'include'
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data.error || `Error HTTP ${res.status}`);
            }
            this.showToast('✅ Cliente eliminado (desactivado)', 'success', 3000);
            await this.cargarClientes();
        } catch (e) {
            console.error(e);
            this.showToast(`Error eliminando cliente: ${e?.message || e}`, 'error', 5000);
        }
    },

    asignarClienteManual(clienteId) {
        const cliente = this.clientes.find(c => c.id === clienteId);
        if (!cliente) {
            alert('Cliente no encontrado');
            return;
        }

        // Llenar el modal con datos del cliente
        document.getElementById('asignar-cliente-id').value = cliente.id;
        document.getElementById('asignar-cliente-nombre').value = cliente.nombre;

        // Establecer semana actual por defecto (lunes de esta semana)
        const hoy = new Date();
        const day = hoy.getDay();
        const diff = hoy.getDate() - day + (day === 0 ? -6 : 1);
        const monday = new Date(hoy.setDate(diff));
        const semanaActual = monday.toISOString().split('T')[0];
        document.getElementById('asignar-cliente-semana').value = semanaActual;

        // Cargar responsables en el select
        const responsableSelect = document.getElementById('asignar-cliente-responsable');
        responsableSelect.innerHTML = '<option value="">Usar responsable del cliente</option>';
        this.responsables.forEach(resp => {
            const option = document.createElement('option');
            option.value = resp.id;
            option.textContent = resp.nombre;
            if (cliente.responsable_id && resp.id === cliente.responsable_id) {
                option.selected = true;
            }
            responsableSelect.appendChild(option);
        });

        // Establecer día de atención del cliente si existe
        if (cliente.dia_atencion) {
            document.getElementById('asignar-cliente-dia').value = cliente.dia_atencion;
        }

        // Establecer precio del cliente
        if (cliente.precio_por_visita) {
            document.getElementById('asignar-cliente-precio').value = cliente.precio_por_visita;
        }

        this.showModal('asignar-cliente-modal');
    },

    async guardarAsignacionManual(e) {
        e.preventDefault();

        const clienteId = parseInt(document.getElementById('asignar-cliente-id').value);
        const semanaInicio = document.getElementById('asignar-cliente-semana').value;
        const responsableId = document.getElementById('asignar-cliente-responsable').value || null;
        const diaAtencion = document.getElementById('asignar-cliente-dia').value || null;
        const precio = document.getElementById('asignar-cliente-precio').value 
            ? parseFloat(document.getElementById('asignar-cliente-precio').value) 
            : null;

        if (!semanaInicio) {
            alert('Debes seleccionar una semana');
            return;
        }

        // Validar que sea un lunes
        const fecha = new Date(semanaInicio);
        if (fecha.getDay() !== 1) {
            if (!confirm('La fecha seleccionada no es un lunes. ¿Deseas continuar de todas formas?')) {
                return;
            }
        }

        try {
            this.showToast('Asignando cliente a semana...', 'info', 2000);
            const res = await fetch(`${API_URL}/api/asignaciones/asignar-manual`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    cliente_id: clienteId,
                    semana_inicio: semanaInicio,
                    responsable_id: responsableId ? parseInt(responsableId) : null,
                    dia_atencion: diaAtencion,
                    precio: precio
                })
            });

            if (res.status === 401) {
                window.location.href = '/login.html';
                return;
            }

            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                this.showToast(`✅ Cliente asignado a la semana ${semanaInicio}`, 'success', 3000);
                this.closeModal('asignar-cliente-modal');
                // Recargar asignaciones si estamos en esa página
                if (this.currentPage === 'asignaciones') {
                    await this.cargarAsignaciones();
                }
            } else {
                throw new Error(data.error || 'Error desconocido');
            }
        } catch (error) {
            console.error('Error asignando cliente:', error);
            this.showToast(`Error: ${error.message || 'Error desconocido'}`, 'error', 5000);
        }
    },

    async cargarFiltros() {
        // Cargar responsables para el filtro
        const responsableFilter = document.getElementById('responsable-filter');
        const bulkResponsable = document.getElementById('bulk-responsable');

        if (responsableFilter) {
            responsableFilter.innerHTML = '<option value="">Todos los responsables</option>';
            responsableFilter.innerHTML += '<option value="sin-asignar">❌ Sin asignar</option>';

            if (this.responsables.length > 0) {
                this.responsables.forEach(resp => {
                    const option = document.createElement('option');
                    option.value = resp.id;
                    option.textContent = resp.nombre;
                    responsableFilter.appendChild(option);
                });
            }
        }

        if (bulkResponsable) {
            bulkResponsable.innerHTML = '<option value="">Seleccionar responsable...</option>';
            if (this.responsables.length > 0) {
                this.responsables.forEach(resp => {
                    const option = document.createElement('option');
                    option.value = resp.id;
                    option.textContent = resp.nombre;
                    bulkResponsable.appendChild(option);
                });
            }
        }

        // Cargar comunas únicas para el filtro
        const comunaFilter = document.getElementById('comuna-filter');
        if (comunaFilter && this.clientes.length > 0) {
            const comunas = [...new Set(this.clientes.map(c => c.comuna).filter(c => c))].sort();
            comunaFilter.innerHTML = '<option value="">Todas las comunas</option>';
            comunas.forEach(comuna => {
                const option = document.createElement('option');
                option.value = comuna;
                option.textContent = comuna;
                comunaFilter.appendChild(option);
            });
        }
    },

    filtrarClientes() {
        const isAdmin = this.currentUser?.rol === 'admin';
        // Solo los admin pueden filtrar (responsables no tienen filtros)
        if (!isAdmin) {
            this.renderClientes(this.clientes);
            return;
        }

        const search = document.getElementById('cliente-search')?.value.toLowerCase() || '';
        const documento = document.getElementById('documento-filter')?.value || '';
        const responsableId = document.getElementById('responsable-filter')?.value || '';
        const comuna = document.getElementById('comuna-filter')?.value || '';
        const dia = document.getElementById('dia-filter')?.value || '';
        const asignado = document.getElementById('asignado-filter')?.value || '';

        let filtered = this.clientes;

        // Filtro de búsqueda por nombre
        if (search) {
            filtered = filtered.filter(c =>
                c.nombre.toLowerCase().includes(search) ||
                (c.direccion && c.direccion.toLowerCase().includes(search)) ||
                (c.comuna && c.comuna.toLowerCase().includes(search))
            );
        }

        // Filtro por responsable
        if (responsableId) {
            if (responsableId === 'sin-asignar') {
                filtered = filtered.filter(c => !c.responsable_id);
            } else {
                filtered = filtered.filter(c => c.responsable_id == responsableId);
            }
        }

        // Filtro por comuna
        if (comuna) {
            filtered = filtered.filter(c => c.comuna === comuna);
        }

        // Filtro por tipo de documento
        if (documento) {
            filtered = filtered.filter(c => (c.documento_tipo || 'invoice') === documento);
        }

        // Filtro por día
        if (dia) {
            filtered = filtered.filter(c => c.dia_atencion === dia);
        }

        // Filtro por asignado/sin asignar
        if (asignado === 'asignado') {
            filtered = filtered.filter(c => c.responsable_id);
        } else if (asignado === 'sin-asignar') {
            filtered = filtered.filter(c => !c.responsable_id);
        }

        this.renderClientes(filtered);
    },

    toggleSelectAll(checked) {
        document.querySelectorAll('.cliente-checkbox').forEach(cb => {
            cb.checked = checked;
        });
        this.actualizarSeleccion();
    },

    actualizarSeleccion() {
        const selected = document.querySelectorAll('.cliente-checkbox:checked');
        const count = selected.length;
        const bulkActions = document.getElementById('bulk-actions');
        const selectedCount = document.getElementById('selected-count');

        if (count > 0) {
            bulkActions.style.display = 'flex';
            selectedCount.textContent = `${count} seleccionado${count > 1 ? 's' : ''}`;
        } else {
            bulkActions.style.display = 'none';
        }

        // Actualizar checkbox "seleccionar todos"
        const selectAll = document.getElementById('select-all');
        const totalCheckboxes = document.querySelectorAll('.cliente-checkbox').length;
        if (selectAll) {
            selectAll.checked = count === totalCheckboxes && totalCheckboxes > 0;
            selectAll.indeterminate = count > 0 && count < totalCheckboxes;
        }
    },

    deseleccionarTodos() {
        document.querySelectorAll('.cliente-checkbox').forEach(cb => {
            cb.checked = false;
        });
        const selectAll = document.getElementById('select-all');
        if (selectAll) selectAll.checked = false;
        this.actualizarSeleccion();
    },

    configurarVistaClientesCompleta() {
        const adminHeaderRow = document.getElementById('admin-header-row');
        const responsableHeaderRow = document.getElementById('responsable-header-row');
        const filtersPanel = document.querySelector('.filters-panel');
        const btnNuevoCliente = document.getElementById('btn-nuevo-cliente');
        const infoResponsable = document.getElementById('clientes-info-responsable');

        if (adminHeaderRow) adminHeaderRow.style.display = '';
        if (responsableHeaderRow) responsableHeaderRow.style.display = 'none';
        if (filtersPanel) filtersPanel.style.display = 'block';
        if (btnNuevoCliente) btnNuevoCliente.style.display = 'inline-block';
        if (infoResponsable) infoResponsable.style.display = 'none';
    },

    configurarVistaClientesLimitada() {
        const adminHeaderRow = document.getElementById('admin-header-row');
        const responsableHeaderRow = document.getElementById('responsable-header-row');
        const filtersPanel = document.querySelector('.filters-panel');
        const btnNuevoCliente = document.getElementById('btn-nuevo-cliente');
        const infoResponsable = document.getElementById('clientes-info-responsable');

        if (adminHeaderRow) adminHeaderRow.style.display = 'none';
        if (responsableHeaderRow) responsableHeaderRow.style.display = '';
        if (filtersPanel) filtersPanel.style.display = 'none';
        if (btnNuevoCliente) btnNuevoCliente.style.display = 'none';
        if (infoResponsable) infoResponsable.style.display = 'block';
    },

    async asignarResponsableMasivo() {
        const selected = Array.from(document.querySelectorAll('.cliente-checkbox:checked')).map(cb => parseInt(cb.value));
        const responsableId = document.getElementById('bulk-responsable').value;

        if (selected.length === 0) {
            alert('Por favor selecciona al menos un cliente');
            return;
        }

        if (!responsableId) {
            alert('Por favor selecciona un responsable');
            return;
        }

        if (!confirm(`¿Asignar ${selected.length} cliente(s) al responsable seleccionado?`)) {
            return;
        }

        try {
            // Actualizar cada cliente
            const promises = selected.map(clienteId =>
                fetch(`${API_URL}/api/clientes/${clienteId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ responsable_id: parseInt(responsableId) })
                })
            );

            await Promise.all(promises);

            alert(`✓ ${selected.length} cliente(s) asignado(s) correctamente`);

            // Recargar clientes y limpiar selección
            await this.cargarClientes();
            this.deseleccionarTodos();
            this.cargarFiltros();
        } catch (error) {
            console.error('Error asignando responsables:', error);
            alert('Error al asignar responsables');
        }
    },

    async cargarAsignaciones() {
        let semana = document.getElementById('semana-selector')?.value;
        if (!semana) {
            const hoy = new Date();
            const day = hoy.getDay();
            const diff = hoy.getDate() - day + (day === 0 ? -6 : 1);
            const monday = new Date(hoy.setDate(diff));
            semana = monday.toISOString().split('T')[0];
            if (document.getElementById('semana-selector')) {
                document.getElementById('semana-selector').value = semana;
            }
        }

        try {
            const res = await fetch(`${API_URL}/api/asignaciones/${semana}`, {
                credentials: 'include'
            });
            if (res.status === 401) {
                window.location.href = '/login.html';
                return;
            }
            this.asignaciones = await res.json();
            console.log('Asignaciones cargadas:', this.asignaciones.length, 'con notas:', this.asignaciones.filter(a => a.notas && a.notas.trim() !== '').length);
            this.renderAsignaciones(this.asignaciones);
        } catch (error) {
            console.error('Error cargando asignaciones:', error);
            document.getElementById('asignaciones-container').innerHTML =
                '<div class="error">Error al cargar asignaciones</div>';
        }
    },

    renderAsignaciones(asignaciones) {
        const container = document.getElementById('asignaciones-container');

        if (asignaciones.length === 0) {
            container.innerHTML = '<div class="empty-state"><h3>No hay asignaciones para esta semana</h3></div>';
            return;
        }

        // Debug: verificar notas en asignaciones
        console.log('[Frontend] Renderizando asignaciones:', asignaciones.length);
        asignaciones.forEach((asig, idx) => {
            if (asig.notas && asig.notas.trim() !== '') {
                console.log(`[Frontend] Asignación ${asig.id} (${asig.cliente_nombre}) tiene nota:`, asig.notas.substring(0, 50));
            }
        });

        // Agrupar por día
        const porDia = {};
        asignaciones.forEach(asig => {
            const dia = asig.dia_atencion || 'Sin día asignado';
            if (!porDia[dia]) porDia[dia] = [];
            porDia[dia].push(asig);
        });

        const diasOrden = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
        const otrosDias = Object.keys(porDia).filter(d => !diasOrden.includes(d));

        container.innerHTML = `
            <div class="asignaciones-grid">
                ${diasOrden.map(dia => {
            if (!porDia[dia]) return '';
            return `
                        <div class="dia-section">
                            <h3>${dia}</h3>
                            ${porDia[dia].map(asig => `
                                <div class="asignacion-item" data-asignacion-id="${asig.id}">
                                    <div class="asignacion-info">
                                        <h4>${asig.cliente_nombre}</h4>
                                        <p>${asig.direccion || ''} ${asig.comuna || ''}</p>
                                        <p>Responsable: ${asig.responsable_nombre || 'Sin asignar'}${this.currentUser?.rol === 'admin' ? ` | Precio: $${formatearPrecio(asig.precio)}` : ''}</p>
                                        <div class="asignacion-nota" id="nota-${asig.id}">
                                            ${asig.notas && asig.notas.trim() !== '' ? `<p class="nota-text"><strong>Nota:</strong> ${asig.notas.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/\n/g, '<br>')}</p>` : ''}
                                            <button class="btn-link" onclick="app.editarNota(${asig.id})" style="font-size: 0.85rem; color: var(--primary); text-decoration: none; border: none; background: none; cursor: pointer; padding: 0;">
                                                ${asig.notas && asig.notas.trim() !== '' ? '✏️ Editar nota' : '+ Agregar nota'}
                                            </button>
                                        </div>
                                    </div>
                                    <div class="asignacion-actions">
                                        ${asig.realizada
                    ? `<button class="btn btn-success btn-sm" onclick="app.marcarAsignacionRealizada(${asig.id}, false)" style="min-width: 120px;">
                                                ✓ Realizada
                                               </button>`
                    : `<button class="btn btn-primary btn-sm" onclick="app.marcarAsignacionRealizada(${asig.id}, true)" style="min-width: 120px;">
                                                Marcar Realizada
                                               </button>`
                }
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    `;
        }).join('')}
                ${otrosDias.map(dia => `
                    <div class="dia-section">
                        <h3>${dia}</h3>
                        ${porDia[dia].map(asig => `
                            <div class="asignacion-item">
                                    <div class="asignacion-info">
                                        <h4>${asig.cliente_nombre}</h4>
                                        <p>${asig.direccion || ''} ${asig.comuna || ''}</p>
                                        <div class="asignacion-nota" id="nota-${asig.id}">
                                            ${asig.notas && asig.notas.trim() !== '' ? `<p class="nota-text"><strong>Nota:</strong> ${asig.notas.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/\n/g, '<br>')}</p>` : ''}
                                            <button class="btn-link" onclick="app.editarNota(${asig.id})" style="font-size: 0.85rem; color: var(--primary); text-decoration: none; border: none; background: none; cursor: pointer; padding: 0;">
                                                ${asig.notas && asig.notas.trim() !== '' ? '✏️ Editar nota' : '+ Agregar nota'}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                        `).join('')}
                    </div>
                `).join('')}
            </div>
        `;
    },

    configurarSemanaActual() {
        const hoy = new Date();
        const day = hoy.getDay();
        const diff = hoy.getDate() - day + (day === 0 ? -6 : 1);
        const monday = new Date(hoy.setDate(diff));
        document.getElementById('semana-selector').value = monday.toISOString().split('T')[0];
    },

    async marcarAsignacionRealizada(id, realizada) {
        try {
            // Evitar doble click
            if (this.pendingAsignaciones.has(id)) return;
            this.pendingAsignaciones.add(id);

            // Feedback inmediato
            const card = document.querySelector(`.asignacion-item[data-asignacion-id="${id}"]`);
            const btn = card?.querySelector('.asignacion-actions button');
            const prevText = btn?.textContent;
            if (btn) {
                btn.classList.add('btn-loading');
                btn.disabled = true;
                btn.textContent = 'Por favor espere, registrando su visita';
            } else {
                this.showToast('Por favor espere, registrando su visita…', 'info', 2000);
            }

            const res = await fetch(`${API_URL}/api/asignaciones/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ realizada: realizada ? 1 : 0 })
            });

            if (res.status === 401) {
                window.location.href = '/login.html';
                return;
            }
            const data = await res.json().catch(() => null);
            if (!res.ok) {
                const msg = data?.error || `HTTP ${res.status}`;
                this.showToast(`Error: ${msg}`, 'error', 4000);
                return;
            }

            // Mostrar resultado de emisión Odoo si aplica
            if (realizada) {
                if (data?.odoo?.name) {
                    this.showToast(`✅ Visita registrada. Odoo: ${data.odoo.name} (${data.odoo.payment_state || 'pendiente'})`, 'success', 5000);
                } else if (data?.odoo_error) {
                    this.showToast('✅ Visita registrada, pero quedó pendiente de emitir en Odoo', 'warning', 5000);
                    setTimeout(() => alert(`Odoo falló al emitir:\n${data.odoo_error}\n\n(Quedó pendiente de emisión)`), 100);
                }
            }

            // Actualizar asignaciones
            await this.cargarAsignaciones();

            // Si es admin y está viendo progreso, actualizar también
            if (this.currentUser?.rol === 'admin' && this.currentPage === 'progreso') {
                setTimeout(() => this.cargarProgreso(), 500);
            }
        } catch (error) {
            console.error('Error marcando asignación:', error);
            this.showToast('Error al actualizar la asignación', 'error', 4000);
        } finally {
            this.pendingAsignaciones.delete(id);
            const card = document.querySelector(`.asignacion-item[data-asignacion-id="${id}"]`);
            const btn = card?.querySelector('.asignacion-actions button');
            if (btn) {
                btn.classList.remove('btn-loading');
                btn.disabled = false;
                // El texto real se recalcula al recargar; si no recargó, restaurar texto anterior
                if (btn.textContent.includes('Por favor espere')) {
                    btn.textContent = (typeof prevText === 'string' && prevText.trim()) ? prevText : 'Actualizar';
                }
            }
        }
    },

    async cargarProgreso() {
        let semana = document.getElementById('progreso-semana-selector')?.value;
        if (!semana) {
            const hoy = new Date();
            const day = hoy.getDay();
            const diff = hoy.getDate() - day + (day === 0 ? -6 : 1);
            const monday = new Date(hoy.setDate(diff));
            semana = monday.toISOString().split('T')[0];
            if (document.getElementById('progreso-semana-selector')) {
                document.getElementById('progreso-semana-selector').value = semana;
            }
        }

        // Mostrar indicador de actualización
        const header = document.querySelector('#progreso-page .page-header');
        if (header && !document.querySelector('.update-indicator')) {
            const indicator = document.createElement('div');
            indicator.className = 'update-indicator';
            indicator.innerHTML = '🔄 Actualizando...';
            indicator.style.cssText = 'font-size: 0.85rem; color: var(--secondary); margin-top: 0.5rem;';
            header.appendChild(indicator);
        }

        try {
            const res = await fetch(`${API_URL}/api/progreso/${semana}`, {
                credentials: 'include'
            });

            if (res.status === 401) {
                window.location.href = '/login.html';
                return;
            }

            if (res.status === 403) {
                document.getElementById('progreso-container').innerHTML =
                    '<div class="empty-state"><h3>No tienes permisos para ver esta información</h3></div>';
                return;
            }

            const progreso = await res.json();
            this.renderProgreso(progreso);
        } catch (error) {
            console.error('Error cargando progreso:', error);
            document.getElementById('progreso-container').innerHTML =
                '<div class="error">Error al cargar el progreso</div>';
        }
    },

    renderProgreso(progreso) {
        const container = document.getElementById('progreso-container');

        // Remover indicador de actualización
        const updateIndicator = document.querySelector('.update-indicator');
        if (updateIndicator) updateIndicator.remove();

        if (!progreso || progreso.length === 0) {
            container.innerHTML = '<div class="empty-state"><h3>No hay datos para esta semana</h3></div>';
            return;
        }

        container.innerHTML = `
            <div class="progreso-grid">
                ${progreso.map(resp => {
            const porcentaje = resp.total > 0 ? Math.round((resp.realizadas / resp.total) * 100) : 0;
            const porcentajeColor = porcentaje === 100 ? 'var(--success)' : porcentaje >= 50 ? 'var(--primary)' : 'var(--warning)';

            return `
                        <div class="progreso-card">
                            <div class="progreso-header">
                                <h3>${resp.responsable_nombre || 'Sin asignar'}</h3>
                                <span class="progreso-badge" style="background: ${porcentajeColor}">
                                    ${porcentaje}%
                                </span>
                            </div>
                            <div class="progreso-stats">
                                <div class="progreso-stat">
                                    <span class="stat-label">Realizadas:</span>
                                    <span class="stat-value" style="color: var(--success)">${resp.realizadas}</span>
                                </div>
                                <div class="progreso-stat">
                                    <span class="stat-label">Pendientes:</span>
                                    <span class="stat-value" style="color: var(--warning)">${resp.pendientes}</span>
                                </div>
                                <div class="progreso-stat">
                                    <span class="stat-label">Total:</span>
                                    <span class="stat-value">${resp.total}</span>
                                </div>
                            </div>
                            <div class="progreso-bar-container">
                                <div class="progreso-bar" style="width: ${porcentaje}%; background: ${porcentajeColor};"></div>
                            </div>
                            <div class="progreso-dias">
                                ${Object.entries(resp.por_dia || {}).map(([dia, datos]) => `
                                    <div class="progreso-dia">
                                        <strong>${dia}:</strong> ${datos.realizadas}/${datos.total}
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    `;
        }).join('')}
            </div>
        `;
    },

    async actualizarProgreso() {
        await this.cargarProgreso();
    },

    async cargarNotas() {
        let semana = document.getElementById('notas-semana-selector')?.value;
        if (!semana) {
            const hoy = new Date();
            const day = hoy.getDay();
            const diff = hoy.getDate() - day + (day === 0 ? -6 : 1);
            const monday = new Date(hoy.setDate(diff));
            semana = monday.toISOString().split('T')[0];
            if (document.getElementById('notas-semana-selector')) {
                document.getElementById('notas-semana-selector').value = semana;
            }
        }

        try {
            const res = await fetch(`${API_URL}/api/asignaciones/${semana}`, {
                credentials: 'include'
            });

            if (res.status === 401) {
                window.location.href = '/login.html';
                return;
            }

            const asignaciones = await res.json();
            // Filtrar solo las que tienen notas
            const conNotas = asignaciones.filter(a => a.notas && a.notas.trim() !== '');
            this.renderNotas(conNotas, semana);
        } catch (error) {
            console.error('Error cargando notas:', error);
            document.getElementById('notas-container').innerHTML =
                '<div class="error">Error al cargar las notas</div>';
        }
    },

    renderNotas(asignaciones, semana) {
        const container = document.getElementById('notas-container');

        if (asignaciones.length === 0) {
            container.innerHTML = '<div class="empty-state"><h3>No hay notas para esta semana</h3><p>Las notas aparecerán aquí cuando se agreguen a las asignaciones.</p></div>';
            return;
        }

        // Agrupar por día
        const porDia = {};
        asignaciones.forEach(asig => {
            const dia = asig.dia_atencion || 'Sin día asignado';
            if (!porDia[dia]) porDia[dia] = [];
            porDia[dia].push(asig);
        });

        const diasOrden = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
        const otrosDias = Object.keys(porDia).filter(d => !diasOrden.includes(d));

        container.innerHTML = `
            <div class="notas-summary">
                <div class="summary-card">
                    <h3>📝 Resumen</h3>
                    <p><strong>Total de notas:</strong> ${asignaciones.length}</p>
                    <p><strong>Semana:</strong> ${semana}</p>
                </div>
            </div>
            <div class="asignaciones-grid">
                ${diasOrden.map(dia => {
            if (!porDia[dia]) return '';
            return `
                        <div class="dia-section">
                            <h3>${dia} (${porDia[dia].length} nota${porDia[dia].length > 1 ? 's' : ''})</h3>
                            ${porDia[dia].map(asig => `
                                <div class="asignacion-item nota-item">
                                    <div class="asignacion-info">
                                        <h4>${asig.cliente_nombre}</h4>
                                        <p>${asig.direccion || ''} ${asig.comuna || ''}</p>
                                        <p>Responsable: ${asig.responsable_nombre || 'Sin asignar'} | Precio: $${formatearPrecio(asig.precio)}</p>
                                        <div class="nota-display">
                                            <p class="nota-text-large"><strong>Nota:</strong> ${asig.notas.replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/\n/g, '<br>')}</p>
                                            <button class="btn btn-sm btn-primary" onclick="app.editarNota(${asig.id})" style="margin-top: 0.5rem;">
                                                ✏️ Editar nota
                                            </button>
                                        </div>
                                    </div>
                                    <div class="asignacion-actions">
                                        ${asig.realizada
                    ? `<span class="tag tag-success">✓ Realizada</span>`
                    : `<span class="tag tag-warning">Pendiente</span>`
                }
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    `;
        }).join('')}
                ${otrosDias.map(dia => `
                    <div class="dia-section">
                        <h3>${dia}</h3>
                        ${porDia[dia].map(asig => `
                            <div class="asignacion-item nota-item">
                                <div class="asignacion-info">
                                    <h4>${asig.cliente_nombre}</h4>
                                    <div class="nota-display">
                                        <p class="nota-text-large"><strong>Nota:</strong> ${asig.notas.replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/\n/g, '<br>')}</p>
                                    </div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                `).join('')}
            </div>
        `;
    },

    editarNota(asignacionId) {
        // Buscar la asignación para obtener la nota actual
        const asignacion = this.asignaciones.find(a => a.id === asignacionId);
        const notaActual = asignacion?.notas || '';

        document.getElementById('nota-asignacion-id').value = asignacionId;
        document.getElementById('nota-texto').value = notaActual;
        this.showModal('nota-modal');
    },

    async guardarNota(e) {
        e.preventDefault();

        const asignacionId = document.getElementById('nota-asignacion-id').value;
        const nota = document.getElementById('nota-texto').value.trim();

        try {
            const res = await fetch(`${API_URL}/api/asignaciones/${asignacionId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ notas: nota })
            });

            if (res.status === 401) {
                window.location.href = '/login.html';
                return;
            }

            if (res.ok) {
                const data = await res.json();
                this.closeModal('nota-modal');
                // Recargar asignaciones inmediatamente
                await this.cargarAsignaciones();
                // Si es admin y está viendo progreso o notas, actualizar también
                if (this.currentUser?.rol === 'admin') {
                    if (this.currentPage === 'progreso') {
                        setTimeout(() => this.cargarProgreso(), 500);
                    } else if (this.currentPage === 'notas') {
                        setTimeout(() => this.cargarNotas(), 500);
                    }
                }
                // Mostrar confirmación
                console.log('Nota guardada exitosamente');
            } else {
                const errorData = await res.json().catch(() => ({ error: 'Error desconocido' }));
                console.error('Error al guardar nota:', errorData);
                alert('Error al guardar la nota: ' + (errorData.error || 'Error desconocido'));
            }
        } catch (error) {
            console.error('Error guardando nota:', error);
            alert('Error al guardar la nota');
        }
    },

    iniciarAutoActualizacion() {
        // Si es admin y está en la página de progreso, actualizar cada 30 segundos
        if (this.currentUser?.rol === 'admin') {
            this.autoUpdateInterval = setInterval(() => {
                if (this.currentPage === 'progreso') {
                    this.cargarProgreso();
                }
            }, 30000); // Actualizar cada 30 segundos
        }
    },

    showModal(modalId) {
        document.getElementById(modalId).classList.add('active');
        if (modalId === 'cliente-modal') {
            this.actualizarCamposDocumento();
        }
    },

    closeModal(modalId) {
        document.getElementById(modalId).classList.remove('active');
        if (modalId === 'cliente-modal') {
            document.getElementById('cliente-form').reset();
            document.getElementById('cliente-id').value = '';
            document.getElementById('cliente-modal-title').textContent = 'Nuevo Cliente';
            if (typeof this.actualizarCamposDocumento === 'function') {
                this.actualizarCamposDocumento();
            }
        } else if (modalId === 'nota-modal') {
            document.getElementById('nota-form').reset();
            document.getElementById('nota-asignacion-id').value = '';
        }
    },

    actualizarCamposDocumento() {
        const tipo = document.getElementById('cliente-documento-tipo')?.value || 'invoice';
        const facturaFields = document.getElementById('factura-fields');

        if (facturaFields) facturaFields.style.display = tipo === 'factura' ? 'block' : 'none';
    },

    async guardarCliente(e) {
        e.preventDefault();

        // Usar validador de RUT (disponible en rut-validator.js)
        const rutValidate = window.rutjs?.validate;
        const rutClean = window.rutjs?.clean;

        const documentoTipo = document.getElementById('cliente-documento-tipo')?.value || 'invoice';
        const rut = document.getElementById('cliente-rut')?.value?.trim() || '';
        const email = document.getElementById('cliente-email')?.value?.trim() || '';
        const direccion = document.getElementById('cliente-direccion')?.value?.trim() || '';
        const comuna = document.getElementById('cliente-comuna')?.value?.trim() || '';

        // Validar RUT del cliente si se proporciona
        if (rut) {
            if (rutValidate && !rutValidate(rut)) {
                alert('El RUT del cliente no es válido. Por favor, verifica el formato (ej: 12.345.678-9)');
                return;
            } else if (!rutValidate) {
                // Validación básica si rut.js no está disponible
                const rutPattern = /^[\d\.]+-[\dkK]$/;
                if (!rutPattern.test(rut)) {
                    alert('El RUT del cliente no tiene un formato válido. Debe ser como: 12.345.678-9');
                    return;
                }
            }
        }

        // Validaciones Factura / Invoice
        const factura_razon_social = document.getElementById('factura-razon-social')?.value?.trim() || '';
        const factura_rut = document.getElementById('factura-rut')?.value?.trim() || '';
        const factura_giro = document.getElementById('factura-giro')?.value?.trim() || '';
        const factura_direccion = document.getElementById('factura-direccion')?.value?.trim() || '';
        const factura_comuna = document.getElementById('factura-comuna')?.value?.trim() || '';
        const factura_email = document.getElementById('factura-email')?.value?.trim() || '';

        // Validar RUT de factura si es factura y se proporciona
        if (documentoTipo === 'factura' && factura_rut) {
            if (rutValidate && !rutValidate(factura_rut)) {
                alert('El RUT de factura no es válido. Por favor, verifica el formato (ej: 12.345.678-9)');
                return;
            } else if (!rutValidate) {
                // Validación básica si rut.js no está disponible
                const rutPattern = /^[\d\.]+-[\dkK]$/;
                if (!rutPattern.test(factura_rut)) {
                    alert('El RUT de factura no tiene un formato válido. Debe ser como: 12.345.678-9');
                    return;
                }
            }
        }

        const cliente = {
            nombre: document.getElementById('cliente-nombre').value,
            rut: rut || null,
            direccion: direccion || null,
            comuna: comuna || null,
            celular: document.getElementById('cliente-celular').value || null,
            email: email || null,
            documento_tipo: documentoTipo,
            // Factura
            factura_razon_social: (documentoTipo === 'factura' && factura_razon_social) ? factura_razon_social : null,
            factura_rut: (documentoTipo === 'factura' && factura_rut) ? factura_rut : null,
            factura_giro: (documentoTipo === 'factura' && factura_giro) ? factura_giro : null,
            factura_direccion: (documentoTipo === 'factura' && factura_direccion) ? factura_direccion : null,
            factura_comuna: (documentoTipo === 'factura' && factura_comuna) ? factura_comuna : null,
            factura_email: (documentoTipo === 'factura' && factura_email) ? factura_email : null,
            // Operación
            responsable_id: document.getElementById('cliente-responsable').value || null,
            dia_atencion: Array.from(document.querySelectorAll('.day-check:checked')).map(cb => cb.value).join(',') || null,
            precio_por_visita: parseFloat(document.getElementById('cliente-precio').value) || 0
        };

        const id = document.getElementById('cliente-id').value;
        const url = id ? `${API_URL}/api/clientes/${id}` : `${API_URL}/api/clientes`;
        const method = id ? 'PUT' : 'POST';

        try {
            if (id) cliente.id = id;
            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(cliente)
            });

            if (res.status === 401) {
                window.location.href = '/login.html';
                return;
            }

            if (res.ok) {
                this.closeModal('cliente-modal');
                this.cargarClientes();
                this.cargarEstadisticas();
            } else {
                const errorData = await res.json().catch(() => ({ error: 'Error desconocido' }));
                console.error('Error guardando cliente:', errorData);
                alert('Error al guardar el cliente: ' + (errorData.error || 'Error desconocido'));
            }
        } catch (error) {
            console.error('Error guardando cliente:', error);
            alert('Error al guardar el cliente: ' + (error.message || 'Error desconocido'));
        }
    },

    async editarCliente(id) {
        const cliente = this.clientes.find(c => c.id === id);
        if (!cliente) return;

        document.getElementById('cliente-id').value = cliente.id;
        document.getElementById('cliente-nombre').value = cliente.nombre;
        if (document.getElementById('cliente-rut')) document.getElementById('cliente-rut').value = cliente.rut || '';
        document.getElementById('cliente-direccion').value = cliente.direccion || '';
        document.getElementById('cliente-comuna').value = cliente.comuna || '';
        document.getElementById('cliente-celular').value = cliente.celular || '';
        if (document.getElementById('cliente-email')) document.getElementById('cliente-email').value = cliente.email || '';
        if (document.getElementById('cliente-documento-tipo')) {
            document.getElementById('cliente-documento-tipo').value = cliente.documento_tipo || 'invoice';
        }
        // Factura
        if (document.getElementById('factura-razon-social')) document.getElementById('factura-razon-social').value = cliente.factura_razon_social || '';
        if (document.getElementById('factura-rut')) document.getElementById('factura-rut').value = cliente.factura_rut || '';
        if (document.getElementById('factura-giro')) document.getElementById('factura-giro').value = cliente.factura_giro || '';
        if (document.getElementById('factura-direccion')) document.getElementById('factura-direccion').value = cliente.factura_direccion || '';
        if (document.getElementById('factura-comuna')) document.getElementById('factura-comuna').value = cliente.factura_comuna || '';
        if (document.getElementById('factura-email')) document.getElementById('factura-email').value = cliente.factura_email || '';

        document.getElementById('cliente-responsable').value = cliente.responsable_id || '';

        // Cargar días
        const dias = (cliente.dia_atencion || '').split(',').map(d => d.trim());
        document.querySelectorAll('.day-check').forEach(cb => {
            cb.checked = dias.includes(cb.value);
        });

        document.getElementById('cliente-precio').value = cliente.precio_por_visita || 0;

        document.getElementById('cliente-modal-title').textContent = 'Editar Cliente';
        this.actualizarCamposDocumento();
        this.showModal('cliente-modal');
    },

    nuevoCliente() {
        document.getElementById('cliente-form').reset();
        document.getElementById('cliente-id').value = '';
        document.getElementById('cliente-modal-title').textContent = 'Nuevo Cliente';
        document.querySelectorAll('.day-check').forEach(cb => cb.checked = false);
        this.actualizarCamposDocumento();
        this.showModal('cliente-modal');
    },

    async guardarResponsable(e) {
        e.preventDefault();

        const nombre = document.getElementById('responsable-nombre').value;

        try {
            const res = await fetch(`${API_URL}/api/responsables`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ nombre })
            });

            if (res.status === 401) {
                window.location.href = '/login.html';
                return;
            }

            if (res.ok) {
                this.closeModal('responsable-modal');
                document.getElementById('responsable-form').reset();
                this.cargarResponsables();
                this.cargarEstadisticas();
            } else {
                alert('Error al guardar el responsable');
            }
        } catch (error) {
            console.error('Error guardando responsable:', error);
            alert('Error al guardar el responsable');
        }
    },

    abrirModalVisita(clienteId) {
        const cliente = this.clientes.find(c => c.id === clienteId);
        if (!cliente) return;

        document.getElementById('visita-cliente-id').value = clienteId;
        document.getElementById('visita-cliente-nombre').value = cliente.nombre;
        document.getElementById('visita-fecha').value = new Date().toISOString().split('T')[0];
        document.getElementById('visita-responsable').value = cliente.responsable_id || '';
        document.getElementById('visita-precio').value = cliente.precio_por_visita || 0;

        this.showModal('visita-modal');
    },

    async registrarVisita(e) {
        e.preventDefault();

        const visita = {
            cliente_id: parseInt(document.getElementById('visita-cliente-id').value),
            fecha_visita: document.getElementById('visita-fecha').value,
            responsable_id: document.getElementById('visita-responsable').value || this.currentUser?.responsable_id || null,
            precio: parseFloat(document.getElementById('visita-precio').value) || null,
            realizada: true
        };

        try {
            const res = await fetch(`${API_URL}/api/visitas`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(visita)
            });

            if (res.status === 401) {
                window.location.href = '/login.html';
                return;
            }

            if (res.ok) {
                this.closeModal('visita-modal');
                const data = await res.json();
                if (data?.odoo?.name) {
                    alert(`Visita registrada ✅\nDocumento Odoo: ${data.odoo.name}\nEstado pago: ${data.odoo.payment_state || 'pendiente'}`);
                } else if (data?.odoo_error) {
                    alert(`Visita registrada ✅\nPero Odoo falló al emitir el documento:\n${data.odoo_error}\n\n(Quedó pendiente de emisión)`);
                } else {
                    alert('Visita registrada correctamente');
                }
                this.cargarAsignaciones();
            } else {
                const errJson = await res.json().catch(() => null);
                const msg = errJson?.error || `HTTP ${res.status}`;
                console.error('Error al registrar visita:', errJson || msg);
                alert(`Error al registrar la visita: ${msg}`);
            }
        } catch (error) {
            console.error('Error registrando visita:', error);
            alert(`Error al registrar la visita: ${error?.message || error}`);
        }
    },

    // Reportes
    async cargarReportes() {
        try {
            const container = document.getElementById('reportes-container');
            if (container) {
                container.innerHTML = '<div class="loading">Cargando reportes...</div>';
            }

            const clienteId = document.getElementById('reporte-cliente-filter')?.value || '';
            const responsableId = document.getElementById('reporte-responsable-filter')?.value || '';

            let url = `${API_URL}/api/reportes/visitas-sin-pagar?`;
            if (clienteId) url += `cliente_id=${clienteId}&`;
            if (responsableId) url += `responsable_id=${responsableId}&`;

            const res = await fetch(url, {
                credentials: 'include'
            });

            if (res.status === 401) {
                window.location.href = '/login.html';
                return;
            }

            if (res.status === 403) {
                if (container) {
                    container.innerHTML = '<div class="empty-state">No tienes permisos para ver reportes</div>';
                }
                return;
            }

            if (!res.ok) {
                let errorData;
                try {
                    errorData = await res.json();
                } catch (e) {
                    // Si no es JSON, leer como texto
                    const text = await res.text();
                    throw new Error(`Error HTTP ${res.status}: ${text || 'Error desconocido'}`);
                }
                throw new Error(errorData.error || `Error HTTP ${res.status}`);
            }

            const visitas = await res.json();

            // Verificar que visitas sea un array
            if (!Array.isArray(visitas)) {
                throw new Error('La respuesta del servidor no es válida');
            }

            this.renderReportes(visitas);

            // Cargar filtros si no están cargados
            if (this.clientes.length === 0 || this.responsables.length === 0) {
                await Promise.all([this.cargarClientes(), this.cargarResponsables()]);
            }
            this.cargarFiltrosReportes();
        } catch (error) {
            console.error('Error cargando reportes:', error);
            const container = document.getElementById('reportes-container');
            if (container) {
                container.innerHTML = `<div class="error">Error al cargar reportes: ${error.message || error}</div>`;
            }
        }
    },

    cargarFiltrosReportes() {
        // Cargar clientes en el filtro
        const clienteFilter = document.getElementById('reporte-cliente-filter');
        if (clienteFilter && this.clientes.length > 0) {
            clienteFilter.innerHTML = '<option value="">Todos los clientes</option>';
            this.clientes.forEach(cliente => {
                const option = document.createElement('option');
                option.value = cliente.id;
                option.textContent = cliente.nombre;
                clienteFilter.appendChild(option);
            });
        }

        // Cargar responsables en el filtro
        const responsableFilter = document.getElementById('reporte-responsable-filter');
        if (responsableFilter && this.responsables.length > 0) {
            responsableFilter.innerHTML = '<option value="">Todos los responsables</option>';
            this.responsables.forEach(resp => {
                const option = document.createElement('option');
                option.value = resp.id;
                option.textContent = resp.nombre;
                responsableFilter.appendChild(option);
            });
        }
    },

    renderReportes(visitas) {
        const container = document.getElementById('reportes-container');
        const resumenDiv = document.getElementById('reportes-resumen');
        const totalVisitas = document.getElementById('reporte-total-visitas');
        const totalMonto = document.getElementById('reporte-total-monto');
        const btnCopiar = document.getElementById('btn-copiar-whatsapp');

        if (!container) return;

        if (visitas.length === 0) {
            container.innerHTML = '<div class="empty-state">No hay visitas sin pagar</div>';
            resumenDiv.style.display = 'none';
            if (btnCopiar) btnCopiar.style.display = 'none';
            return;
        }

        // Guardar visitas para poder copiarlas después
        this.visitasSinPagar = visitas;

        // Calcular totales
        const total = visitas.length;
        const montoTotal = visitas.reduce((sum, v) => sum + (parseFloat(v.precio) || 0), 0);

        if (totalVisitas) totalVisitas.textContent = total;
        if (totalMonto) totalMonto.textContent = `$${formatearPrecio(montoTotal)}`;
        if (resumenDiv) resumenDiv.style.display = 'block';
        if (btnCopiar) btnCopiar.style.display = 'inline-block';

        // Formatear fecha para mostrar (DD-MM-YYYY)
        const formatearFecha = (fecha) => {
            if (!fecha) return '-';
            try {
                const d = new Date(fecha);
                const dia = String(d.getDate()).padStart(2, '0');
                const mes = String(d.getMonth() + 1).padStart(2, '0');
                const año = d.getFullYear();
                return `${dia}-${mes}-${año}`;
            } catch {
                return fecha;
            }
        };

        // Agrupar visitas por cliente
        const porCliente = {};
        visitas.forEach(v => {
            const clienteId = v.cliente_id;
            if (!porCliente[clienteId]) {
                porCliente[clienteId] = {
                    cliente_id: clienteId,
                    cliente_nombre: v.cliente_nombre || 'Sin nombre',
                    cliente_rut: v.cliente_rut || '',
                    cliente_celular: v.cliente_celular || '',
                    visitas: []
                };
            }
            porCliente[clienteId].visitas.push(v);
        });

        // Renderizar clientes agrupados
        let html = '';
        Object.values(porCliente).forEach(cliente => {
            const totalCliente = cliente.visitas.reduce((sum, v) => sum + (parseFloat(v.precio) || 0), 0);
            const fechasVisitas = cliente.visitas.map(v => formatearFecha(v.fecha_visita)).join(', ');

            html += `
                <div class="cliente-reporte-card" style="background: white; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; padding-bottom: 0.75rem; border-bottom: 2px solid #e0e0e0;">
                        <div>
                            <h3 style="margin: 0; font-size: 1.2rem; color: #333;">${cliente.cliente_nombre}</h3>
                            ${cliente.cliente_rut ? `<div style="color: #666; font-size: 0.9rem; margin-top: 0.25rem;">RUT: ${cliente.cliente_rut}</div>` : ''}
                            ${cliente.cliente_celular ? `<div style="color: #666; font-size: 0.9rem;">Tel: ${cliente.cliente_celular}</div>` : ''}
                        </div>
                        <div style="text-align: right;">
                            <div style="font-size: 1.1rem; font-weight: bold; color: #d32f2f;">
                                Total Pendiente: $${formatearPrecio(totalCliente)}
                            </div>
                            <div style="color: #666; font-size: 0.9rem; margin-top: 0.25rem;">
                                ${cliente.visitas.length} visita${cliente.visitas.length > 1 ? 's' : ''}
                            </div>
                        </div>
                    </div>
                    <div style="margin-bottom: 0.75rem;">
                        <strong>Visitas sin pagar:</strong> ${fechasVisitas}
                    </div>
                    <div>
                        <table style="width: 100%; border-collapse: collapse;">
                            <thead>
                                <tr style="background: #f5f5f5;">
                                    <th style="padding: 0.5rem; text-align: left; border-bottom: 1px solid #ddd; width: 40px;">
                                        <input type="checkbox" class="check-cliente" data-cliente-id="${cliente.cliente_id}" onchange="app.toggleClienteVisitas(${cliente.cliente_id}, this.checked)">
                                    </th>
                                    <th style="padding: 0.5rem; text-align: left; border-bottom: 1px solid #ddd;">Fecha</th>
                                    <th style="padding: 0.5rem; text-align: left; border-bottom: 1px solid #ddd;">Documento</th>
                                    <th style="padding: 0.5rem; text-align: right; border-bottom: 1px solid #ddd;">Precio</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${cliente.visitas.map(v => `
                                    <tr>
                                        <td style="padding: 0.5rem; border-bottom: 1px solid #eee;">
                                            <input type="checkbox" class="check-visita" data-visita-id="${v.id}" data-cliente-id="${cliente.cliente_id}" checked>
                                        </td>
                                        <td style="padding: 0.5rem; border-bottom: 1px solid #eee;">${formatearFecha(v.fecha_visita)}</td>
                                        <td style="padding: 0.5rem; border-bottom: 1px solid #eee;">
                                            ${v.odoo_move_name || '<span style="color: #999;">No emitido</span>'}
                                        </td>
                                        <td style="padding: 0.5rem; text-align: right; border-bottom: 1px solid #eee;">
                                            $${formatearPrecio(v.precio)}
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        });

        container.innerHTML = html;
    },

    toggleClienteVisitas(clienteId, checked) {
        const checkboxes = document.querySelectorAll(`.check-visita[data-cliente-id="${clienteId}"]`);
        checkboxes.forEach(cb => cb.checked = checked);
    },

    seleccionarTodoReportes() {
        const btn = document.getElementById('btn-seleccionar-todo');
        const allChecked = Array.from(document.querySelectorAll('.check-visita')).every(cb => cb.checked);
        const newState = !allChecked;

        document.querySelectorAll('.check-visita').forEach(cb => cb.checked = newState);
        document.querySelectorAll('.check-cliente').forEach(cb => cb.checked = newState);

        btn.textContent = newState ? '☐ Deseleccionar Todo' : '☑️ Seleccionar Todo';
    },

    copiarParaWhatsApp() {
        if (!this.visitasSinPagar || this.visitasSinPagar.length === 0) {
            this.showToast('No hay visitas para copiar', 'warning', 2000);
            return;
        }

        // Obtener visitas seleccionadas
        const checkboxes = document.querySelectorAll('.check-visita:checked');
        if (checkboxes.length === 0) {
            this.showToast('Por favor selecciona al menos una visita', 'warning', 2000);
            return;
        }

        const visitasSeleccionadasIds = Array.from(checkboxes).map(cb => parseInt(cb.dataset.visitaId));
        const visitasSeleccionadas = this.visitasSinPagar.filter(v => visitasSeleccionadasIds.includes(v.id));

        // Formatear fecha para WhatsApp (DD-MM-YYYY)
        const formatearFechaWhatsApp = (fecha) => {
            if (!fecha) return '';
            try {
                const d = new Date(fecha);
                const dia = String(d.getDate()).padStart(2, '0');
                const mes = String(d.getMonth() + 1).padStart(2, '0');
                const año = d.getFullYear();
                return `${dia}-${mes}-${año}`;
            } catch {
                return fecha;
            }
        };

        // Agrupar visitas seleccionadas por cliente
        const porCliente = {};
        visitasSeleccionadas.forEach(v => {
            const clienteId = v.cliente_id;
            if (!porCliente[clienteId]) {
                porCliente[clienteId] = {
                    cliente_nombre: v.cliente_nombre || 'Sin nombre',
                    visitas: []
                };
            }
            porCliente[clienteId].visitas.push(v);
        });

        // Construir texto para WhatsApp según formato solicitado
        let textos = [];

        Object.values(porCliente).forEach(cliente => {
            const fechas = cliente.visitas.map(v => formatearFechaWhatsApp(v.fecha_visita)).join('  ');
            const totalCliente = cliente.visitas.reduce((sum, v) => sum + (parseFloat(v.precio) || 0), 0);

            let textoCliente = `Cliente: ${cliente.cliente_nombre}\n`;
            textoCliente += `Visitas: ${fechas}\n`;
            textoCliente += `Total Pendiente de pago: $${formatearPrecio(totalCliente)}`;

            textos.push(textoCliente);
        });

        const textoFinal = textos.join('\n\n');

        // Copiar al portapapeles
        navigator.clipboard.writeText(textoFinal).then(() => {
            this.showToast('✅ Texto copiado al portapapeles. Listo para pegar en WhatsApp', 'success', 4000);
        }).catch(err => {
            console.error('Error copiando:', err);
            // Fallback: mostrar en un modal
            const modal = document.createElement('div');
            modal.className = 'modal active';
            modal.innerHTML = `
                <div class="modal-content" style="max-width: 600px;">
                    <span class="close" onclick="this.parentElement.parentElement.remove()">&times;</span>
                    <h2>Texto para WhatsApp</h2>
                    <textarea readonly style="width: 100%; height: 400px; padding: 1rem; font-family: monospace; border: 1px solid #ddd; border-radius: 4px;">${textoFinal}</textarea>
                    <div class="form-actions" style="margin-top: 1rem;">
                        <button class="btn btn-primary" onclick="navigator.clipboard.writeText(this.previousElementSibling.value).then(() => alert('Copiado!')).catch(() => {})">Copiar</button>
                        <button class="btn btn-secondary" onclick="this.closest('.modal').remove()">Cerrar</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        });
    },

    async sincronizarPagosMes() {
        const btn = document.getElementById('btn-sync-pagos');
        const textoOriginal = btn?.textContent || '🔄 Sincronizar Pagos del Mes';

        try {
            if (btn) {
                btn.disabled = true;
                btn.textContent = '⏳ Sincronizando...';
            }

            this.showToast('Sincronizando estados de pago del mes desde Odoo...', 'info', 3000);

            const res = await fetch(`${API_URL}/api/reportes/sync-pagos-mes`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' }
            });

            if (res.status === 401) {
                window.location.href = '/login.html';
                return;
            }

            if (res.status === 403) {
                this.showToast('No tienes permisos para sincronizar pagos', 'error', 3000);
                return;
            }

            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || `Error HTTP ${res.status}`);
            }

            const resultado = await res.json();

            let mensaje = '';
            if (resultado.actualizadas > 0) {
                mensaje = `✅ Sincronización completada. ${resultado.actualizadas} visita(s) actualizada(s)`;
                if (resultado.errores > 0) {
                    mensaje += `, ${resultado.errores} error(es)`;
                }
            } else if (resultado.total === 0) {
                mensaje = 'ℹ️ No hay visitas del mes con documentos en Odoo para sincronizar';
            } else {
                mensaje = `✅ Sincronización completada. No hubo cambios en los estados de pago`;
                if (resultado.errores > 0) {
                    mensaje += `. ${resultado.errores} error(es)`;
                }
            }

            this.showToast(mensaje, resultado.actualizadas > 0 ? 'success' : 'info', 5000);

            // Recargar reportes para reflejar los cambios
            await this.cargarReportes();

        } catch (e) {
            console.error('Error sincronizando pagos:', e);
            this.showToast(`Error al sincronizar pagos: ${e?.message || e}`, 'error', 4500);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = textoOriginal;
            }
        }
    },

    async descargarReporteExcel() {
        try {
            this.showToast('Preparando Excel de reportes…', 'info', 2000);

            const clienteId = document.getElementById('reporte-cliente-filter')?.value || '';
            const responsableId = document.getElementById('reporte-responsable-filter')?.value || '';

            let url = `${API_URL}/api/reportes/visitas-sin-pagar/export?`;
            if (clienteId) url += `cliente_id=${clienteId}&`;
            if (responsableId) url += `responsable_id=${responsableId}&`;

            const res = await fetch(url, {
                credentials: 'include'
            });

            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || `Error HTTP ${res.status}`);
            }

            const blob = await res.blob();
            const cd = res.headers.get('content-disposition') || '';
            const m = /filename="([^"]+)"/i.exec(cd);
            const filename = m?.[1] || 'visitas-sin-pagar.xlsx';

            const urlBlob = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = urlBlob;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(urlBlob);

            this.showToast('✅ Excel descargado correctamente', 'success', 3000);
        } catch (e) {
            console.error(e);
            this.showToast(`Error al descargar Excel: ${e?.message || e}`, 'error', 4500);
        }
    },

    // Verificación y restauración de asignaciones
    async verificarAsignaciones() {
        try {
            const semana = document.getElementById('semana-selector')?.value || '';
            let url = `${API_URL}/api/asignaciones/verificar`;
            if (semana) url += `?semana=${semana}`;

            this.showToast('Verificando asignaciones...', 'info', 2000);

            const res = await fetch(url, {
                credentials: 'include'
            });

            if (res.status === 401) {
                window.location.href = '/login.html';
                return;
            }

            if (res.status === 403) {
                this.showToast('Solo administradores pueden verificar asignaciones', 'error', 3000);
                return;
            }

            if (!res.ok) {
                const errorData = await res.json().catch(() => ({ error: 'Error desconocido' }));
                throw new Error(errorData.error || `Error HTTP ${res.status}`);
            }

            const resultado = await res.json();

            // Mostrar resultado
            const div = document.getElementById('asignaciones-verificacion');
            const text = document.getElementById('asignaciones-verificacion-text');

            if (div && text) {
                let mensaje = `📊 Verificación de Asignaciones - Semana: ${resultado.semanaInicio}\n\n`;
                mensaje += `Total de asignaciones: ${resultado.totalAsignaciones}\n`;

                if (resultado.duplicados && resultado.duplicados.length > 0) {
                    mensaje += `\n⚠️ Duplicados encontrados: ${resultado.duplicados.length}\n`;
                    resultado.duplicados.forEach(dup => {
                        mensaje += `  • ${dup.cliente_nombre}: ${dup.asignaciones.length} asignaciones\n`;
                    });
                } else {
                    mensaje += `\n✅ No hay duplicados\n`;
                }

                if (resultado.clientesSinAsignacion && resultado.clientesSinAsignacion.length > 0) {
                    mensaje += `\n⚠️ Clientes sin asignación: ${resultado.clientesSinAsignacion.length}\n`;
                    resultado.clientesSinAsignacion.forEach(cliente => {
                        mensaje += `  • ${cliente.nombre}\n`;
                    });
                } else {
                    mensaje += `\n✅ Todos los clientes tienen asignación\n`;
                }

                text.textContent = mensaje;
                div.style.display = 'block';

                this.showToast('Verificación completada', 'success', 3000);
            }
        } catch (error) {
            console.error('Error verificando asignaciones:', error);
            this.showToast(`Error: ${error.message || error}`, 'error', 5000);
        }
    },

    async restaurarAsignacionesFaltantes() {
        if (!confirm('¿Restaurar asignaciones faltantes para la semana seleccionada?\n\nEsto creará asignaciones para clientes activos que no tienen asignación.')) {
            return;
        }

        try {
            const semana = document.getElementById('semana-selector')?.value || '';

            this.showToast('Restaurando asignaciones...', 'info', 2000);

            const res = await fetch(`${API_URL}/api/asignaciones/restaurar-faltantes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ semana })
            });

            if (res.status === 401) {
                window.location.href = '/login.html';
                return;
            }

            if (res.status === 403) {
                this.showToast('Solo administradores pueden restaurar asignaciones', 'error', 3000);
                return;
            }

            if (!res.ok) {
                const errorData = await res.json().catch(() => ({ error: 'Error desconocido' }));
                throw new Error(errorData.error || `Error HTTP ${res.status}`);
            }

            const resultado = await res.json();

            this.showToast(`✅ ${resultado.restaurados} asignación(es) restaurada(s)`, 'success', 4000);

            // Recargar asignaciones
            await this.cargarAsignaciones();

            // Ocultar mensaje de verificación
            const div = document.getElementById('asignaciones-verificacion');
            if (div) div.style.display = 'none';
        } catch (error) {
            console.error('Error restaurando asignaciones:', error);
            this.showToast(`Error: ${error.message || error}`, 'error', 5000);
        }
    },

    async restaurarVisitasAsignaciones() {
        const fechaCreacion = prompt('¿Restaurar asignaciones específicas?\n\nIngresa la fecha de creación (ej: 2026-01-13 21:50:39.945573)\no deja vacío para restaurar todas las asignaciones de la semana:');

        try {
            const semana = document.getElementById('semana-selector')?.value || '';

            this.showToast('Restaurando relaciones...', 'info', 2000);

            const body = { semana };
            if (fechaCreacion && fechaCreacion.trim()) {
                body.fecha_creacion = fechaCreacion.trim();
            }

            const res = await fetch(`${API_URL}/api/asignaciones/restaurar-visitas`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(body)
            });

            if (res.status === 401) {
                window.location.href = '/login.html';
                return;
            }

            if (res.status === 403) {
                this.showToast('Solo administradores pueden restaurar relaciones', 'error', 3000);
                return;
            }

            if (!res.ok) {
                const errorData = await res.json().catch(() => ({ error: 'Error desconocido' }));
                throw new Error(errorData.error || `Error HTTP ${res.status}`);
            }

            const resultado = await res.json();

            this.showToast(`✅ ${resultado.restauradas} relación(es) restaurada(s)${resultado.sinVisita ? `, ${resultado.sinVisita} sin visita` : ''}`, 'success', 5000);

            // Recargar asignaciones
            await this.cargarAsignaciones();

            // Ocultar mensaje de verificación
            const div = document.getElementById('asignaciones-verificacion');
            if (div) div.style.display = 'none';
        } catch (error) {
            console.error('Error restaurando relaciones:', error);
            this.showToast(`Error: ${error.message || error}`, 'error', 5000);
        }
    }
};

// Función global para asignar semana actual
async function asignarSemanaActual() {
    if (!confirm('¿Asignar todos los clientes activos a la semana actual?')) return;

    try {
        const res = await fetch(`${API_URL}/api/asignaciones/asignar-semana-actual`, {
            method: 'POST',
            credentials: 'include'
        });

        if (res.status === 401) {
            window.location.href = '/login.html';
            return;
        }

        if (res.status === 403) {
            alert('Solo administradores pueden asignar semanas');
            return;
        }

        const data = await res.json();
        if (data.success) {
            alert(`✓ ${data.asignados} clientes asignados a la semana del ${data.semana}`);
            app.cargarAsignaciones();
            app.cargarEstadisticas();
        } else {
            alert('Error al asignar clientes');
        }
    } catch (error) {
        console.error('Error asignando semana:', error);
        alert('Error al asignar clientes');
    }
}

// Inicializar cuando cargue la página
document.addEventListener('DOMContentLoaded', async () => {
    await app.init();
});

