#!/usr/bin/env node
/**
 * Script para migrar datos de SQLite a PostgreSQL
 * 
 * Uso:
 *   node scripts/migrar-a-postgresql.js
 * 
 * Requisitos:
 *   1. PostgreSQL instalado y corriendo
 *   2. Base de datos creada (ver instrucciones)
 *   3. Variables de entorno configuradas (.env)
 */

require('dotenv').config();
const Database = require('better-sqlite3');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Configuración PostgreSQL
const pgConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'unitenpools',
  user: process.env.DB_USER || 'unitenpools_user',
  password: process.env.DB_PASSWORD || ''
};

// Conectar a SQLite (origen)
const sqliteDb = new Database(path.join(__dirname, '..', 'piscinas.db'));

// Conectar a PostgreSQL (destino)
const pgPool = new Pool(pgConfig);

async function testPostgresConnection() {
  try {
    const client = await pgPool.connect();
    await client.query('SELECT NOW()');
    client.release();
    console.log('✅ Conexión a PostgreSQL exitosa');
    return true;
  } catch (error) {
    console.error('❌ Error conectando a PostgreSQL:', error.message);
    console.error('\nVerifica:');
    console.error('  1. PostgreSQL está instalado y corriendo');
    console.error('  2. La base de datos existe: CREATE DATABASE unitenpools;');
    console.error('  3. Las variables de entorno están configuradas en .env');
    return false;
  }
}

async function createSchema() {
  const schemaPath = path.join(__dirname, '..', 'schema_postgresql.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  
  try {
    const client = await pgPool.connect();
    await client.query(schema);
    client.release();
    console.log('✅ Esquema PostgreSQL creado');
    return true;
  } catch (error) {
    console.error('❌ Error creando esquema:', error.message);
    return false;
  }
}

async function migrateTable(tableName, fields, transform = null) {
  const sqliteData = sqliteDb.prepare(`SELECT * FROM ${tableName}`).all();
  
  if (sqliteData.length === 0) {
    console.log(`  ⏭️  Tabla ${tableName} está vacía, saltando...`);
    return 0;
  }

  const client = await pgPool.connect();
  let migrated = 0;

  try {
    await client.query('BEGIN');

    for (const row of sqliteData) {
      let data = transform ? transform(row) : row;
      
      // Construir query de inserción
      const fieldNames = Object.keys(data).filter(k => data[k] !== undefined);
      const fieldValues = fieldNames.map(k => data[k]);
      const placeholders = fieldNames.map((_, i) => `$${i + 1}`).join(', ');
      
      const insertQuery = `
        INSERT INTO ${tableName} (${fieldNames.join(', ')})
        VALUES (${placeholders})
        ON CONFLICT DO NOTHING
      `;

      try {
        await client.query(insertQuery, fieldValues);
        migrated++;
      } catch (err) {
        console.error(`  ⚠️  Error insertando registro en ${tableName}:`, err.message);
      }
    }

    await client.query('COMMIT');
    console.log(`  ✅ ${tableName}: ${migrated}/${sqliteData.length} registros migrados`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return migrated;
}

// Transformadores para ajustar formatos entre SQLite y PostgreSQL
function transformResponsable(row) {
  return {
    id: row.id,
    nombre: row.nombre,
    activo: row.activo || 1,
    created_at: row.created_at ? new Date(row.created_at) : new Date()
  };
}

function transformUsuario(row) {
  return {
    id: row.id,
    username: row.username,
    password: row.password,
    responsable_id: row.responsable_id || null,
    rol: row.rol || 'responsable',
    activo: row.activo || 1,
    created_at: row.created_at ? new Date(row.created_at) : new Date()
  };
}

function transformCliente(row) {
  return {
    id: row.id,
    nombre: row.nombre,
    rut: row.rut || null,
    direccion: row.direccion || null,
    comuna: row.comuna || null,
    celular: row.celular || null,
    email: row.email || null,
    documento_tipo: row.documento_tipo || 'invoice',
    odoo_partner_id: row.odoo_partner_id || null,
    odoo_last_sync: row.odoo_last_sync ? new Date(row.odoo_last_sync) : null,
    factura_razon_social: row.factura_razon_social || null,
    factura_rut: row.factura_rut || null,
    factura_giro: row.factura_giro || null,
    factura_direccion: row.factura_direccion || null,
    factura_comuna: row.factura_comuna || null,
    factura_email: row.factura_email || null,
    invoice_nombre: row.invoice_nombre || null,
    invoice_tax_id: row.invoice_tax_id || null,
    invoice_direccion: row.invoice_direccion || null,
    invoice_comuna: row.invoice_comuna || null,
    invoice_email: row.invoice_email || null,
    invoice_pais: row.invoice_pais || null,
    responsable_id: row.responsable_id || null,
    dia_atencion: row.dia_atencion || null,
    precio_por_visita: row.precio_por_visita || 0,
    activo: row.activo || 1,
    notas: row.notas || null,
    created_at: row.created_at ? new Date(row.created_at) : new Date(),
    updated_at: row.updated_at ? new Date(row.updated_at) : new Date()
  };
}

function transformVisita(row) {
  return {
    id: row.id,
    cliente_id: row.cliente_id,
    fecha_visita: row.fecha_visita,
    responsable_id: row.responsable_id || null,
    precio: row.precio || null,
    realizada: row.realizada || 0,
    notas: row.notas || null,
    odoo_move_id: row.odoo_move_id || null,
    odoo_move_name: row.odoo_move_name || null,
    odoo_payment_state: row.odoo_payment_state || null,
    odoo_last_sync: row.odoo_last_sync ? new Date(row.odoo_last_sync) : null,
    odoo_error: row.odoo_error || null,
    odoo_notified_at: row.odoo_notified_at ? new Date(row.odoo_notified_at) : null,
    odoo_notify_count: row.odoo_notify_count || 0,
    created_at: row.created_at ? new Date(row.created_at) : new Date()
  };
}

function transformAsignacion(row) {
  return {
    id: row.id,
    semana_inicio: row.semana_inicio,
    cliente_id: row.cliente_id,
    responsable_id: row.responsable_id || null,
    dia_atencion: row.dia_atencion || null,
    precio: row.precio || null,
    asignada: row.asignada || 1,
    realizada: row.realizada || 0,
    notas: row.notas || null,
    visita_id: row.visita_id || null,
    created_at: row.created_at ? new Date(row.created_at) : new Date()
  };
}

async function migrate() {
  console.log('\n🚀 Iniciando migración de SQLite a PostgreSQL\n');
  console.log('Configuración PostgreSQL:');
  console.log(`  Host: ${pgConfig.host}:${pgConfig.port}`);
  console.log(`  Database: ${pgConfig.database}`);
  console.log(`  User: ${pgConfig.user}\n`);

  // 1. Probar conexión
  const connected = await testPostgresConnection();
  if (!connected) {
    process.exit(1);
  }

  // 2. Crear esquema
  console.log('\n📋 Creando esquema...');
  const schemaCreated = await createSchema();
  if (!schemaCreated) {
    process.exit(1);
  }

  // 3. Migrar datos (en orden de dependencias)
  console.log('\n📦 Migrando datos...\n');

  try {
    await migrateTable('responsables', null, transformResponsable);
    await migrateTable('usuarios', null, transformUsuario);
    await migrateTable('clientes', null, transformCliente);
    await migrateTable('visitas', null, transformVisita);
    await migrateTable('asignaciones_semanales', null, transformAsignacion);

    console.log('\n✅ Migración completada exitosamente!\n');
    
    // Verificar conteos
    const client = await pgPool.connect();
    const counts = {
      responsables: (await client.query('SELECT COUNT(*) FROM responsables')).rows[0].count,
      usuarios: (await client.query('SELECT COUNT(*) FROM usuarios')).rows[0].count,
      clientes: (await client.query('SELECT COUNT(*) FROM clientes')).rows[0].count,
      visitas: (await client.query('SELECT COUNT(*) FROM visitas')).rows[0].count,
      asignaciones: (await client.query('SELECT COUNT(*) FROM asignaciones_semanales')).rows[0].count
    };
    client.release();

    console.log('📊 Resumen:');
    console.log(`  Responsables: ${counts.responsables}`);
    console.log(`  Usuarios: ${counts.usuarios}`);
    console.log(`  Clientes: ${counts.clientes}`);
    console.log(`  Visitas: ${counts.visitas}`);
    console.log(`  Asignaciones: ${counts.asignaciones}`);
    console.log('\n✨ Listo! Ahora actualiza tu .env para usar PostgreSQL.\n');

  } catch (error) {
    console.error('\n❌ Error durante la migración:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    sqliteDb.close();
    await pgPool.end();
  }
}

// Ejecutar migración
migrate().catch(error => {
  console.error('Error fatal:', error);
  process.exit(1);
});
