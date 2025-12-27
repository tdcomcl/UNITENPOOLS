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

async function getProductIdForService() {
  const envId = process.env.ODOO_PRODUCT_ID;
  if (envId) return parseInt(envId, 10);

  const productName = process.env.ODOO_PRODUCT_NAME || 'Servicio semanal de mantención de piscina';

  // 1) Buscar en product.product
  let ids = await executeKw({
    model: 'product.product',
    method: 'search',
    args: [[['name', '=', productName]]],
    kwargs: { limit: 1 }
  });
  if (Array.isArray(ids) && ids.length > 0) return ids[0];

  // 2) Buscar en product.template y tomar variante
  ids = await executeKw({
    model: 'product.template',
    method: 'search',
    args: [[['name', '=', productName]]],
    kwargs: { limit: 1 }
  });
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new Error(
      `No se encontró el producto '${productName}' en Odoo. ` +
      `Configura ODOO_PRODUCT_ID o crea el producto con ese nombre.`
    );
  }
  const [tmpl] = await executeKw({
    model: 'product.template',
    method: 'read',
    args: [[ids[0]], ['product_variant_id', 'product_variant_ids']]
  });
  const variantId =
    (tmpl?.product_variant_id && Array.isArray(tmpl.product_variant_id) ? tmpl.product_variant_id[0] : null) ||
    (Array.isArray(tmpl?.product_variant_ids) && tmpl.product_variant_ids.length > 0 ? tmpl.product_variant_ids[0] : null);

  if (!variantId) {
    throw new Error(`Producto template encontrado pero sin variante usable: '${productName}'`);
  }
  return variantId;
}

async function getJournalIdForTipo(documentoTipo) {
  const tipo = mapDocumentoTipo(documentoTipo);

  // Permitir override por variables de entorno
  if (tipo === 'boleta' && process.env.ODOO_JOURNAL_BOLETA_ID) {
    return parseInt(process.env.ODOO_JOURNAL_BOLETA_ID, 10);
  }
  if (tipo === 'factura' && process.env.ODOO_JOURNAL_FACTURA_ID) {
    return parseInt(process.env.ODOO_JOURNAL_FACTURA_ID, 10);
  }
  if (tipo === 'invoice' && process.env.ODOO_JOURNAL_INVOICE_ID) {
    return parseInt(process.env.ODOO_JOURNAL_INVOICE_ID, 10);
  }

  // Defaults según tu configuración
  if (tipo === 'boleta') return 39;   // Diario boletas
  if (tipo === 'factura') return 33;  // Diario ventas (facturas)

  // Invoice: buscar por nombre "Documento Interno"
  const invoiceJournalName = process.env.ODOO_JOURNAL_INVOICE_NAME || 'Documento Interno';
  const ids = await executeKw({
    model: 'account.journal',
    method: 'search',
    args: [[['name', '=', invoiceJournalName]]],
    kwargs: { limit: 1 }
  });
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new Error(
      `No se encontró el diario '${invoiceJournalName}' para Invoice. ` +
      `Configura ODOO_JOURNAL_INVOICE_ID o ODOO_JOURNAL_INVOICE_NAME`
    );
  }
  return ids[0];
}

async function getIncomeAccountId() {
  const envId = process.env.ODOO_INCOME_ACCOUNT_ID;
  if (envId) return parseInt(envId, 10);
  const ids = await executeKw({
    model: 'account.account',
    method: 'search',
    args: [[['account_type', '=', 'income'], ['deprecated', '=', false]]],
    kwargs: { limit: 1 }
  });
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new Error('No se encontró una cuenta de ingresos en Odoo. Configura ODOO_INCOME_ACCOUNT_ID');
  }
  return ids[0];
}

function mapDocumentoTipo(clienteDocumentoTipo) {
  const tipo = (clienteDocumentoTipo || 'invoice').toLowerCase();
  if (tipo === 'factura') return 'factura';
  if (tipo === 'boleta') return 'boleta';
  return 'invoice';
}

async function createInvoiceForVisit({ cliente, visita, partnerId }) {
  const journalId = await getJournalIdForTipo(cliente.documento_tipo);
  const productId = await getProductIdForService();

  const tipo = mapDocumentoTipo(cliente.documento_tipo);
  const moveType = 'out_invoice';

  const lineName = (process.env.ODOO_SERVICE_NAME || 'Servicio semanal de mantención de piscina');
  // El valor de la visita viene del cliente (precio_por_visita). Si viene precio en la visita, se usa como fallback.
  const priceUnit = Number(cliente.precio_por_visita ?? visita.precio ?? 0) || 0;

  const moveVals = {
    move_type: moveType,
    partner_id: partnerId,
    journal_id: journalId,
    invoice_date: visita.fecha_visita,
    ref: `Visita ${visita.id} - Cliente ${cliente.id}`,
    invoice_line_ids: [[0, 0, {
      name: lineName,
      product_id: productId,
      quantity: 1,
      price_unit: priceUnit
    }]]
  };

  // Si tienes IDs específicos para documentos (Latam), puedes configurarlos por env.
  // Nota: esto depende de módulos de localización instalados en Odoo.
  if (tipo === 'factura' && process.env.ODOO_DOC_TYPE_FACTURA_ID) {
    moveVals.l10n_latam_document_type_id = parseInt(process.env.ODOO_DOC_TYPE_FACTURA_ID, 10);
  }
  if (tipo === 'boleta' && process.env.ODOO_DOC_TYPE_BOLETA_ID) {
    moveVals.l10n_latam_document_type_id = parseInt(process.env.ODOO_DOC_TYPE_BOLETA_ID, 10);
  }

  const moveId = await executeKw({
    model: 'account.move',
    method: 'create',
    args: [moveVals]
  });

  // Postear para que quede "pendiente de pago" (not_paid) si no se registra pago
  await executeKw({
    model: 'account.move',
    method: 'action_post',
    args: [[moveId]]
  });

  const [move] = await executeKw({
    model: 'account.move',
    method: 'read',
    args: [[moveId], ['name', 'state', 'payment_state', 'amount_total', 'invoice_date']]
  });

  return {
    moveId,
    name: move?.name,
    state: move?.state,
    payment_state: move?.payment_state,
    amount_total: move?.amount_total,
    invoice_date: move?.invoice_date
  };
}

module.exports = {
  getOdooConfig,
  testConnection,
  upsertPartnerFromCliente,
  createInvoiceForVisit
};


