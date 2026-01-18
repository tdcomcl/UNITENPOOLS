require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const multer = require('multer');
const XLSX = require('xlsx');
const db = require('./database');
const odoo = require('./odoo');
const { validate: validateRut, clean: cleanRut } = require('rut.js');
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
      const row = await db.db.prepare('SELECT odoo_notify_count FROM visitas WHERE id = ?').get(visitaId);
      const next = (row?.odoo_notify_count || 0) + 1;
      await db.actualizarVisita(visitaId, {
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
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 } // 15MB
});

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
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
    }

    const usuario = await db.verificarPassword(username, password);
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

app.get('/api/usuarios', requireAuth, async (req, res) => {
  try {
    if (!req.isAdmin) {
      return res.status(403).json({ error: 'No tienes permisos para ver usuarios' });
    }
    const usuarios = await db.obtenerUsuarios();
    res.json(usuarios);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/usuarios', requireAuth, async (req, res) => {
  try {
    if (!req.isAdmin) {
      return res.status(403).json({ error: 'No tienes permisos para crear usuarios' });
    }
    const { username, password, responsable_id, rol } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
    }
    const id = await db.crearUsuario(username, password, responsable_id || null, rol || 'responsable');
    res.json({ id, success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Responsables
app.get('/api/responsables', requireAuth, async (req, res) => {
  try {
    const responsables = await db.obtenerResponsables();
    res.json(responsables);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/responsables', requireAuth, async (req, res) => {
  try {
    if (!req.isAdmin) {
      return res.status(403).json({ error: 'Solo administradores pueden crear responsables' });
    }
    const { nombre } = req.body;
    if (!nombre) {
      return res.status(400).json({ error: 'El nombre es obligatorio' });
    }
    const id = await db.agregarResponsable(nombre);
    res.json({ id, nombre, activo: 1 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Clientes
app.get('/api/clientes', requireAuth, async (req, res) => {
  try {
    if (!req.isAdmin) {
      return res.status(403).json({ error: 'Solo administradores pueden ver clientes' });
    }
    const clientes = await db.obtenerClientes(true, null);
    res.json(clientes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/clientes/export', requireAuth, async (req, res) => {
  try {
    if (!req.isAdmin) {
      return res.status(403).json({ error: 'Solo administradores pueden exportar clientes' });
    }

    const clientes = await db.obtenerClientes(false, null); // incluir activos e inactivos
    const rows = clientes.map(c => ({
      id: c.id,
      nombre: c.nombre || '',
      rut: c.rut || '',
      direccion: c.direccion || '',
      comuna: c.comuna || '',
      celular: c.celular || '',
      email: c.email || '',
      documento_tipo: c.documento_tipo || 'invoice',
      responsable_id: c.responsable_id || '',
      responsable: c.responsable_nombre || '',
      dia_atencion: c.dia_atencion || '',
      precio_por_visita: c.precio_por_visita ?? 0,
      activo: c.activo ?? 1,
      notas: c.notas || '',
      factura_razon_social: c.factura_razon_social || '',
      factura_rut: c.factura_rut || '',
      factura_giro: c.factura_giro || '',
      factura_direccion: c.factura_direccion || '',
      factura_comuna: c.factura_comuna || '',
      factura_email: c.factura_email || '',
      odoo_partner_id: c.odoo_partner_id || '',
      odoo_last_sync: c.odoo_last_sync || ''
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Clientes');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const today = new Date().toISOString().slice(0, 10);
    const filename = `clientes-${today}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buf);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint para verificar contraseña de importación
app.post('/api/clientes/import/verify-password', requireAuth, async (req, res) => {
  try {
    if (!req.isAdmin) {
      return res.status(403).json({ error: 'Solo administradores pueden importar clientes' });
    }
    const { password } = req.body;
    const expectedPassword = process.env.EXCEL_IMPORT_PASSWORD || 'import2024';
    
    if (!password || password !== expectedPassword) {
      return res.json({ valid: false, error: 'Contraseña incorrecta' });
    }
    
    res.json({ valid: true });
  } catch (error) {
    res.status(500).json({ valid: false, error: error.message });
  }
});

app.post('/api/clientes/import', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.isAdmin) {
      return res.status(403).json({ error: 'Solo administradores pueden importar clientes' });
    }
    
    // Verificar contraseña
    const password = req.body.password;
    const expectedPassword = process.env.EXCEL_IMPORT_PASSWORD || 'import2024';
    if (!password || password !== expectedPassword) {
      return res.status(403).json({ error: 'Contraseña de importación incorrecta' });
    }
    
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'Archivo Excel no recibido (campo: file)' });
    }

    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = wb.SheetNames?.[0];
    if (!sheetName) {
      return res.status(400).json({ error: 'El Excel no tiene hojas' });
    }
    const ws = wb.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json(ws, { defval: '' });

    const normKey = (k) => String(k || '').trim().toLowerCase();
    const pick = (obj, keys) => {
      for (const k of keys) {
        const found = Object.keys(obj).find(ok => normKey(ok) === normKey(k));
        if (found !== undefined) return obj[found];
      }
      return undefined;
    };
    const toStr = (v) => {
      if (v === undefined || v === null) return null;
      const s = String(v).trim();
      return s === '' ? null : s;
    };
    const toNum = (v) => {
      if (v === undefined || v === null) return null;
      if (typeof v === 'number') return v;
      const s = String(v).replace(',', '.').trim();
      if (!s) return null;
      const n = Number(s);
      return Number.isFinite(n) ? n : null;
    };
    const toInt = (v) => {
      const n = toNum(v);
      if (n === null) return null;
      return parseInt(String(n), 10);
    };
    const normalizeDocTipo = (v) => {
      const s = String(v || '').trim().toLowerCase();
      if (!s) return 'invoice';
      if (s.includes('boleta')) return 'boleta';
      if (s.includes('factura')) return 'factura';
      if (s === 'invoice') return 'invoice';
      return s; // fallback (por si usan valores internos)
    };

    const result = { created: 0, updated: 0, skipped: 0, errors: [] };

    for (let idx = 0; idx < rawRows.length; idx++) {
      const r = rawRows[idx];
      try {
        const id = toInt(pick(r, ['id', 'ID', 'Id']));
        const nombre = toStr(pick(r, ['nombre', 'Nombre'])) || '';
        if (!nombre.trim()) {
          result.skipped++;
          result.errors.push({ row: idx + 2, error: 'Falta nombre' });
          continue;
        }

        const responsableId = toInt(pick(r, ['responsable_id', 'responsable id', 'id_responsable']));
        const responsableNombre = toStr(pick(r, ['responsable', 'Responsable']));
        let resolvedResponsableId = responsableId;
        if (!resolvedResponsableId && responsableNombre) {
          resolvedResponsableId = await db.agregarResponsable(responsableNombre);
        }

        const payload = {
          nombre: nombre,
          rut: toStr(pick(r, ['rut', 'RUT'])),
          direccion: toStr(pick(r, ['direccion', 'dirección'])),
          comuna: toStr(pick(r, ['comuna'])),
          celular: toStr(pick(r, ['celular', 'telefono', 'teléfono'])),
          email: toStr(pick(r, ['email', 'correo', 'correo electrónico', 'correo electronico'])),
          documento_tipo: normalizeDocTipo(pick(r, ['documento_tipo', 'documento', 'tipo_documento', 'tipo documento'])),
          responsable_id: resolvedResponsableId,
          dia_atencion: toStr(pick(r, ['dia_atencion', 'día', 'dia', 'día_atencion'])),
          precio_por_visita: toNum(pick(r, ['precio_por_visita', 'precio', 'valor'])),
          activo: (() => {
            const v = pick(r, ['activo', 'Activo']);
            if (v === '' || v === null || v === undefined) return undefined;
            const s = String(v).trim().toLowerCase();
            if (s === '1' || s === 'si' || s === 'sí' || s === 'true') return 1;
            if (s === '0' || s === 'no' || s === 'false') return 0;
            const n = toInt(v);
            return n === null ? undefined : (n ? 1 : 0);
          })(),
          notas: toStr(pick(r, ['notas', 'Notas'])),
          factura_razon_social: toStr(pick(r, ['factura_razon_social', 'razon social', 'razón social'])),
          factura_rut: toStr(pick(r, ['factura_rut', 'rut factura'])),
          factura_giro: toStr(pick(r, ['factura_giro', 'giro'])),
          factura_direccion: toStr(pick(r, ['factura_direccion', 'direccion factura', 'dirección factura'])),
          factura_comuna: toStr(pick(r, ['factura_comuna', 'comuna factura'])),
          factura_email: toStr(pick(r, ['factura_email', 'correo factura', 'email factura']))
        };

        // Normalizar nulls / defaults
        if (payload.precio_por_visita === null) payload.precio_por_visita = 0;
        if (!payload.documento_tipo) payload.documento_tipo = 'invoice';

        if (id) {
          const exists = await db.obtenerClientePorId(id);
          if (exists) {
            await db.actualizarCliente(id, payload);
            result.updated++;
            continue;
          }
        }

        const newId = await db.agregarCliente({
          nombre: payload.nombre,
          rut: payload.rut,
          direccion: payload.direccion,
          comuna: payload.comuna,
          celular: payload.celular,
          email: payload.email,
          documento_tipo: payload.documento_tipo || 'invoice',
          factura_razon_social: payload.factura_razon_social,
          factura_rut: payload.factura_rut,
          factura_giro: payload.factura_giro,
          factura_direccion: payload.factura_direccion,
          factura_comuna: payload.factura_comuna,
          factura_email: payload.factura_email,
          responsable_id: payload.responsable_id,
          dia_atencion: payload.dia_atencion,
          precio_por_visita: payload.precio_por_visita
        });

        // Setear campos que no están en agregarCliente (activo/notas)
        const post = {};
        if (payload.activo !== undefined) post.activo = payload.activo;
        if (payload.notas !== undefined) post.notas = payload.notas;
        if (Object.keys(post).length > 0) {
          await db.actualizarCliente(newId, post);
        }

        result.created++;
      } catch (e) {
        result.errors.push({ row: idx + 2, error: e?.message || String(e) });
      }
    }

    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/clientes/:id(\\d+)', requireAuth, async (req, res) => {
  try {
    if (!req.isAdmin) {
      return res.status(403).json({ error: 'Solo administradores pueden ver clientes' });
    }
    const cliente = await db.obtenerClientePorId(req.params.id);
    if (!cliente) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }
    res.json(cliente);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/clientes', requireAuth, async (req, res) => {
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

    // Validar RUT del cliente si se proporciona
    if (rut && rut.trim()) {
      if (!validateRut(rut)) {
        return res.status(400).json({ error: 'El RUT del cliente no es válido. Verifica el formato (ej: 12.345.678-9)' });
      }
    }

    // Validar RUT de factura si es factura y se proporciona
    if (documento_tipo === 'factura' && factura_rut && factura_rut.trim()) {
      if (!validateRut(factura_rut)) {
        return res.status(400).json({ error: 'El RUT de factura no es válido. Verifica el formato (ej: 12.345.678-9)' });
      }
    }

    // Normalizar valores vacíos a null para PostgreSQL
    // Limpiar RUTs antes de guardar (remover puntos y guiones, dejar solo números y dígito verificador)
    const rutLimpio = rut && rut.trim() ? cleanRut(rut) : null;
    const facturaRutLimpio = factura_rut && factura_rut.trim() ? cleanRut(factura_rut) : null;
    const id = await db.agregarCliente({
      nombre,
      rut: rutLimpio,
      direccion: (direccion && direccion.trim()) || null,
      comuna: (comuna && comuna.trim()) || null,
      celular: (celular && celular.trim()) || null,
      email: (email && email.trim()) || null,
      documento_tipo: documento_tipo || 'invoice',
      factura_razon_social: (factura_razon_social && factura_razon_social.trim()) || null,
      factura_rut: facturaRutLimpio,
      factura_giro: (factura_giro && factura_giro.trim()) || null,
      factura_direccion: (factura_direccion && factura_direccion.trim()) || null,
      factura_comuna: (factura_comuna && factura_comuna.trim()) || null,
      factura_email: (factura_email && factura_email.trim()) || null,
      invoice_nombre: (invoice_nombre && invoice_nombre.trim()) || null,
      invoice_tax_id: (invoice_tax_id && invoice_tax_id.trim()) || null,
      invoice_direccion: (invoice_direccion && invoice_direccion.trim()) || null,
      invoice_comuna: (invoice_comuna && invoice_comuna.trim()) || null,
      invoice_email: (invoice_email && invoice_email.trim()) || null,
      invoice_pais: (invoice_pais && invoice_pais.trim()) || null,
      responsable_id: responsable_id || null,
      dia_atencion: (dia_atencion && dia_atencion.trim()) || null,
      precio_por_visita: precio_por_visita || 0
    });
    res.json({ id, success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/clientes/:id(\\d+)', requireAuth, async (req, res) => {
  try {
    if (!req.isAdmin) {
      return res.status(403).json({ error: 'Solo administradores pueden editar clientes' });
    }
    const cliente = await db.obtenerClientePorId(req.params.id);
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

    // Validar RUT del cliente si se proporciona
    if (rut && rut.trim()) {
      if (!validateRut(rut)) {
        return res.status(400).json({ error: 'El RUT del cliente no es válido. Verifica el formato (ej: 12.345.678-9)' });
      }
    }

    // Validar RUT de factura si es factura y se proporciona
    if (documento_tipo === 'factura' && factura_rut && factura_rut.trim()) {
      if (!validateRut(factura_rut)) {
        return res.status(400).json({ error: 'El RUT de factura no es válido. Verifica el formato (ej: 12.345.678-9)' });
      }
    }

    // Limpiar RUTs antes de guardar
    const rutLimpio = rut && rut.trim() ? cleanRut(rut) : undefined;
    const facturaRutLimpio = factura_rut && factura_rut.trim() ? cleanRut(factura_rut) : undefined;

    const updates = {
      nombre,
      rut: rutLimpio !== undefined ? rutLimpio : rut,
      direccion,
      comuna,
      celular,
      email,
      documento_tipo,
      factura_razon_social,
      factura_rut: facturaRutLimpio !== undefined ? facturaRutLimpio : factura_rut,
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

    await db.actualizarCliente(req.params.id, updates);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/clientes/:id(\\d+)', requireAuth, async (req, res) => {
  try {
    if (!req.isAdmin) {
      return res.status(403).json({ error: 'Solo administradores pueden eliminar clientes' });
    }
    const cliente = await db.obtenerClientePorId(req.params.id);
    if (!cliente) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    // Borrado lógico (recomendado): mantener historial de visitas/asignaciones
    await db.actualizarCliente(req.params.id, { activo: 0 });
    res.json({ success: true, deleted: true });
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

    const cliente = await db.obtenerClientePorId(req.params.id);
    if (!cliente) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    const { partnerId, action } = await odoo.upsertPartnerFromCliente(cliente);
    await db.actualizarCliente(req.params.id, {
      odoo_partner_id: partnerId,
      odoo_last_sync: new Date().toISOString()
    });

    res.json({ success: true, partnerId, action });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Asignaciones semanales
app.get('/api/asignaciones/:semana', requireAuth, async (req, res) => {
  try {
    const asignaciones = await db.obtenerAsignacionesSemana(req.params.semana, req.responsableId);
    res.json(asignaciones);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/asignaciones/semana-actual', requireAuth, async (req, res) => {
  try {
    const semanaActual = db.obtenerSemanaActual();
    const asignaciones = await db.obtenerAsignacionesSemana(semanaActual, req.responsableId);
    res.json({ semana: semanaActual, asignaciones });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/asignaciones/asignar-semana-actual', requireAuth, async (req, res) => {
  try {
    if (!req.isAdmin) {
      return res.status(403).json({ error: 'Solo administradores pueden asignar semanas' });
    }
    const semanaActual = db.obtenerSemanaActual();
    
    // Manejar tanto funciones síncronas (SQLite) como asíncronas (PostgreSQL)
    let asignados;
    if (typeof db.asignarClientesSemana === 'function') {
      const result = db.asignarClientesSemana(semanaActual);
      asignados = result instanceof Promise ? await result : result;
    } else {
      throw new Error('Función asignarClientesSemana no encontrada');
    }
    
    res.json({ semana: semanaActual, asignados, success: true });
  } catch (error) {
    console.error('[API] Error asignando semana:', error);
    res.status(500).json({ error: error.message });
  }
});

// Asignar manualmente un cliente a una semana específica
app.post('/api/asignaciones/asignar-manual', requireAuth, async (req, res) => {
  try {
    if (!req.isAdmin) {
      return res.status(403).json({ error: 'Solo administradores pueden asignar manualmente' });
    }

    const { cliente_id, semana_inicio, responsable_id, dia_atencion, precio } = req.body;

    if (!cliente_id || !semana_inicio) {
      return res.status(400).json({ error: 'cliente_id y semana_inicio son obligatorios' });
    }

    // Validar formato de fecha (YYYY-MM-DD)
    const fechaRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!fechaRegex.test(semana_inicio)) {
      return res.status(400).json({ error: 'semana_inicio debe tener formato YYYY-MM-DD' });
    }

    // Manejar tanto funciones síncronas (SQLite) como asíncronas (PostgreSQL)
    let resultado;
    if (typeof db.asignarClienteManual === 'function') {
      const result = db.asignarClienteManual(
        cliente_id,
        semana_inicio,
        responsable_id || null,
        dia_atencion || null,
        precio || null
      );
      resultado = result instanceof Promise ? await result : result;
    } else {
      throw new Error('Función asignarClienteManual no encontrada');
    }

    res.json({ 
      success: true, 
      asignacion_id: resultado.id,
      action: resultado.action,
      semana: semana_inicio
    });
  } catch (error) {
    console.error('[API] Error asignando cliente manualmente:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint para verificar y corregir asignaciones
app.get('/api/asignaciones/verificar', requireAuth, async (req, res) => {
  try {
    if (!req.isAdmin) {
      return res.status(403).json({ error: 'Solo administradores pueden verificar asignaciones' });
    }
    
    const semana = req.query.semana || db.obtenerSemanaActual();
    const verificar = require('./scripts/verificar-asignaciones');
    const resultado = await verificar.verificarAsignaciones(semana);
    res.json(resultado);
  } catch (error) {
    console.error('[API] Error verificando asignaciones:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/asignaciones/limpiar-duplicados', requireAuth, async (req, res) => {
  try {
    if (!req.isAdmin) {
      return res.status(403).json({ error: 'Solo administradores pueden limpiar duplicados' });
    }
    
    const semana = req.body.semana || db.obtenerSemanaActual();
    const mantenerId = req.body.mantener_id || null;
    const verificar = require('./scripts/verificar-asignaciones');
    const eliminados = await verificar.limpiarDuplicados(semana, mantenerId);
    res.json({ success: true, eliminados });
  } catch (error) {
    console.error('[API] Error limpiando duplicados:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/asignaciones/restaurar-faltantes', requireAuth, async (req, res) => {
  try {
    if (!req.isAdmin) {
      return res.status(403).json({ error: 'Solo administradores pueden restaurar asignaciones' });
    }
    
    const semana = req.body.semana || db.obtenerSemanaActual();
    const verificar = require('./scripts/verificar-asignaciones');
    const restaurados = await verificar.restaurarAsignacionesFaltantes(semana);
    res.json({ success: true, restaurados });
  } catch (error) {
    console.error('[API] Error restaurando asignaciones:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/asignaciones/restaurar-visitas', requireAuth, async (req, res) => {
  try {
    if (!req.isAdmin) {
      return res.status(403).json({ error: 'Solo administradores pueden restaurar relaciones' });
    }
    
    const semana = req.body.semana || db.obtenerSemanaActual();
    const fechaCreacion = req.body.fecha_creacion || null;
    
    if (fechaCreacion) {
      // Restaurar asignaciones específicas por fecha de creación
      const restaurarEspecifico = require('./scripts/restaurar-asignaciones-especificas');
      const resultado = await restaurarEspecifico.restaurarAsignacionesPorFechaCreacion(fechaCreacion, semana);
      res.json({ success: true, ...resultado });
    } else {
      // Restaurar todas las asignaciones de la semana
      const restaurar = require('./scripts/restaurar-visitas-asignaciones');
      const resultado = await restaurar.restaurarVisitasAsignaciones(semana);
      res.json({ success: true, ...resultado });
    }
  } catch (error) {
    console.error('[API] Error restaurando relaciones:', error);
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/asignaciones/:id', requireAuth, async (req, res) => {
  try {
    // Si es responsable, solo puede marcar como realizada sus propias asignaciones
    const asignacion = await db.obtenerAsignacionPorId(req.params.id);
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
    
    await db.actualizarAsignacion(req.params.id, updates);
    
    // Si se marcó como realizada, crear 1 visita por asignación (si no existe) y emitir documento en Odoo.
    let odooResult = null;
    let odooError = null;
    let visitaId = asignacion.visita_id || null;
    if (realizada !== undefined && Number(realizada) === 1) {
      try {
        // Usar la fecha de la asignación (semana_inicio) en lugar de la fecha actual
        const fechaVisita = asignacion.semana_inicio ? 
          (asignacion.semana_inicio instanceof Date ? asignacion.semana_inicio.toISOString().split('T')[0] : asignacion.semana_inicio) :
          new Date().toISOString().split('T')[0];

        // 1) Asegurar 1 visita por asignación
        if (!visitaId) {
          // Registrar visita (precio NULL => usa precio_por_visita del cliente)
          visitaId = await db.registrarVisita(asignacion.cliente_id, fechaVisita, asignacion.responsable_id || null, null, true);
          await db.actualizarAsignacion(req.params.id, { visita_id: visitaId });
        }

        // 2) Emitir documento SI no existe aún para esa visita (idempotente)
        const visitaRow = visitaId
          ? await db.obtenerVisitaPorId(visitaId)
          : null;

        if (visitaRow && !visitaRow.odoo_move_id) {
          const cliente = await db.obtenerClientePorId(asignacion.cliente_id);
          if (cliente) {
            const { partnerId } = await odoo.upsertPartnerFromCliente(cliente);
            await db.actualizarCliente(asignacion.cliente_id, {
              odoo_partner_id: partnerId,
              odoo_last_sync: new Date().toISOString()
            });
            odooResult = await odoo.createInvoiceForVisit({
              cliente,
              visita: { id: visitaId, fecha_visita: fechaVisita, precio: null },
              partnerId
            });
            await db.actualizarVisita(visitaId, {
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
          await db.actualizarVisita(visitaId, {
            odoo_last_sync: new Date().toISOString(),
            odoo_error: odooError
          });
        }

        // Notificar por correo
        if (visitaId) {
          const visitaRow = await db.obtenerVisitaPorId(visitaId);
          if (shouldNotifyOdooError(visitaRow)) {
            const cliente = await db.obtenerClientePorId(asignacion.cliente_id);
            await notifyOdooError({ where: 'asignacion', odooError, cliente, visitaId, asignacionId: req.params.id });
          }
        }
      }
    }

    const actualizada = await db.obtenerAsignacionPorId(req.params.id);
    res.json({ success: true, notas: actualizada?.notas, visita_id: visitaId, odoo: odooResult, odoo_error: odooError });
  } catch (error) {
    console.error('[API] Error actualizando asignación:', error);
    res.status(500).json({ error: error.message });
  }
});

// Visitas
app.get('/api/clientes/:id(\\d+)/visitas', requireAuth, async (req, res) => {
  try {
    // Verificar que el cliente pertenece al responsable si es responsable
    if (req.responsableId) {
      const cliente = await db.obtenerClientePorId(req.params.id);
      if (!cliente || cliente.responsable_id !== req.responsableId) {
        return res.status(403).json({ error: 'No tienes permisos para ver visitas de este cliente' });
      }
    }
    const visitas = await db.obtenerVisitasCliente(req.params.id, 20);
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
      const cliente = await db.obtenerClientePorId(cliente_id);
      if (!cliente || cliente.responsable_id !== req.responsableId) {
        return res.status(403).json({ error: 'No tienes permisos para registrar visitas de este cliente' });
      }
    }
    
    const id = await db.registrarVisita(cliente_id, fecha_visita, responsableIdFinal, precio, realizada !== false);

    // Emitir documento en Odoo al registrar visita (solo admin, por ahora)
    let odooResult = null;
    let odooError = null;
    if (req.isAdmin) {
      const cliente = await db.obtenerClientePorId(cliente_id);
      if (cliente) {
        try {
          // Sync partner
          const { partnerId } = await odoo.upsertPartnerFromCliente(cliente);
          await db.actualizarCliente(cliente_id, {
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
          await db.actualizarVisita(id, {
            odoo_move_id: odooResult.moveId,
            odoo_move_name: odooResult.name,
            odoo_payment_state: odooResult.payment_state,
            odoo_last_sync: new Date().toISOString(),
            odoo_error: null
          });
        } catch (e) {
          odooError = e?.message || String(e);
          console.error('[Odoo] Error emitiendo documento para visita', id, odooError);
          await db.actualizarVisita(id, {
            odoo_last_sync: new Date().toISOString(),
            odoo_error: odooError
          });

          const visitaRow = await db.db.prepare('SELECT * FROM visitas WHERE id = ?').get(id);
          if (shouldNotifyOdooError(visitaRow)) {
            const cliente = await db.obtenerClientePorId(cliente_id);
            await notifyOdooError({ where: 'visita', odooError, cliente, visitaId: id, asignacionId: null });
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
app.get('/api/estadisticas', requireAuth, async (req, res) => {
  try {
    const stats = await db.obtenerEstadisticas(req.responsableId);
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Reportes - Visitas sin pagar
app.get('/api/reportes/visitas-sin-pagar', requireAuth, async (req, res) => {
  try {
    if (!req.isAdmin) {
      return res.status(403).json({ error: 'Solo administradores pueden ver reportes' });
    }
    
    const clienteId = req.query.cliente_id ? parseInt(req.query.cliente_id) : null;
    const responsableId = req.query.responsable_id ? parseInt(req.query.responsable_id) : null;
    
    // Manejar tanto funciones síncronas (SQLite) como asíncronas (PostgreSQL)
    let visitas;
    if (typeof db.obtenerVisitasSinPagar === 'function') {
      const result = db.obtenerVisitasSinPagar(clienteId, responsableId);
      visitas = result instanceof Promise ? await result : result;
      
      // Asegurar que visitas sea un array
      if (!Array.isArray(visitas)) {
        console.error('[API] obtenerVisitasSinPagar no devolvió un array:', typeof visitas, visitas);
        visitas = [];
      }
    } else {
      throw new Error('Función obtenerVisitasSinPagar no encontrada');
    }
    
    res.json(visitas || []);
  } catch (error) {
    console.error('[API] Error obteniendo visitas sin pagar:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/reportes/visitas-sin-pagar/export', requireAuth, async (req, res) => {
  try {
    if (!req.isAdmin) {
      return res.status(403).json({ error: 'Solo administradores pueden exportar reportes' });
    }
    
    const clienteId = req.query.cliente_id ? parseInt(req.query.cliente_id) : null;
    const responsableId = req.query.responsable_id ? parseInt(req.query.responsable_id) : null;
    
    // Manejar tanto funciones síncronas (SQLite) como asíncronas (PostgreSQL)
    let visitas;
    if (typeof db.obtenerVisitasSinPagar === 'function') {
      const result = db.obtenerVisitasSinPagar(clienteId, responsableId);
      visitas = result instanceof Promise ? await result : result;
    } else {
      throw new Error('Función obtenerVisitasSinPagar no encontrada');
    }
    
    // Preparar datos para Excel
    const rows = visitas.map(v => ({
      'ID Visita': v.id,
      'Fecha Visita': v.fecha_visita || '',
      'Cliente': v.cliente_nombre || '',
      'RUT Cliente': v.cliente_rut || '',
      'Dirección': v.cliente_direccion || '',
      'Comuna': v.cliente_comuna || '',
      'Celular': v.cliente_celular || '',
      'Email': v.cliente_email || '',
      'Responsable': v.responsable_nombre || 'Sin asignar',
      'Precio': v.precio || 0,
      'Documento Odoo': v.odoo_move_name || 'No emitido',
      'Estado Pago': v.odoo_payment_state || 'Pendiente',
      'Error Odoo': v.odoo_error || ''
    }));
    
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Visitas Sin Pagar');
    
    // Agregar hoja de resumen
    const total = visitas.length;
    const totalMonto = visitas.reduce((sum, v) => sum + (parseFloat(v.precio) || 0), 0);
    const resumen = [
      { 'Concepto': 'Total Visitas Sin Pagar', 'Valor': total },
      { 'Concepto': 'Monto Total Pendiente', 'Valor': totalMonto }
    ];
    const wsResumen = XLSX.utils.json_to_sheet(resumen);
    XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen');
    
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const today = new Date().toISOString().slice(0, 10);
    const filename = `visitas-sin-pagar-${today}.xlsx`;
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buf);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Sincronizar pagos del mes desde Odoo
app.post('/api/reportes/sync-pagos-mes', requireAuth, async (req, res) => {
  try {
    if (!req.isAdmin) {
      return res.status(403).json({ error: 'Solo administradores pueden sincronizar pagos' });
    }
    
    const hoy = new Date();
    const ano = hoy.getFullYear();
    const mes = hoy.getMonth() + 1; // getMonth() devuelve 0-11
    
    // Obtener visitas del mes actual con odoo_move_id
    const result = db.obtenerVisitasDelMesConOdoo(ano, mes);
    const visitas = result instanceof Promise ? await result : result;
    
    if (!visitas || visitas.length === 0) {
      return res.json({ 
        success: true, 
        actualizadas: 0, 
        errores: 0,
        mensaje: 'No hay visitas del mes con documentos en Odoo para sincronizar'
      });
    }
    
    let actualizadas = 0;
    let errores = 0;
    const erroresDetalle = [];
    
    // Sincronizar cada visita
    for (const visita of visitas) {
      try {
        const estadoOdoo = await odoo.getPaymentStateFromOdoo(visita.odoo_move_id);
        
        // Solo actualizar si cambió el estado
        if (estadoOdoo.payment_state !== visita.odoo_payment_state) {
          db.actualizarVisita(visita.id, {
            odoo_payment_state: estadoOdoo.payment_state,
            odoo_last_sync: new Date().toISOString(),
            odoo_error: null
          });
          actualizadas++;
        }
      } catch (error) {
        errores++;
        const errorMsg = error?.message || String(error);
        erroresDetalle.push({
          visita_id: visita.id,
          odoo_move_id: visita.odoo_move_id,
          error: errorMsg
        });
        console.error(`[Sync Pagos] Error sincronizando visita ${visita.id}:`, errorMsg);
      }
    }
    
    res.json({
      success: true,
      actualizadas,
      errores,
      total: visitas.length,
      erroresDetalle: erroresDetalle.length > 0 ? erroresDetalle : undefined
    });
  } catch (error) {
    console.error('[API] Error sincronizando pagos del mes:', error);
    res.status(500).json({ error: error.message });
  }
});

// Progreso por responsable (solo admin)
app.get('/api/progreso/:semana', requireAuth, async (req, res) => {
  try {
    if (!req.isAdmin) {
      return res.status(403).json({ error: 'Solo administradores pueden ver el progreso' });
    }
    
    const progreso = await db.obtenerProgresoPorResponsable(req.params.semana);
    res.json(progreso);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Notas de asignaciones (solo admin)
app.get('/api/notas/:semana', requireAuth, async (req, res) => {
  try {
    if (!req.isAdmin) {
      return res.status(403).json({ error: 'Solo administradores pueden ver las notas' });
    }
    
    const notas = await db.obtenerAsignacionesConNotas(req.params.semana);
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

