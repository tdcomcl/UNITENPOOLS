#!/usr/bin/env node
/**
 * Script para eliminar asignaciones de una fecha específica
 * 
 * Uso:
 *   node scripts/eliminar-asignaciones.js 2026-01-12
 *   node scripts/eliminar-asignaciones.js 12-01  (formato corto)
 */

require('dotenv').config();
const db = require('../database');

// Obtener fecha desde argumentos
const fechaArg = process.argv[2];

if (!fechaArg) {
  console.error('❌ Error: Debes proporcionar una fecha');
  console.error('   Uso: node scripts/eliminar-asignaciones.js 2026-01-12');
  console.error('   O:    node scripts/eliminar-asignaciones.js 12-01');
  process.exit(1);
}

// Procesar fecha
let fechaSemana;
if (fechaArg.includes('-') && fechaArg.length === 10) {
  // Formato completo: 2026-01-12
  fechaSemana = fechaArg;
} else if (fechaArg.includes('-') && fechaArg.length === 5) {
  // Formato corto: 12-01 (asume año actual)
  const [dia, mes] = fechaArg.split('-');
  const año = new Date().getFullYear();
  fechaSemana = `${año}-${mes}-${dia}`;
} else {
  console.error('❌ Error: Formato de fecha inválido');
  console.error('   Usa: 2026-01-12 o 12-01');
  process.exit(1);
}

async function eliminarAsignaciones() {
  const dbType = process.env.DB_TYPE || 'sqlite';
  
  try {
    console.log('🔍 Buscando asignaciones para eliminar...\n');
    console.log(`   Fecha: ${fechaSemana}\n`);
    
    if (dbType === 'postgresql') {
      // PostgreSQL - usar el método query de la clase
      // Primero verificar cuántas hay
      const countResult = await db.query(`
        SELECT COUNT(*) as total
        FROM asignaciones_semanales
        WHERE semana_inicio = $1
      `, [fechaSemana]);
      
      const total = parseInt(countResult.rows[0].total, 10);
      
      if (total === 0) {
        console.log('ℹ️  No se encontraron asignaciones para esa fecha');
        process.exit(0);
      }
      
      console.log(`📊 Se encontraron ${total} asignaciones para eliminar\n`);
      
      // Mostrar algunas asignaciones antes de eliminar
      const asignacionesResult = await db.query(`
        SELECT a.id, a.semana_inicio, c.nombre as cliente_nombre, 
               r.nombre as responsable_nombre, a.dia_atencion
        FROM asignaciones_semanales a
        LEFT JOIN clientes c ON a.cliente_id = c.id
        LEFT JOIN responsables r ON a.responsable_id = r.id
        WHERE a.semana_inicio = $1
        LIMIT 10
      `, [fechaSemana]);
      
      if (asignacionesResult.rows.length > 0) {
        console.log('📋 Ejemplos de asignaciones a eliminar:');
        asignacionesResult.rows.forEach(a => {
          console.log(`   - ${a.cliente_nombre} (${a.responsable_nombre || 'Sin responsable'}) - ${a.dia_atencion || 'Sin día'}`);
        });
        if (total > 10) {
          console.log(`   ... y ${total - 10} más`);
        }
        console.log('');
      }
      
      // Eliminar asignaciones
      console.log('🗑️  Eliminando asignaciones...');
      const deleteResult = await db.query(`
        DELETE FROM asignaciones_semanales
        WHERE semana_inicio = $1
      `, [fechaSemana]);
      
      console.log(`✅ Se eliminaron ${deleteResult.rowCount} asignaciones exitosamente`);
      
    } else {
      // SQLite
      const asignaciones = db.db.prepare(`
        SELECT COUNT(*) as total
        FROM asignaciones_semanales
        WHERE semana_inicio = ?
      `).get(fechaSemana);
      
      const total = asignaciones.total;
      
      if (total === 0) {
        console.log('ℹ️  No se encontraron asignaciones para esa fecha');
        process.exit(0);
      }
      
      console.log(`📊 Se encontraron ${total} asignaciones para eliminar\n`);
      
      // Mostrar algunas asignaciones
      const ejemplos = db.db.prepare(`
        SELECT a.id, a.semana_inicio, c.nombre as cliente_nombre, 
               r.nombre as responsable_nombre, a.dia_atencion
        FROM asignaciones_semanales a
        LEFT JOIN clientes c ON a.cliente_id = c.id
        LEFT JOIN responsables r ON a.responsable_id = r.id
        WHERE a.semana_inicio = ?
        LIMIT 10
      `).all(fechaSemana);
      
      if (ejemplos.length > 0) {
        console.log('📋 Ejemplos de asignaciones a eliminar:');
        ejemplos.forEach(a => {
          console.log(`   - ${a.cliente_nombre} (${a.responsable_nombre || 'Sin responsable'}) - ${a.dia_atencion || 'Sin día'}`);
        });
        if (total > 10) {
          console.log(`   ... y ${total - 10} más`);
        }
        console.log('');
      }
      
      console.log('🗑️  Eliminando asignaciones...');
      const deleteResult = db.db.prepare(`
        DELETE FROM asignaciones_semanales
        WHERE semana_inicio = ?
      `).run(fechaSemana);
      
      console.log(`✅ Se eliminaron ${deleteResult.changes} asignaciones exitosamente`);
    }
    
  } catch (error) {
    console.error('❌ Error eliminando asignaciones:', error.message);
    process.exit(1);
  }
}

eliminarAsignaciones().catch(error => {
  console.error('❌ Error fatal:', error);
  process.exit(1);
});
