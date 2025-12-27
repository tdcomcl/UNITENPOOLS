const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const session = require('express-session');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3011;

// Middleware
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Configurar sesiones
app.use(session({
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
    const clientes = db.obtenerClientes(true, req.responsableId);
    res.json(clientes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/clientes/:id', requireAuth, (req, res) => {
  try {
    const cliente = db.obtenerClientePorId(req.params.id);
    if (!cliente) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }
    // Si es responsable, solo puede ver sus propios clientes
    if (req.responsableId && cliente.responsable_id !== req.responsableId) {
      return res.status(403).json({ error: 'No tienes permisos para ver este cliente' });
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
    const { nombre, direccion, comuna, celular, responsable_id, dia_atencion, precio_por_visita } = req.body;
    if (!nombre) {
      return res.status(400).json({ error: 'El nombre es obligatorio' });
    }
    const id = db.agregarCliente(nombre, direccion, comuna, celular, responsable_id, dia_atencion, precio_por_visita || 0);
    res.json({ id, nombre, direccion, comuna, celular, responsable_id, dia_atencion, precio_por_visita: precio_por_visita || 0 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/clientes/:id', requireAuth, (req, res) => {
  try {
    const cliente = db.obtenerClientePorId(req.params.id);
    if (!cliente) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }
    // Responsables solo pueden editar sus propios clientes (y solo campos limitados)
    if (req.responsableId && cliente.responsable_id !== req.responsableId) {
      return res.status(403).json({ error: 'No tienes permisos para editar este cliente' });
    }
    
    const { nombre, direccion, comuna, celular, responsable_id, dia_atencion, precio_por_visita, activo } = req.body;
    
    // Si es responsable, solo puede actualizar campos limitados
    const updates = req.isAdmin 
      ? { nombre, direccion, comuna, celular, responsable_id, dia_atencion, precio_por_visita, activo }
      : { direccion, comuna, celular }; // Responsables solo pueden actualizar datos de contacto
    
    db.actualizarCliente(req.params.id, updates);
    res.json({ success: true });
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

app.put('/api/asignaciones/:id', requireAuth, (req, res) => {
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
    
    // Verificar que se guardó correctamente
    const actualizada = db.db.prepare('SELECT * FROM asignaciones_semanales WHERE id = ?').get(req.params.id);
    console.log(`[API] Asignación después de actualizar - Notas:`, actualizada?.notas || '(null)');
    
    res.json({ success: true, notas: actualizada?.notas });
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

app.post('/api/visitas', requireAuth, (req, res) => {
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
    res.json({ id, success: true });
  } catch (error) {
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

