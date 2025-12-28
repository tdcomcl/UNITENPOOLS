const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const db = require('./database');
const odoo = require('./odoo');
const mailer = require('./mailer');

function shouldNotifyOdooError(visitaRow) {
  // Anti-spam: máximo 1 mail cada 10 minutos por visita
  if (!visitaRow) return true;
  if (!visitaRow.odoo_notified_at) return true;
  const last = Date.parse(visitaRow.odoo_notified_at);
  if (Number.isNaN(last)) return true;
  return Date.now() - last > 10 * 60 * 1000;
}

async function notifyOdooError({ where, odooError, cliente, visitaId, asignacionId }) {
  try {
    const subject = `[UNITENPOOLS] Error Odoo al emitir (${where}) - Cliente ${cliente?.id || '?'} - Visita ${visitaId || '?'}`;
    const text = [
      `Fecha: ${new Date().toISOString()}`,
      `Lugar: ${where}`,
      `Cliente: ${cliente?.id || ''} - ${cliente?.nombre || ''}`,
      `Documento tipo: ${cliente?.documento_tipo || ''}`,
      `Asignación: ${asignacionId || ''}`,
      `Visita: ${visitaId || ''}`,
      '',
      'Error:',
      String(odooError || ''),
      '',
      'Server:',
      `PORT=${process.env.PORT || ''}`,
      `NODE_ENV=${process.env.NODE_ENV || ''}`
    ].join('\n');

    await mailer.sendOdooErrorEmail({ subject, text });

    if (visitaId) {
      const row = db.db.prepare('SELECT odoo_notify_count FROM visitas WHERE id = ?').get(visitaId);
      const next = (row?.odoo_notify_count || 0) + 1;
      db.actualizarVisita(visitaId, {
        odoo_notified_at: new Date().toISOString(),
        odoo_notify_count: next
      });
    }
  } catch (e) {
    console.error('[MAIL] Error enviando correo de alerta:', e?.message || e);
  }
}

const app = express();
const PORT = process.env.PORT || 3011;

// Middleware
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Configurar sesiones con SQLite Store (mejor para producción)
// Asegurar carpeta de sesiones (evita SQLITE_CANTOPEN)
const sessionsDir = path.join(__dirname, 'sessions');
try {
  fs.mkdirSync(sessionsDir, { recursive: true });
} catch (_) {
  // no-op
}

app.use(session({
  store: new SQLiteStore({
    db: 'sessions.db',
    dir: sessionsDir
  }),
  secret: 'piscinas-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false, // En producción con HTTPS, poner en true
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 horas
  }
}));

// Middleware para verificar autenticación
function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  res.status(401).json({ error: 'No autenticado' });
}

// Middleware para obtener usuario actual
function getCurrentUser(req, res, next) {
  req.currentUser = req.session?.user || null;
  req.responsableId = req.currentUser?.responsable_id || null;
  req.isAdmin = req.currentUser?.rol === 'admin';
  next();
}

app.use(getCurrentUser);

// Servir archivos estáticos (excepto index.html que requiere autenticación)
app.use(express.static('public', {
  index: false // No servir index.html automáticamente
}));

// Rutas API

// Debug/version (útil para confirmar que el server corriendo tiene los últimos cambios)
app.get('/api/version', (req, res) => {
  let git = null;
  try {
    git = execSync('git rev-parse --short HEAD', { cwd: __dirname }).toString().trim();
  } catch (_) {}
  res.json({
    ok: true,
    git,
    port: PORT,
    node: process.version
  });
});

// Autenticación
app.post('/api/login', (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
    }

    const usuario = db.verificarPassword(username, password);
    if (!usuario) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    req.session.user = usuario;
    res.json({ 
      success: true, 
      user: {
        id: usuario.id,
        username: usuario.username,
        responsable_id: usuario.responsable_id,
        responsable_nombre: usuario.responsable_nombre,
        rol: usuario.rol
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/session', (req, res) => {
  if (req.session && req.session.user) {
    const user = req.session.user;
    res.json({
      authenticated: true,
      user: {
        id: user.id,
        username: user.username,
        responsable_id: user.responsable_id,
        responsable_nombre: user.responsable_nombre,
        rol: user.rol
      }
    });
  } else {
    res.json({ authenticated: false });
  }
});

app.get('/api/usuarios', requireAuth, (req, res) => {
  try {
    if (!req.isAdmin) {
      return res.status(403).json({ error: 'No tienes permisos para ver usuarios' });
    }
    const usuarios = db.obtenerUsuarios();
    res.json(usuarios);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/usuarios', requireAuth, (req, res) => {
  try {
    if (!req.isAdmin) {
      return res.status(403).json({ error: 'No tienes permisos para crear usuarios' });
    }
    const { username, password, responsable_id, rol } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
    }
    const id = db.crearUsuario(username, password, responsable_id || null, rol || 'responsable');
    res.json({ id, success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Responsables
app.get('/api/responsables', requireAuth, (req, res) => {
  try {
    const responsables = db.obtenerResponsables();
    res.json(responsables);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/responsables', requireAuth, (req, res) => {
  try {
    if (!req.isAdmin) {
      return res.status(403).json({ error: 'Solo administradores pueden crear responsables' });
    }
    const { nombre } = req.body;
    if (!nombre) {
      return res.status(400).json({ error: 'El nombre es obligatorio' });
    }
    const id = db.agregarResponsable(nombre);
    res.json({ id, nombre, activo: 1 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Clientes
app.get('/api/clientes', requireAuth, (req, res) => {
  try {
    if (!req.isAdmin) {
      return res.status(403).json({ error: 'Solo administradores pueden ver clientes' });
    }
    const clientes = db.obtenerClientes(true, null);
    res.json(clientes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/clientes/:id', requireAuth, (req, res) => {
  try {
    if (!req.isAdmin) {
      return res.status(403).json({ error: 'Solo administradores pueden ver clientes' });
    }
    const cliente = db.obtenerClientePorId(req.params.id);
    if (!cliente) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }
    res.json(cliente);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/clientes', requireAuth, (req, res) => {
  try {
    if (!req.isAdmin) {
      return res.status(403).json({ error: 'Solo administradores pueden crear clientes' });
    }
    const {
      nombre,
      rut,
      direccion,
      comuna,
      celular,
      email,
      documento_tipo,
      factura_razon_social,
      factura_rut,
      factura_giro,
      factura_direccion,
      factura_comuna,
      factura_email,
      invoice_nombre,
      invoice_tax_id,
      invoice_direccion,
      invoice_comuna,
      invoice_email,
      invoice_pais,
      responsable_id,
      dia_atencion,
      precio_por_visita
    } = req.body;
    if (!nombre) {
      return res.status(400).json({ error: 'El nombre es obligatorio' });
    }
    const id = db.agregarCliente({
      nombre,
      rut: rut || null,
      direccion,
      comuna,
      celular,
      email: email || null,
      documento_tipo: documento_tipo || 'invoice',
      factura_razon_social: factura_razon_social || null,
      factura_rut: factura_rut || null,
      factura_giro: factura_giro || null,
      factura_direccion: factura_direccion || null,
      factura_comuna: factura_comuna || null,
      factura_email: factura_email || null,
      invoice_nombre: invoice_nombre || null,
      invoice_tax_id: invoice_tax_id || null,
      invoice_direccion: invoice_direccion || null,
      invoice_comuna: invoice_comuna || null,
      invoice_email: invoice_email || null,
      invoice_pais: invoice_pais || null,
      responsable_id: responsable_id || null,
      dia_atencion: dia_atencion || null,
      precio_por_visita: precio_por_visita || 0
    });
    res.json({ id, success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/clientes/:id', requireAuth, (req, res) => {
  try {
    if (!req.isAdmin) {
      return res.status(403).json({ error: 'Solo administradores pueden editar clientes' });
    }
    const cliente = db.obtenerClientePorId(req.params.id);
    if (!cliente) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    const {
      nombre,
      rut,
      direccion,
      comuna,
      celular,
      email,
      documento_tipo,
      factura_razon_social,
      factura_rut,
      factura_giro,
      factura_direccion,
      factura_comuna,
      factura_email,
      invoice_nombre,
      invoice_tax_id,
      invoice_direccion,
      invoice_comuna,
      invoice_email,
      invoice_pais,
      responsable_id,
      dia_atencion,
      precio_por_visita,
      activo
    } = req.body;

    const updates = {
      nombre,
      rut,
      direccion,
      comuna,
      celular,
      email,
      documento_tipo,
      factura_razon_social,
      factura_rut,
      factura_giro,
      factura_direccion,
      factura_comuna,
      factura_email,
      invoice_nombre,
      invoice_tax_id,
      invoice_direccion,
      invoice_comuna,
      invoice_email,
      invoice_pais,
      responsable_id,
      dia_atencion,
      precio_por_visita,
      activo
    };

    db.actualizarCliente(req.params.id, updates);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Odoo (solo admin) - test y sync cliente
app.get('/api/odoo/test', requireAuth, async (req, res) => {
  try {
    if (!req.isAdmin) {
      return res.status(403).json({ error: 'Solo administradores pueden usar Odoo' });
    }
    const result = await odoo.testConnection();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/odoo/clientes/:id/sync', requireAuth, async (req, res) => {
  try {
    if (!req.isAdmin) {
      return res.status(403).json({ error: 'Solo administradores pueden sincronizar con Odoo' });
    }

    const cliente = db.obtenerClientePorId(req.params.id);
    if (!cliente) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    const { partnerId, action } = await odoo.upsertPartnerFromCliente(cliente);
    db.actualizarCliente(req.params.id, {
      odoo_partner_id: partnerId,
      odoo_last_sync: new Date().toISOString()
    });

    res.json({ success: true, partnerId, action });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Asignaciones semanales
app.get('/api/asignaciones/:semana', requireAuth, (req, res) => {
  try {
    const asignaciones = db.obtenerAsignacionesSemana(req.params.semana, req.responsableId);
    res.json(asignaciones);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/asignaciones/semana-actual', requireAuth, (req, res) => {
  try {
    const semanaActual = db.obtenerSemanaActual();
    const asignaciones = db.obtenerAsignacionesSemana(semanaActual, req.responsableId);
    res.json({ semana: semanaActual, asignaciones });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/asignaciones/asignar-semana-actual', requireAuth, (req, res) => {
  try {
    if (!req.isAdmin) {
      return res.status(403).json({ error: 'Solo administradores pueden asignar semanas' });
    }
    const semanaActual = db.obtenerSemanaActual();
    const asignados = db.asignarClientesSemana(semanaActual);
    res.json({ semana: semanaActual, asignados, success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/asignaciones/:id', requireAuth, async (req, res) => {
  try {
    // Si es responsable, solo puede marcar como realizada sus propias asignaciones
    const asignacion = db.db.prepare('SELECT * FROM asignaciones_semanales WHERE id = ?').get(req.params.id);
    if (!asignacion) {
      return res.status(404).json({ error: 'Asignación no encontrada' });
    }
    
    if (req.responsableId && asignacion.responsable_id !== req.responsableId) {
      return res.status(403).json({ error: 'No tienes permisos para modificar esta asignación' });
    }
    
    const { realizada, responsable_id, dia_atencion, precio, notas } = req.body;
    console.log(`[API] Actualizando asignación ${req.params.id} con:`, { realizada, notas, responsable_id, dia_atencion, precio });
    
    const updates = {};
    if (realizada !== undefined) updates.realizada = realizada;
    if (notas !== undefined) {
      updates.notas = notas || null; // Permitir notas vacías (se guarda como null)
    }
    if (req.isAdmin) {
      if (responsable_id !== undefined) updates.responsable_id = responsable_id;
      if (dia_atencion !== undefined) updates.dia_atencion = dia_atencion;
      if (precio !== undefined) updates.precio = precio;
    }
    
    console.log(`[API] Updates a aplicar:`, updates);
    
    db.actualizarAsignacion(req.params.id, updates);
    
    // Si se marcó como realizada, crear 1 visita por asignación (si no existe) y emitir documento en Odoo.
    let odooResult = null;
    let odooError = null;
    let visitaId = asignacion.visita_id || null;
    if (realizada !== undefined && Number(realizada) === 1) {
      try {
        const hoy = new Date().toISOString().split('T')[0];

        // 1) Asegurar 1 visita por asignación
        if (!visitaId) {
          // Registrar visita (precio NULL => usa precio_por_visita del cliente)
          visitaId = db.registrarVisita(asignacion.cliente_id, hoy, asignacion.responsable_id || null, null, true);
          db.actualizarAsignacion(req.params.id, { visita_id: visitaId });
        }

        // 2) Emitir documento SI no existe aún para esa visita (idempotente)
        const visitaRow = visitaId
          ? db.db.prepare('SELECT * FROM visitas WHERE id = ?').get(visitaId)
          : null;

        if (visitaRow && !visitaRow.odoo_move_id) {
          const cliente = db.obtenerClientePorId(asignacion.cliente_id);
          if (cliente) {
            const { partnerId } = await odoo.upsertPartnerFromCliente(cliente);
            db.actualizarCliente(asignacion.cliente_id, {
              odoo_partner_id: partnerId,
              odoo_last_sync: new Date().toISOString()
            });
            odooResult = await odoo.createInvoiceForVisit({
              cliente,
              visita: { id: visitaId, fecha_visita: hoy, precio: null },
              partnerId
            });
            db.actualizarVisita(visitaId, {
              odoo_move_id: odooResult.moveId,
              odoo_move_name: odooResult.name,
              odoo_payment_state: odooResult.payment_state,
              odoo_last_sync: new Date().toISOString(),
              odoo_error: null
            });
          }
        }
      } catch (e) {
        odooError = e?.message || String(e);
        console.error('[Odoo] Error emitiendo documento desde asignación', req.params.id, odooError);
        if (visitaId) {
          db.actualizarVisita(visitaId, {
            odoo_last_sync: new Date().toISOString(),
            odoo_error: odooError
          });
        }

        // Notificar por correo
        if (visitaId) {
          const visitaRow = db.db.prepare('SELECT * FROM visitas WHERE id = ?').get(visitaId);
          if (shouldNotifyOdooError(visitaRow)) {
            const cliente = db.obtenerClientePorId(asignacion.cliente_id);
            notifyOdooError({ where: 'asignacion', odooError, cliente, visitaId, asignacionId: req.params.id });
          }
        }
      }
    }

    const actualizada = db.db.prepare('SELECT * FROM asignaciones_semanales WHERE id = ?').get(req.params.id);
    res.json({ success: true, notas: actualizada?.notas, visita_id: visitaId, odoo: odooResult, odoo_error: odooError });
  } catch (error) {
    console.error('[API] Error actualizando asignación:', error);
    res.status(500).json({ error: error.message });
  }
});

// Visitas
app.get('/api/clientes/:id/visitas', requireAuth, (req, res) => {
  try {
    // Verificar que el cliente pertenece al responsable si es responsable
    if (req.responsableId) {
      const cliente = db.obtenerClientePorId(req.params.id);
      if (!cliente || cliente.responsable_id !== req.responsableId) {
        return res.status(403).json({ error: 'No tienes permisos para ver visitas de este cliente' });
      }
    }
    const visitas = db.obtenerVisitasCliente(req.params.id, 20);
    res.json(visitas);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/visitas', requireAuth, async (req, res) => {
  try {
    const { cliente_id, fecha_visita, responsable_id, precio, realizada } = req.body;
    if (!cliente_id || !fecha_visita) {
      return res.status(400).json({ error: 'cliente_id y fecha_visita son obligatorios' });
    }
    
    // Si es responsable, usar su propio responsable_id
    const responsableIdFinal = req.responsableId || responsable_id;
    
    // Verificar que el cliente pertenece al responsable si es responsable
    if (req.responsableId) {
      const cliente = db.obtenerClientePorId(cliente_id);
      if (!cliente || cliente.responsable_id !== req.responsableId) {
        return res.status(403).json({ error: 'No tienes permisos para registrar visitas de este cliente' });
      }
    }
    
    const id = db.registrarVisita(cliente_id, fecha_visita, responsableIdFinal, precio, realizada !== false);

    // Emitir documento en Odoo al registrar visita (solo admin, por ahora)
    let odooResult = null;
    let odooError = null;
    if (req.isAdmin) {
      const cliente = db.obtenerClientePorId(cliente_id);
      if (cliente) {
        try {
          // Sync partner
          const { partnerId } = await odoo.upsertPartnerFromCliente(cliente);
          db.actualizarCliente(cliente_id, {
            odoo_partner_id: partnerId,
            odoo_last_sync: new Date().toISOString()
          });

          // Crear invoice/boleta/factura según documento_tipo del cliente
          odooResult = await odoo.createInvoiceForVisit({
            cliente,
            visita: { id, fecha_visita, precio },
            partnerId
          });

          // Guardar referencia en la visita
          db.actualizarVisita(id, {
            odoo_move_id: odooResult.moveId,
            odoo_move_name: odooResult.name,
            odoo_payment_state: odooResult.payment_state,
            odoo_last_sync: new Date().toISOString(),
            odoo_error: null
          });
        } catch (e) {
          odooError = e?.message || String(e);
          console.error('[Odoo] Error emitiendo documento para visita', id, odooError);
          db.actualizarVisita(id, {
            odoo_last_sync: new Date().toISOString(),
            odoo_error: odooError
          });

          const visitaRow = db.db.prepare('SELECT * FROM visitas WHERE id = ?').get(id);
          if (shouldNotifyOdooError(visitaRow)) {
            const cliente = db.obtenerClientePorId(cliente_id);
            notifyOdooError({ where: 'visita', odooError, cliente, visitaId: id, asignacionId: null });
          }
        }
      }
    }

    // Siempre devolver success=true: la visita ya quedó registrada; si Odoo falló, devolvemos el motivo.
    res.json({ id, success: true, odoo: odooResult, odoo_error: odooError });
  } catch (error) {
    console.error('[API] Error registrando visita:', error);
    res.status(500).json({ error: error.message });
  }
});

// Estadísticas
app.get('/api/estadisticas', requireAuth, (req, res) => {
  try {
    const stats = db.obtenerEstadisticas(req.responsableId);
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Progreso por responsable (solo admin)
app.get('/api/progreso/:semana', requireAuth, (req, res) => {
  try {
    if (!req.isAdmin) {
      return res.status(403).json({ error: 'Solo administradores pueden ver el progreso' });
    }
    
    const progreso = db.obtenerProgresoPorResponsable(req.params.semana);
    res.json(progreso);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Notas de asignaciones (solo admin)
app.get('/api/notas/:semana', requireAuth, (req, res) => {
  try {
    if (!req.isAdmin) {
      return res.status(403).json({ error: 'Solo administradores pueden ver las notas' });
    }
    
    const notas = db.obtenerAsignacionesConNotas(req.params.semana);
    res.json(notas);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Servir login.html (sin autenticación)
app.get('/login.html', (req, res) => {
  if (req.session && req.session.user) {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/login', (req, res) => {
  if (req.session && req.session.user) {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Servir la aplicación web principal (requiere autenticación)
app.get('/', (req, res) => {
  if (!req.session || !req.session.user) {
    return res.redirect('/login.html');
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
  console.log(`📊 Base de datos inicializada`);
});

