/**
 * Script para corregir las secuencias de PostgreSQL después de la migración
 * Esto asegura que los IDs auto-incrementales funcionen correctamente
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'unitenpools',
  user: process.env.DB_USER || 'unitenpools_user',
  password: process.env.DB_PASSWORD || '',
});

async function fixSequences() {
  const client = await pool.connect();
  try {
    console.log('🔧 Corrigiendo secuencias de PostgreSQL...\n');

    // Obtener el máximo ID actual de cada tabla
    const tables = ['responsables', 'usuarios', 'clientes', 'visitas', 'asignaciones_semanales'];
    
    for (const table of tables) {
      try {
        // Obtener el máximo ID actual
        const maxResult = await client.query(`SELECT MAX(id) as max_id FROM ${table}`);
        const maxId = maxResult.rows[0].max_id || 0;
        
        // Obtener el nombre de la secuencia (usualmente es tabla_id_seq)
        const seqName = `${table}_id_seq`;
        
        // Verificar si la secuencia existe
        const seqExists = await client.query(`
          SELECT EXISTS (
            SELECT 1 FROM pg_sequences WHERE schemaname = 'public' AND sequencename = $1
          )
        `, [seqName]);
        
        if (seqExists.rows[0].exists) {
          // Obtener el valor actual de la secuencia
          const seqResult = await client.query(`SELECT last_value, is_called FROM ${seqName}`);
          const currentValue = seqResult.rows[0].last_value;
          const isCalled = seqResult.rows[0].is_called;
          
          // Calcular el nuevo valor (debe ser mayor que el máximo ID actual)
          const newValue = Math.max(maxId, currentValue) + 1;
          
          if (newValue > (currentValue + (isCalled ? 1 : 0))) {
            console.log(`📊 ${table}:`);
            console.log(`   Max ID actual: ${maxId}`);
            console.log(`   Valor actual de secuencia: ${currentValue} (is_called: ${isCalled})`);
            console.log(`   Nuevo valor de secuencia: ${newValue}`);
            
            // Establecer el nuevo valor de la secuencia
            await client.query(`SELECT setval('${seqName}', $1, false)`, [newValue]);
            console.log(`   ✅ Secuencia corregida\n`);
          } else {
            console.log(`✅ ${table}: Secuencia ya está correcta (max_id: ${maxId}, seq: ${currentValue})\n`);
          }
        } else {
          console.log(`⚠️  ${table}: Secuencia ${seqName} no existe (puede ser normal si la tabla usa otro método)\n`);
        }
      } catch (error) {
        console.error(`❌ Error procesando ${table}:`, error.message);
      }
    }
    
    console.log('✅ Corrección de secuencias completada');
  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

fixSequences().catch(console.error);
