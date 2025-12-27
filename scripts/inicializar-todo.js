const db = require('../database');

// Script para inicializar responsables y usuarios desde cero

console.log('=== Inicializando base de datos ===\n');

// 1. Crear responsables
console.log('1. Creando responsables...\n');

const responsablesBase = [
    { nombre: 'Mati' },
    { nombre: 'Jano' }
];

responsablesBase.forEach(resp => {
    try {
        const responsables = db.obtenerResponsables(false);
        const existe = responsables.find(r => r.nombre.toLowerCase() === resp.nombre.toLowerCase());
        
        if (!existe) {
            const id = db.crearResponsable(resp.nombre);
            console.log(`✓ Responsable creado: ${resp.nombre} (ID: ${id})`);
        } else {
            console.log(`⚠ Responsable ${resp.nombre} ya existe (ID: ${existe.id})`);
        }
    } catch (error) {
        console.error(`✗ Error creando responsable ${resp.nombre}:`, error.message);
    }
});

// 2. Crear usuarios
console.log('\n2. Creando usuarios...\n');

// Crear admin primero
try {
    const usuarios = db.obtenerUsuarios();
    const adminExiste = usuarios.find(u => u.username === 'admin');
    
    if (!adminExiste) {
        const adminId = db.crearUsuario('admin', 'admin', null, 'admin');
        console.log(`✓ Usuario admin creado: admin/admin (Administrador)`);
    } else {
        console.log(`⚠ Usuario admin ya existe`);
    }
} catch (error) {
    if (error.message.includes('ya existe')) {
        console.log(`⚠ Usuario admin ya existe`);
    } else {
        console.error(`✗ Error creando admin:`, error.message);
    }
}

// Crear usuarios para cada responsable
const responsables = db.obtenerResponsables(false);

responsables.forEach(resp => {
    const username = resp.nombre.toLowerCase().replace(/\s+/g, '');
    const password = username;
    
    try {
        const usuarios = db.obtenerUsuarios();
        const usuarioExiste = usuarios.find(u => u.username === username);
        
        if (!usuarioExiste) {
            const id = db.crearUsuario(username, password, resp.id, 'responsable');
            console.log(`✓ Usuario creado: ${username}/${password} (Responsable: ${resp.nombre})`);
        } else {
            console.log(`⚠ Usuario ${username} ya existe`);
        }
    } catch (error) {
        if (error.message.includes('ya existe')) {
            console.log(`⚠ Usuario ${username} ya existe`);
        } else {
            console.error(`✗ Error creando usuario ${username}:`, error.message);
        }
    }
});

// 3. Resumen
console.log('\n=== Resumen ===\n');

const todosLosUsuarios = db.obtenerUsuarios();
console.log(`Total usuarios: ${todosLosUsuarios.length}`);
todosLosUsuarios.forEach(user => {
    console.log(`  - ${user.username} (${user.rol})`);
});

const todosLosResponsables = db.obtenerResponsables(false);
console.log(`\nTotal responsables: ${todosLosResponsables.length}`);
todosLosResponsables.forEach(resp => {
    console.log(`  - ${resp.nombre} (ID: ${resp.id})`);
});

console.log('\n✓ Proceso completado');
console.log('\nCredenciales:');
console.log('  - admin / admin (Administrador)');
todosLosResponsables.forEach(resp => {
    const username = resp.nombre.toLowerCase().replace(/\s+/g, '');
    console.log(`  - ${username} / ${username} (Responsable: ${resp.nombre})`);
});

