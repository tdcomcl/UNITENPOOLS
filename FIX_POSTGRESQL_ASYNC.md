# Fix: Convertir server.js a async/await para PostgreSQL

## Problema

Cuando se migra a PostgreSQL, todas las funciones de la base de datos son `async` (retornan Promises), pero `server.js` las está llamando como si fueran síncronas.

## Solución

Necesitamos convertir todas las rutas en `server.js` que llaman funciones de la base de datos para que sean `async` y usen `await`.

## Rutas ya corregidas

- ✅ `/api/login` - Convertido a async/await

## Rutas que necesitan corrección

Todas las rutas que llaman funciones de `db.*` necesitan ser convertidas. Ejemplos:

### Autenticación y usuarios:
- `/api/usuarios` (GET) - `db.obtenerUsuarios()`
- `/api/usuarios` (POST) - `db.crearUsuario()`
- `/api/session` - Ya no necesita cambio (no llama DB)

### Responsables:
- `/api/responsables` (GET) - `db.obtenerResponsables()`
- `/api/responsables` (POST) - `db.agregarResponsable()`

### Clientes:
- `/api/clientes` (GET) - `db.obtenerClientes()`
- `/api/clientes/export` (GET) - `db.obtenerClientes()`
- `/api/clientes/import` (POST) - `db.agregarResponsable()`, `db.obtenerClientePorId()`, `db.actualizarCliente()`, `db.agregarCliente()`
- `/api/clientes/:id` (GET) - `db.obtenerClientePorId()`
- `/api/clientes` (POST) - `db.agregarCliente()`
- `/api/clientes/:id` (PUT) - `db.obtenerClientePorId()`, `db.actualizarCliente()`
- `/api/clientes/:id` (DELETE) - `db.obtenerClientePorId()`, `db.actualizarCliente()`

### Odoo:
- `/api/odoo/clientes/:id/sync` (POST) - `db.obtenerClientePorId()`, `db.actualizarCliente()`

### Asignaciones:
- `/api/asignaciones/:semana` (GET) - `db.obtenerAsignacionesSemana()`
- `/api/asignaciones/semana-actual` (GET) - `db.obtenerSemanaActual()`, `db.obtenerAsignacionesSemana()`
- `/api/asignaciones/asignar-semana-actual` (POST) - `db.obtenerSemanaActual()`, `db.asignarClientesSemana()`
- `/api/asignaciones/:id` (PUT) - `db.db.prepare()`, `db.obtenerClientePorId()`, `db.actualizarAsignacion()`, `db.registrarVisita()`, `db.actualizarVisita()`

### Visitas:
- `/api/clientes/:id/visitas` (GET) - `db.obtenerClientePorId()`, `db.obtenerVisitasCliente()`
- `/api/visitas` (POST) - `db.obtenerClientePorId()`, `db.registrarVisita()`, `db.actualizarCliente()`, `db.actualizarVisita()`

### Estadísticas:
- `/api/estadisticas` (GET) - `db.obtenerEstadisticas()`
- `/api/progreso/:semana` (GET) - `db.obtenerProgresoPorResponsable()`
- `/api/notas/:semana` (GET) - `db.obtenerAsignacionesConNotas()`

## Patrón de conversión

### Antes (síncrono):
```javascript
app.get('/api/ruta', requireAuth, (req, res) => {
  try {
    const datos = db.obtenerDatos();
    res.json(datos);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

### Después (async/await):
```javascript
app.get('/api/ruta', requireAuth, async (req, res) => {
  try {
    const datos = await db.obtenerDatos();
    res.json(datos);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

## Nota importante

Para mantener compatibilidad con SQLite (que usa funciones síncronas), podrías hacer que database.js siempre retorne Promises, incluso en SQLite. Pero esto requeriría cambios más grandes en database.js.

La solución más simple por ahora es convertir todas las rutas a async/await, que funcionará tanto con SQLite como con PostgreSQL (las Promises se resuelven inmediatamente si la función es síncrona).

## Estado actual

- ✅ Login funciona
- ⚠️ Otras rutas probablemente necesitan corrección también

Para verificar qué rutas fallan, revisa los logs del servidor cuando uses la aplicación.
