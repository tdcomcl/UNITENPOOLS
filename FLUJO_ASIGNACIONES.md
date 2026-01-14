# Flujo de Asignaciones Semanales y Visitas

## 📋 Resumen del Sistema

El sistema funciona con dos tablas principales relacionadas:

1. **`asignaciones_semanales`** - Planificación semanal de visitas
2. **`visitas`** - Registro real de visitas realizadas (con estado de pago)

## 🔄 Flujo Completo

### 1. Creación de Asignaciones Semanales

**Función:** `asignarClientesSemana(semanaInicio)`

**Cómo funciona:**
- Obtiene todos los clientes activos de la tabla `clientes`
- Para cada cliente, crea una entrada en `asignaciones_semanales` con:
  - `semana_inicio`: Fecha del lunes de la semana (formato YYYY-MM-DD)
  - `cliente_id`: ID del cliente
  - `responsable_id`: Responsable asignado al cliente
  - `dia_atencion`: Día de la semana (Lunes, Martes, etc.)
  - `precio`: Precio por visita del cliente
  - `realizada`: 0 (no realizada aún)
  - `visita_id`: NULL (aún no hay visita creada)

**Consulta SQL (PostgreSQL):**
```sql
INSERT INTO asignaciones_semanales
(semana_inicio, cliente_id, responsable_id, dia_atencion, precio)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (semana_inicio, cliente_id) 
DO UPDATE SET responsable_id = EXCLUDED.responsable_id, 
              dia_atencion = EXCLUDED.dia_atencion, 
              precio = EXCLUDED.precio
```

**Endpoint:** `POST /api/asignaciones/asignar-semana-actual`

### 2. Obtención de Asignaciones

**Función:** `obtenerAsignacionesSemana(semanaInicio, responsableId)`

**Cómo funciona:**
- Consulta la tabla `asignaciones_semanales` filtrando por:
  - `semana_inicio`: Fecha del lunes de la semana
  - `responsable_id`: (opcional) Si se proporciona, filtra por responsable
- Hace JOIN con `clientes` y `responsables` para obtener información completa
- Ordena por `dia_atencion` y `nombre` del cliente

**Consulta SQL:**
```sql
SELECT a.*, 
       c.nombre as cliente_nombre, 
       c.direccion, 
       c.comuna, 
       c.celular,
       r.nombre as responsable_nombre, 
       a.precio as precio
FROM asignaciones_semanales a
LEFT JOIN clientes c ON a.cliente_id = c.id
LEFT JOIN responsables r ON a.responsable_id = r.id
WHERE a.semana_inicio = $1
  [AND a.responsable_id = $2]  -- Si se proporciona responsableId
ORDER BY a.dia_atencion, c.nombre
```

**Endpoints:**
- `GET /api/asignaciones/:semana` - Obtiene asignaciones de una semana específica
- `GET /api/asignaciones/semana-actual` - Obtiene asignaciones de la semana actual

### 3. Marcar Asignación como Realizada

**Función:** `actualizarAsignacion(id, { realizada: 1 })`

**Cómo funciona:**
Cuando se marca una asignación como realizada (`realizada = 1`):

1. **Crea una visita** en la tabla `visitas`:
   - `cliente_id`: Del cliente de la asignación
   - `fecha_visita`: Fecha actual
   - `responsable_id`: Del responsable de la asignación
   - `precio`: Del precio de la asignación (o del cliente si es NULL)
   - `realizada`: 1
   - `odoo_payment_state`: NULL (aún no se ha emitido documento)

2. **Actualiza la asignación**:
   - `realizada`: 1
   - `visita_id`: ID de la visita creada

3. **Emite documento en Odoo** (si está configurado):
   - Crea factura/boleta en Odoo
   - Actualiza la visita con:
     - `odoo_move_id`: ID del documento en Odoo
     - `odoo_move_name`: Número del documento
     - `odoo_payment_state`: Estado de pago ('not_paid', 'paid', etc.)

**Endpoint:** `PUT /api/asignaciones/:id`

**Código relevante (server.js líneas 748-809):**
```javascript
if (realizada !== undefined && Number(realizada) === 1) {
  // 1) Crear visita si no existe
  if (!visitaId) {
    visitaId = await db.registrarVisita(
      asignacion.cliente_id, 
      hoy, 
      asignacion.responsable_id || null, 
      null, 
      true
    );
    await db.actualizarAsignacion(req.params.id, { visita_id: visitaId });
  }
  
  // 2) Emitir documento en Odoo
  if (visitaRow && !visitaRow.odoo_move_id) {
    // ... código de emisión Odoo ...
  }
}
```

### 4. Reporte de Visitas Sin Pagar

**Función:** `obtenerVisitasSinPagar(clienteId, responsableId)`

**Cómo funciona:**
- Consulta directamente la tabla `visitas` (NO la tabla de asignaciones)
- Filtra visitas que:
  - `realizada = 1` (visitas que fueron realizadas)
  - `odoo_payment_state` es NULL, vacío, 'not_paid', 'partial', o cualquier valor que NO sea 'paid' o 'in_payment'

**Consulta SQL:**
```sql
SELECT 
  v.id,
  v.cliente_id,
  v.fecha_visita,
  v.precio,
  v.odoo_move_name,
  v.odoo_payment_state,
  v.odoo_error,
  c.nombre as cliente_nombre,
  c.rut as cliente_rut,
  c.direccion as cliente_direccion,
  c.comuna as cliente_comuna,
  c.celular as cliente_celular,
  c.email as cliente_email,
  c.documento_tipo,
  r.nombre as responsable_nombre
FROM visitas v
LEFT JOIN clientes c ON v.cliente_id = c.id
LEFT JOIN responsables r ON v.responsable_id = r.id
WHERE v.realizada = 1 
  AND (
    v.odoo_payment_state IS NULL 
    OR v.odoo_payment_state = '' 
    OR v.odoo_payment_state = 'not_paid' 
    OR v.odoo_payment_state = 'partial'
    OR (v.odoo_payment_state IS NOT NULL 
        AND v.odoo_payment_state NOT IN ('paid', 'in_payment'))
  )
  [AND v.cliente_id = $1]      -- Si se proporciona clienteId
  [AND v.responsable_id = $2]  -- Si se proporciona responsableId
ORDER BY v.fecha_visita DESC, c.nombre
```

**Endpoints:**
- `GET /api/reportes/visitas-sin-pagar` - Obtiene visitas sin pagar en JSON
- `GET /api/reportes/visitas-sin-pagar/export` - Exporta a Excel

## 🔗 Relación entre Tablas

```
asignaciones_semanales
├── cliente_id → clientes.id
├── responsable_id → responsables.id
└── visita_id → visitas.id (cuando se marca como realizada)

visitas
├── cliente_id → clientes.id
└── responsable_id → responsables.id
```

## 📊 Estados de una Asignación

1. **Creada pero no realizada:**
   - `realizada = 0`
   - `visita_id = NULL`
   - No existe registro en `visitas`

2. **Marcada como realizada:**
   - `realizada = 1`
   - `visita_id = [ID de visita]`
   - Existe registro en `visitas` con `realizada = 1`
   - `odoo_payment_state` puede ser NULL o 'not_paid'

3. **Visita pagada:**
   - `visitas.odoo_payment_state = 'paid'`
   - No aparece en el reporte de visitas sin pagar

## ⚠️ Importante

- **Las asignaciones semanales** son la planificación (qué visitas se deben hacer)
- **Las visitas** son el registro real (qué visitas se hicieron y su estado de pago)
- **El reporte de visitas sin pagar** consulta directamente `visitas`, NO `asignaciones_semanales`
- Una asignación puede existir sin visita (si no se ha marcado como realizada)
- Una visita siempre debe tener una asignación asociada (a través de `visita_id`)

## 🔍 Para Depurar

Si no aparecen visitas en el reporte, verifica:

1. ¿Existen asignaciones marcadas como realizadas?
   ```sql
   SELECT * FROM asignaciones_semanales WHERE realizada = 1;
   ```

2. ¿Existen visitas creadas?
   ```sql
   SELECT * FROM visitas WHERE realizada = 1;
   ```

3. ¿Cuál es el estado de pago de las visitas?
   ```sql
   SELECT id, cliente_id, fecha_visita, odoo_payment_state 
   FROM visitas 
   WHERE realizada = 1;
   ```

4. ¿Las visitas tienen `odoo_payment_state` correcto?
   - NULL, '', 'not_paid', 'partial' → Aparecen en reporte
   - 'paid', 'in_payment' → NO aparecen en reporte
