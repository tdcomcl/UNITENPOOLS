# Guía de Despliegue en Servidor

## Instalación en Servidor (10.10.10.81)

### 1. Conectarse al servidor
```bash
ssh usuario@10.10.10.81
```

### 2. Instalar Node.js (si no está instalado)
```bash
# Verificar si Node.js está instalado
node --version

# Si no está instalado, instalar Node.js 18 LTS
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verificar instalación
node --version
npm --version
```

### 3. Instalar PM2 globalmente
```bash
sudo npm install -g pm2
```

### 4. Clonar el repositorio
```bash
# Ir a la carpeta donde quieres clonar (ej: /var/www o /home/usuario)
cd /var/www  # o la ruta que prefieras

# Clonar el repositorio
git clone https://github.com/tdcomcl/UNITENPOOLS.git
cd UNITENPOOLS
```

### 5. Instalar dependencias
```bash
npm install
```

### 5.1 Configurar variables de entorno (recomendado)

```bash
cp env.example .env
nano .env
```

### 6. Importar datos (opcional, si tienes el archivo Excel)
```bash
# Si tienes el archivo Excel en el servidor
npm run import

# O importar manualmente copiando el archivo Excel
```

### 7. Crear usuarios iniciales
```bash
npm run crear-usuarios
```

### 8. Crear directorio de logs
```bash
mkdir -p logs
```

### 9. Iniciar con PM2
```bash
# Iniciar la aplicación
npm run pm2:start

# O directamente:
pm2 start ecosystem.config.js
```

### 10. Configurar PM2 para iniciar automáticamente
```bash
# Guardar la configuración actual de PM2
pm2 save

# Configurar PM2 para iniciar en el arranque del sistema
pm2 startup

# Seguir las instrucciones que aparezcan (copiar y ejecutar el comando que muestre)
```

## Comandos PM2 Útiles

```bash
# Ver estado de la aplicación
npm run pm2:status
# o
pm2 status

# Ver logs en tiempo real
npm run pm2:logs
# o
pm2 logs piscinas-alagrando

# Reiniciar la aplicación
npm run pm2:restart
# o
pm2 restart piscinas-alagrando

# Detener la aplicación
npm run pm2:stop
# o
pm2 stop piscinas-alagrando

# Eliminar la aplicación de PM2
npm run pm2:delete
# o
pm2 delete piscinas-alagrando

# Ver información detallada
pm2 info piscinas-alagrando

# Ver uso de recursos
pm2 monit
```

## Actualizar la Aplicación

Cuando necesites actualizar el código en el servidor:

```bash
cd /var/www/UNITENPOOLS  # o la ruta donde clonaste
git pull
npm install  # solo si hay cambios en package.json
npm run pm2:restart
```

## Configurar Firewall (si es necesario)

Si necesitas abrir el puerto 3000:

```bash
# UFW (Ubuntu)
sudo ufw allow 3000/tcp

# O iptables
sudo iptables -A INPUT -p tcp --dport 3000 -j ACCEPT
```

## Usar Nginx como Proxy Reverso (Recomendado)

Para usar un dominio y HTTPS, configura Nginx:

```nginx
server {
    listen 80;
    server_name tu-dominio.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## Solución de Problemas

### Ver logs de errores
```bash
pm2 logs piscinas-alagrando --err
```

### Ver logs de salida
```bash
pm2 logs piscinas-alagrando --out
```

### Reiniciar PM2 completamente
```bash
pm2 kill
pm2 resurrect
```

