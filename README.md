# Sistema de Mantenimiento de Piscinas

Sistema web moderno para gestión de mantenimiento de piscinas. Aplicación web con Node.js, Express y SQLite que permite asignar responsables, gestionar días de mantenimiento, precios por visita y asignaciones semanales.

## Características

- ✅ Gestión de clientes con información completa (nombre, dirección, comuna, celular)
- ✅ Gestión de responsables
- ✅ Asignación de días de mantenimiento por cliente
- ✅ Precio por visita configurable por cliente
- ✅ Asignaciones semanales de clientes
- ✅ Historial de visitas realizadas
- ✅ Importación de datos desde Excel

## Instalación

1. Asegúrate de tener Node.js 16 o superior instalado.

2. Instala las dependencias:
```bash
npm install
```

3. (Opcional) Importa tus datos desde Excel:
```bash
npm run import
```

O manualmente:
```bash
node scripts/importar-excel.js "Base de Datos United al 28 oct 2025.xlsx"
```

## Uso

### Iniciar el servidor

```bash
npm start
```

O en modo desarrollo (con auto-recarga):

```bash
npm run dev
```

Luego abre tu navegador en: **http://localhost:3000**

### Importar datos desde Excel

Si aún no has importado tus datos:

```bash
npm run import
```

Este script:
- Lee todos los clientes del Excel
- Crea responsables únicos automáticamente
- Importa todos los datos (dirección, comuna, celular, responsable, día de atención, precio)

### Funcionalidades disponibles

La aplicación web incluye:

1. **Dashboard** - Vista general con estadísticas y acciones rápidas
2. **Clientes** - Gestión completa de clientes:
   - Ver todos los clientes
   - Buscar y filtrar por día
   - Agregar nuevos clientes
   - Editar clientes existentes
   - Registrar visitas realizadas
3. **Asignaciones Semanales** - Gestión de asignaciones:
   - Ver asignaciones de cualquier semana
   - Asignar todos los clientes a la semana actual
   - Marcar visitas como realizadas
   - Vista agrupada por día de la semana
4. **Responsables** - Gestión de responsables técnicos

## Estructura de la Base de Datos

La base de datos SQLite (`piscinas.db`) contiene las siguientes tablas:

### `responsables`
- `id` - ID único
- `nombre` - Nombre del responsable
- `activo` - Si está activo o no
- `created_at` - Fecha de creación

### `clientes`
- `id` - ID único
- `nombre` - Nombre del cliente
- `direccion` - Dirección
- `comuna` - Comuna
- `celular` - Número de celular
- `responsable_id` - ID del responsable asignado
- `dia_atencion` - Día de la semana para mantenimiento
- `precio_por_visita` - Precio por cada visita
- `activo` - Si está activo o no
- `notas` - Notas adicionales
- `created_at` - Fecha de creación
- `updated_at` - Fecha de última actualización

### `visitas`
- `id` - ID único
- `cliente_id` - ID del cliente
- `fecha_visita` - Fecha de la visita
- `responsable_id` - ID del responsable
- `precio` - Precio cobrado
- `realizada` - Si la visita fue realizada
- `notas` - Notas adicionales
- `created_at` - Fecha de creación

### `asignaciones_semanales`
- `id` - ID único
- `semana_inicio` - Fecha de inicio de la semana (lunes)
- `cliente_id` - ID del cliente
- `responsable_id` - ID del responsable
- `dia_atencion` - Día de atención
- `precio` - Precio de la visita
- `asignada` - Si está asignada
- `realizada` - Si fue realizada
- `notas` - Notas adicionales
- `created_at` - Fecha de creación

## Flujo de trabajo semanal

1. **Cada lunes**: Desde el Dashboard o la sección de Asignaciones, haz clic en "Asignar Clientes a Semana Actual"
2. **Durante la semana**: Consulta las asignaciones en la sección "Asignaciones" - están agrupadas por día
3. **Después de cada visita**: Marca la casilla de "Realizada" en la asignación correspondiente, o usa el botón "Registrar Visita" desde la sección de Clientes
4. **Gestionar**: Agrega nuevos clientes, edita información o crea responsables desde sus respectivas secciones

## Características técnicas

- **Backend**: Node.js con Express.js
- **Base de datos**: SQLite con better-sqlite3
- **Frontend**: HTML5, CSS3, JavaScript vanilla (sin frameworks)
- **API REST**: Endpoints para todas las operaciones
- **Autenticación**: Sistema de login con sesiones
- **Control de acceso**: Cada responsable solo ve sus asignaciones y clientes
- **Diseño**: Responsive y moderno, funciona en móviles y tablets
- **Importación**: Soporte para archivos Excel (.xlsx)

## Autenticación

El sistema incluye autenticación y control de acceso:

- **Administrador**: Puede ver y gestionar todo el sistema
- **Responsables**: Solo pueden ver sus propios clientes y asignaciones

### Crear usuarios

Después de importar tus datos, crea usuarios para cada responsable:

```bash
npm run crear-usuarios
```

Este script crea:
- Un usuario `admin` con password `admin` (administrador)
- Un usuario por cada responsable (username = nombre en minúsculas, password = username)

### Usuarios creados

Después de ejecutar el script, tendrás:
- **admin/admin** - Administrador (puede ver y gestionar todo)
- **jano/jano** - Responsable Jano (solo ve sus asignaciones)
- **mati/mati** - Responsable Mati (solo ve sus asignaciones)

### Cambiar contraseñas

Por seguridad, cambia las contraseñas después de la primera sesión. Puedes hacerlo directamente en la base de datos o agregar una funcionalidad de cambio de contraseña.

## Notas

- La base de datos se crea automáticamente la primera vez que ejecutas el sistema
- El archivo de base de datos se llama `piscinas.db` y se guarda en el mismo directorio
- Las asignaciones semanales usan la fecha del lunes de cada semana como referencia
- Puedes editar clientes para cambiar responsables, días de atención o precios en cualquier momento
- El servidor corre por defecto en el puerto 3000. Puedes cambiarlo con la variable de entorno `PORT`

## Estructura del proyecto

```
├── server.js              # Servidor Express y rutas API
├── database.js            # Lógica de base de datos SQLite
├── package.json           # Dependencias y scripts
├── public/                # Frontend
│   ├── index.html         # Página principal
│   ├── styles.css         # Estilos
│   └── app.js             # Lógica del frontend
├── scripts/
│   └── importar-excel.js  # Script de importación
└── piscinas.db           # Base de datos SQLite (se crea automáticamente)
```

## API Endpoints

- `GET /api/clientes` - Lista todos los clientes
- `GET /api/clientes/:id` - Obtiene un cliente específico
- `POST /api/clientes` - Crea un nuevo cliente
- `PUT /api/clientes/:id` - Actualiza un cliente
- `GET /api/responsables` - Lista todos los responsables
- `POST /api/responsables` - Crea un nuevo responsable
- `GET /api/asignaciones/semana-actual` - Obtiene asignaciones de la semana actual
- `GET /api/asignaciones/:semana` - Obtiene asignaciones de una semana específica
- `POST /api/asignaciones/asignar-semana-actual` - Asigna todos los clientes a la semana actual
- `PUT /api/asignaciones/:id` - Actualiza una asignación
- `POST /api/visitas` - Registra una visita
- `GET /api/estadisticas` - Obtiene estadísticas generales

