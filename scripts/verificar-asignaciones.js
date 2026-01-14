/**
 * Script para verificar y corregir asignaciones semanales
 * - Detecta duplicados
 * - Encuentra asignaciones faltantes
 * - Limpia duplicados manteniendo la mejor asignación
 */

require('dotenv').config();
const db = require('../database');

async function verificarAsignaciones(semanaInicio = null) {
  if (!semanaInicio) {
    // Obtener semana actual
    const today = new Date();
    const day = today.getDay();
    const diff = today.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(today.setDate(diff));
    semanaInicio = monday.toISOString().split('T')[0];
  }

  console.log(`\n🔍 Verificando asignaciones para la semana: ${semanaInicio}\n`);

  // Obtener todas las asignaciones de la semana
  let asignaciones;
  if (typeof db.obtenerAsignacionesSemana === 'function') {
    const result = db.obtenerAsignacionesSemana(semanaInicio);
    asignaciones = result instanceof Promise ? await result : result;
  } else {
    throw new Error('Función obtenerAsignacionesSemana no encontrada');
  }
  console.log(`Total de asignaciones encontradas: ${asignaciones.length}`);

  // Verificar duplicados (mismo cliente_id en la misma semana)
  const porCliente = {};
  const duplicados = [];

  asignaciones.forEach(asig => {
    const key = `${asig.semana_inicio}-${asig.cliente_id}`;
    if (!porCliente[key]) {
      porCliente[key] = [];
    }
    porCliente[key].push(asig);
  });

  // Encontrar duplicados
  Object.keys(porCliente).forEach(key => {
    if (porCliente[key].length > 1) {
      duplicados.push({
        cliente_id: porCliente[key][0].cliente_id,
        cliente_nombre: porCliente[key][0].cliente_nombre,
        asignaciones: porCliente[key]
      });
    }
  });

  if (duplicados.length > 0) {
    console.log(`\n⚠️  Se encontraron ${duplicados.length} cliente(s) con asignaciones duplicadas:\n`);
    duplicados.forEach(dup => {
      console.log(`  Cliente: ${dup.cliente_nombre} (ID: ${dup.cliente_id})`);
      dup.asignaciones.forEach(a => {
        console.log(`    - Asignación ID: ${a.id}, Realizada: ${a.realizada}, Visita ID: ${a.visita_id || 'N/A'}`);
      });
    });
  } else {
    console.log(`\n✅ No se encontraron duplicados`);
  }

  // Verificar asignaciones faltantes
  let clientes;
  if (typeof db.obtenerClientes === 'function') {
    const result = db.obtenerClientes(true);
    clientes = result instanceof Promise ? await result : result;
  } else {
    throw new Error('Función obtenerClientes no encontrada');
  }
  const clientesConAsignacion = new Set(asignaciones.map(a => a.cliente_id));
  const clientesSinAsignacion = clientes.filter(c => !clientesConAsignacion.has(c.id));

  if (clientesSinAsignacion.length > 0) {
    console.log(`\n⚠️  Se encontraron ${clientesSinAsignacion.length} cliente(s) sin asignación:\n`);
    clientesSinAsignacion.forEach(cliente => {
      console.log(`  - ${cliente.nombre} (ID: ${cliente.id})`);
    });
  } else {
    console.log(`\n✅ Todos los clientes activos tienen asignación`);
  }

  return {
    semanaInicio,
    totalAsignaciones: asignaciones.length,
    duplicados,
    clientesSinAsignacion
  };
}

async function limpiarDuplicados(semanaInicio = null, mantenerId = null) {
  if (!semanaInicio) {
    const today = new Date();
    const day = today.getDay();
    const diff = today.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(today.setDate(diff));
    semanaInicio = monday.toISOString().split('T')[0];
  }

  console.log(`\n🧹 Limpiando duplicados para la semana: ${semanaInicio}\n`);

  const asignaciones = await db.obtenerAsignacionesSemana(semanaInicio);
  const porCliente = {};

  asignaciones.forEach(asig => {
    const key = `${asig.semana_inicio}-${asig.cliente_id}`;
    if (!porCliente[key]) {
      porCliente[key] = [];
    }
    porCliente[key].push(asig);
  });

  let eliminados = 0;

  for (const key in porCliente) {
    const grupo = porCliente[key];
    if (grupo.length > 1) {
      // Ordenar: mantener la que tiene visita_id o la más reciente
      grupo.sort((a, b) => {
        if (a.visita_id && !b.visita_id) return -1;
        if (!a.visita_id && b.visita_id) return 1;
        if (mantenerId && a.id === mantenerId) return -1;
        if (mantenerId && b.id === mantenerId) return 1;
        return b.id - a.id; // Más reciente primero
      });

      const mantener = grupo[0];
      const eliminar = grupo.slice(1);

      console.log(`  Cliente ${mantener.cliente_nombre}:`);
      console.log(`    ✅ Mantener: ID ${mantener.id}${mantener.visita_id ? ` (tiene visita ${mantener.visita_id})` : ''}`);

      for (const asig of eliminar) {
        try {
          const dbType = process.env.DB_TYPE || 'sqlite';
          if (dbType === 'postgresql') {
            // PostgreSQL
            await db.query('DELETE FROM asignaciones_semanales WHERE id = $1', [asig.id]);
          } else {
            // SQLite
            db.db.prepare('DELETE FROM asignaciones_semanales WHERE id = ?').run(asig.id);
          }
          console.log(`    ❌ Eliminado: ID ${asig.id}`);
          eliminados++;
        } catch (error) {
          console.error(`    ⚠️  Error eliminando ID ${asig.id}:`, error.message);
        }
      }
    }
  }

  console.log(`\n✅ Limpieza completada. ${eliminados} asignación(es) eliminada(s).\n`);
  return eliminados;
}

async function restaurarAsignacionesFaltantes(semanaInicio = null) {
  if (!semanaInicio) {
    const today = new Date();
    const day = today.getDay();
    const diff = today.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(today.setDate(diff));
    semanaInicio = monday.toISOString().split('T')[0];
  }

  console.log(`\n🔧 Restaurando asignaciones faltantes para la semana: ${semanaInicio}\n`);

  const clientes = await db.obtenerClientes(true);
  const asignaciones = await db.obtenerAsignacionesSemana(semanaInicio);
  const clientesConAsignacion = new Set(asignaciones.map(a => a.cliente_id));
  const clientesSinAsignacion = clientes.filter(c => !clientesConAsignacion.has(c.id));

  if (clientesSinAsignacion.length === 0) {
    console.log(`✅ Todos los clientes ya tienen asignación.\n`);
    return 0;
  }

  let restaurados = 0;

  const dbType = process.env.DB_TYPE || 'sqlite';
  
  for (const cliente of clientesSinAsignacion) {
    try {
      if (dbType === 'postgresql') {
        // PostgreSQL
        await db.query(`
          INSERT INTO asignaciones_semanales
          (semana_inicio, cliente_id, responsable_id, dia_atencion, precio)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (semana_inicio, cliente_id) 
          DO UPDATE SET responsable_id = EXCLUDED.responsable_id, 
                        dia_atencion = EXCLUDED.dia_atencion, 
                        precio = EXCLUDED.precio
        `, [semanaInicio, cliente.id, cliente.responsable_id, cliente.dia_atencion, cliente.precio_por_visita]);
      } else {
        // SQLite
        db.db.prepare(`
          INSERT OR REPLACE INTO asignaciones_semanales
          (semana_inicio, cliente_id, responsable_id, dia_atencion, precio)
          VALUES (?, ?, ?, ?, ?)
        `).run(
          semanaInicio,
          cliente.id,
          cliente.responsable_id,
          cliente.dia_atencion,
          cliente.precio_por_visita
        );
      }
      console.log(`  ✅ Restaurado: ${cliente.nombre}`);
      restaurados++;
    } catch (error) {
      console.error(`  ⚠️  Error restaurando ${cliente.nombre}:`, error.message);
    }
  }

  console.log(`\n✅ Restauración completada. ${restaurados} asignación(es) restaurada(s).\n`);
  return restaurados;
}

// Ejecutar si se llama directamente
if (require.main === module) {
  const args = process.argv.slice(2);
  const comando = args[0];

  (async () => {
    try {
      if (comando === 'verificar') {
        const semana = args[1] || null;
        await verificarAsignaciones(semana);
      } else if (comando === 'limpiar') {
        const semana = args[1] || null;
        const mantenerId = args[2] ? parseInt(args[2]) : null;
        await limpiarDuplicados(semana, mantenerId);
      } else if (comando === 'restaurar') {
        const semana = args[1] || null;
        await restaurarAsignacionesFaltantes(semana);
      } else if (comando === 'todo') {
        const semana = args[1] || null;
        console.log('=== VERIFICACIÓN ===');
        await verificarAsignaciones(semana);
        console.log('\n=== LIMPIEZA DE DUPLICADOS ===');
        await limpiarDuplicados(semana);
        console.log('\n=== RESTAURACIÓN ===');
        await restaurarAsignacionesFaltantes(semana);
        console.log('\n=== VERIFICACIÓN FINAL ===');
        await verificarAsignaciones(semana);
      } else {
        console.log(`
Uso:
  node scripts/verificar-asignaciones.js verificar [semana]     - Verifica asignaciones
  node scripts/verificar-asignaciones.js limpiar [semana] [id]  - Limpia duplicados
  node scripts/verificar-asignaciones.js restaurar [semana]    - Restaura faltantes
  node scripts/verificar-asignaciones.js todo [semana]          - Ejecuta todo

Ejemplos:
  node scripts/verificar-asignaciones.js verificar
  node scripts/verificar-asignaciones.js limpiar 2024-01-15
  node scripts/verificar-asignaciones.js restaurar
  node scripts/verificar-asignaciones.js todo
        `);
      }
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  })();
}

module.exports = {
  verificarAsignaciones,
  limpiarDuplicados,
  restaurarAsignacionesFaltantes
};
