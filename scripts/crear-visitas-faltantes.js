/**
 * Script para crear visitas faltantes desde asignaciones realizadas
 * Crea visitas para asignaciones que están marcadas como realizadas pero no tienen visita asociada
 */

require('dotenv').config();
const db = require('../database');
const odoo = require('../odoo');

async function crearVisitasFaltantes() {
  try {
    console.log('🔍 Buscando asignaciones realizadas sin visita...\n');
    
    // Obtener asignaciones realizadas sin visita
    let asignaciones;
    const dbType = process.env.DB_TYPE || 'sqlite';
    
    if (dbType === 'postgresql') {
      const result = await db.query(`
        SELECT 
          a.id,
          a.semana_inicio,
          a.cliente_id,
          a.responsable_id,
          a.realizada,
          a.visita_id,
          c.nombre as cliente_nombre,
          c.precio_por_visita
        FROM asignaciones_semanales a
        LEFT JOIN clientes c ON c.id = a.cliente_id
        WHERE a.realizada = 1
          AND a.visita_id IS NULL
        ORDER BY a.semana_inicio, a.id
      `);
      asignaciones = result.rows.map(r => db.rowToObject ? db.rowToObject(r) : r);
    } else {
      asignaciones = db.db.prepare(`
        SELECT 
          a.id,
          a.semana_inicio,
          a.cliente_id,
          a.responsable_id,
          a.realizada,
          a.visita_id,
          c.nombre as cliente_nombre,
          c.precio_por_visita
        FROM asignaciones_semanales a
        LEFT JOIN clientes c ON c.id = a.cliente_id
        WHERE a.realizada = 1
          AND a.visita_id IS NULL
        ORDER BY a.semana_inicio, a.id
      `).all();
    }
    
    if (!asignaciones || asignaciones.length === 0) {
      console.log('✅ No hay asignaciones realizadas sin visita');
      return;
    }
    
    console.log(`📋 Encontradas ${asignaciones.length} asignaciones realizadas sin visita\n`);
    console.log('🚀 Creando visitas...\n');
    
    let creadas = 0;
    let errores = 0;
    const erroresDetalle = [];
    
    for (const asignacion of asignaciones) {
      try {
        // Usar la fecha de la asignación (semana_inicio) para la visita
        const fechaVisita = asignacion.semana_inicio instanceof Date 
          ? asignacion.semana_inicio.toISOString().split('T')[0]
          : asignacion.semana_inicio;
        
        console.log(`📝 Asignación ID: ${asignacion.id} - Cliente: ${asignacion.cliente_nombre} - Fecha: ${fechaVisita}...`);
        
        // Crear la visita usando la fecha de la asignación
        const visitaId = await db.registrarVisita(
          asignacion.cliente_id,
          fechaVisita,
          asignacion.responsable_id || null,
          null, // precio NULL => usa precio_por_visita del cliente
          true  // realizada = true
        );
        
        // Asociar la visita a la asignación
        await db.actualizarAsignacion(asignacion.id, { visita_id: visitaId });
        
        console.log(`   ✅ Visita creada: ID ${visitaId}`);
        creadas++;
      } catch (error) {
        errores++;
        const errorMsg = error?.message || String(error);
        erroresDetalle.push({
          asignacion_id: asignacion.id,
          cliente: asignacion.cliente_nombre,
          error: errorMsg
        });
        console.log(`   ❌ Error: ${errorMsg}`);
      }
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('📊 RESUMEN:');
    console.log(`   Total asignaciones procesadas: ${asignaciones.length}`);
    console.log(`   ✅ Visitas creadas: ${creadas}`);
    console.log(`   ❌ Errores: ${errores}`);
    
    if (erroresDetalle.length > 0) {
      console.log('\n❌ DETALLE DE ERRORES:');
      erroresDetalle.forEach(e => {
        console.log(`   Asignación ID: ${e.asignacion_id} - Cliente: ${e.cliente}`);
        console.log(`   Error: ${e.error}`);
        console.log('');
      });
    }
    
    if (creadas > 0) {
      console.log('\n💡 Siguiente paso:');
      console.log('   Puedes ejecutar el script para enviar las visitas a Odoo si es necesario.');
      console.log('   Ejemplo: node scripts/enviar-visitas-pendientes-hoy.js');
    }
    
  } catch (error) {
    console.error('❌ Error general:', error.message);
    if (error.stack) console.error(error.stack);
    process.exit(1);
  }
  
  if (db.close) await db.close();
  process.exit(0);
}

crearVisitasFaltantes();
