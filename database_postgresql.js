/**
 * Base de datos PostgreSQL para UNITENPOOLS
 * Versión migrada desde SQLite
 */
require('dotenv').config();
const { Pool } = require('pg');

class PiscinasDB {
  constructor() {
    const dbType = process.env.DB_TYPE || 'sqlite';

    if (dbType !== 'postgresql') {
      throw new Error('Este archivo es solo para PostgreSQL. Usa database.js para SQLite o configura DB_TYPE=postgresql');
    }

    this.pool = new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      database: process.env.DB_NAME || 'unitenpools',
      user: process.env.DB_USER || 'unitenpools_user',
      password: process.env.DB_PASSWORD || '',
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    // Manejo de errores de conexión
    this.pool.on('error', (err) => {
      console.error('Error inesperado en el pool de PostgreSQL', err);
    });

    // Inicializar esquema
    this.initDatabase().catch(err => {
      console.error('Error inicializando esquema PostgreSQL:', err.message);
    });
  }

  async query(text, params) {
    const start = Date.now();
    try {
      const res = await this.pool.query(text, params);
      const duration = Date.now() - start;
      if (duration > 1000) {
        console.log('Query lenta ejecutada', { text, duration, rows: res.rowCount });
      }
      return res;
    } catch (error) {
      console.error('Error ejecutando query', { text, error: error.message });
      throw error;
    }
  }

  // Helper para convertir resultados a formato compatible
  rowToObject(row) {
    const obj = {};
    for (const key in row) {
      obj[key] = row[key];
    }
    return obj;
  }

  async initDatabase() {
    const fs = require('fs');
    const path = require('path');
    const schemaPath = path.join(__dirname, 'schema_postgresql.sql');

    if (fs.existsSync(schemaPath)) {
      const schema = fs.readFileSync(schemaPath, 'utf8');
      try {
        await this.query(schema);
        console.log('✅ Esquema PostgreSQL inicializado');
      } catch (error) {
        // Ignorar errores de "ya existe" (tablas, índices, triggers, funciones)
        if (!error.message.includes('already exists') &&
          !error.message.includes('ya existe') &&
          !error.message.includes('duplicate key')) {
          console.error('Error inicializando esquema:', error.message);
        }
        // Si hay error pero es porque ya existe, está bien
      }
    }
  }

  // Responsables
  async obtenerResponsables(activosOnly = true) {
    const query = activosOnly
      ? `SELECT * FROM responsables WHERE activo = 1 ORDER BY nombre`
      : `SELECT * FROM responsables ORDER BY nombre`;
    const result = await this.query(query);
    return result.rows.map(r => this.rowToObject(r));
  }

  async agregarResponsable(nombre) {
    try {
      const result = await this.query(
        'INSERT INTO responsables (nombre) VALUES ($1) RETURNING id',
        [nombre]
      );
      return result.rows[0].id;
    } catch (error) {
      if (error.code === '23505') { // UNIQUE violation
        const result = await this.query('SELECT id FROM responsables WHERE nombre = $1', [nombre]);
        return result.rows[0] ? result.rows[0].id : null;
      }
      throw error;
    }
  }

  // Clientes
  async obtenerClientes(activosOnly = true, responsableId = null) {
    let whereClause = '';
    const params = [];
    let paramIndex = 1;

    if (responsableId) {
      whereClause = `WHERE c.responsable_id = $${paramIndex++}`;
      params.push(responsableId);
      if (activosOnly) {
        whereClause += ` AND c.activo = 1`;
      }
    } else if (activosOnly) {
      whereClause = 'WHERE c.activo = 1';
    }

    const query = `SELECT c.*, r.nombre as responsable_nombre 
                   FROM clientes c
                   LEFT JOIN responsables r ON c.responsable_id = r.id
                   ${whereClause}
                   ORDER BY c.nombre`;
    const result = await this.query(query, params);
    return result.rows.map(r => this.rowToObject(r));
  }

  async obtenerClientePorId(id) {
    const result = await this.query(`
      SELECT c.*, r.nombre as responsable_nombre 
      FROM clientes c
      LEFT JOIN responsables r ON c.responsable_id = r.id
      WHERE c.id = $1
    `, [id]);
    return result.rows[0] ? this.rowToObject(result.rows[0]) : null;
  }

  async agregarCliente(nombre, direccion = null, comuna = null, celular = null,
    responsable_id = null, dia_atencion = null, precio_por_visita = 0,
    rut = null, email = null, documento_tipo = 'invoice',
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
        c.documento_tipo ?? 'invoice',
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

    const result = await this.query(`
      INSERT INTO clientes 
      (nombre, rut, direccion, comuna, celular, email, documento_tipo,
       factura_razon_social, factura_rut, factura_giro, factura_direccion, factura_comuna, factura_email,
       invoice_nombre, invoice_tax_id, invoice_direccion, invoice_comuna, invoice_email, invoice_pais,
       responsable_id, dia_atencion, precio_por_visita)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
      RETURNING id
    `, [
      nombre, rut, direccion, comuna, celular, email, documento_tipo,
      factura_razon_social, factura_rut, factura_giro, factura_direccion, factura_comuna, factura_email,
      invoice_nombre, invoice_tax_id, invoice_direccion, invoice_comuna, invoice_email, invoice_pais,
      responsable_id, dia_atencion, precio_por_visita
    ]);
    return result.rows[0].id;
  }

  async actualizarCliente(id, updates) {
    const fields = [];
    const values = [];
    let paramIndex = 1;

    Object.keys(updates).forEach(key => {
      if (updates[key] !== undefined) {
        fields.push(`${key} = $${paramIndex++}`);
        values.push(updates[key]);
      }
    });

    if (fields.length === 0) return;

    values.push(id);
    const query = `UPDATE clientes SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${paramIndex}`;
    await this.query(query, values);
  }

  // Asignaciones semanales
  obtenerSemanaActual() {
    const today = new Date();
    const day = today.getDay();
    const diff = today.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(today.setDate(diff));
    return monday.toISOString().split('T')[0];
  }

  async obtenerAsignacionesSemana(semanaInicio, responsableId = null) {
    let whereClause = 'WHERE a.semana_inicio = $1';
    const params = [semanaInicio];
    let paramIndex = 2;

    if (responsableId) {
      whereClause += ` AND a.responsable_id = $${paramIndex++}`;
      params.push(responsableId);
    }

    const result = await this.query(`
      SELECT a.*, c.nombre as cliente_nombre, c.direccion, c.comuna, c.celular,
             r.nombre as responsable_nombre, a.precio as precio
      FROM asignaciones_semanales a
      LEFT JOIN clientes c ON a.cliente_id = c.id
      LEFT JOIN responsables r ON a.responsable_id = r.id
      ${whereClause}
      ORDER BY a.dia_atencion, c.nombre
    `, params);

    console.log(`[DB] Obtenidas ${result.rows.length} asignaciones para semana ${semanaInicio}`);
    return result.rows.map(r => this.rowToObject(r));
  }

  async obtenerAsignacionesConNotas(semanaInicio) {
    const result = await this.query(`
      SELECT a.*, c.nombre as cliente_nombre, c.direccion, c.comuna, c.celular,
             r.nombre as responsable_nombre
      FROM asignaciones_semanales a
      LEFT JOIN clientes c ON a.cliente_id = c.id
      LEFT JOIN responsables r ON a.responsable_id = r.id
      WHERE a.semana_inicio = $1 AND a.notas IS NOT NULL AND a.notas != ''
      ORDER BY a.dia_atencion, c.nombre
    `, [semanaInicio]);
    return result.rows.map(r => this.rowToObject(r));
  }

  async asignarClientesSemana(semanaInicio) {
    const clientes = await this.obtenerClientes(true);
    let asignados = 0;
    let actualizados = 0;
    let preservados = 0;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      for (const cliente of clientes) {
        // Soporte para múltiples días (ej: "Lunes,Jueves" o "Lunes, Jueves")
        const dias = (cliente.dia_atencion || '').split(',').map(d => d.trim()).filter(d => d);

        // Si no tiene día asignado, usar null/vacío para crear almenos una (o decidir si saltar)
        // Comportamiento actual: si no tiene día, crea una con dia_atencion=null
        if (dias.length === 0) dias.push(null);

        for (const dia of dias) {
          // Verificar si ya existe la asignación para esta semana+cliente+dia
          let checkQuery = `
              SELECT id, visita_id, realizada FROM asignaciones_semanales
              WHERE semana_inicio = $1 AND cliente_id = $2
            `;
          const checkParams = [semanaInicio, cliente.id];

          if (dia) {
            checkQuery += ` AND dia_atencion = $3`;
            checkParams.push(dia);
          } else {
            checkQuery += ` AND dia_atencion IS NULL`;
          }

          const checkResult = await client.query(checkQuery, checkParams);

          if (checkResult.rows.length > 0) {
            const existente = checkResult.rows[0];

            // Si ya existe y tiene visita_id o está realizada, preservarla
            if (existente.visita_id || existente.realizada) {
              preservados++;
              continue; // No tocar esta asignación
            }

            // Si existe pero no tiene visita, actualizar
            // Solo actualizamos si no está realizada ni tiene visita
            // La condición del update debe matching exactamente la row encontrada
            await client.query(`
                UPDATE asignaciones_semanales
                SET responsable_id = $1,
                    precio = $2
                WHERE id = $3
              `, [cliente.responsable_id, cliente.precio_por_visita, existente.id]);
            actualizados++;
          } else {
            // No existe, crear nueva
            await client.query(`
                INSERT INTO asignaciones_semanales
                (semana_inicio, cliente_id, responsable_id, dia_atencion, precio)
                VALUES ($1, $2, $3, $4, $5)
              `, [semanaInicio, cliente.id, cliente.responsable_id, dia, cliente.precio_por_visita]);
            asignados++;
          }
        }
      }

      await client.query('COMMIT');
      console.log(`[DB] Asignaciones: ${asignados} nuevas, ${actualizados} actualizadas, ${preservados} preservadas`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    return asignados + actualizados;
  }

  async obtenerAsignacionPorId(id) {
    const result = await this.query(`
      SELECT * FROM asignaciones_semanales WHERE id = $1
    `, [id]);
    return result.rows[0] ? this.rowToObject(result.rows[0]) : null;
  }

  async actualizarAsignacion(id, updates) {
    const fields = [];
    const values = [];
    let paramIndex = 1;

    Object.keys(updates).forEach(key => {
      if (updates[key] !== undefined) {
        fields.push(`${key} = $${paramIndex++}`);
        values.push(updates[key]);
      }
    });

    if (fields.length === 0) return;

    values.push(id);
    const query = `UPDATE asignaciones_semanales SET ${fields.join(', ')} WHERE id = $${paramIndex}`;

    console.log(`[DB] Actualizando asignación ${id}:`, updates);
    await this.query(query, values);
  }

  // Visitas
  async registrarVisita(cliente_id, fecha_visita, responsable_id = null, precio = null, realizada = true) {
    if (precio === null || precio === undefined) {
      const cliente = await this.obtenerClientePorId(cliente_id);
      precio = cliente ? cliente.precio_por_visita : 0;
    }

    // Asegurar tipos correctos para PostgreSQL - convertir undefined a null
    const clienteIdInt = parseInt(cliente_id, 10);
    const responsableIdInt = (responsable_id !== null && responsable_id !== undefined) ? parseInt(responsable_id, 10) : null;
    const precioDecimal = (precio !== null && precio !== undefined) ? parseFloat(precio) : null;
    const realizadaInt = realizada ? 1 : 0;

    // Preparar parámetros asegurando que null sea null (no undefined)
    const params = [
      clienteIdInt,
      fecha_visita,
      responsableIdInt === undefined ? null : responsableIdInt,
      precioDecimal === undefined ? null : precioDecimal,
      realizadaInt
    ];

    try {
      const result = await this.query(`
        INSERT INTO visitas
        (cliente_id, fecha_visita, responsable_id, precio, realizada)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `, params);
      return result.rows[0].id;
    } catch (error) {
      // Si hay error de clave duplicada, probablemente es un problema de secuencia
      // Intentar sincronizar la secuencia y reintentar
      if (error.code === '23505') {
        console.error('[DB] Error de clave duplicada en visitas. Sincronizando secuencia...');
        try {
          await this.query(`
            SELECT setval('visitas_id_seq', (SELECT COALESCE(MAX(id),0)+1 FROM visitas), false)
          `);
          // Reintentar el INSERT con los mismos parámetros
          const result = await this.query(`
            INSERT INTO visitas
            (cliente_id, fecha_visita, responsable_id, precio, realizada)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id
          `, params);
          console.log('[DB] Visita insertada después de sincronizar secuencia');
          return result.rows[0].id;
        } catch (retryError) {
          console.error('[DB] Error al reintentar después de sincronizar:', retryError.message);
          throw retryError;
        }
      }
      throw error;
    }
  }

  async obtenerVisitaPorId(id) {
    const result = await this.query(`
      SELECT * FROM visitas WHERE id = $1
    `, [id]);
    return result.rows[0] ? this.rowToObject(result.rows[0]) : null;
  }

  async actualizarVisita(id, updates) {
    const fields = [];
    const values = [];
    let paramIndex = 1;

    Object.keys(updates).forEach(key => {
      if (updates[key] !== undefined) {
        fields.push(`${key} = $${paramIndex++}`);
        values.push(updates[key]);
      }
    });

    if (fields.length === 0) return;

    values.push(id);
    const query = `UPDATE visitas SET ${fields.join(', ')} WHERE id = $${paramIndex}`;
    await this.query(query, values);
  }

  async obtenerVisitasCliente(cliente_id, limit = 10) {
    const result = await this.query(`
      SELECT v.*, c.nombre as cliente_nombre, r.nombre as responsable_nombre
      FROM visitas v
      LEFT JOIN clientes c ON v.cliente_id = c.id
      LEFT JOIN responsables r ON v.responsable_id = r.id
      WHERE v.cliente_id = $1
      ORDER BY v.fecha_visita DESC
      LIMIT $2
    `, [cliente_id, limit]);
    return result.rows.map(r => this.rowToObject(r));
  }

  // Obtener visitas del mes actual con odoo_move_id para sincronizar pagos
  async obtenerVisitasDelMesConOdoo(ano, mes) {
    // mes es 1-12, año es 4 dígitos
    const fechaInicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
    const fechaFin = `${ano}-${String(mes).padStart(2, '0')}-31`;

    const result = await this.query(`
      SELECT id, odoo_move_id, odoo_move_name, odoo_payment_state, fecha_visita
      FROM visitas
      WHERE odoo_move_id IS NOT NULL
        AND fecha_visita >= $1::date
        AND fecha_visita <= $2::date
        AND realizada = 1
      ORDER BY fecha_visita
    `, [fechaInicio, fechaFin]);

    return result.rows.map(r => this.rowToObject(r));
  }

  // Obtener visitas sin pagar (para reportes)
  async obtenerVisitasSinPagar(clienteId = null, responsableId = null) {
    let whereClause = `WHERE v.realizada = 1 AND (
      v.odoo_payment_state IS NULL 
      OR v.odoo_payment_state = '' 
      OR v.odoo_payment_state = 'not_paid' 
      OR v.odoo_payment_state = 'partial'
      OR (v.odoo_payment_state IS NOT NULL AND v.odoo_payment_state NOT IN ('paid', 'in_payment'))
    )`;
    const params = [];
    let paramIndex = 1;

    if (clienteId) {
      whereClause += ` AND v.cliente_id = $${paramIndex++}`;
      params.push(clienteId);
    }

    if (responsableId) {
      whereClause += ` AND v.responsable_id = $${paramIndex++}`;
      params.push(responsableId);
    }

    try {
      const result = await this.query(`
        SELECT 
          v.id,
          v.cliente_id,
          v.fecha_visita,
          v.precio,
          v.odoo_move_name,
          v.odoo_payment_state,
          v.odoo_error,
          c.nombre as cliente_nombre,
          c.rut as cliente_rut,
          c.direccion as cliente_direccion,
          c.comuna as cliente_comuna,
          c.celular as cliente_celular,
          c.email as cliente_email,
          c.documento_tipo,
          r.nombre as responsable_nombre
        FROM visitas v
        LEFT JOIN clientes c ON v.cliente_id = c.id
        LEFT JOIN responsables r ON v.responsable_id = r.id
        ${whereClause}
        ORDER BY v.fecha_visita DESC, c.nombre
      `, params);
      return result.rows.map(r => this.rowToObject(r));
    } catch (error) {
      console.error('[DB] Error obteniendo visitas sin pagar:', error);
      throw error;
    }
  }

  // Estadísticas
  async obtenerEstadisticas(responsableId = null) {
    let clienteWhere = 'WHERE activo = 1';
    let asignacionWhere = '';
    const params = [];
    let paramIndex = 1;

    if (responsableId) {
      clienteWhere = `WHERE activo = 1 AND responsable_id = $${paramIndex++}`;
      asignacionWhere = `AND responsable_id = $${paramIndex++}`;
      params.push(responsableId, responsableId);
    }

    const totalClientesResult = await this.query(
      `SELECT COUNT(*) as total FROM clientes ${clienteWhere}`,
      responsableId ? [responsableId] : []
    );
    const totalClientes = parseInt(totalClientesResult.rows[0].total, 10);

    const totalResponsablesResult = await this.query(
      'SELECT COUNT(*) as total FROM responsables WHERE activo = 1'
    );
    const totalResponsables = parseInt(totalResponsablesResult.rows[0].total, 10);

    const semanaActual = this.obtenerSemanaActual();

    const asignacionQuery = responsableId
      ? `SELECT COUNT(*) as total FROM asignaciones_semanales WHERE semana_inicio = $1 ${asignacionWhere}`
      : 'SELECT COUNT(*) as total FROM asignaciones_semanales WHERE semana_inicio = $1';

    const asignacionesResult = await this.query(asignacionQuery, params.length > 0 ? [semanaActual, ...params] : [semanaActual]);
    const asignacionesSemana = parseInt(asignacionesResult.rows[0].total, 10);

    return {
      totalClientes,
      totalResponsables,
      asignacionesSemanaActual: asignacionesSemana,
      semanaActual
    };
  }

  // Usuarios y autenticación
  async obtenerUsuarioPorUsername(username) {
    const result = await this.query(`
      SELECT u.*, r.nombre as responsable_nombre
      FROM usuarios u
      LEFT JOIN responsables r ON u.responsable_id = r.id
      WHERE u.username = $1 AND u.activo = 1
    `, [username]);
    return result.rows[0] ? this.rowToObject(result.rows[0]) : null;
  }

  async crearUsuario(username, password, responsableId = null, rol = 'responsable') {
    try {
      const result = await this.query(`
        INSERT INTO usuarios (username, password, responsable_id, rol)
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `, [username, password, responsableId, rol]);
      return result.rows[0].id;
    } catch (error) {
      if (error.code === '23505') {
        throw new Error('El usuario ya existe');
      }
      throw error;
    }
  }

  async verificarPassword(username, password) {
    const usuario = await this.obtenerUsuarioPorUsername(username);
    if (!usuario) {
      return null;
    }
    if (usuario.password === password) {
      const { password: _, ...usuarioSinPassword } = usuario;
      return usuarioSinPassword;
    }
    return null;
  }

  async obtenerUsuarioPorId(id) {
    const result = await this.query(`
      SELECT u.*, r.nombre as responsable_nombre
      FROM usuarios u
      LEFT JOIN responsables r ON u.responsable_id = r.id
      WHERE u.id = $1
    `, [id]);
    return result.rows[0] ? this.rowToObject(result.rows[0]) : null;
  }

  async obtenerUsuarios() {
    const result = await this.query(`
      SELECT u.*, r.nombre as responsable_nombre
      FROM usuarios u
      LEFT JOIN responsables r ON u.responsable_id = r.id
      ORDER BY u.username
    `);
    return result.rows.map(r => this.rowToObject(r));
  }

  // Progreso por responsable
  async obtenerProgresoPorResponsable(semanaInicio) {
    const result = await this.query(`
      SELECT a.*, r.nombre as responsable_nombre
      FROM asignaciones_semanales a
      LEFT JOIN responsables r ON a.responsable_id = r.id
      WHERE a.semana_inicio = $1
    `, [semanaInicio]);

    const asignaciones = result.rows.map(r => this.rowToObject(r));
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

      const dia = asig.dia_atencion || 'Sin día';
      if (!porResponsable[respId].por_dia[dia]) {
        porResponsable[respId].por_dia[dia] = { total: 0, realizadas: 0 };
      }
      porResponsable[respId].por_dia[dia].total++;
      if (asig.realizada) {
        porResponsable[respId].por_dia[dia].realizadas++;
      }
    });

    return Object.values(porResponsable).sort((a, b) =>
      a.responsable_nombre.localeCompare(b.responsable_nombre)
    );
  }

  // Método para compatibilidad con código existente que accede a this.db.prepare()
  get db() {
    return {
      prepare: (query) => ({
        get: async (...params) => {
          const result = await this.query(query.replace(/\?/g, (_, i) => `$${i + 1}`), params);
          return result.rows[0] ? this.rowToObject(result.rows[0]) : null;
        },
        all: async (...params) => {
          const result = await this.query(query.replace(/\?/g, (_, i) => `$${i + 1}`), params);
          return result.rows.map(r => this.rowToObject(r));
        },
        run: async (...params) => {
          const result = await this.query(query.replace(/\?/g, (_, i) => `$${i + 1}`), params);
          return { lastInsertRowid: result.rows[0]?.id };
        }
      })
    };
  }
}

// Exportar instancia única
const db = new PiscinasDB();
module.exports = db;
