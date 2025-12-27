const db = require('../database');

// Script para crear usuarios iniciales
// Usa los responsables existentes para crear usuarios

function crearUsuariosIniciales() {
    console.log('Creando usuarios iniciales...\n');
    
    const responsables = db.obtenerResponsables(false);
    
    if (responsables.length === 0) {
        console.log('No hay responsables en la base de datos. Crea responsables primero.');
        return;
    }
    
    responsables.forEach(resp => {
        const username = resp.nombre.toLowerCase().replace(/\s+/g, '');
        const password = username; // Password inicial igual al username
        
        try {
            const id = db.crearUsuario(username, password, resp.id, 'responsable');
            console.log(`✓ Usuario creado: ${username} (Responsable: ${resp.nombre}) - Password: ${password}`);
        } catch (error) {
            if (error.message.includes('ya existe')) {
                console.log(`⚠ Usuario ${username} ya existe`);
            } else {
                console.error(`✗ Error creando usuario ${username}:`, error.message);
            }
        }
    });
    
    // Crear usuario admin
    try {
        const adminId = db.crearUsuario('admin', 'admin', null, 'admin');
        console.log(`\n✓ Usuario administrador creado: admin - Password: admin`);
    } catch (error) {
        if (error.message.includes('ya existe')) {
            console.log(`\n⚠ Usuario admin ya existe`);
        } else {
            console.error(`\n✗ Error creando admin:`, error.message);
        }
    }
    
    console.log('\n✓ Proceso completado');
    console.log('\nUsuarios creados:');
    console.log('- admin/admin (Administrador - puede ver todo)');
    responsables.forEach(resp => {
        const username = resp.nombre.toLowerCase().replace(/\s+/g, '');
        console.log(`- ${username}/${username} (Responsable: ${resp.nombre})`);
    });
}

crearUsuariosIniciales();

