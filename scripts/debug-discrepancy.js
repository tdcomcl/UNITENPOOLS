const db = require('../database');

async function checkDiscrepancies() {
    console.log('Checking for discrepancies between Asignaciones and Visitas...');

    try {
        // 1. Get all assignments that are "realizada = 1" but have no "visita_id"
        // db.db.prepare returns an object with async methods get, all, run
        const missingVisitaId = await db.db.prepare(`
            SELECT count(*) as count 
            FROM asignaciones_semanales 
            WHERE realizada = 1 AND visita_id IS NULL
        `).get();

        console.log(`Assignments marked as realized but with NULL visita_id: ${missingVisitaId?.count}`);

        if (missingVisitaId?.count > 0) {
            const rows = await db.db.prepare(`
                SELECT * FROM asignaciones_semanales 
                WHERE realizada = 1 AND visita_id IS NULL
                
            `).all();
            console.log('Sample rows (NULL visita_id):', rows.slice(0, 3));
        }

        // 2. Get all assignments that have a visita_id, but the visit doesn't exist in visits table
        // (Orphan references)
        const orphanVisitaId = await db.db.prepare(`
            SELECT count(*) as count 
            FROM asignaciones_semanales a
            LEFT JOIN visitas v ON a.visita_id = v.id
            WHERE a.realizada = 1 AND a.visita_id IS NOT NULL AND v.id IS NULL
        `).get();

        console.log(`Assignments with visita_id pointing to non-existent visit: ${orphanVisitaId?.count}`);

        if (orphanVisitaId?.count > 0) {
            const rows = await db.db.prepare(`
                SELECT a.* 
                FROM asignaciones_semanales a
                LEFT JOIN visitas v ON a.visita_id = v.id
                WHERE a.realizada = 1 AND a.visita_id IS NOT NULL AND v.id IS NULL
            `).all();
            console.log('Sample rows (Orphan visita_id):', rows.slice(0, 3));
        }

        // 3. Count total realized assignments for current week to match Dashboard
        const semanaActual = db.obtenerSemanaActual();
        const statsSemana = await db.db.prepare(`
            SELECT count(*) as count 
            FROM asignaciones_semanales 
            WHERE semana_inicio = ? AND realizada = 1
        `).get(semanaActual);

        console.log(`Total realized assignments for current week (${semanaActual}): ${statsSemana?.count} (Should match Dashboard ~196)`);

        // 4. Count total unpaid visits (Visitas Sin Pagar report)
        // Using the same logic as obtenerVisitasSinPagar
        const reportVisits = await db.obtenerVisitasSinPagar();
        console.log(`Total unpaid visits in report: ${reportVisits.length} (Observed 141)`);

    } catch (err) {
        console.error('Error executing checkDiscrepancies:', err);
    } finally {
        // Close pool if possible, though PiscinasDB doesn't expose close/end explicitly in public API easily, 
        // but we can let the script exit naturally or force exit.
        // However, PG pool usually keeps process alive.
        process.exit(0);
    }
}

checkDiscrepancies();
