#!/usr/bin/env node
/**
 * Script para hacer respaldo de la base de datos PostgreSQL usando Node.js
 * Esta versión no requiere pg_dump del sistema, usa el módulo pg directamente
 * 
 * Uso:
 *   node scripts/backup-postgresql-node.js
 * 
 * Requisitos:
 *   - Variables de entorno configuradas (.env)
 *   - Módulo pg instalado (npm install pg)
 */

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Configuración desde variables de entorno
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'unitenpools',
  user: process.env.DB_USER || 'unitenpools_user',
  password: process.env.DB_PASSWORD || ''
};

// Crear directorio de backups si no existe
const backupsDir = path.join(__dirname, '..', 'backups');
if (!fs.existsSync(backupsDir)) {
  fs.mkdirSync(backupsDir, { recursive: true });
  console.log(`📁 Directorio de backups creado: ${backupsDir}`);
}

// Generar nombre de archivo con timestamp
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0] + '_' + 
                  new Date().toTimeString().split(' ')[0].replace(/:/g, '-');
const backupFilename = `backup_unitenpools_${timestamp}.sql`;
const backupPath = path.join(backupsDir, backupFilename);

console.log('🔄 Iniciando respaldo de PostgreSQL (usando Node.js)...\n');
console.log('Configuración:');
console.log(`  Host: ${dbConfig.host}:${dbConfig.port}`);
console.log(`  Database: ${dbConfig.database}`);
console.log(`  User: ${dbConfig.user}`);
console.log(`  Archivo: ${backupPath}\n`);

// Crear pool de conexiones
const pool = new Pool({
  host: dbConfig.host,
  port: dbConfig.port,
  database: dbConfig.database,
  user: dbConfig.user,
  password: dbConfig.password,
  max: 1, // Solo una conexión para el dump
});

async function backupDatabase() {
  const client = await pool.connect();
  const writeStream = fs.createWriteStream(backupPath);
  
  try {
    console.log('⏳ Conectando a la base de datos...');
    
    // Escribir encabezado del dump
    writeStream.write(`-- PostgreSQL database dump\n`);
    writeStream.write(`-- Dumped from database: ${dbConfig.database}\n`);
    writeStream.write(`-- Dump date: ${new Date().toISOString()}\n`);
    writeStream.write(`\n`);
    
    // Obtener todas las tablas
    const tablesResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    
    const tables = tablesResult.rows.map(row => row.table_name);
    console.log(`📊 Encontradas ${tables.length} tablas\n`);
    
    // Para cada tabla, hacer dump
    for (const table of tables) {
      console.log(`  📋 Respaldo de tabla: ${table}...`);
      
      // Obtener estructura de la tabla
      const createTableResult = await client.query(`
        SELECT 
          'CREATE TABLE ' || quote_ident(table_name) || ' (' ||
          string_agg(
            quote_ident(column_name) || ' ' || 
            CASE 
              WHEN data_type = 'character varying' THEN 'VARCHAR(' || character_maximum_length || ')'
              WHEN data_type = 'character' THEN 'CHAR(' || character_maximum_length || ')'
              WHEN data_type = 'numeric' THEN 'NUMERIC(' || numeric_precision || ',' || numeric_scale || ')'
              WHEN data_type = 'timestamp without time zone' THEN 'TIMESTAMP'
              WHEN data_type = 'timestamp with time zone' THEN 'TIMESTAMPTZ'
              WHEN data_type = 'time without time zone' THEN 'TIME'
              WHEN data_type = 'time with time zone' THEN 'TIMETZ'
              WHEN data_type = 'double precision' THEN 'DOUBLE PRECISION'
              WHEN data_type = 'USER-DEFINED' THEN udt_name
              ELSE UPPER(data_type)
            END ||
            CASE WHEN is_nullable = 'NO' THEN ' NOT NULL' ELSE '' END ||
            CASE WHEN column_default IS NOT NULL THEN ' DEFAULT ' || column_default ELSE '' END,
            ', '
            ORDER BY ordinal_position
          ) || ');' as create_statement
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        GROUP BY table_name
      `, [table]);
      
      if (createTableResult.rows.length > 0) {
        writeStream.write(`\n-- Table: ${table}\n`);
        writeStream.write(`DROP TABLE IF EXISTS ${table} CASCADE;\n`);
        writeStream.write(`${createTableResult.rows[0].create_statement}\n\n`);
      }
      
      // Obtener datos de la tabla
      const dataResult = await client.query(`SELECT * FROM ${table}`);
      
      if (dataResult.rows.length > 0) {
        writeStream.write(`\n-- Data for table: ${table}\n`);
        
        // Obtener nombres de columnas
        const columns = Object.keys(dataResult.rows[0]);
        
        for (const row of dataResult.rows) {
          const values = columns.map(col => {
            const val = row[col];
            if (val === null) return 'NULL';
            if (typeof val === 'string') {
              return `'${val.replace(/'/g, "''")}'`;
            }
            if (val instanceof Date) {
              return `'${val.toISOString()}'`;
            }
            return val;
          });
          
          writeStream.write(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values.join(', ')});\n`);
        }
        writeStream.write(`\n`);
      }
    }
    
    // Obtener secuencias y sus valores actuales
    const sequencesResult = await client.query(`
      SELECT sequence_name
      FROM information_schema.sequences
      WHERE sequence_schema = 'public'
    `);
    
    if (sequencesResult.rows.length > 0) {
      writeStream.write(`\n-- Sequences\n`);
      for (const seq of sequencesResult.rows) {
        // Obtener el último valor de la secuencia
        const lastValueResult = await client.query(`SELECT last_value FROM ${seq.sequence_name}`);
        const lastValue = lastValueResult.rows[0]?.last_value || 1;
        writeStream.write(`SELECT setval('${seq.sequence_name}', ${lastValue}, true);\n`);
      }
    }
    
    writeStream.end();
    
    // Esperar a que termine de escribir
    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });
    
    const stats = fs.statSync(backupPath);
    const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    
    console.log('\n✅ Respaldo completado exitosamente!');
    console.log(`   Archivo: ${backupPath}`);
    console.log(`   Tamaño: ${fileSizeMB} MB`);
    console.log(`\n💾 Para restaurar este respaldo:`);
    console.log(`   PGPASSWORD="${dbConfig.password}" psql -h ${dbConfig.host} -p ${dbConfig.port} -U ${dbConfig.user} -d ${dbConfig.database} < "${backupPath}"`);
    
  } catch (error) {
    console.error('❌ Error durante el respaldo:', error.message);
    if (fs.existsSync(backupPath)) {
      fs.unlinkSync(backupPath);
    }
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

backupDatabase().catch(error => {
  console.error('❌ Error fatal:', error);
  process.exit(1);
});
