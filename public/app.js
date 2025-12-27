const API_URL = '';

const app = {
    currentPage: 'dashboard',
    clientes: [],
    responsables: [],
    asignaciones: [],
    currentUser: null,

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
        if (btnResponsables) {
            btnResponsables.style.display = isAdmin ? 'inline-block' : 'none';
        }
        
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
        } else if (page === 'responsables') {
            this.cargarResponsables();
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
            const colspan = isAdmin ? '8' : '3';
            tbody.innerHTML = `<tr><td colspan="${colspan}" class="empty-state">No hay clientes registrados</td></tr>`;
            return;
        }

        if (isAdmin) {
            // Vista completa para admin
            tbody.innerHTML = clientes.map(cliente => `
                <tr>
                    <td>
                        <input type="checkbox" class="cliente-checkbox" value="${cliente.id}" onchange="app.actualizarSeleccion()">
                    </td>
                    <td>${cliente.id}</td>
                    <td><strong>${cliente.nombre}</strong></td>
                    <td>${cliente.comuna || '-'}</td>
                    <td>${cliente.responsable_nombre || '<span class="tag tag-danger">Sin asignar</span>'}</td>
                    <td>${cliente.dia_atencion || '-'}</td>
                    <td>$${cliente.precio_por_visita?.toLocaleString() || '0'}</td>
                    <td class="actions">
                        <button class="btn btn-sm btn-primary" onclick="app.editarCliente(${cliente.id})">Editar</button>
                        <button class="btn btn-sm btn-success" onclick="app.abrirModalVisita(${cliente.id})">Registrar Visita</button>
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
                                        <p>Responsable: ${asig.responsable_nombre || 'Sin asignar'}${this.currentUser?.rol === 'admin' ? ` | Precio: $${asig.precio?.toLocaleString() || '0'}` : ''}</p>
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
            
            // Actualizar asignaciones
            await this.cargarAsignaciones();
            
            // Si es admin y está viendo progreso, actualizar también
            if (this.currentUser?.rol === 'admin' && this.currentPage === 'progreso') {
                setTimeout(() => this.cargarProgreso(), 500);
            }
        } catch (error) {
            console.error('Error marcando asignación:', error);
            alert('Error al actualizar la asignación');
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
                                        <p>Responsable: ${asig.responsable_nombre || 'Sin asignar'} | Precio: $${asig.precio?.toLocaleString() || '0'}</p>
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
        const tipo = document.getElementById('cliente-documento-tipo')?.value || 'boleta';
        const facturaFields = document.getElementById('factura-fields');
        const invoiceFields = document.getElementById('invoice-fields');

        if (facturaFields) facturaFields.style.display = tipo === 'factura' ? 'block' : 'none';
        if (invoiceFields) invoiceFields.style.display = tipo === 'invoice' ? 'block' : 'none';
    },

    async guardarCliente(e) {
        e.preventDefault();

        const documentoTipo = document.getElementById('cliente-documento-tipo')?.value || 'boleta';
        const rut = document.getElementById('cliente-rut')?.value?.trim() || '';
        const email = document.getElementById('cliente-email')?.value?.trim() || '';
        const direccion = document.getElementById('cliente-direccion')?.value?.trim() || '';
        const comuna = document.getElementById('cliente-comuna')?.value?.trim() || '';

        // Validaciones base (para emitir documentos)
        if (!direccion) {
            alert('Falta Dirección (necesaria para emitir documentos)');
            return;
        }
        if (!comuna) {
            alert('Falta Comuna (necesaria para emitir documentos)');
            return;
        }
        if (!email) {
            alert('Falta Correo electrónico (necesario para emitir documentos)');
            return;
        }
        if (documentoTipo !== 'invoice' && !rut) {
            alert('Falta RUT (necesario para Boleta/Factura)');
            return;
        }

        // Validaciones Factura / Invoice
        const factura_razon_social = document.getElementById('factura-razon-social')?.value?.trim() || '';
        const factura_rut = document.getElementById('factura-rut')?.value?.trim() || '';
        const factura_giro = document.getElementById('factura-giro')?.value?.trim() || '';
        const factura_direccion = document.getElementById('factura-direccion')?.value?.trim() || '';
        const factura_comuna = document.getElementById('factura-comuna')?.value?.trim() || '';
        const factura_email = document.getElementById('factura-email')?.value?.trim() || '';

        const invoice_nombre = document.getElementById('invoice-nombre')?.value?.trim() || '';
        const invoice_tax_id = document.getElementById('invoice-tax-id')?.value?.trim() || '';
        const invoice_direccion = document.getElementById('invoice-direccion')?.value?.trim() || '';
        const invoice_comuna = document.getElementById('invoice-comuna')?.value?.trim() || '';
        const invoice_email = document.getElementById('invoice-email')?.value?.trim() || '';
        const invoice_pais = document.getElementById('invoice-pais')?.value?.trim() || '';

        if (documentoTipo === 'factura') {
            if (!factura_razon_social || !factura_rut || !factura_direccion || !factura_comuna || !factura_email) {
                alert('Para Factura electrónica faltan datos (Razón social, RUT, Dirección, Comuna, Correo).');
                return;
            }
        }
        if (documentoTipo === 'invoice') {
            if (!invoice_nombre || !invoice_direccion || !invoice_email) {
                alert('Para Invoice faltan datos (Nombre/Empresa, Dirección, Correo).');
                return;
            }
        }

        const cliente = {
            nombre: document.getElementById('cliente-nombre').value,
            rut: rut || null,
            direccion,
            comuna,
            celular: document.getElementById('cliente-celular').value,
            email: email || null,
            documento_tipo: documentoTipo,
            // Factura
            factura_razon_social: documentoTipo === 'factura' ? factura_razon_social : null,
            factura_rut: documentoTipo === 'factura' ? factura_rut : null,
            factura_giro: documentoTipo === 'factura' ? factura_giro : null,
            factura_direccion: documentoTipo === 'factura' ? factura_direccion : null,
            factura_comuna: documentoTipo === 'factura' ? factura_comuna : null,
            factura_email: documentoTipo === 'factura' ? factura_email : null,
            // Invoice
            invoice_nombre: documentoTipo === 'invoice' ? invoice_nombre : null,
            invoice_tax_id: documentoTipo === 'invoice' ? invoice_tax_id : null,
            invoice_direccion: documentoTipo === 'invoice' ? invoice_direccion : null,
            invoice_comuna: documentoTipo === 'invoice' ? invoice_comuna : null,
            invoice_email: documentoTipo === 'invoice' ? invoice_email : null,
            invoice_pais: documentoTipo === 'invoice' ? invoice_pais : null,
            // Operación
            responsable_id: document.getElementById('cliente-responsable').value || null,
            dia_atencion: document.getElementById('cliente-dia').value || null,
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
                alert('Error al guardar el cliente');
            }
        } catch (error) {
            console.error('Error guardando cliente:', error);
            alert('Error al guardar el cliente');
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
            document.getElementById('cliente-documento-tipo').value = cliente.documento_tipo || 'boleta';
        }
        // Factura
        if (document.getElementById('factura-razon-social')) document.getElementById('factura-razon-social').value = cliente.factura_razon_social || '';
        if (document.getElementById('factura-rut')) document.getElementById('factura-rut').value = cliente.factura_rut || '';
        if (document.getElementById('factura-giro')) document.getElementById('factura-giro').value = cliente.factura_giro || '';
        if (document.getElementById('factura-direccion')) document.getElementById('factura-direccion').value = cliente.factura_direccion || '';
        if (document.getElementById('factura-comuna')) document.getElementById('factura-comuna').value = cliente.factura_comuna || '';
        if (document.getElementById('factura-email')) document.getElementById('factura-email').value = cliente.factura_email || '';
        // Invoice
        if (document.getElementById('invoice-nombre')) document.getElementById('invoice-nombre').value = cliente.invoice_nombre || '';
        if (document.getElementById('invoice-tax-id')) document.getElementById('invoice-tax-id').value = cliente.invoice_tax_id || '';
        if (document.getElementById('invoice-direccion')) document.getElementById('invoice-direccion').value = cliente.invoice_direccion || '';
        if (document.getElementById('invoice-comuna')) document.getElementById('invoice-comuna').value = cliente.invoice_comuna || '';
        if (document.getElementById('invoice-email')) document.getElementById('invoice-email').value = cliente.invoice_email || '';
        if (document.getElementById('invoice-pais')) document.getElementById('invoice-pais').value = cliente.invoice_pais || '';

        document.getElementById('cliente-responsable').value = cliente.responsable_id || '';
        document.getElementById('cliente-dia').value = cliente.dia_atencion || '';
        document.getElementById('cliente-precio').value = cliente.precio_por_visita || 0;
        document.getElementById('cliente-modal-title').textContent = 'Editar Cliente';

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
                alert('Visita registrada correctamente');
                this.cargarAsignaciones();
            } else {
                alert('Error al registrar la visita');
            }
        } catch (error) {
            console.error('Error registrando visita:', error);
            alert('Error al registrar la visita');
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

