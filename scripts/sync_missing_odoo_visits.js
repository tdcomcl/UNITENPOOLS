
require('dotenv').config();
const db = require('../database');
const odoo = require('../odoo');

async function syncMissingVisits() {
    try {
        console.log('🔍 Buscando visitas realizadas sin sincronizar con Odoo...');

        // 1. Obtener visitas sin odoo_move_id
        const rows = await db.db.prepare(`
            SELECT v.*, c.nombre as cliente_nombre 
            FROM visitas v
            JOIN clientes c ON v.cliente_id = c.id
            WHERE v.realizada = 1 
            AND (v.odoo_move_id IS NULL OR v.odoo_move_id = 0)
            ORDER BY v.fecha_visita ASC
        `).all();

        if (rows.length === 0) {
            console.log('✅ No hay visitas pendientes de sincronizar.');
            return;
        }

        console.log(`📋 Se encontraron ${rows.length} visitas pendientes.`);

        let successCount = 0;
        let errorCount = 0;

        for (const visita of rows) {
            console.log(`\n🔄 Procesando Visita ID ${visita.id} (Cliente: ${visita.cliente_nombre}, Fecha: ${visita.fecha_visita})...`);

            try {
                // Obtener cliente completo para datos de facturación
                const cliente = await db.obtenerClientePorId(visita.cliente_id);
                if (!cliente) {
                    throw new Error(`Cliente ID ${visita.cliente_id} no encontrado`);
                }

                // 2. Asegurar Partner en Odoo
                console.log('   👤 Sincronizando cliente en Odoo...');
                const { partnerId } = await odoo.upsertPartnerFromCliente(cliente);

                // Actualizar partner_id en cliente si cambió (opcional pero útil)
                await db.actualizarCliente(cliente.id, {
                    odoo_partner_id: partnerId,
                    odoo_last_sync: new Date().toISOString()
                });

                // 3. Crear Factura en Odoo
                console.log('   🧾 Creando factura en Odoo...');
                const odooResult = await odoo.createInvoiceForVisit({
                    cliente,
                    visita,
                    partnerId
                });

                console.log(`   ✅ Factura creada: ${odooResult.name} (ID: ${odooResult.moveId})`);

                // 4. Actualizar visita localmente
                await db.actualizarVisita(visita.id, {
                    odoo_move_id: odooResult.moveId,
                    odoo_move_name: odooResult.name,
                    odoo_payment_state: odooResult.payment_state,
                    odoo_last_sync: new Date().toISOString(),
                    odoo_error: null
                });

                successCount++;

            } catch (error) {
                console.error(`   ❌ Error: ${error.message}`);

                // Guardar error en la visita para diagnóstico
                await db.actualizarVisita(visita.id, {
                    odoo_error: error.message,
                    odoo_last_sync: new Date().toISOString()
                });

                errorCount++;
            }
        }

        console.log('\n==========================================');
        console.log('📊 RESUMEN FINAL');
        console.log(`Total procesado: ${rows.length}`);
        console.log(`✅ Exitosos: ${successCount}`);
        console.log(`❌ Fallidos: ${errorCount}`);
        console.log('==========================================');

    } catch (e) {
        console.error('CRITICAL ERROR:', e);
    }
}

syncMissingVisits();
