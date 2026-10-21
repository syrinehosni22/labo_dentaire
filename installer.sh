#!/usr/bin/env bash
# Laboratoire dentaire : installation des dépendances (macOS / Linux)
set -e
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Node.js n'est pas installé : https://nodejs.org (version 18 ou plus)"; exit 1; }
node -e "process.exit(Number(process.versions.node.split('.')[0])>=18?0:1)" || { echo "Node.js 18 ou plus est requis (actuel : $(node -v))"; exit 1; }
echo "[1/2] Serveur…";   (cd server && npm install)
echo "[2/2] Interface…"; (cd client && npm install)
[ -f server/.env ] || { cp server/.env.example server/.env; echo "server/.env créé à partir du modèle : pensez à renseigner JWT_SECRET."; }
echo "Vérification de MongoDB…"; (cd server && npm run -s check:db) || echo "→ Démarrez MongoDB avant de lancer le serveur (voir README)."
echo "Installation terminée. Lancez : npm run dev:server   puis, dans un autre terminal : npm run dev:client"
