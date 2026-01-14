/**
 * Script para restaurar visitas de asignaciones específicas
 * Útil cuando se conocen los IDs de las asignaciones o la fecha de creación
 */

require('dotenv').config();
const db = require('../database');

async function restaurarAsignacionesPorFechaCreacion(fechaCreacion, semanaInicio = null) {
  console.log(`\n🔧 Restaurando asignaciones creadas el ${fechaCreacion}\n`);

  // Primero obtener las asignaciones para saber cuál es su semana_inicio real
  const dbType = process.env.DB_TYPE || 'sqlite';
  
  try {
    if (dbType === 'postgresql') {
      const fechaSegundo = fechaCreacion.split('.')[0];
      const result = await db.query(`
        SELECT DISTINCT semana_inicio
        FROM asignaciones_semanales
        WHERE created_at::text LIKE $1
        ORDER BY semana_inicio
        LIMIT 1
      `, [fechaSegundo + '%']);
      if (result.rows.length > 0) {
        // Convertir a formato YYYY-MM-DD si es un objeto Date
        const semana = result.rows[0].semana_inicio;
        if (semana instanceof Date) {
          semanaInicio = semana.toISOString().split('T')[0];
        } else {
          semanaInicio = typeof semana === 'string' ? semana.split('T')[0] : semana;
        }
        console.log(`📅 Semana detectada desde BD: ${semanaInicio}\n`);
      }
    } else {
      const fechaBusqueda = fechaCreacion.split('.')[0];
      const result = db.db.prepare(`
        SELECT DISTINCT semana_inicio
        FROM asignaciones_semanales
        WHERE datetime(created_at) LIKE ?
        ORDER BY semana_inicio
        LIMIT 1
      `).get(fechaBusqueda + '%');
      if (result) {
        // Convertir a formato YYYY-MM-DD si es un objeto Date
        const semana = result.semana_inicio;
        if (semana instanceof Date) {
          semanaInicio = semana.toISOString().split('T')[0];
        } else {
          semanaInicio = typeof semana === 'string' ? semana.split('T')[0] : semana;
        }
        console.log(`📅 Semana detectada desde BD: ${semanaInicio}\n`);
      }
    }
  } catch (error) {
    console.error('Error detectando semana:', error.message);
  }

  if (!semanaInicio) {
    // Fallback: calcular semana_inicio de la fecha de creación
    const fecha = new Date(fechaCreacion);
    const day = fecha.getDay();
    const diff = fecha.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(fecha.setDate(diff));
    semanaInicio = monday.toISOString().split('T')[0];
    console.log(`⚠️  No se pudo detectar semana, usando calculada: ${semanaInicio}\n`);
  }
  
  // Obtener asignaciones creadas en esa fecha/hora específica
  // Usar rango de tiempo para capturar el timestamp exacto (con microsegundos)
  let asignaciones;
  try {
    if (dbType === 'postgresql') {
      // Parsear la fecha y crear un rango de 1 segundo
      const fechaBase = new Date(fechaCreacion);
      const fechaInicio = new Date(fechaBase);
      fechaInicio.setMilliseconds(0);
      const fechaFin = new Date(fechaInicio);
      fechaFin.setSeconds(fechaFin.getSeconds() + 1);
      
      // Buscar asignaciones en ese rango de tiempo
      const result = await db.query(`
        SELECT a.*, c.nombre as cliente_nombre
        FROM asignaciones_semanales a
        LEFT JOIN clientes c ON a.cliente_id = c.id
        WHERE a.semana_inicio = $1
          AND a.created_at >= $2
          AND a.created_at < $3
        ORDER BY a.id
      `, [
        semanaInicio, 
        fechaInicio.toISOString(),
        fechaFin.toISOString()
      ]);
      asignaciones = result.rows.map(r => db.rowToObject ? db.rowToObject(r) : r);
      
      // Si no encuentra con el rango, intentar búsqueda más amplia (mismo segundo)
      if (asignaciones.length === 0) {
        console.log('  Intentando búsqueda más amplia (mismo segundo)...');
        const fechaSegundo = fechaCreacion.split('.')[0]; // Quitar microsegundos
        const result2 = await db.query(`
          SELECT a.*, c.nombre as cliente_nombre
          FROM asignaciones_semanales a
          LEFT JOIN clientes c ON a.cliente_id = c.id
          WHERE a.semana_inicio = $1
            AND a.created_at::text LIKE $2
          ORDER BY a.id
        `, [semanaInicio, fechaSegundo + '%']);
        asignaciones = result2.rows.map(r => db.rowToObject ? db.rowToObject(r) : r);
      }
    } else {
      // SQLite - buscar por fecha (sin microsegundos)
      const fechaBusqueda = fechaCreacion.split('.')[0]; // Quitar microsegundos
      asignaciones = db.db.prepare(`
        SELECT a.*, c.nombre as cliente_nombre
        FROM asignaciones_semanales a
        LEFT JOIN clientes c ON a.cliente_id = c.id
        WHERE a.semana_inicio = ?
          AND datetime(a.created_at) LIKE ?
        ORDER BY a.id
      `).all(semanaInicio, fechaBusqueda + '%');
    }
  } catch (error) {
    console.error('Error obteniendo asignaciones:', error);
    throw error;
  }

  if (asignaciones.length === 0) {
    console.log(`⚠️  No se encontraron asignaciones creadas en ${fechaCreacion}`);
    return { restauradas: 0, sinVisita: 0, total: 0 };
  }

  console.log(`Encontradas ${asignaciones.length} asignaciones\n`);

  let restauradas = 0;
  let sinVisita = 0;
  // Ampliar rango de búsqueda: desde 7 días antes hasta 14 días después
  const fechaInicio = new Date(semanaInicio);
  fechaInicio.setDate(fechaInicio.getDate() - 7);
  const fechaFin = new Date(semanaInicio);
  fechaFin.setDate(fechaFin.getDate() + 14);

  for (const asignacion of asignaciones) {
    // Si ya tiene visita_id válido, verificar y continuar
    if (asignacion.visita_id && asignacion.realizada) {
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
        visita = null;
      }
      
      if (visita && visita.cliente_id === asignacion.cliente_id) {
        console.log(`  ✓ Asignación ${asignacion.id} ya tiene visita ${asignacion.visita_id} válida`);
        continue;
      }
    }

    // Buscar visita para este cliente en el rango de fechas
    let visitas;
    try {
      if (dbType === 'postgresql') {
        // Buscar visitas, ordenar por fecha más cercana a la semana
        // Priorizar visitas dentro de la semana (lunes a domingo)
        const semanaFin = new Date(semanaInicio);
        semanaFin.setDate(semanaFin.getDate() + 6);
        
        // Primero intentar visitas no asignadas a ninguna asignación
        let result = await db.query(`
          SELECT * FROM visitas
          WHERE cliente_id = $1
            AND fecha_visita >= $2
            AND fecha_visita <= $3
            AND realizada = 1
            AND id NOT IN (
              SELECT visita_id FROM asignaciones_semanales 
              WHERE visita_id IS NOT NULL
            )
          ORDER BY 
            CASE 
              WHEN fecha_visita >= $4 AND fecha_visita <= $5 THEN 0 
              ELSE 1 
            END,
            fecha_visita DESC
          LIMIT 1
        `, [
          asignacion.cliente_id,
          fechaInicio.toISOString().split('T')[0],
          fechaFin.toISOString().split('T')[0],
          semanaInicio,
          semanaFin.toISOString().split('T')[0]
        ]);
        
        // Si no encuentra visitas sin asignar, buscar cualquier visita del cliente (puede estar duplicada)
        if (result.rows.length === 0) {
          result = await db.query(`
            SELECT * FROM visitas
            WHERE cliente_id = $1
              AND fecha_visita >= $2
              AND fecha_visita <= $3
              AND realizada = 1
            ORDER BY 
              CASE 
                WHEN fecha_visita >= $4 AND fecha_visita <= $5 THEN 0 
                ELSE 1 
              END,
              fecha_visita DESC
            LIMIT 1
          `, [
            asignacion.cliente_id,
            fechaInicio.toISOString().split('T')[0],
            fechaFin.toISOString().split('T')[0],
            semanaInicio,
            semanaFin.toISOString().split('T')[0]
          ]);
        }
        
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
            AND id NOT IN (
              SELECT COALESCE(visita_id, 0) FROM asignaciones_semanales 
              WHERE semana_inicio = ? AND visita_id IS NOT NULL AND id != ?
            )
          ORDER BY diff_dias ASC
          LIMIT 1
        `).all(
          semanaInicio,
          asignacion.cliente_id,
          fechaInicio.toISOString().split('T')[0],
          fechaFin.toISOString().split('T')[0],
          semanaInicio,
          asignacion.id
        );
      }
    } catch (error) {
      console.error(`  ⚠️  Error buscando visitas para asignación ${asignacion.id}: ${error.message}`);
      visitas = [];
    }

    if (visitas.length > 0) {
      const visita = visitas[0];
      
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
    } else {
      console.log(`  ⚠️  Asignación ${asignacion.id} (${asignacion.cliente_nombre || `Cliente ${asignacion.cliente_id}`}) - No se encontró visita realizada`);
      sinVisita++;
    }
  }

  console.log(`\n✅ Restauración completada:`);
  console.log(`   - ${restauradas} relación(es) restaurada(s)`);
  console.log(`   - ${sinVisita} asignación(es) sin visita encontrada`);
  console.log(`   - Total procesadas: ${asignaciones.length}\n`);

  return { restauradas, sinVisita, total: asignaciones.length };
}

// Ejecutar si se llama directamente
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(`
Uso:
  node scripts/restaurar-asignaciones-especificas.js <fecha_creacion> [semana_inicio]

Ejemplo:
  node scripts/restaurar-asignaciones-especificas.js "2026-01-13 21:50:39.945573"
  node scripts/restaurar-asignaciones-especificas.js "2026-01-13 21:50:39.945573" "2026-01-13"
    `);
    process.exit(1);
  }

  const fechaCreacion = args[0];
  const semanaInicio = args[1] || null;

  (async () => {
    try {
      await restaurarAsignacionesPorFechaCreacion(fechaCreacion, semanaInicio);
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  })();
}

module.exports = { restaurarAsignacionesPorFechaCreacion };
