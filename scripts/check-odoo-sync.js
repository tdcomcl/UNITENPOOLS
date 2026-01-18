require('dotenv').config();
const db = require('../database');

async function checkMissingOdooSync() {
    console.log('🔍 Checking for visits not synced to Odoo...');

    try {
        const missingOdoo = await db.db.prepare(`
            SELECT count(*) as count 
            FROM visitas 
            WHERE realizada = 1 AND odoo_move_id IS NULL
        `).get();

        console.log(`Visits marked as realized but with NULL odoo_move_id: ${missingOdoo?.count}`);

        if (missingOdoo?.count > 0) {
            const rows = await db.db.prepare(`
                SELECT v.id, v.fecha_visita, c.nombre as cliente
                FROM visitas v
                LEFT JOIN clientes c ON v.cliente_id = c.id
                WHERE v.realizada = 1 AND v.odoo_move_id IS NULL
                LIMIT 5
            `).all();
            console.log('Sample rows:', rows);
        }

    } catch (err) {
        console.error('Error checking Odoo sync:', err);
    } finally {
        process.exit(0);
    }
}

checkMissingOdooSync();
