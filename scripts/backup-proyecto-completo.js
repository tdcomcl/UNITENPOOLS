#!/usr/bin/env node
/**
 * Script para hacer respaldo completo del proyecto
 * Incluye:
 * - Base de datos PostgreSQL
 * - Todos los archivos del código fuente
 * - Crea un archivo comprimido .tar.gz
 * 
 * Uso:
 *   node scripts/backup-proyecto-completo.js
 */

require('dotenv').config();
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');

const execAsync = promisify(exec);

// Configuración
const projectRoot = path.join(__dirname, '..');
const backupsDir = path.join(projectRoot, 'backups');

// Generar timestamp para el respaldo
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0] + '_' + 
                  new Date().toTimeString().split(' ')[0].replace(/:/g, '-');
const backupDirName = `backup_proyecto_${timestamp}`;
const backupDirPath = path.join(backupsDir, backupDirName);
const backupTarFile = path.join(backupsDir, `${backupDirName}.tar.gz`);

console.log('🔄 Iniciando respaldo completo del proyecto...\n');

// Crear directorio de backups si no existe
if (!fs.existsSync(backupsDir)) {
  fs.mkdirSync(backupsDir, { recursive: true });
  console.log(`📁 Directorio de backups creado: ${backupsDir}`);
}

// Crear directorio temporal para el respaldo
if (!fs.existsSync(backupDirPath)) {
  fs.mkdirSync(backupDirPath, { recursive: true });
}

async function backupDatabase() {
  console.log('📊 Respaldo de base de datos...');
  
  const dbType = process.env.DB_TYPE || 'sqlite';
  
  if (dbType === 'postgresql') {
    // Usar el script de respaldo de PostgreSQL
    const dbBackupScript = path.join(__dirname, 'backup-postgresql-node.js');
    const dbBackupFile = path.join(backupDirPath, 'database_backup.sql');
    
    try {
      // Ejecutar el script de respaldo pero redirigir la salida a nuestro archivo
      const { Pool } = require('pg');
      const pool = new Pool({
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        database: process.env.DB_NAME || 'unitenpools',
        user: process.env.DB_USER || 'unitenpools_user',
        password: process.env.DB_PASSWORD || ''
      });
      
      const client = await pool.connect();
      const writeStream = fs.createWriteStream(dbBackupFile);
      
      try {
        // Escribir encabezado
        writeStream.write(`-- PostgreSQL database dump\n`);
        writeStream.write(`-- Dumped from database: ${process.env.DB_NAME || 'unitenpools'}\n`);
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
        
        // Para cada tabla, hacer dump
        for (const table of tables) {
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
        
        // Obtener secuencias
        const sequencesResult = await client.query(`
          SELECT sequence_name
          FROM information_schema.sequences
          WHERE sequence_schema = 'public'
        `);
        
        if (sequencesResult.rows.length > 0) {
          writeStream.write(`\n-- Sequences\n`);
          for (const seq of sequencesResult.rows) {
            const lastValueResult = await client.query(`SELECT last_value FROM ${seq.sequence_name}`);
            const lastValue = lastValueResult.rows[0]?.last_value || 1;
            writeStream.write(`SELECT setval('${seq.sequence_name}', ${lastValue}, true);\n`);
          }
        }
        
        writeStream.end();
        
        await new Promise((resolve, reject) => {
          writeStream.on('finish', resolve);
          writeStream.on('error', reject);
        });
        
        const stats = fs.statSync(dbBackupFile);
        const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
        console.log(`   ✅ Base de datos respaldada: ${fileSizeMB} MB`);
        
      } finally {
        client.release();
        await pool.end();
      }
    } catch (error) {
      console.error('   ❌ Error respaldando base de datos:', error.message);
      throw error;
    }
  } else {
    // SQLite - copiar el archivo directamente
    const dbFile = path.join(projectRoot, 'piscinas.db');
    if (fs.existsSync(dbFile)) {
      const dbBackupFile = path.join(backupDirPath, 'piscinas.db');
      fs.copyFileSync(dbFile, dbBackupFile);
      const stats = fs.statSync(dbBackupFile);
      const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
      console.log(`   ✅ Base de datos SQLite respaldada: ${fileSizeMB} MB`);
    } else {
      console.log(`   ⚠️  Archivo de base de datos SQLite no encontrado`);
    }
  }
}

async function backupFiles() {
  console.log('\n📁 Respaldo de archivos del proyecto...');
  
  // Leer .gitignore para excluir archivos
  const gitignorePath = path.join(projectRoot, '.gitignore');
  let excludePatterns = [
    'node_modules',
    'backups',
    '.git',
    'venv',
    '__pycache__',
    '*.log',
    '.env',
    '*.db',
    '*.db.backup',
    'sessions'
  ];
  
  if (fs.existsSync(gitignorePath)) {
    const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
    const gitignoreLines = gitignoreContent.split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
    excludePatterns = [...excludePatterns, ...gitignoreLines];
  }
  
  // Crear lista de exclusiones para tar
  const excludeArgs = excludePatterns
    .filter(pattern => pattern)
    .map(pattern => `--exclude="${pattern}"`)
    .join(' ');
  
  // Crear archivo tar.gz
  const tarCommand = `cd "${projectRoot}" && tar ${excludeArgs} -czf "${backupTarFile}" . 2>&1`;
  
  try {
    const { stdout, stderr } = await execAsync(tarCommand);
    if (stderr && !stderr.includes('tar: Removing leading')) {
      console.warn('   ⚠️  Advertencias:', stderr);
    }
    
    const stats = fs.statSync(backupTarFile);
    const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    console.log(`   ✅ Archivos comprimidos: ${fileSizeMB} MB`);
    
  } catch (error) {
    console.error('   ❌ Error creando archivo comprimido:', error.message);
    throw error;
  }
}

async function createManifest() {
  console.log('\n📝 Creando manifiesto del respaldo...');
  
  const manifest = {
    fecha: new Date().toISOString(),
    timestamp: timestamp,
    proyecto: 'pisinas-alagrando',
    base_datos: {
      tipo: process.env.DB_TYPE || 'sqlite',
      host: process.env.DB_HOST || 'localhost',
      database: process.env.DB_NAME || 'unitenpools',
    },
    archivos: {
      base_datos: process.env.DB_TYPE === 'postgresql' ? 'database_backup.sql' : 'piscinas.db',
      proyecto: `${backupDirName}.tar.gz`
    }
  };
  
  const manifestPath = path.join(backupDirPath, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log('   ✅ Manifiesto creado');
}

async function main() {
  try {
    // 1. Respaldo de base de datos
    await backupDatabase();
    
    // 2. Respaldo de archivos
    await backupFiles();
    
    // 3. Crear manifiesto
    await createManifest();
    
    // 4. Mover el tar.gz al directorio de respaldo
    const finalTarPath = path.join(backupDirPath, `${backupDirName}.tar.gz`);
    if (fs.existsSync(backupTarFile)) {
      fs.renameSync(backupTarFile, finalTarPath);
    }
    
    // Calcular tamaños totales
    const dbBackupFile = path.join(backupDirPath, process.env.DB_TYPE === 'postgresql' ? 'database_backup.sql' : 'piscinas.db');
    const dbSize = fs.existsSync(dbBackupFile) ? fs.statSync(dbBackupFile).size : 0;
    const tarSize = fs.existsSync(finalTarPath) ? fs.statSync(finalTarPath).size : 0;
    const totalSizeMB = ((dbSize + tarSize) / (1024 * 1024)).toFixed(2);
    
    console.log('\n✅ Respaldo completo finalizado exitosamente!\n');
    console.log('📦 Archivos creados:');
    console.log(`   📁 Directorio: ${backupDirPath}`);
    if (fs.existsSync(dbBackupFile)) {
      console.log(`   💾 Base de datos: ${(dbSize / (1024 * 1024)).toFixed(2)} MB`);
    }
    if (fs.existsSync(finalTarPath)) {
      console.log(`   📦 Proyecto comprimido: ${(tarSize / (1024 * 1024)).toFixed(2)} MB`);
    }
    console.log(`   📊 Tamaño total: ${totalSizeMB} MB`);
    console.log(`\n💡 Para restaurar:`);
    console.log(`   1. Extraer: tar -xzf ${backupDirName}.tar.gz`);
    console.log(`   2. Restaurar BD: psql -d unitenpools < database_backup.sql`);
    
  } catch (error) {
    console.error('\n❌ Error durante el respaldo:', error.message);
    // Limpiar en caso de error
    if (fs.existsSync(backupDirPath)) {
      console.log('🧹 Limpiando archivos temporales...');
      fs.rmSync(backupDirPath, { recursive: true, force: true });
    }
    if (fs.existsSync(backupTarFile)) {
      fs.unlinkSync(backupTarFile);
    }
    process.exit(1);
  }
}

main();
