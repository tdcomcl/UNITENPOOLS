/**
 * Script para enviar a Odoo todas las visitas pendientes de emisión
 * Busca asignaciones realizadas que tienen visita pero no tienen odoo_move_id
 */

require('dotenv').config();
const db = require('../database');
const odoo = require('../odoo');

// Acceder al pool de PostgreSQL directamente
const pool = db.pool || (db.db && db.db.pool);

async function procesarPendientes(soloHoy = false) {
  try {
    const hoy = new Date().toISOString().split('T')[0];
    const filtroFecha = soloHoy 
      ? `AND DATE(v.fecha_visita) = '${hoy}'`
      : '';
    
    console.log(`🔍 Buscando visitas pendientes de emisión en Odoo${soloHoy ? ' (solo hoy)' : ''}...\n`);

    // Buscar asignaciones realizadas que necesitan visita o tienen visita sin odoo_move_id
    let query;
    if (soloHoy) {
      // Para hoy: buscar asignaciones realizadas que no tienen visita o tienen visita sin odoo
      query = `
        SELECT 
          a.id as asignacion_id,
          a.cliente_id,
          a.responsable_id,
          COALESCE(a.visita_id, 0) as visita_id,
          COALESCE(v.fecha_visita, '${hoy}') as fecha_visita,
          c.nombre as cliente_nombre,
          c.documento_tipo,
          c.precio_por_visita,
          v.odoo_move_id,
          v.odoo_error,
          a.realizada
        FROM asignaciones_semanales a
        INNER JOIN clientes c ON c.id = a.cliente_id
        LEFT JOIN visitas v ON v.id = a.visita_id
        WHERE a.realizada = 1
          AND (a.visita_id IS NULL OR v.odoo_move_id IS NULL)
          AND (v.odoo_error IS NULL OR v.odoo_error = '')
          AND DATE(COALESCE(v.created_at, a.created_at)) = '${hoy}'
        ORDER BY a.id
      `;
    } else {
      // Para todas: buscar visitas que no tienen odoo_move_id
      query = `
        SELECT DISTINCT
          COALESCE(a.id, 0) as asignacion_id,
          v.cliente_id,
          v.responsable_id,
          v.id as visita_id,
          v.fecha_visita,
          c.nombre as cliente_nombre,
          c.documento_tipo,
          c.precio_por_visita,
          v.odoo_move_id,
          v.odoo_error,
          COALESCE(a.realizada, 1) as realizada
        FROM visitas v
        INNER JOIN clientes c ON c.id = v.cliente_id
        LEFT JOIN asignaciones_semanales a ON a.visita_id = v.id
        WHERE v.odoo_move_id IS NULL
          AND (v.odoo_error IS NULL OR v.odoo_error = '')
          AND (a.realizada = 1 OR a.realizada IS NULL)
        ORDER BY v.fecha_visita DESC, v.id
      `;
    }

    // Usar el método query de la base de datos
    const result = await db.query(query, []);
    const pendientes = result.rows;

    if (pendientes.length === 0) {
      console.log('✅ No hay visitas pendientes de emisión en Odoo');
      return;
    }

    console.log(`📋 Encontradas ${pendientes.length} visitas pendientes:\n`);
    pendientes.forEach((p, idx) => {
      console.log(`  ${idx + 1}. Asignación ${p.asignacion_id} - Cliente: ${p.cliente_nombre} (ID: ${p.cliente_id})`);
      console.log(`     Visita ID: ${p.visita_id}, Fecha: ${p.fecha_visita}`);
      if (p.odoo_error) {
        console.log(`     ⚠️  Error previo: ${p.odoo_error}`);
      }
    });

    console.log(`\n🚀 Procesando ${pendientes.length} visitas...\n`);

    let exitosos = 0;
    let fallidos = 0;
    const errores = [];

    for (const item of pendientes) {
      try {
        console.log(`📝 Procesando asignación ${item.asignacion_id} - Cliente: ${item.cliente_nombre}...`);

        // Obtener datos completos del cliente
        const cliente = await db.obtenerClientePorId(item.cliente_id);
        if (!cliente) {
          throw new Error(`Cliente ${item.cliente_id} no encontrado`);
        }

        // Si no tiene visita, crearla primero
        let visitaId = item.visita_id;
        if (!visitaId || visitaId === 0) {
          console.log(`   📝 Creando visita para asignación ${item.asignacion_id}...`);
          const hoy = new Date().toISOString().split('T')[0];
          visitaId = await db.registrarVisita(
            item.cliente_id,
            hoy,
            item.responsable_id || null,
            null,
            true
          );
          // Actualizar asignación con la visita creada
          if (item.asignacion_id && item.asignacion_id > 0) {
            await db.actualizarAsignacion(item.asignacion_id, { visita_id: visitaId });
          }
          console.log(`   ✅ Visita creada: ${visitaId}`);
        }

        // Obtener datos de la visita
        const visita = await db.obtenerVisitaPorId(visitaId);
        if (!visita) {
          throw new Error(`Visita ${visitaId} no encontrada`);
        }

        // Si ya tiene odoo_move_id, saltar
        if (visita.odoo_move_id) {
          console.log(`   ⏭️  Visita ${visitaId} ya tiene documento Odoo: ${visita.odoo_move_name || visita.odoo_move_id}`);
          continue;
        }

        // Sincronizar partner en Odoo
        const { partnerId } = await odoo.upsertPartnerFromCliente(cliente);
        await db.actualizarCliente(item.cliente_id, {
          odoo_partner_id: partnerId,
          odoo_last_sync: new Date().toISOString()
        });

        // Crear documento en Odoo
        const odooResult = await odoo.createInvoiceForVisit({
          cliente,
          visita: {
            id: visitaId,
            fecha_visita: visita.fecha_visita || item.fecha_visita,
            precio: visita.precio || null
          },
          partnerId
        });

        // Actualizar visita con los datos de Odoo
        await db.actualizarVisita(visitaId, {
          odoo_move_id: odooResult.moveId,
          odoo_move_name: odooResult.name,
          odoo_payment_state: odooResult.payment_state,
          odoo_last_sync: new Date().toISOString(),
          odoo_error: null
        });

        console.log(`   ✅ Documento emitido: ${odooResult.name} (ID: ${odooResult.moveId})`);
        exitosos++;
      } catch (error) {
        const errorMsg = error?.message || String(error);
        console.error(`   ❌ Error: ${errorMsg}`);
        
        // Guardar el error en la visita
        await db.actualizarVisita(item.visita_id, {
          odoo_last_sync: new Date().toISOString(),
          odoo_error: errorMsg
        });

        errores.push({
          asignacion_id: item.asignacion_id,
          cliente: item.cliente_nombre,
          visita_id: item.visita_id,
          error: errorMsg
        });
        fallidos++;
      }
    }

    console.log(`\n📊 Resumen:`);
    console.log(`   ✅ Exitosos: ${exitosos}`);
    console.log(`   ❌ Fallidos: ${fallidos}`);

    if (errores.length > 0) {
      console.log(`\n⚠️  Errores encontrados:`);
      errores.forEach(e => {
        console.log(`   - Asignación ${e.asignacion_id} (Cliente: ${e.cliente}, Visita: ${e.visita_id}): ${e.error}`);
      });
    }

    console.log(`\n✅ Proceso completado`);
  } catch (error) {
    console.error('❌ Error fatal:', error);
    throw error;
  }
}

// Ejecutar
// Si se pasa --hoy como argumento, solo procesa las de hoy
const soloHoy = process.argv.includes('--hoy');
procesarPendientes(soloHoy)
  .then(() => {
    console.log('\n✅ Script finalizado');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Error:', error);
    process.exit(1);
  });
