require('dotenv').config();
const db = require('../database');
const odoo = require('../odoo');

async function syncMissingOdoo() {
    console.log('🚀 Starting Odoo Sync for missing visits...');

    try {
        // 1. Get all visits realized but not synced
        const visitsToSync = await db.db.prepare(`
            SELECT * FROM visitas 
            WHERE realizada = 1 AND odoo_move_id IS NULL
        `).all();

        console.log(`📋 Found ${visitsToSync.length} visits to sync.`);

        if (visitsToSync.length === 0) {
            console.log('✅ No visits to sync.');
            process.exit(0);
        }

        let successCount = 0;
        let errorCount = 0;

        for (const visit of visitsToSync) {
            try {
                console.log(`Processing Visit #${visit.id} (Client ${visit.cliente_id})...`);

                // 2. Get full client data
                const cliente = await db.obtenerClientePorId(visit.cliente_id);
                if (!cliente) {
                    throw new Error(`Client ${visit.cliente_id} not found`);
                }

                // 3. Upsert Partner in Odoo
                const { partnerId } = await odoo.upsertPartnerFromCliente(cliente);
                console.log(`   -> Partner ID: ${partnerId}`);

                // 4. Create Invoice
                const invoice = await odoo.createInvoiceForVisit({
                    cliente,
                    visita: visit,
                    partnerId
                });
                console.log(`   -> Invoice Created: ${invoice.name} (ID: ${invoice.moveId})`);

                // 5. Update Local DB
                await db.actualizarVisita(visit.id, {
                    odoo_move_id: invoice.moveId,
                    odoo_move_name: invoice.name,
                    odoo_payment_state: invoice.payment_state || 'not_paid',
                    odoo_last_sync: new Date().toISOString(),
                    odoo_error: null // Clear any previous error
                });

                successCount++;

            } catch (err) {
                console.error(`   ❌ Error syncing visit #${visit.id}:`, err.message);

                // Save error to DB so we know what happened
                try {
                    await db.actualizarVisita(visit.id, {
                        odoo_error: err.message
                    });
                } catch (e) { /* ignore update error */ }

                errorCount++;
            }
        }

        console.log('\n==========================================');
        console.log(`✅ Finished processing.`);
        console.log(`   Success: ${successCount}`);
        console.log(`   Errors: ${errorCount}`);
        console.log('==========================================\n');

    } catch (err) {
        console.error('Fatal error in sync script:', err);
    } finally {
        process.exit(0);
    }
}

syncMissingOdoo();
