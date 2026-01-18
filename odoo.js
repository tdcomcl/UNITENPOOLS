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

const _cache = {
  modelFields: new Map(),
  countryIdCL: null,
  idTypeRUT: null,
  latamDocTypeByCode: new Map()
};

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

async function getModelFields(model) {
  if (_cache.modelFields.has(model)) return _cache.modelFields.get(model);
  const fields = await executeKw({
    model,
    method: 'fields_get',
    args: [],
    kwargs: { attributes: ['type', 'string', 'selection', 'relation'] }
  });
  _cache.modelFields.set(model, fields || {});
  return fields || {};
}

function pickSelectionKey(fieldsGet, fieldName, labelRegex) {
  const f = fieldsGet?.[fieldName];
  const sel = f?.selection;
  if (!Array.isArray(sel)) return null;
  const hit = sel.find(([key, label]) => labelRegex.test(String(label || '')));
  return hit ? hit[0] : null;
}

async function getCountryIdCL() {
  if (_cache.countryIdCL) return _cache.countryIdCL;
  const ids = await executeKw({
    model: 'res.country',
    method: 'search',
    args: [[['code', '=', 'CL']]],
    kwargs: { limit: 1 }
  });
  if (!Array.isArray(ids) || ids.length === 0) return null;
  _cache.countryIdCL = ids[0];
  return _cache.countryIdCL;
}

async function getIdentificationTypeIdRUT() {
  if (_cache.idTypeRUT) return _cache.idTypeRUT;
  // Chile localization uses l10n_latam.identification.type
  const ids = await executeKw({
    model: 'l10n_latam.identification.type',
    method: 'search',
    args: [[['name', 'ilike', 'RUT']]],
    kwargs: { limit: 1 }
  });
  if (!Array.isArray(ids) || ids.length === 0) return null;
  _cache.idTypeRUT = ids[0];
  return _cache.idTypeRUT;
}

async function getLatamDocumentTypeIdByCode(code) {
  const key = String(code);
  if (_cache.latamDocTypeByCode.has(key)) return _cache.latamDocTypeByCode.get(key);

  const countryId = await getCountryIdCL();
  const domain = [['code', '=', key]];
  if (countryId) domain.push(['country_id', '=', countryId]);

  const ids = await executeKw({
    model: 'l10n_latam.document.type',
    method: 'search',
    args: [domain],
    kwargs: { limit: 1 }
  });
  const id = Array.isArray(ids) && ids.length > 0 ? ids[0] : null;
  _cache.latamDocTypeByCode.set(key, id);
  return id;
}

async function upsertPartnerFromCliente(cliente) {
  // Campos base mínimos en Odoo (res.partner)
  const partnerFields = await getModelFields('res.partner');

  const potentialFields = Object.keys(partnerFields).filter(k => k.includes('l10n') || k.includes('sii') || k.includes('taxpayer') || k.includes('contribuyente'));
  console.log('[Odoo DEBUG] Potential Taxpayer Fields:', potentialFields);

  if (partnerFields['l10n_cl_sii_taxpayer_type']) {
    console.log('[Odoo DEBUG] Found standard field l10n_cl_sii_taxpayer_type');
  } else {
    console.log('[Odoo DEBUG] Standard field l10n_cl_sii_taxpayer_type NOT FOUND');
  }

  // Determinar si debemos usar datos de factura
  const tipo = (cliente.documento_tipo || 'invoice').toLowerCase();
  const usaDatosFactura = tipo === 'factura' && (
    cliente.factura_razon_social || 
    cliente.factura_rut || 
    cliente.factura_direccion || 
    cliente.factura_email
  );

  // Si es factura y hay datos de factura, usar esos datos para facturación
  const tieneRazonSocial = usaDatosFactura && cliente.factura_razon_social;
  
  // Determinar RUT a usar: prioridad factura_rut si existe, luego cliente.rut
  const rutParaEnviar = usaDatosFactura && cliente.factura_rut 
    ? cliente.factura_rut 
    : (cliente.rut || null);
  
  // Determinar nombre a usar: si es factura y hay razón social, usar razón social, sino nombre del cliente
  const nombreParaEnviar = usaDatosFactura && cliente.factura_razon_social
    ? cliente.factura_razon_social
    : (cliente.nombre || 'Sin nombre');
  
  const values = {
    name: nombreParaEnviar, // Razón social si es factura, sino nombre del cliente
    vat: rutParaEnviar || false, // No enviar null, usar false si no hay RUT
    email: usaDatosFactura && cliente.factura_email ? cliente.factura_email : (cliente.email || false),
    phone: cliente.celular || false,
    street: usaDatosFactura && cliente.factura_direccion ? cliente.factura_direccion : (cliente.direccion || false),
    city: usaDatosFactura && cliente.factura_comuna ? cliente.factura_comuna : (cliente.comuna || false),
    is_company: tieneRazonSocial,
    company_type: tieneRazonSocial ? 'company' : 'person'
  };

  // Log para debug
  console.log(`[Odoo DEBUG] Cliente: ${cliente.nombre}, Tipo: ${tipo}, UsaDatosFactura: ${usaDatosFactura}`);
  if (usaDatosFactura) {
    console.log(`[Odoo DEBUG] Datos factura - RUT: ${cliente.factura_rut || 'N/A'}, Razón Social: ${cliente.factura_razon_social || 'N/A'}`);
  }
  console.log(`[Odoo DEBUG] RUT a enviar: ${rutParaEnviar || 'N/A'}`);
  console.log(`[Odoo DEBUG] Nombre a enviar: ${nombreParaEnviar}`);

  // Si hay razón social de factura y se usó como name, guardar el nombre del cliente en comment
  if (tieneRazonSocial) {
    // Guardar el nombre del cliente en comment para referencia
    if (partnerFields.comment) {
      values.comment = `Cliente: ${cliente.nombre}`;
    }
  }

  // Forzar Chile para evitar que Odoo lo trate como extranjero
  const countryId = await getCountryIdCL();
  if (countryId && partnerFields?.country_id) {
    values.country_id = countryId;
  }

  // Tipo identificación (RUT) si viene rut
  const idTypeRUT = await getIdentificationTypeIdRUT();
  if (idTypeRUT && partnerFields?.l10n_latam_identification_type_id) {
    // Usar el mismo RUT que se está enviando en vat
    values.l10n_latam_identification_type_id = rutParaEnviar ? idTypeRUT : false;
    console.log(`[Odoo DEBUG] Tipo identificación RUT: ${rutParaEnviar ? 'Sí' : 'No'}`);
  }

  // Tipo contribuyente según documento del cliente
  // CRÍTICO: Para facturas, siempre debe tener tipo de contribuyente
  if (partnerFields?.l10n_cl_sii_taxpayer_type) {
    console.log('[Odoo DEBUG] Taxpayer Selection:', JSON.stringify(partnerFields.l10n_cl_sii_taxpayer_type.selection));

    // Asignar email DTE si existe el campo y tenemos email de facturación
    if (Object.keys(partnerFields).includes('l10n_cl_dte_email') && usaDatosFactura && cliente.factura_email) {
      values.l10n_cl_dte_email = cliente.factura_email;
    }

    if (tipo === 'boleta') {
      const key = pickSelectionKey(partnerFields, 'l10n_cl_sii_taxpayer_type', /consumidor/i);
      if (key) {
        values.l10n_cl_sii_taxpayer_type = key;
        console.log(`[Odoo DEBUG] Tipo contribuyente Boleta: ${key}`);
      }
    } else if (tipo === 'factura') {
      // Para facturas, buscar "VAT Affected" o usar "1" directamente
      let key = pickSelectionKey(partnerFields, 'l10n_cl_sii_taxpayer_type', /afecto|vat affected/i);
      // Si no encuentra, usar "1" directamente (primera categoría)
      if (!key && Array.isArray(partnerFields.l10n_cl_sii_taxpayer_type.selection)) {
        const option1 = partnerFields.l10n_cl_sii_taxpayer_type.selection.find(([k, v]) => k === '1' || k === 1);
        if (option1) key = option1[0];
      }
      if (key) {
        values.l10n_cl_sii_taxpayer_type = key;
        console.log(`[Odoo DEBUG] Tipo contribuyente Factura: ${key}`);
      } else {
        console.error('[Odoo ERROR] No se pudo determinar tipo de contribuyente para factura');
      }
    }
  }

  // Validación: Para facturas, RUT y tipo de contribuyente son obligatorios
  if (tipo === 'factura') {
    if (!rutParaEnviar) {
      console.error('[Odoo ERROR] Factura requiere RUT pero no se encontró factura_rut ni rut');
    }
    if (!values.l10n_cl_sii_taxpayer_type) {
      console.error('[Odoo ERROR] Factura requiere tipo de contribuyente pero no se estableció');
    }
  }

  // Si hay giro de factura, intentar asignarlo
  if (usaDatosFactura && cliente.factura_giro && partnerFields.l10n_cl_activity_description) {
    values.l10n_cl_activity_description = cliente.factura_giro;
  }

  // Buscar partner existente: prioridad RUT de factura (si existe), luego RUT normal, luego email, luego nombre+street
  let domain = [];
  const rutParaBusqueda = usaDatosFactura && cliente.factura_rut ? cliente.factura_rut : cliente.rut;
  const emailParaBusqueda = usaDatosFactura && cliente.factura_email ? cliente.factura_email : cliente.email;
  
  if (rutParaBusqueda) {
    domain = [['vat', '=', rutParaBusqueda]];
  } else if (emailParaBusqueda) {
    domain = [['email', '=', emailParaBusqueda]];
  } else {
    domain = [['name', '=', cliente.nombre || ''], ['street', '=', values.street || '']];
  }

  const ids = await executeKw({
    model: 'res.partner',
    method: 'search',
    args: [domain],
    kwargs: { limit: 1 }
  });

  if (Array.isArray(ids) && ids.length > 0) {
    const partnerId = ids[0];
    console.log(`[Odoo DEBUG] Partner existente encontrado ID: ${partnerId}`);
    
    // Leer datos actuales del partner en Odoo
    const [partnerActual] = await executeKw({
      model: 'res.partner',
      method: 'read',
      args: [[partnerId], Object.keys(values)]
    });
    
    // Crear objeto de actualización: solo actualizar campos que están vacíos en Odoo
    // o que son diferentes y necesarios para facturas
    const valuesToUpdate = {};
    
    // Para facturas, siempre actualizar datos de factura si están disponibles
    if (tipo === 'factura' && usaDatosFactura) {
      // Actualizar name si hay razón social y el actual no coincide
      if (cliente.factura_razon_social && partnerActual.name !== cliente.factura_razon_social) {
        valuesToUpdate.name = cliente.factura_razon_social;
      }
      // Actualizar vat si hay factura_rut y el actual no coincide
      if (cliente.factura_rut && partnerActual.vat !== cliente.factura_rut) {
        valuesToUpdate.vat = cliente.factura_rut;
      }
      // Actualizar email si hay factura_email y el actual está vacío o no coincide
      if (cliente.factura_email && (!partnerActual.email || partnerActual.email !== cliente.factura_email)) {
        valuesToUpdate.email = cliente.factura_email;
      }
      // Actualizar street si hay factura_direccion y el actual está vacío
      if (cliente.factura_direccion && (!partnerActual.street || partnerActual.street !== cliente.factura_direccion)) {
        valuesToUpdate.street = cliente.factura_direccion;
      }
      // Actualizar city si hay factura_comuna y el actual está vacío
      if (cliente.factura_comuna && (!partnerActual.city || partnerActual.city !== cliente.factura_comuna)) {
        valuesToUpdate.city = cliente.factura_comuna;
      }
    } else {
      // Para no facturas, actualizar solo si están vacíos
      if (values.name && !partnerActual.name) valuesToUpdate.name = values.name;
      if (values.vat && !partnerActual.vat) valuesToUpdate.vat = values.vat;
      if (values.email && !partnerActual.email) valuesToUpdate.email = values.email;
      if (values.street && !partnerActual.street) valuesToUpdate.street = values.street;
      if (values.city && !partnerActual.city) valuesToUpdate.city = values.city;
    }
    
    // Siempre actualizar campos críticos si están definidos
    if (values.country_id && !partnerActual.country_id) valuesToUpdate.country_id = values.country_id;
    if (values.l10n_latam_identification_type_id && !partnerActual.l10n_latam_identification_type_id) {
      valuesToUpdate.l10n_latam_identification_type_id = values.l10n_latam_identification_type_id;
    }
    if (values.l10n_cl_sii_taxpayer_type && !partnerActual.l10n_cl_sii_taxpayer_type) {
      valuesToUpdate.l10n_cl_sii_taxpayer_type = values.l10n_cl_sii_taxpayer_type;
    }
    if (values.l10n_cl_dte_email && !partnerActual.l10n_cl_dte_email) {
      valuesToUpdate.l10n_cl_dte_email = values.l10n_cl_dte_email;
    }
    if (values.l10n_cl_activity_description && !partnerActual.l10n_cl_activity_description) {
      valuesToUpdate.l10n_cl_activity_description = values.l10n_cl_activity_description;
    }
    if (values.comment && !partnerActual.comment) {
      valuesToUpdate.comment = values.comment;
    }
    
    // Actualizar solo si hay cambios
    if (Object.keys(valuesToUpdate).length > 0) {
      console.log(`[Odoo DEBUG] Actualizando partner existente con campos:`, JSON.stringify(valuesToUpdate, null, 2));
      await executeKw({
        model: 'res.partner',
        method: 'write',
        args: [[partnerId], valuesToUpdate]
      });
      return { partnerId, action: 'updated' };
    } else {
      console.log(`[Odoo DEBUG] Partner existente ya tiene todos los datos, no se actualiza`);
      return { partnerId, action: 'no_changes' };
    }
  }

  console.log(`[Odoo DEBUG] Creando nuevo partner`);
  console.log(`[Odoo DEBUG] Valores a crear:`, JSON.stringify(values, null, 2));
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

async function journalExists(journalId) {
  try {
    const res = await executeKw({
      model: 'account.journal',
      method: 'read',
      args: [[journalId], ['id', 'name', 'type', 'active']]
    });
    return Array.isArray(res) && res.length > 0;
  } catch (_) {
    return false;
  }
}

async function findJournalIdByName({ name, type = null }) {
  const domain = [];
  if (name) domain.push(['name', '=', name]);
  if (type) domain.push(['type', '=', type]);
  const ids = await executeKw({
    model: 'account.journal',
    method: 'search',
    args: [domain],
    kwargs: { limit: 1 }
  });
  return Array.isArray(ids) && ids.length > 0 ? ids[0] : null;
}

async function findJournalIdByNameLike({ nameLike, type = null }) {
  const domain = [];
  if (nameLike) domain.push(['name', 'ilike', nameLike]);
  if (type) domain.push(['type', '=', type]);
  const ids = await executeKw({
    model: 'account.journal',
    method: 'search',
    args: [domain],
    kwargs: { limit: 1 }
  });
  return Array.isArray(ids) && ids.length > 0 ? ids[0] : null;
}

async function getJournalIdForTipo(documentoTipo) {
  const tipo = mapDocumentoTipo(documentoTipo);

  // Permitir override por variables de entorno
  if ((tipo === 'boleta' || tipo === 'factura') && process.env.ODOO_JOURNAL_SALES_ID) {
    return parseInt(process.env.ODOO_JOURNAL_SALES_ID, 10);
  }
  if (tipo === 'invoice' && process.env.ODOO_JOURNAL_INVOICE_ID) {
    return parseInt(process.env.ODOO_JOURNAL_INVOICE_ID, 10);
  }

  // Boleta y Factura: usar el diario "Ventas"
  if (tipo === 'boleta' || tipo === 'factura') {
    const salesJournalName = process.env.ODOO_JOURNAL_SALES_NAME || 'Ventas';
    const byName =
      (await findJournalIdByName({ name: salesJournalName, type: 'sale' })) ||
      (await findJournalIdByNameLike({ nameLike: salesJournalName, type: 'sale' })) ||
      (await findJournalIdByNameLike({ nameLike: 'Ventas', type: 'sale' })) ||
      (await findJournalIdByNameLike({ nameLike: 'Sale', type: 'sale' }));

    if (byName) return byName;
    throw new Error(
      `No se encontró el diario de ventas '${salesJournalName}' para ${tipo}. ` +
      `Configura ODOO_JOURNAL_SALES_ID o ODOO_JOURNAL_SALES_NAME`
    );
  }

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
  console.log(`[Odoo] Emisión tipo=${tipo} usando journal_id=${journalId}`);

  const lineName = (process.env.ODOO_SERVICE_NAME || 'Servicio semanal de mantención de piscina');
  // El valor de la visita viene del cliente (precio_por_visita). Si viene precio en la visita, se usa como fallback.
  const priceUnit = Number(cliente.precio_por_visita ?? visita.precio ?? 0) || 0;

  // Usar fecha de hoy (sin hora) para evitar problemas de zona horaria
  const fechaHoy = new Date().toISOString().split('T')[0];

  const moveVals = {
    move_type: moveType,
    partner_id: partnerId,
    journal_id: journalId,
    invoice_date: fechaHoy,
    ref: `Visita ${visita.id} - Cliente ${cliente.id}`,
    invoice_line_ids: [[0, 0, {
      name: lineName,
      product_id: productId,
      quantity: 1,
      price_unit: priceUnit
    }]]
  };

  // Clase de documento Chile (si está instalado l10n_latam/l10n_cl)
  // Factura: 33, Boleta: 39
  if (tipo === 'factura') {
    const id = process.env.ODOO_DOC_TYPE_FACTURA_ID
      ? parseInt(process.env.ODOO_DOC_TYPE_FACTURA_ID, 10)
      : await getLatamDocumentTypeIdByCode('33');
    if (id) moveVals.l10n_latam_document_type_id = id;
  }
  if (tipo === 'boleta') {
    const id = process.env.ODOO_DOC_TYPE_BOLETA_ID
      ? parseInt(process.env.ODOO_DOC_TYPE_BOLETA_ID, 10)
      : await getLatamDocumentTypeIdByCode('39');
    if (id) moveVals.l10n_latam_document_type_id = id;
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

// Leer estado de pago desde Odoo
async function getPaymentStateFromOdoo(moveId) {
  try {
    const [move] = await executeKw({
      model: 'account.move',
      method: 'read',
      args: [[moveId], ['name', 'payment_state', 'state']]
    });

    return {
      moveId,
      name: move?.name,
      payment_state: move?.payment_state || null,
      state: move?.state || null
    };
  } catch (error) {
    console.error(`[Odoo] Error leyendo estado de pago para move_id ${moveId}:`, error);
    throw error;
  }
}

module.exports = {
  getOdooConfig,
  testConnection,
  upsertPartnerFromCliente,
  createInvoiceForVisit,
  getPaymentStateFromOdoo
};


