#!/usr/bin/env bash
# Lance le backend Django en local.
# Usage : bash run_local.sh [port]   (défaut : 8000)
set -e

PORT="${1:-8000}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# ── 1. Venv ─────────────────────────────────────────────────────────────────
if [ ! -d "venv" ]; then
  echo "── Création du venv ────────────────────────────────────"
  python -m venv venv
fi

# Windows Git Bash : Scripts/activate  |  Linux/Mac : bin/activate
if [ -f "venv/Scripts/activate" ]; then
  # shellcheck disable=SC1091
  source venv/Scripts/activate
else
  # shellcheck disable=SC1091
  source venv/bin/activate
fi

# ── 2. Dépendances ──────────────────────────────────────────────────────────
echo "── Installation des dépendances ────────────────────────"
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt

# ── 3. Vérification du .env ─────────────────────────────────────────────────
if [ ! -f ".env" ]; then
  echo "⚠  Fichier .env introuvable — copie .env.example en .env"
  cp .env.example .env
  echo "   Édite backend/.env et relance ce script."
  exit 1
fi

# ── 4. Migrations ───────────────────────────────────────────────────────────
echo "── Migrations ──────────────────────────────────────────"
python manage.py migrate

# ── 5. Runserver ─────────────────────────────────────────────────────────────
echo "── Serveur de dev → http://localhost:${PORT} ────────────"
python manage.py runserver "127.0.0.1:${PORT}"
