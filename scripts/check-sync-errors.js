require('dotenv').config();
const db = require('../database');

async function checkSyncErrors() {
    console.log('🔍 Checking for Odoo sync errors...');

    try {
        const errors = await db.db.prepare(`
            SELECT v.id, v.fecha_visita, c.nombre as cliente, v.odoo_error
            FROM visitas v
            LEFT JOIN clientes c ON v.cliente_id = c.id
            WHERE v.odoo_error IS NOT NULL AND v.realizada = 1
        `).all();

        console.log(`Found ${errors.length} visits with errors:`);
        errors.forEach(e => {
            console.log(`- Visit #${e.id} (${e.cliente}): ${e.odoo_error}`);
        });

    } catch (err) {
        console.error('Error checking errors:', err);
    } finally {
        process.exit(0);
    }
}

checkSyncErrors();
