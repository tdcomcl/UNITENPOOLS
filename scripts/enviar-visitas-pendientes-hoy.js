/**
 * Script para enviar a Odoo las visitas de hoy que no tienen documento
 * Procesa una por una las visitas pendientes
 */

require('dotenv').config();
const db = require('../database');
const odoo = require('../odoo');

async function enviarVisitasPendientesHoy() {
  try {
    const hoy = new Date().toISOString().split('T')[0];
    console.log(`🔍 Buscando visitas de hoy (${hoy}) sin documento en Odoo...\n`);
    
    // Obtener visitas de hoy sin odoo_move_id
    let visitas;
    const dbType = process.env.DB_TYPE || 'sqlite';
    
    if (dbType === 'postgresql') {
      const result = await db.query(`
        SELECT 
          v.id,
          v.cliente_id,
          v.fecha_visita,
          v.realizada,
          v.odoo_move_id,
          v.odoo_error,
          c.nombre as cliente_nombre,
          c.documento_tipo,
          c.precio_por_visita
        FROM visitas v
        LEFT JOIN clientes c ON v.cliente_id = c.id
        WHERE v.fecha_visita = $1::date
          AND v.realizada = 1
          AND v.odoo_move_id IS NULL
        ORDER BY v.id
      `, [hoy]);
      visitas = result.rows.map(r => db.rowToObject ? db.rowToObject(r) : r);
    } else {
      visitas = db.db.prepare(`
        SELECT 
          v.id,
          v.cliente_id,
          v.fecha_visita,
          v.realizada,
          v.odoo_move_id,
          v.odoo_error,
          c.nombre as cliente_nombre,
          c.documento_tipo,
          c.precio_por_visita
        FROM visitas v
        LEFT JOIN clientes c ON v.cliente_id = c.id
        WHERE v.fecha_visita = ?
          AND v.realizada = 1
          AND v.odoo_move_id IS NULL
        ORDER BY v.id
      `).all(hoy);
    }
    
    if (visitas.length === 0) {
      console.log('✅ No hay visitas pendientes de hoy para enviar a Odoo');
      return;
    }
    
    console.log(`📋 Encontradas ${visitas.length} visitas pendientes:\n`);
    visitas.forEach((v, idx) => {
      console.log(`  ${idx + 1}. Visita ID: ${v.id} - Cliente: ${v.cliente_nombre} (ID: ${v.cliente_id})`);
      if (v.odoo_error) {
        console.log(`     ⚠️  Error previo: ${v.odoo_error}`);
      }
    });
    
    console.log(`\n🚀 Procesando ${visitas.length} visitas una por una...\n`);
    
    let exitosos = 0;
    let fallidos = 0;
    const errores = [];
    
    for (const visitaRow of visitas) {
      try {
        console.log(`📝 Procesando visita ID: ${visitaRow.id} - Cliente: ${visitaRow.cliente_nombre}...`);
        
        // Obtener datos completos del cliente
        const cliente = await db.obtenerClientePorId(visitaRow.cliente_id);
        if (!cliente) {
          throw new Error(`Cliente ${visitaRow.cliente_id} no encontrado`);
        }
        
        // Obtener datos de la visita
        const visita = await db.obtenerVisitaPorId(visitaRow.id);
        if (!visita) {
          throw new Error(`Visita ${visitaRow.id} no encontrada`);
        }
        
        // Sincronizar partner en Odoo
        console.log(`   🔄 Sincronizando cliente en Odoo...`);
        const { partnerId } = await odoo.upsertPartnerFromCliente(cliente);
        await db.actualizarCliente(visitaRow.cliente_id, {
          odoo_partner_id: partnerId,
          odoo_last_sync: new Date().toISOString()
        });
        
        // Crear documento en Odoo
        console.log(`   📄 Creando documento en Odoo...`);
        const odooResult = await odoo.createInvoiceForVisit({
          cliente,
          visita: {
            id: visita.id,
            fecha_visita: visita.fecha_visita,
            precio: visita.precio || null
          },
          partnerId
        });
        
        // Actualizar visita con los datos de Odoo
        await db.actualizarVisita(visita.id, {
          odoo_move_id: odooResult.moveId,
          odoo_move_name: odooResult.name,
          odoo_payment_state: odooResult.payment_state,
          odoo_last_sync: new Date().toISOString(),
          odoo_error: null
        });
        
        console.log(`   ✅ Documento emitido: ${odooResult.name} (ID: ${odooResult.moveId})`);
        console.log(`   ✅ Estado de pago: ${odooResult.payment_state || 'N/A'}\n`);
        exitosos++;
        
        // Pequeña pausa entre cada visita para no sobrecargar Odoo
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (error) {
        const errorMsg = error?.message || String(error);
        console.error(`   ❌ Error: ${errorMsg}\n`);
        
        // Guardar el error en la visita
        await db.actualizarVisita(visitaRow.id, {
          odoo_last_sync: new Date().toISOString(),
          odoo_error: errorMsg
        });
        
        errores.push({
          visita_id: visitaRow.id,
          cliente: visitaRow.cliente_nombre,
          error: errorMsg
        });
        fallidos++;
        
        // Pequeña pausa antes de continuar
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    console.log(`\n📊 Resumen:`);
    console.log(`   ✅ Exitosos: ${exitosos}`);
    console.log(`   ❌ Fallidos: ${fallidos}`);
    
    if (errores.length > 0) {
      console.log(`\n⚠️  Errores encontrados:`);
      errores.forEach(e => {
        console.log(`   - Visita ${e.visita_id} (Cliente: ${e.cliente}): ${e.error}`);
      });
    }
    
    console.log(`\n✅ Proceso completado`);
  } catch (error) {
    console.error('❌ Error fatal:', error);
    throw error;
  }
}

// Ejecutar
enviarVisitasPendientesHoy()
  .then(() => {
    console.log('\n✅ Script finalizado');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Error:', error);
    process.exit(1);
  });
