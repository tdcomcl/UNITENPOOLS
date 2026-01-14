/**
 * Script para verificar qué visitas existen para los clientes de las asignaciones
 */

require('dotenv').config();
const db = require('../database');

async function verificarVisitasAsignaciones(semanaInicio, fechaCreacion = null) {
  console.log(`\n🔍 Verificando visitas para asignaciones de la semana: ${semanaInicio}\n`);

  const dbType = process.env.DB_TYPE || 'sqlite';
  
  // Obtener asignaciones
  let asignaciones;
  if (fechaCreacion) {
    // Buscar por fecha de creación
    if (dbType === 'postgresql') {
      const fechaSegundo = fechaCreacion.split('.')[0];
      const result = await db.query(`
        SELECT a.*, c.nombre as cliente_nombre
        FROM asignaciones_semanales a
        LEFT JOIN clientes c ON a.cliente_id = c.id
        WHERE a.semana_inicio = $1
          AND a.created_at::text LIKE $2
        ORDER BY a.id
      `, [semanaInicio, fechaSegundo + '%']);
      asignaciones = result.rows.map(r => db.rowToObject ? db.rowToObject(r) : r);
    } else {
      const fechaBusqueda = fechaCreacion.split('.')[0];
      asignaciones = db.db.prepare(`
        SELECT a.*, c.nombre as cliente_nombre
        FROM asignaciones_semanales a
        LEFT JOIN clientes c ON a.cliente_id = c.id
        WHERE a.semana_inicio = ?
          AND datetime(a.created_at) LIKE ?
        ORDER BY a.id
      `).all(semanaInicio, fechaBusqueda + '%');
    }
  } else {
    let result = db.obtenerAsignacionesSemana(semanaInicio);
    asignaciones = result instanceof Promise ? await result : result;
  }

  console.log(`Total asignaciones: ${asignaciones.length}\n`);

  const fechaInicio = new Date(semanaInicio);
  fechaInicio.setDate(fechaInicio.getDate() - 7);
  const fechaFin = new Date(semanaInicio);
  fechaFin.setDate(fechaFin.getDate() + 14);

  let conVisita = 0;
  let sinVisita = 0;
  let visitasEncontradas = [];

  for (const asignacion of asignaciones) {
    if (asignacion.visita_id) {
      conVisita++;
      continue;
    }

    // Buscar visitas del cliente
    let visitas;
    try {
      if (dbType === 'postgresql') {
        const result = await db.query(`
          SELECT * FROM visitas
          WHERE cliente_id = $1
            AND fecha_visita >= $2
            AND fecha_visita <= $3
          ORDER BY fecha_visita DESC
        `, [
          asignacion.cliente_id,
          fechaInicio.toISOString().split('T')[0],
          fechaFin.toISOString().split('T')[0]
        ]);
        visitas = result.rows.map(r => db.rowToObject ? db.rowToObject(r) : r);
      } else {
        visitas = db.db.prepare(`
          SELECT * FROM visitas
          WHERE cliente_id = ?
            AND fecha_visita >= ?
            AND fecha_visita <= ?
          ORDER BY fecha_visita DESC
        `).all(
          asignacion.cliente_id,
          fechaInicio.toISOString().split('T')[0],
          fechaFin.toISOString().split('T')[0]
        );
      }
    } catch (error) {
      console.error(`  Error buscando visitas para cliente ${asignacion.cliente_id}: ${error.message}`);
      visitas = [];
    }

    if (visitas.length > 0) {
      visitasEncontradas.push({
        asignacion_id: asignacion.id,
        cliente: asignacion.cliente_nombre || `Cliente ${asignacion.cliente_id}`,
        visitas: visitas.map(v => ({
          id: v.id,
          fecha: v.fecha_visita,
          realizada: v.realizada,
          precio: v.precio
        }))
      });
    } else {
      sinVisita++;
    }
  }

  console.log(`\n📊 Resumen:`);
  console.log(`   - Asignaciones con visita_id: ${conVisita}`);
  console.log(`   - Asignaciones sin visita encontrada: ${sinVisita}`);
  console.log(`   - Asignaciones con visitas disponibles: ${visitasEncontradas.length}\n`);

  if (visitasEncontradas.length > 0) {
    console.log(`\n🔍 Asignaciones con visitas disponibles (primeras 20):\n`);
    visitasEncontradas.slice(0, 20).forEach(item => {
      console.log(`  ${item.cliente} (Asignación ${item.asignacion_id}):`);
      item.visitas.forEach(v => {
        const estado = v.realizada ? '✅ realizada' : '❌ no realizada';
        console.log(`    - Visita ${v.id}: ${v.fecha} - ${estado} - $${v.precio || 0}`);
      });
    });
    if (visitasEncontradas.length > 20) {
      console.log(`  ... y ${visitasEncontradas.length - 20} más`);
    }
  }

  return { conVisita, sinVisita, visitasEncontradas: visitasEncontradas.length };
}

// Ejecutar si se llama directamente
if (require.main === module) {
  const args = process.argv.slice(2);
  const semana = args[0] || null;
  const fechaCreacion = args[1] || null;

  (async () => {
    try {
      if (!semana) {
        const today = new Date();
        const day = today.getDay();
        const diff = today.getDate() - day + (day === 0 ? -6 : 1);
        const monday = new Date(today.setDate(diff));
        await verificarVisitasAsignaciones(monday.toISOString().split('T')[0], fechaCreacion);
      } else {
        await verificarVisitasAsignaciones(semana, fechaCreacion);
      }
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  })();
}

module.exports = { verificarVisitasAsignaciones };
