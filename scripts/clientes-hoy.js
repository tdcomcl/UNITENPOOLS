const db = require('../database');

// Obtener la fecha de hoy en formato YYYY-MM-DD
const hoy = new Date().toISOString().split('T')[0];

console.log(`\n📊 Clientes ingresados hoy (${hoy}):\n`);

// Consultar clientes creados hoy
const clientesHoy = db.db.prepare(`
  SELECT 
    c.id,
    c.nombre,
    c.rut,
    c.direccion,
    c.comuna,
    c.celular,
    c.email,
    c.responsable_id,
    r.nombre as responsable_nombre,
    c.dia_atencion,
    c.precio_por_visita,
    c.activo,
    c.created_at
  FROM clientes c
  LEFT JOIN responsables r ON c.responsable_id = r.id
  WHERE date(c.created_at) = date('now')
  ORDER BY c.created_at DESC
`).all();

if (clientesHoy.length === 0) {
  console.log('❌ No se encontraron clientes ingresados hoy.\n');
  process.exit(0);
}

console.log(`✅ Total de clientes ingresados hoy: ${clientesHoy.length}\n`);

// Lista compacta
console.log('LISTA DE CLIENTES:\n');
clientesHoy.forEach((cliente, index) => {
  const info = [];
  info.push(`ID: ${cliente.id}`);
  info.push(cliente.nombre || '(sin nombre)');
  if (cliente.comuna) info.push(`- ${cliente.comuna}`);
  if (cliente.responsable_nombre) info.push(`[${cliente.responsable_nombre}]`);
  if (cliente.dia_atencion) info.push(`(${cliente.dia_atencion})`);
  if (cliente.precio_por_visita) info.push(`$${cliente.precio_por_visita}`);
  
  console.log(`${(index + 1).toString().padStart(3, ' ')}. ${info.join(' ')}`);
});

console.log('\n' + '═'.repeat(80));
console.log('\nDETALLE COMPLETO:\n');

clientesHoy.forEach((cliente, index) => {
  console.log(`\n${index + 1}. Cliente ID: ${cliente.id}`);
  console.log(`   Nombre: ${cliente.nombre || '(sin nombre)'}`);
  if (cliente.rut) console.log(`   RUT: ${cliente.rut}`);
  if (cliente.direccion) console.log(`   Dirección: ${cliente.direccion}`);
  if (cliente.comuna) console.log(`   Comuna: ${cliente.comuna}`);
  if (cliente.celular) console.log(`   Celular: ${cliente.celular}`);
  if (cliente.email) console.log(`   Email: ${cliente.email}`);
  if (cliente.responsable_nombre) {
    console.log(`   Responsable: ${cliente.responsable_nombre} (ID: ${cliente.responsable_id})`);
  }
  if (cliente.dia_atencion) console.log(`   Día de atención: ${cliente.dia_atencion}`);
  if (cliente.precio_por_visita) console.log(`   Precio por visita: $${cliente.precio_por_visita}`);
  console.log(`   Estado: ${cliente.activo ? '✅ Activo' : '❌ Inactivo'}`);
  console.log(`   Fecha de creación: ${cliente.created_at}`);
  console.log('─'.repeat(80));
});

console.log(`\n✅ Consulta completada.\n`);
