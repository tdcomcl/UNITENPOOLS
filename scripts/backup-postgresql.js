#!/usr/bin/env node
/**
 * Script para hacer respaldo de la base de datos PostgreSQL
 * 
 * Uso:
 *   node scripts/backup-postgresql.js
 * 
 * Requisitos:
 *   - PostgreSQL instalado con pg_dump disponible
 *   - Variables de entorno configuradas (.env)
 */

require('dotenv').config();
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuración desde variables de entorno
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || '5432',
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

// Construir comando pg_dump
// Usar PGPASSWORD para evitar que pida contraseña
// Agregar --no-version-check para evitar problemas de versión (PostgreSQL 15+)
// Si no funciona, intentar sin esa opción
const pgDumpSqlCommand = `PGPASSWORD="${dbConfig.password}" pg_dump --no-version-check -h ${dbConfig.host} -p ${dbConfig.port} -U ${dbConfig.user} -d ${dbConfig.database} -F p > "${backupPath}" 2>&1`;

console.log('🔄 Iniciando respaldo de PostgreSQL...\n');
console.log('Configuración:');
console.log(`  Host: ${dbConfig.host}:${dbConfig.port}`);
console.log(`  Database: ${dbConfig.database}`);
console.log(`  User: ${dbConfig.user}`);
console.log(`  Archivo: ${backupPath}\n`);

// Verificar que pg_dump esté disponible
exec('which pg_dump', (error) => {
  if (error) {
    console.error('❌ Error: pg_dump no está disponible en el PATH');
    console.error('   Asegúrate de que PostgreSQL esté instalado y pg_dump esté en tu PATH');
    process.exit(1);
  }

  // Ejecutar pg_dump
  console.log('⏳ Ejecutando pg_dump...');
  exec(pgDumpSqlCommand, (error, stdout, stderr) => {
    // Si hay error de versión, intentar sin --no-version-check
    if (error && (stderr.includes('version mismatch') || stderr.includes('server version'))) {
      console.log('⚠️  Advertencia de versión detectada. Intentando sin --no-version-check...');
      const pgDumpSqlCommandFallback = `PGPASSWORD="${dbConfig.password}" pg_dump -h ${dbConfig.host} -p ${dbConfig.port} -U ${dbConfig.user} -d ${dbConfig.database} -F p > "${backupPath}" 2>&1`;
      
      exec(pgDumpSqlCommandFallback, (error2, stdout2, stderr2) => {
        if (error2) {
          console.error('❌ Error ejecutando pg_dump:', error2.message);
          console.error('\n💡 Solución: Actualiza pg_dump a una versión compatible con PostgreSQL 18');
          console.error('   En macOS: brew upgrade postgresql@14 (o instala postgresql@18)');
          console.error('   O usa pg_dump desde el servidor PostgreSQL directamente');
          if (stderr2) {
            console.error('   Detalles:', stderr2);
          }
          process.exit(1);
        }
        checkBackupFile();
      });
      return;
    }
    
    if (error) {
      console.error('❌ Error ejecutando pg_dump:', error.message);
      if (stderr) {
        console.error('   Detalles:', stderr);
      }
      process.exit(1);
    }
    
    checkBackupFile();
  });
  
  function checkBackupFile() {

    // Verificar que el archivo se creó
    if (fs.existsSync(backupPath)) {
      const stats = fs.statSync(backupPath);
      const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
      
      console.log('✅ Respaldo completado exitosamente!');
      console.log(`   Archivo: ${backupPath}`);
      console.log(`   Tamaño: ${fileSizeMB} MB`);
      console.log(`\n💾 Para restaurar este respaldo:`);
      console.log(`   PGPASSWORD="${dbConfig.password}" psql -h ${dbConfig.host} -p ${dbConfig.port} -U ${dbConfig.user} -d ${dbConfig.database} < "${backupPath}"`);
    } else {
      console.error('❌ Error: El archivo de respaldo no se creó');
      process.exit(1);
    }
  }
});
