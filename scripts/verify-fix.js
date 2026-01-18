require('dotenv').config();
const db = require('../database');

async function verifyFix() {
    console.log('🔍 Verifying final counts...');

    try {
        // 1. Total assignments for current week (Realizadas)
        const semanaActual = db.obtenerSemanaActual();
        const statsSemana = await db.db.prepare(`
            SELECT count(*) as count 
            FROM asignaciones_semanales 
            WHERE semana_inicio = $1 AND realizada = 1
        `).get(semanaActual);

        console.log(`Assignments 'Realizadas' (Dashboard Reference): ${statsSemana?.count}`);

        // 2. Total unpaid visits (Report)
        const reportVisits = await db.obtenerVisitasSinPagar();
        console.log(`Total Unpaid Visits (Report): ${reportVisits.length}`);

        const difference = Math.abs((parseInt(statsSemana?.count) || 0) - reportVisits.length);
        console.log(`Difference: ${difference}`);

        if (difference < 5) {
            console.log('✅ Counts are consistent (or very close)! Fix successful.');
        } else {
            console.log('⚠️ Counts still differ significantly.');
        }

    } catch (err) {
        console.error('Error verifying:', err);
    } finally {
        process.exit(0);
    }
}

verifyFix();
