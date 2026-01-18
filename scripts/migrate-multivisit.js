require('dotenv').config();
const db = require('../database');

async function migrateMultiVisit() {
    console.log('🚀 Migrating DB for Multi-Visit Support...');

    try {
        // 1. Drop old constraint
        // Try known names or catch error
        console.log('Dropping old constraint...');
        try {
            await db.query(`
                ALTER TABLE asignaciones_semanales 
                DROP CONSTRAINT IF EXISTS asignaciones_semanales_semana_inicio_cliente_id_key;
            `);
        } catch (e) {
            console.log('Warning dropping constraint (might not exist):', e.message);
        }

        try {
            // Also try the implicit index name if constraint name was different
            await db.query(`
                DROP INDEX IF EXISTS asignaciones_semanales_semana_inicio_cliente_id_key;
            `);
        } catch (e) {
            console.log('Warning dropping index:', e.message);
        }

        // 2. Add new constraint
        console.log('Adding new constraint (semana, cliente, dia)...');
        // Clean up duplicates if any before adding constraint?
        // Assuming current data is clean (1 per week)

        await db.query(`
            ALTER TABLE asignaciones_semanales 
            ADD CONSTRAINT asignaciones_semanales_unique_day 
            UNIQUE (semana_inicio, cliente_id, dia_atencion);
        `);

        console.log('✅ Migration successful.');

    } catch (err) {
        console.error('❌ Migration failed:', err);
    } finally {
        process.exit(0);
    }
}

migrateMultiVisit();
