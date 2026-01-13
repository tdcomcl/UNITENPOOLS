# Instrucciones de Migración a PostgreSQL

## Pasos para Migrar de SQLite a PostgreSQL

### 1. Instalar PostgreSQL

#### En Ubuntu/Debian:
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

#### Verificar instalación:
```bash
sudo -u postgres psql --version
```

### 2. Crear Base de Datos y Usuario

```bash
# Entrar a PostgreSQL como usuario postgres
sudo -u postgres psql

# Crear base de datos
CREATE DATABASE unitenpools;

# Crear usuario
CREATE USER unitenpools_user WITH PASSWORD 'tu_password_seguro_aqui';

# Dar permisos
GRANT ALL PRIVILEGES ON DATABASE unitenpools TO unitenpools_user;

# En PostgreSQL 15+, también necesitas:
\c unitenpools
GRANT ALL ON SCHEMA public TO unitenpools_user;

# Salir
\q
```

### 3. Instalar Dependencias Node.js

```bash
cd /root/proyectos/UNITENPOOLS
npm install
```

Esto instalará el paquete `pg` necesario para PostgreSQL.

### 4. Configurar Variables de Entorno

Edita tu archivo `.env` (o cópialo desde `env.example`):

```bash
cp env.example .env
nano .env
```

Agrega o actualiza las siguientes variables:

```env
# Base de Datos - PostgreSQL
DB_TYPE=postgresql
DB_HOST=localhost
DB_PORT=5432
DB_NAME=unitenpools
DB_USER=unitenpools_user
DB_PASSWORD=tu_password_seguro_aqui
```

### 5. Ejecutar Script de Migración

```bash
node scripts/migrar-a-postgresql.js
```

Este script:
1. ✅ Conecta a PostgreSQL
2. ✅ Crea el esquema (tablas, índices, triggers)
3. ✅ Migra todos los datos de SQLite a PostgreSQL
4. ✅ Verifica la integridad de los datos

### 6. Verificar Migración

El script mostrará un resumen al final:
```
📊 Resumen:
  Responsables: X
  Usuarios: X
  Clientes: X
  Visitas: X
  Asignaciones: X
```

### 7. Probar la Aplicación

```bash
# Detener el servidor si está corriendo
npm run pm2:stop

# Reiniciar con nueva configuración
npm run pm2:start

# Ver logs
npm run pm2:logs
```

O en desarrollo:
```bash
npm start
```

### 8. Probar Funcionalidades

1. Iniciar sesión
2. Ver clientes
3. Ver asignaciones
4. Registrar una visita
5. Verificar que todo funciona

## Revertir a SQLite (si es necesario)

Si necesitas volver a SQLite:

1. Edita `.env`:
```env
DB_TYPE=sqlite
# DB_PATH=piscinas.db  (opcional, por defecto usa piscinas.db)
```

2. Reinicia el servidor

## Verificar Conexión con Navicat

Una vez migrado a PostgreSQL, puedes conectarte con Navicat:

1. Abre Navicat
2. Nueva conexión → PostgreSQL
3. Configuración:
   - **Host**: localhost (o IP del servidor)
   - **Port**: 5432
   - **Database**: unitenpools
   - **User**: unitenpools_user
   - **Password**: tu_password

## Solución de Problemas

### Error: "no such database"
- Verifica que la base de datos existe: `psql -l | grep unitenpools`
- Si no existe, créala: `CREATE DATABASE unitenpools;`

### Error: "password authentication failed"
- Verifica el usuario y contraseña en `.env`
- Verifica que el usuario tiene permisos: `GRANT ALL PRIVILEGES ON DATABASE unitenpools TO unitenpools_user;`

### Error: "relation does not exist"
- El esquema no se creó correctamente
- Ejecuta manualmente: `psql -U unitenpools_user -d unitenpools -f schema_postgresql.sql`

### Error: "connection refused"
- Verifica que PostgreSQL está corriendo: `sudo systemctl status postgresql`
- Verifica que el puerto 5432 está abierto: `sudo netstat -tulpn | grep 5432`

### Error en la migración de datos
- Revisa los logs del script
- Verifica que los datos en SQLite están correctos
- Puedes ejecutar el script múltiples veces (usa `ON CONFLICT DO NOTHING`)

## Backups

**IMPORTANTE**: Antes de migrar, haz backup de tu SQLite:

```bash
cp piscinas.db piscinas.db.backup
```

Después de migrar, también haz backup de PostgreSQL:

```bash
pg_dump -U unitenpools_user unitenpools > backup_unitenpools_$(date +%Y%m%d).sql
```

## Ventajas de PostgreSQL

- ✅ Mejor concurrencia (múltiples usuarios simultáneos)
- ✅ Más robusto para producción
- ✅ Mejor soporte en Navicat y otras herramientas
- ✅ Escalabilidad mejorada
- ✅ Más características avanzadas (triggers, funciones, etc.)

## Soporte

Si encuentras problemas durante la migración, revisa:
1. Los logs del script de migración
2. Los logs de PostgreSQL: `/var/log/postgresql/`
3. Los logs de la aplicación: `npm run pm2:logs`
