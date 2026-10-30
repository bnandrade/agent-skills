#!/usr/bin/env bash
# Roda toda a validação do repositório que pode ser executada sem um LLM.
#   ./tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== Gauntlet: harness + configuração (node --test)"
node --test tests/gauntlet/*.test.mjs

echo
echo "== Gauntlet: instalador (sandbox)"
bash tests/gauntlet/install.test.sh

echo
echo "== Skills juridicas: estrutura, fronteira e fontes (node --test)"
node --test tests/juridico/*.test.mjs
