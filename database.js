const Database = require('better-sqlite3');
const path = require('path');

class PiscinasDB {
  constructor(dbPath = 'piscinas.db') {
    this.db = new Database(dbPath);
    this.initDatabase();
  }

  ensureColumn(tableName, columnName, columnDefSql) {
    const cols = this.db.prepare(`PRAGMA table_info(${tableName})`).all();
    const exists = cols.some(c => c.name === columnName);
    if (!exists) {
      this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnDefSql}`);
    }
  }

  initDatabase() {
    // Tabla de responsables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS responsables (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL UNIQUE,
        activo INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    // Tabla de usuarios (para login)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        responsable_id INTEGER,
        rol TEXT DEFAULT 'responsable',
        activo INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (responsable_id) REFERENCES responsables(id)
      )
    `);

    // Tabla de clientes
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS clientes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        rut TEXT,
        direccion TEXT,
        comuna TEXT,
        celular TEXT,
        email TEXT,
        documento_tipo TEXT DEFAULT 'boleta',
        factura_razon_social TEXT,
        factura_rut TEXT,
        factura_giro TEXT,
        factura_direccion TEXT,
        factura_comuna TEXT,
        factura_email TEXT,
        invoice_nombre TEXT,
        invoice_tax_id TEXT,
        invoice_direccion TEXT,
        invoice_comuna TEXT,
        invoice_email TEXT,
        invoice_pais TEXT,
        responsable_id INTEGER,
        dia_atencion TEXT,
        precio_por_visita REAL DEFAULT 0,
        activo INTEGER DEFAULT 1,
        notas TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (responsable_id) REFERENCES responsables(id)
      )
    `);

    // Migración segura: agregar columnas nuevas si la BD ya existía
    this.ensureColumn('clientes', 'rut', 'rut TEXT');
    this.ensureColumn('clientes', 'email', 'email TEXT');
    this.ensureColumn('clientes', 'documento_tipo', "documento_tipo TEXT DEFAULT 'boleta'");
    this.ensureColumn('clientes', 'factura_razon_social', 'factura_razon_social TEXT');
    this.ensureColumn('clientes', 'factura_rut', 'factura_rut TEXT');
    this.ensureColumn('clientes', 'factura_giro', 'factura_giro TEXT');
    this.ensureColumn('clientes', 'factura_direccion', 'factura_direccion TEXT');
    this.ensureColumn('clientes', 'factura_comuna', 'factura_comuna TEXT');
    this.ensureColumn('clientes', 'factura_email', 'factura_email TEXT');
    this.ensureColumn('clientes', 'invoice_nombre', 'invoice_nombre TEXT');
    this.ensureColumn('clientes', 'invoice_tax_id', 'invoice_tax_id TEXT');
    this.ensureColumn('clientes', 'invoice_direccion', 'invoice_direccion TEXT');
    this.ensureColumn('clientes', 'invoice_comuna', 'invoice_comuna TEXT');
    this.ensureColumn('clientes', 'invoice_email', 'invoice_email TEXT');
    this.ensureColumn('clientes', 'invoice_pais', 'invoice_pais TEXT');

    // Tabla de visitas
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS visitas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cliente_id INTEGER NOT NULL,
        fecha_visita TEXT NOT NULL,
        responsable_id INTEGER,
        precio REAL,
        realizada INTEGER DEFAULT 0,
        notas TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (cliente_id) REFERENCES clientes(id),
        FOREIGN KEY (responsable_id) REFERENCES responsables(id)
      )
    `);

    // Tabla de asignaciones semanales
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS asignaciones_semanales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        semana_inicio TEXT NOT NULL,
        cliente_id INTEGER NOT NULL,
        responsable_id INTEGER,
        dia_atencion TEXT,
        precio REAL,
        asignada INTEGER DEFAULT 1,
        realizada INTEGER DEFAULT 0,
        notas TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (cliente_id) REFERENCES clientes(id),
        FOREIGN KEY (responsable_id) REFERENCES responsables(id),
        UNIQUE(semana_inicio, cliente_id)
      )
    `);

    // Índices
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_clientes_responsable ON clientes(responsable_id);
      CREATE INDEX IF NOT EXISTS idx_clientes_dia ON clientes(dia_atencion);
      CREATE INDEX IF NOT EXISTS idx_visitas_cliente ON visitas(cliente_id);
      CREATE INDEX IF NOT EXISTS idx_visitas_fecha ON visitas(fecha_visita);
      CREATE INDEX IF NOT EXISTS idx_asignaciones_semana ON asignaciones_semanales(semana_inicio);
      CREATE INDEX IF NOT EXISTS idx_asignaciones_cliente ON asignaciones_semanales(cliente_id);
    `);
  }

  // Responsables
  obtenerResponsables(activosOnly = true) {
    const query = activosOnly
      ? `SELECT * FROM responsables WHERE activo = 1 ORDER BY nombre`
      : `SELECT * FROM responsables ORDER BY nombre`;
    return this.db.prepare(query).all();
  }

  agregarResponsable(nombre) {
    try {
      const stmt = this.db.prepare('INSERT INTO responsables (nombre) VALUES (?)');
      const info = stmt.run(nombre);
      return info.lastInsertRowid;
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        // Si ya existe, retornar el ID existente
        const result = this.db.prepare('SELECT id FROM responsables WHERE nombre = ?').get(nombre);
        return result ? result.id : null;
      }
      throw error;
    }
  }

  // Clientes
  obtenerClientes(activosOnly = true, responsableId = null) {
    let whereClause = '';
    const params = [];
    
    if (responsableId) {
      whereClause = 'WHERE c.responsable_id = ?';
      params.push(responsableId);
      if (activosOnly) {
        whereClause += ' AND c.activo = 1';
      }
    } else if (activosOnly) {
      whereClause = 'WHERE c.activo = 1';
    }
    
    const query = `SELECT c.*, r.nombre as responsable_nombre 
                   FROM clientes c
                   LEFT JOIN responsables r ON c.responsable_id = r.id
                   ${whereClause}
                   ORDER BY c.nombre`;
    return this.db.prepare(query).all(...params);
  }

  obtenerClientePorId(id) {
    return this.db.prepare(`
      SELECT c.*, r.nombre as responsable_nombre 
      FROM clientes c
      LEFT JOIN responsables r ON c.responsable_id = r.id
      WHERE c.id = ?
    `).get(id);
  }

  agregarCliente(nombre, direccion = null, comuna = null, celular = null, 
                 responsable_id = null, dia_atencion = null, precio_por_visita = 0,
                 rut = null, email = null, documento_tipo = 'boleta',
                 factura_razon_social = null, factura_rut = null, factura_giro = null,
                 factura_direccion = null, factura_comuna = null, factura_email = null,
                 invoice_nombre = null, invoice_tax_id = null, invoice_direccion = null,
                 invoice_comuna = null, invoice_email = null, invoice_pais = null) {
    // Backward compatible: permitir pasar un objeto
    if (typeof nombre === 'object' && nombre !== null) {
      const c = nombre;
      return this.agregarCliente(
        c.nombre,
        c.direccion ?? null,
        c.comuna ?? null,
        c.celular ?? null,
        c.responsable_id ?? null,
        c.dia_atencion ?? null,
        c.precio_por_visita ?? 0,
        c.rut ?? null,
        c.email ?? null,
        c.documento_tipo ?? 'boleta',
        c.factura_razon_social ?? null,
        c.factura_rut ?? null,
        c.factura_giro ?? null,
        c.factura_direccion ?? null,
        c.factura_comuna ?? null,
        c.factura_email ?? null,
        c.invoice_nombre ?? null,
        c.invoice_tax_id ?? null,
        c.invoice_direccion ?? null,
        c.invoice_comuna ?? null,
        c.invoice_email ?? null,
        c.invoice_pais ?? null
      );
    }

    const stmt = this.db.prepare(`
      INSERT INTO clientes 
      (nombre, rut, direccion, comuna, celular, email, documento_tipo,
       factura_razon_social, factura_rut, factura_giro, factura_direccion, factura_comuna, factura_email,
       invoice_nombre, invoice_tax_id, invoice_direccion, invoice_comuna, invoice_email, invoice_pais,
       responsable_id, dia_atencion, precio_por_visita)
      VALUES (?, ?, ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?, ?,
              ?, ?, ?)
    `);
    const info = stmt.run(
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
    );
    return info.lastInsertRowid;
  }

  actualizarCliente(id, updates) {
    const fields = [];
    const values = [];
    
    Object.keys(updates).forEach(key => {
      if (updates[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(updates[key]);
      }
    });
    
    if (fields.length === 0) return;
    
    fields.push("updated_at = datetime('now')");
    values.push(id);
    
    const query = `UPDATE clientes SET ${fields.join(', ')} WHERE id = ?`;
    this.db.prepare(query).run(...values);
  }

  // Asignaciones semanales
  obtenerSemanaActual() {
    const today = new Date();
    const day = today.getDay();
    const diff = today.getDate() - day + (day === 0 ? -6 : 1); // Ajuste para lunes
    const monday = new Date(today.setDate(diff));
    return monday.toISOString().split('T')[0];
  }

  obtenerAsignacionesSemana(semanaInicio, responsableId = null) {
    let whereClause = 'WHERE a.semana_inicio = ?';
    const params = [semanaInicio];
    
    if (responsableId) {
      whereClause += ' AND a.responsable_id = ?';
      params.push(responsableId);
    }
    
    const result = this.db.prepare(`
      SELECT a.*, c.nombre as cliente_nombre, c.direccion, c.comuna, c.celular,
             r.nombre as responsable_nombre, a.precio as precio
      FROM asignaciones_semanales a
      LEFT JOIN clientes c ON a.cliente_id = c.id
      LEFT JOIN responsables r ON a.responsable_id = r.id
      ${whereClause}
      ORDER BY a.dia_atencion, c.nombre
    `).all(...params);
    
    // Debug: verificar que las notas estén incluidas
    console.log(`[DB] Obtenidas ${result.length} asignaciones para semana ${semanaInicio}`);
    const conNotas = result.filter(a => a.notas && a.notas.trim() !== '');
    if (conNotas.length > 0) {
      console.log(`[DB] ${conNotas.length} asignaciones con notas encontradas`);
    }
    
    return result;
  }

  obtenerAsignacionesConNotas(semanaInicio) {
    return this.db.prepare(`
      SELECT a.*, c.nombre as cliente_nombre, c.direccion, c.comuna, c.celular,
             r.nombre as responsable_nombre
      FROM asignaciones_semanales a
      LEFT JOIN clientes c ON a.cliente_id = c.id
      LEFT JOIN responsables r ON a.responsable_id = r.id
      WHERE a.semana_inicio = ? AND a.notas IS NOT NULL AND a.notas != ''
      ORDER BY a.dia_atencion, c.nombre
    `).all(semanaInicio);
  }

  asignarClientesSemana(semanaInicio) {
    const clientes = this.obtenerClientes(true);
    let asignados = 0;
    
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO asignaciones_semanales
      (semana_inicio, cliente_id, responsable_id, dia_atencion, precio)
      VALUES (?, ?, ?, ?, ?)
    `);
    
    const insertMany = this.db.transaction((clientes) => {
      for (const cliente of clientes) {
        stmt.run(
          semanaInicio,
          cliente.id,
          cliente.responsable_id,
          cliente.dia_atencion,
          cliente.precio_por_visita
        );
        asignados++;
      }
    });
    
    insertMany(clientes);
    return asignados;
  }

  actualizarAsignacion(id, updates) {
    const fields = [];
    const values = [];
    
    Object.keys(updates).forEach(key => {
      if (updates[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(updates[key]);
      }
    });
    
    if (fields.length === 0) return;
    
    values.push(id);
    const query = `UPDATE asignaciones_semanales SET ${fields.join(', ')} WHERE id = ?`;
    
    // Debug: verificar qué se está actualizando
    console.log(`[DB] Actualizando asignación ${id}:`, updates);
    
    const result = this.db.prepare(query).run(...values);
    
    // Verificar que se actualizó correctamente
    const actualizada = this.db.prepare('SELECT * FROM asignaciones_semanales WHERE id = ?').get(id);
    console.log(`[DB] Asignación actualizada. Notas:`, actualizada?.notas || '(vacío)');
    
    return result;
  }

  // Visitas
  registrarVisita(cliente_id, fecha_visita, responsable_id = null, precio = null, realizada = true) {
    if (precio === null) {
      const cliente = this.obtenerClientePorId(cliente_id);
      precio = cliente ? cliente.precio_por_visita : 0;
    }
    
    const stmt = this.db.prepare(`
      INSERT INTO visitas
      (cliente_id, fecha_visita, responsable_id, precio, realizada)
      VALUES (?, ?, ?, ?, ?)
    `);
    const info = stmt.run(cliente_id, fecha_visita, responsable_id, precio, realizada ? 1 : 0);
    return info.lastInsertRowid;
  }

  obtenerVisitasCliente(cliente_id, limit = 10) {
    return this.db.prepare(`
      SELECT v.*, c.nombre as cliente_nombre, r.nombre as responsable_nombre
      FROM visitas v
      LEFT JOIN clientes c ON v.cliente_id = c.id
      LEFT JOIN responsables r ON v.responsable_id = r.id
      WHERE v.cliente_id = ?
      ORDER BY v.fecha_visita DESC
      LIMIT ?
    `).all(cliente_id, limit);
  }

  // Estadísticas
  obtenerEstadisticas(responsableId = null) {
    let clienteWhere = 'WHERE activo = 1';
    let asignacionWhere = '';
    const params = [];
    
    if (responsableId) {
      clienteWhere = 'WHERE activo = 1 AND responsable_id = ?';
      asignacionWhere = 'AND responsable_id = ?';
      params.push(responsableId);
    }
    
    const totalClientes = responsableId 
      ? this.db.prepare(`SELECT COUNT(*) as total FROM clientes ${clienteWhere}`).get(responsableId)
      : this.db.prepare(`SELECT COUNT(*) as total FROM clientes ${clienteWhere}`).get();
    
    const totalResponsables = this.db.prepare('SELECT COUNT(*) as total FROM responsables WHERE activo = 1').get();
    const semanaActual = this.obtenerSemanaActual();
    
    const asignacionesSemana = responsableId
      ? this.db.prepare(`SELECT COUNT(*) as total FROM asignaciones_semanales WHERE semana_inicio = ? ${asignacionWhere}`).get(semanaActual, responsableId)
      : this.db.prepare('SELECT COUNT(*) as total FROM asignaciones_semanales WHERE semana_inicio = ?').get(semanaActual);
    
    return {
      totalClientes: totalClientes.total,
      totalResponsables: totalResponsables.total,
      asignacionesSemanaActual: asignacionesSemana.total,
      semanaActual
    };
  }

  // Usuarios y autenticación
  obtenerUsuarioPorUsername(username) {
    return this.db.prepare(`
      SELECT u.*, r.nombre as responsable_nombre
      FROM usuarios u
      LEFT JOIN responsables r ON u.responsable_id = r.id
      WHERE u.username = ? AND u.activo = 1
    `).get(username);
  }

  crearUsuario(username, password, responsableId = null, rol = 'responsable') {
    // Password simple (en producción debería estar hasheado)
    const stmt = this.db.prepare(`
      INSERT INTO usuarios (username, password, responsable_id, rol)
      VALUES (?, ?, ?, ?)
    `);
    try {
      const info = stmt.run(username, password, responsableId, rol);
      return info.lastInsertRowid;
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        throw new Error('El usuario ya existe');
      }
      throw error;
    }
  }

  verificarPassword(username, password) {
    const usuario = this.obtenerUsuarioPorUsername(username);
    if (!usuario) {
      return null;
    }
    // Comparación simple (en producción usar bcrypt)
    if (usuario.password === password) {
      const { password: _, ...usuarioSinPassword } = usuario;
      return usuarioSinPassword;
    }
    return null;
  }

  obtenerUsuarioPorId(id) {
    return this.db.prepare(`
      SELECT u.*, r.nombre as responsable_nombre
      FROM usuarios u
      LEFT JOIN responsables r ON u.responsable_id = r.id
      WHERE u.id = ?
    `).get(id);
  }

  obtenerUsuarios() {
    return this.db.prepare(`
      SELECT u.*, r.nombre as responsable_nombre
      FROM usuarios u
      LEFT JOIN responsables r ON u.responsable_id = r.id
      ORDER BY u.username
    `).all();
  }

  // Progreso por responsable
  obtenerProgresoPorResponsable(semanaInicio) {
    // Obtener todas las asignaciones de la semana
    const asignaciones = this.db.prepare(`
      SELECT a.*, r.nombre as responsable_nombre
      FROM asignaciones_semanales a
      LEFT JOIN responsables r ON a.responsable_id = r.id
      WHERE a.semana_inicio = ?
    `).all(semanaInicio);

    // Agrupar por responsable
    const porResponsable = {};
    
    asignaciones.forEach(asig => {
      const respId = asig.responsable_id || 0;
      const respNombre = asig.responsable_nombre || 'Sin asignar';
      
      if (!porResponsable[respId]) {
        porResponsable[respId] = {
          responsable_id: respId,
          responsable_nombre: respNombre,
          total: 0,
          realizadas: 0,
          pendientes: 0,
          por_dia: {}
        };
      }
      
      porResponsable[respId].total++;
      if (asig.realizada) {
        porResponsable[respId].realizadas++;
      } else {
        porResponsable[respId].pendientes++;
      }
      
      // Por día
      const dia = asig.dia_atencion || 'Sin día';
      if (!porResponsable[respId].por_dia[dia]) {
        porResponsable[respId].por_dia[dia] = { total: 0, realizadas: 0 };
      }
      porResponsable[respId].por_dia[dia].total++;
      if (asig.realizada) {
        porResponsable[respId].por_dia[dia].realizadas++;
      }
    });

    // Convertir a array y ordenar por nombre
    return Object.values(porResponsable).sort((a, b) => 
      a.responsable_nombre.localeCompare(b.responsable_nombre)
    );
  }
}

// Exportar instancia única
const db = new PiscinasDB();
module.exports = db;

