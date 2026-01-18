/**
 * Script para actualizar las visitas que ya están registradas en Odoo
 * Sincroniza el estado de pago y otros datos desde Odoo hacia la base de datos local
 */

require('dotenv').config();
const db = require('../database');
const odoo = require('../odoo');

async function actualizarVisitasOdoo() {
  try {
    console.log('🔄 Actualizando visitas desde Odoo...\n');
    
    // Obtener todas las visitas que tienen documento en Odoo
    let visitas;
    const dbType = process.env.DB_TYPE || 'sqlite';
    
    if (dbType === 'postgresql') {
      const result = await db.query(`
        SELECT 
          v.id,
          v.cliente_id,
          v.fecha_visita,
          v.odoo_move_id,
          v.odoo_move_name,
          v.odoo_payment_state,
          c.nombre as cliente_nombre
        FROM visitas v
        LEFT JOIN clientes c ON v.cliente_id = c.id
        WHERE v.odoo_move_id IS NOT NULL
          AND v.realizada = 1
        ORDER BY v.fecha_visita DESC, v.id
      `);
      visitas = result.rows.map(r => db.rowToObject ? db.rowToObject(r) : r);
    } else {
      visitas = db.db.prepare(`
        SELECT 
          v.id,
          v.cliente_id,
          v.fecha_visita,
          v.odoo_move_id,
          v.odoo_move_name,
          v.odoo_payment_state,
          c.nombre as cliente_nombre
        FROM visitas v
        LEFT JOIN clientes c ON v.cliente_id = c.id
        WHERE v.odoo_move_id IS NOT NULL
          AND v.realizada = 1
        ORDER BY v.fecha_visita DESC, v.id
      `).all();
    }
    
    if (!visitas || visitas.length === 0) {
      console.log('ℹ️  No hay visitas con documento en Odoo para actualizar.');
      return;
    }
    
    console.log(`📊 Encontradas ${visitas.length} visitas con documento en Odoo\n`);
    console.log('🚀 Sincronizando datos desde Odoo...\n');
    
    let actualizadas = 0;
    let sinCambios = 0;
    let errores = 0;
    const erroresDetalle = [];
    
    for (const visita of visitas) {
      try {
        console.log(`📝 Visita ID: ${visita.id} - Cliente: ${visita.cliente_nombre} (Odoo Move ID: ${visita.odoo_move_id})...`);
        
        // Obtener datos desde Odoo
        const datosOdoo = await odoo.getPaymentStateFromOdoo(visita.odoo_move_id);
        
        // Verificar si hay cambios
        const cambios = {};
        let tieneCambios = false;
        
        if (datosOdoo.name && datosOdoo.name !== visita.odoo_move_name) {
          cambios.odoo_move_name = datosOdoo.name;
          tieneCambios = true;
        }
        
        if (datosOdoo.payment_state && datosOdoo.payment_state !== visita.odoo_payment_state) {
          cambios.odoo_payment_state = datosOdoo.payment_state;
          tieneCambios = true;
        }
        
        if (tieneCambios) {
          cambios.odoo_last_sync = new Date().toISOString();
          cambios.odoo_error = null;
          
          await db.actualizarVisita(visita.id, cambios);
          actualizadas++;
          
          console.log(`   ✅ Actualizada:`);
          if (cambios.odoo_move_name) {
            console.log(`      Nombre: ${visita.odoo_move_name} → ${cambios.odoo_move_name}`);
          }
          if (cambios.odoo_payment_state) {
            console.log(`      Estado de pago: ${visita.odoo_payment_state || 'NULL'} → ${cambios.odoo_payment_state}`);
          }
        } else {
          sinCambios++;
          console.log(`   ℹ️  Sin cambios (Estado: ${datosOdoo.payment_state || 'NULL'}, Nombre: ${datosOdoo.name || 'NULL'})`);
          
          // Actualizar odoo_last_sync incluso si no hay cambios
          await db.actualizarVisita(visita.id, {
            odoo_last_sync: new Date().toISOString()
          });
        }
      } catch (error) {
        errores++;
        const errorMsg = error?.message || String(error);
        erroresDetalle.push({
          visita_id: visita.id,
          cliente: visita.cliente_nombre,
          odoo_move_id: visita.odoo_move_id,
          error: errorMsg
        });
        console.log(`   ❌ Error: ${errorMsg}`);
      }
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('📊 RESUMEN:');
    console.log(`   Total visitas procesadas: ${visitas.length}`);
    console.log(`   ✅ Actualizadas: ${actualizadas}`);
    console.log(`   ℹ️  Sin cambios: ${sinCambios}`);
    console.log(`   ❌ Errores: ${errores}`);
    
    if (erroresDetalle.length > 0) {
      console.log('\n❌ DETALLE DE ERRORES:');
      erroresDetalle.forEach(e => {
        console.log(`   Visita ID: ${e.visita_id} - Cliente: ${e.cliente} - Move ID: ${e.odoo_move_id}`);
        console.log(`   Error: ${e.error}`);
        console.log('');
      });
    }
    
  } catch (error) {
    console.error('❌ Error general:', error.message);
    if (error.stack) console.error(error.stack);
    process.exit(1);
  }
  
  if (db.close) await db.close();
  process.exit(0);
}

actualizarVisitasOdoo();
