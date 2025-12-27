const xmlrpc = require('xmlrpc');

function getOdooConfig() {
  return {
    url: process.env.ODOO_URL || 'http://10.10.10.166:8086',
    db: process.env.ODOO_DB || 'pools',
    username: process.env.ODOO_USERNAME || 'admin',
    password: process.env.ODOO_PASSWORD || 'admin'
  };
}

function callXmlRpc(client, method, params) {
  return new Promise((resolve, reject) => {
    client.methodCall(method, params, (err, value) => {
      if (err) return reject(err);
      resolve(value);
    });
  });
}

async function authenticate() {
  const { url, db, username, password } = getOdooConfig();
  const common = xmlrpc.createClient({ url: `${url}/xmlrpc/2/common` });
  const uid = await callXmlRpc(common, 'authenticate', [db, username, password, {}]);
  if (!uid) {
    throw new Error('Odoo authentication failed (uid vacío). Revisa ODOO_DB/ODOO_USERNAME/ODOO_PASSWORD');
  }
  return uid;
}

async function executeKw({ model, method, args = [], kwargs = {} }) {
  const { url, db, username, password } = getOdooConfig();
  const uid = await authenticate();
  const object = xmlrpc.createClient({ url: `${url}/xmlrpc/2/object` });
  return await callXmlRpc(object, 'execute_kw', [db, uid, password, model, method, args, kwargs]);
}

async function testConnection() {
  const uid = await authenticate();
  return { ok: true, uid, config: { ...getOdooConfig(), password: '***' } };
}

async function upsertPartnerFromCliente(cliente) {
  // Campos base mínimos en Odoo (res.partner)
  const values = {
    name: cliente.nombre || 'Sin nombre',
    vat: cliente.rut || false,
    email: cliente.email || false,
    phone: cliente.celular || false,
    street: cliente.direccion || false,
    city: cliente.comuna || false,
    is_company: false,
    company_type: 'person'
  };

  // Buscar partner existente: prioridad RUT, luego email, luego nombre+street
  let domain = [];
  if (cliente.rut) domain = [['vat', '=', cliente.rut]];
  else if (cliente.email) domain = [['email', '=', cliente.email]];
  else domain = [['name', '=', cliente.nombre || ''], ['street', '=', cliente.direccion || '']];

  const ids = await executeKw({
    model: 'res.partner',
    method: 'search',
    args: [domain],
    kwargs: { limit: 1 }
  });

  if (Array.isArray(ids) && ids.length > 0) {
    const partnerId = ids[0];
    await executeKw({
      model: 'res.partner',
      method: 'write',
      args: [[partnerId], values]
    });
    return { partnerId, action: 'updated' };
  }

  const partnerId = await executeKw({
    model: 'res.partner',
    method: 'create',
    args: [values]
  });

  return { partnerId, action: 'created' };
}

module.exports = {
  getOdooConfig,
  testConnection,
  upsertPartnerFromCliente
};


