/**
 * Script para restaurar la relación entre asignaciones y visitas
 * Útil cuando se han perdido las relaciones después de reasignar semanas
 */

require('dotenv').config();
const db = require('../database');

async function restaurarVisitasAsignaciones(semanaInicio = null) {
  if (!semanaInicio) {
    const today = new Date();
    const day = today.getDay();
    const diff = today.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(today.setDate(diff));
    semanaInicio = monday.toISOString().split('T')[0];
  }

  console.log(`\n🔧 Restaurando relaciones entre asignaciones y visitas para la semana: ${semanaInicio}\n`);

  // Obtener asignaciones de la semana
  let asignaciones;
  if (typeof db.obtenerAsignacionesSemana === 'function') {
    const result = db.obtenerAsignacionesSemana(semanaInicio);
    asignaciones = result instanceof Promise ? await result : result;
  } else {
    throw new Error('Función obtenerAsignacionesSemana no encontrada');
  }

  console.log(`Total de asignaciones: ${asignaciones.length}`);

  let restauradas = 0;
  let sinVisita = 0;
  const dbType = process.env.DB_TYPE || 'sqlite';

  for (const asignacion of asignaciones) {
    // Si ya tiene visita_id, verificar que la visita existe
    if (asignacion.visita_id) {
      let visita;
      try {
        if (typeof db.obtenerVisitaPorId === 'function') {
          const result = db.obtenerVisitaPorId(asignacion.visita_id);
          visita = result instanceof Promise ? await result : result;
        } else if (dbType === 'postgresql') {
          const result = await db.query('SELECT * FROM visitas WHERE id = $1', [asignacion.visita_id]);
          visita = result.rows[0] ? (db.rowToObject ? db.rowToObject(result.rows[0]) : result.rows[0]) : null;
        } else {
          visita = db.db.prepare('SELECT * FROM visitas WHERE id = ?').get(asignacion.visita_id);
        }
      } catch (error) {
        console.error(`    Error obteniendo visita ${asignacion.visita_id}: ${error.message}`);
        visita = null;
      }
      
      if (!visita) {
        console.log(`  ⚠️  Asignación ${asignacion.id} tiene visita_id ${asignacion.visita_id} pero la visita no existe`);
        // Limpiar visita_id inválido
        try {
          if (dbType === 'postgresql') {
            await db.query('UPDATE asignaciones_semanales SET visita_id = NULL WHERE id = $1', [asignacion.id]);
          } else {
            db.db.prepare('UPDATE asignaciones_semanales SET visita_id = NULL WHERE id = ?').run(asignacion.id);
          }
        } catch (error) {
          console.error(`    Error limpiando visita_id: ${error.message}`);
        }
      } else {
        // Verificar que la visita corresponde al cliente y fecha correcta
        const fechaAsignacion = new Date(semanaInicio);
        const fechaVisita = new Date(visita.fecha_visita);
        const diffDias = Math.abs((fechaVisita - fechaAsignacion) / (1000 * 60 * 60 * 24));
        
        if (visita.cliente_id === asignacion.cliente_id && diffDias <= 7) {
          // Relación correcta, verificar que realizada esté en 1
          if (!asignacion.realizada && visita.realizada) {
            try {
              if (dbType === 'postgresql') {
                await db.query('UPDATE asignaciones_semanales SET realizada = 1 WHERE id = $1', [asignacion.id]);
              } else {
                db.db.prepare('UPDATE asignaciones_semanales SET realizada = 1 WHERE id = ?').run(asignacion.id);
              }
              console.log(`  ✅ Asignación ${asignacion.id} actualizada: realizada = 1`);
            } catch (error) {
              console.error(`    Error actualizando realizada: ${error.message}`);
            }
          }
          continue;
        } else {
          console.log(`  ⚠️  Asignación ${asignacion.id} tiene visita_id ${asignacion.visita_id} pero no coincide (cliente o fecha)`);
        }
      }
    }

    // Buscar visita correspondiente para esta asignación
    // Buscar visitas del cliente en la semana correspondiente (más amplio: desde 3 días antes hasta 3 días después)
    const fechaInicio = new Date(semanaInicio);
    fechaInicio.setDate(fechaInicio.getDate() - 3); // 3 días antes por si se registró antes
    const fechaFin = new Date(semanaInicio);
    fechaFin.setDate(fechaFin.getDate() + 10); // Hasta 10 días después por si se registró después

    let visitas;
    try {
      if (dbType === 'postgresql') {
        const result = await db.query(`
          SELECT * FROM visitas
          WHERE cliente_id = $1
            AND fecha_visita >= $2
            AND fecha_visita <= $3
            AND realizada = 1
          ORDER BY ABS(EXTRACT(EPOCH FROM (fecha_visita - $4::date))) ASC
          LIMIT 1
        `, [
          asignacion.cliente_id, 
          fechaInicio.toISOString().split('T')[0], 
          fechaFin.toISOString().split('T')[0],
          semanaInicio
        ]);
        visitas = result.rows.map(r => db.rowToObject ? db.rowToObject(r) : r);
      } else {
        visitas = db.db.prepare(`
          SELECT *, 
                 ABS(julianday(fecha_visita) - julianday(?)) as diff_dias
          FROM visitas
          WHERE cliente_id = ?
            AND fecha_visita >= ?
            AND fecha_visita <= ?
            AND realizada = 1
          ORDER BY diff_dias ASC
          LIMIT 1
        `).all(
          semanaInicio,
          asignacion.cliente_id, 
          fechaInicio.toISOString().split('T')[0], 
          fechaFin.toISOString().split('T')[0]
        );
      }
    } catch (error) {
      console.error(`  ⚠️  Error buscando visitas para asignación ${asignacion.id}: ${error.message}`);
      visitas = [];
    }

    if (visitas.length > 0) {
      const visita = visitas[0];
      
      // Verificar que la visita no esté ya asignada a otra asignación de la misma semana
      let yaAsignada = false;
      try {
        if (dbType === 'postgresql') {
          const checkResult = await db.query(`
            SELECT id FROM asignaciones_semanales
            WHERE visita_id = $1 AND semana_inicio = $2 AND id != $3
          `, [visita.id, semanaInicio, asignacion.id]);
          yaAsignada = checkResult.rows.length > 0;
        } else {
          const checkResult = db.db.prepare(`
            SELECT id FROM asignaciones_semanales
            WHERE visita_id = ? AND semana_inicio = ? AND id != ?
          `).get(visita.id, semanaInicio, asignacion.id);
          yaAsignada = !!checkResult;
        }
      } catch (error) {
        console.error(`    Error verificando si visita ya está asignada: ${error.message}`);
      }
      
      if (yaAsignada) {
        console.log(`  ⚠️  Visita ${visita.id} ya está asignada a otra asignación de esta semana`);
        sinVisita++;
      } else {
        // Restaurar relación
        try {
          if (dbType === 'postgresql') {
            await db.query(`
              UPDATE asignaciones_semanales
              SET visita_id = $1, realizada = 1
              WHERE id = $2
            `, [visita.id, asignacion.id]);
          } else {
            db.db.prepare(`
              UPDATE asignaciones_semanales
              SET visita_id = ?, realizada = 1
              WHERE id = ?
            `).run(visita.id, asignacion.id);
          }
          
          const fechaVisita = visita.fecha_visita || 'N/A';
          console.log(`  ✅ Asignación ${asignacion.id} (${asignacion.cliente_nombre || `Cliente ${asignacion.cliente_id}`}) → Visita ${visita.id} (${fechaVisita})`);
          restauradas++;
        } catch (error) {
          console.error(`  ⚠️  Error restaurando asignación ${asignacion.id}: ${error.message}`);
        }
      }
    } else {
      if (asignacion.realizada) {
        console.log(`  ⚠️  Asignación ${asignacion.id} (${asignacion.cliente_nombre || `Cliente ${asignacion.cliente_id}`}) marcada como realizada pero no tiene visita`);
        sinVisita++;
      } else {
        // No hay visita pero tampoco está marcada como realizada - esto es normal
        console.log(`  ℹ️  Asignación ${asignacion.id} (${asignacion.cliente_nombre || `Cliente ${asignacion.cliente_id}`}) sin visita (aún no realizada)`);
      }
    }
  }

  console.log(`\n✅ Restauración completada:`);
  console.log(`   - ${restauradas} relación(es) restaurada(s)`);
  if (sinVisita > 0) {
    console.log(`   - ${sinVisita} asignación(es) marcada(s) como realizada sin visita`);
  }
  console.log();

  return { restauradas, sinVisita };
}

// Ejecutar si se llama directamente
if (require.main === module) {
  const args = process.argv.slice(2);
  const semana = args[0] || null;

  (async () => {
    try {
      await restaurarVisitasAsignaciones(semana);
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  })();
}

module.exports = { restaurarVisitasAsignaciones };
