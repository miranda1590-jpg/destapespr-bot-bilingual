#!/bin/bash
# 🚫 Script para liberar el puerto 3000 si está ocupado

PORT=${1:-3000}

echo "🔍 Buscando procesos en el puerto $PORT..."
PID=$(lsof -ti tcp:$PORT)

if [ -n "$PID" ]; then
  echo "🧨 Terminando proceso $PID en puerto $PORT..."
  kill -9 $PID 2>/dev/null
  echo "✅ Puerto $PORT liberado."
else
  echo "✅ Puerto $PORT ya está libre."
fi
