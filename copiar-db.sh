#!/bin/bash
# Script para copiar la base de datos completa al servidor

SERVIDOR="root@10.10.10.81"
RUTA_SERVIDOR="/root/proyectos/UNITENPOOLS"
DB_LOCAL="piscinas.db"

echo "=== Copiando base de datos al servidor ==="
echo ""
echo "Servidor: $SERVIDOR"
echo "Ruta en servidor: $RUTA_SERVIDOR"
echo ""

# Verificar que existe la base de datos local
if [ ! -f "$DB_LOCAL" ]; then
    echo "❌ Error: No se encuentra $DB_LOCAL en el directorio actual"
    exit 1
fi

echo "✓ Base de datos local encontrada: $DB_LOCAL"
echo "Tamaño: $(du -h $DB_LOCAL | cut -f1)"
echo ""

# Hacer backup en el servidor antes de copiar
echo "1. Creando backup en el servidor..."
ssh $SERVIDOR "cd $RUTA_SERVIDOR && cp piscinas.db piscinas.db.backup.$(date +%Y%m%d_%H%M%S) 2>/dev/null || echo 'No hay base de datos previa para hacer backup'"

# Copiar la base de datos
echo "2. Copiando base de datos al servidor..."
scp $DB_LOCAL $SERVIDOR:$RUTA_SERVIDOR/

if [ $? -eq 0 ]; then
    echo "✓ Base de datos copiada exitosamente"
    echo ""
    echo "3. Verificando en el servidor..."
    ssh $SERVIDOR "cd $RUTA_SERVIDOR && ls -lh piscinas.db && echo '' && echo 'Reiniciando PM2...' && pm2 restart piscinas-alagrando"
    echo ""
    echo "✓ Proceso completado!"
    echo ""
    echo "La base de datos en el servidor ahora tiene los mismos datos que la local."
else
    echo "❌ Error al copiar la base de datos"
    exit 1
fi

