const db = require('../database');

// Script para verificar usuarios existentes

console.log('=== Verificando usuarios en la base de datos ===\n');

// Obtener todos los usuarios
const usuarios = db.obtenerUsuarios();

if (usuarios.length === 0) {
    console.log('❌ No hay usuarios en la base de datos.');
    console.log('\nEjecuta: npm run crear-usuarios\n');
    process.exit(1);
}

console.log(`✓ Encontrados ${usuarios.length} usuario(s):\n`);

usuarios.forEach(user => {
    console.log(`Username: ${user.username}`);
    console.log(`  - ID: ${user.id}`);
    console.log(`  - Rol: ${user.rol}`);
    console.log(`  - Activo: ${user.activo ? 'Sí' : 'No'}`);
    console.log(`  - Responsable ID: ${user.responsable_id || 'N/A'}`);
    console.log(`  - Responsable Nombre: ${user.responsable_nombre || 'N/A'}`);
    console.log(`  - Password: ${user.password ? '***' : 'No definida'}`);
    console.log('');
});

// Obtener responsables
console.log('\n=== Responsables disponibles ===\n');
const responsables = db.obtenerResponsables(false);
if (responsables.length === 0) {
    console.log('❌ No hay responsables en la base de datos.');
} else {
    responsables.forEach(resp => {
        console.log(`- ${resp.nombre} (ID: ${resp.id})`);
    });
}

