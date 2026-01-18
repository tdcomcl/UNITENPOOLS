require('dotenv').config();
const db = require('../database');

async function fixMissingVisits() {
    console.log('🚀 Starting fix for missing visits...');

    try {
        // 1. Get all assignments that are "realizada = 1" but have no "visita_id"
        // Also get the client's current price to use as default if assignment price is missing
        const assignments = await db.db.prepare(`
            SELECT a.*, c.precio_por_visita as cliente_precio
            FROM asignaciones_semanales a
            LEFT JOIN clientes c ON a.cliente_id = c.id
            WHERE a.realizada = 1 AND a.visita_id IS NULL
        `).all();

        console.log(`📋 Found ${assignments.length} assignments to fix.`);

        if (assignments.length === 0) {
            console.log('✅ No assignments to fix.');
            process.exit(0);
        }

        let fixedCount = 0;
        let errorCount = 0;

        for (const assign of assignments) {
            try {
                // Determine values for the new visit
                const fechaVisita = assign.semana_inicio; // Default to the start of the week
                const responsableId = assign.responsable_id || null;
                const precio = assign.precio || assign.cliente_precio || 0;

                console.log(`Processing Assign #${assign.id} (Client ${assign.cliente_id}, Date ${fechaVisita})...`);

                // Insert new visit
                // Note: db.registrarVisita handles nulls correctly via our previous check/fix in database_postgresql.js? 
                // Wait, database.js/database_postgresql.js 'registrarVisita' expects (cliente_id, fecha_visita, responsable_id, precio, realizada)

                // We'll use the raw DB insert to be safe and explicit, or use the helper if we trust it.
                // The helper in database_postgresql.js is:
                // async registrarVisita(cliente_id, fecha_visita, responsable_id = null, precio = null, realizada = true)

                const newVisitaId = await db.registrarVisita(
                    assign.cliente_id,
                    fechaVisita,
                    responsableId,
                    precio,
                    true // realizada
                );

                console.log(`   -> Created Visit #${newVisitaId}`);

                // Update assignment with new visit ID
                await db.actualizarAsignacion(assign.id, {
                    visita_id: newVisitaId
                });

                console.log(`   -> Updated Assignment #${assign.id} with visita_id=${newVisitaId}`);
                fixedCount++;

            } catch (err) {
                console.error(`   ❌ Error fixing assignment #${assign.id}:`, err);
                errorCount++;
            }
        }

        console.log('\n==========================================');
        console.log(`✅ Finished processing.`);
        console.log(`   Fixed: ${fixedCount}`);
        console.log(`   Errors: ${errorCount}`);
        console.log('==========================================\n');

    } catch (err) {
        console.error('Fatal error in fix script:', err);
    } finally {
        process.exit(0);
    }
}

fixMissingVisits();
