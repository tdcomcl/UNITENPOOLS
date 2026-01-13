# Conexión a la Base de Datos con Navicat

## Información de la Base de Datos

- **Tipo**: SQLite
- **Ubicación**: `/root/proyectos/UNITENPOOLS/piscinas.db`
- **Tamaño**: ~292 KB

## Pasos para Conectarse desde Navicat

### 1. Abrir Navicat
   - Abre Navicat en tu computadora

### 2. Crear Nueva Conexión SQLite
   - Haz clic en **"Connection"** (Conexión) en el menú superior
   - Selecciona **"SQLite"** del menú desplegable

### 3. Configurar la Conexión
   En la ventana de configuración:
   
   - **Connection Name** (Nombre de Conexión): `UNITENPOOLS` (o el nombre que prefieras)
   - **Database File** (Archivo de Base de Datos): 
     - Haz clic en el botón **"..."** (Browse)
     - Navega hasta: `/root/proyectos/UNITENPOOLS/piscinas.db`
     - O escribe la ruta completa: `/root/proyectos/UNITENPOOLS/piscinas.db`

### 4. Probar y Guardar
   - Haz clic en **"Test Connection"** (Probar Conexión) para verificar
   - Si todo está bien, haz clic en **"OK"** para guardar la conexión

### 5. Conectarse
   - Doble clic en la conexión creada para conectarte
   - Verás todas las tablas de la base de datos:
     - `clientes`
     - `responsables`
     - `visitas`
     - `asignaciones_semanales`
     - `usuarios`

## Notas Importantes

⚠️ **Si estás en Windows/Mac y la base de datos está en un servidor Linux:**

Tienes dos opciones:

### Opción A: Copiar la base de datos localmente
```bash
# Desde el servidor, copiar la base de datos a tu máquina local
scp root@tu-servidor:/root/proyectos/UNITENPOOLS/piscinas.db /ruta/local/
```

### Opción B: Usar SSH Tunnel (si Navicat lo soporta)
   - Configura un túnel SSH al servidor
   - Monta el directorio remoto como unidad local
   - Usa la ruta montada en Navicat

### Opción C: Usar Navicat con soporte remoto
   - Algunas versiones de Navicat pueden acceder a sistemas de archivos remotos
   - Requiere configuración adicional de red

## Tablas Disponibles

Una vez conectado, podrás ver y editar:

1. **clientes** - Todos los clientes del sistema
2. **responsables** - Los responsables de mantenimiento
3. **visitas** - Historial de visitas realizadas
4. **asignaciones_semanales** - Asignaciones por semana
5. **usuarios** - Usuarios del sistema

## Comandos Útiles

Si necesitas copiar la base de datos desde el servidor:

```bash
# Copiar la base de datos completa
scp root@servidor:/root/proyectos/UNITENPOOLS/piscinas.db ./

# O si solo necesitas ver el contenido sin copiarlo:
# Usa SSH y sqlite3 directamente en el servidor
```
