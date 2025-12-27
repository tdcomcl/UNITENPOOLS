const db = require('../database');

// Script para resetear password de un usuario
const username = process.argv[2];
const newPassword = process.argv[3];

if (!username || !newPassword) {
    console.log('Uso: node scripts/reset-password.js <username> <nueva-password>');
    console.log('\nEjemplo:');
    console.log('  node scripts/reset-password.js admin admin');
    console.log('  node scripts/reset-password.js mati mati');
    process.exit(1);
}

try {
    // Buscar usuario
    const usuario = db.obtenerUsuarioPorUsername(username);
    if (!usuario) {
        console.log(`❌ Usuario '${username}' no encontrado`);
        process.exit(1);
    }
    
    // Actualizar password
    db.db.prepare('UPDATE usuarios SET password = ? WHERE id = ?').run(newPassword, usuario.id);
    
    console.log(`✓ Password actualizado para usuario '${username}'`);
    console.log(`  Nueva password: ${newPassword}`);
} catch (error) {
    console.error('✗ Error:', error.message);
    process.exit(1);
}

