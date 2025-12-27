#!/bin/bash
# Script para detener procesos en el puerto 3000 y reiniciar PM2

echo "Deteniendo procesos en el puerto 3000..."
# Buscar y detener procesos que usan el puerto 3000
lsof -ti:3000 | xargs kill -9 2>/dev/null || echo "No hay procesos usando el puerto 3000"

echo "Deteniendo todas las instancias de PM2 de piscinas-alagrando..."
pm2 delete piscinas-alagrando 2>/dev/null || echo "No hay instancias de PM2 para eliminar"

echo "Iniciando aplicación con PM2..."
pm2 start ecosystem.config.js

echo "Estado de PM2:"
pm2 status

echo "Listo! Verifica con: pm2 logs piscinas-alagrando"

