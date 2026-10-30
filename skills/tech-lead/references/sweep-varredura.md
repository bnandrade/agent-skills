# Varredura de superfície — comandos concretos

Fase 1 do workflow. Barato, mecânico, roda em minutos e aponta *onde* a varredura profunda deve começar. Nada aqui prova um problema — só levanta sinais. Confirmação e severidade vêm nas Fases 2–3, com as skills especializadas.

Adaptar ao stack do projeto (Laravel/PHP, React/TS, React Native, Go). Rodar da raiz do repo.

---

## 1. Tamanho e forma do codebase

```bash
# Linhas por linguagem (precisa de cloc; senão, use o git ls-files abaixo)
cloc --vcs=git .

# Sem cloc: arquivos por extensão, ordenados por quantidade
git ls-files | sed 's/.*\.//' | sort | uniq -c | sort -rn | head -20

# Arquivos gigantes (candidatos a God Object) — top 25 por linhas
git ls-files | grep -E '\.(php|ts|tsx|js|jsx|go|py|vue)$' \
  | xargs wc -l 2>/dev/null | sort -rn | head -26
```

Regra de bolso: arquivo de código > 400 linhas ou função > 50 linhas é candidato a dívida — anota, não conclui.

---

## 2. Hotspots — churn × complexidade

O sinal mais valioso. Bug e dívida moram onde **arquivo muito mexido** encontra **arquivo complexo**. Um arquivo feio que ninguém toca há 2 anos não é prioridade; um arquivo feio que muda toda semana é uma sangria.

```bash
# CHURN: arquivos mais modificados no último ano (nº de commits que os tocaram)
git log --since="1 year ago" --name-only --pretty=format: \
  | grep -E '\.(php|ts|tsx|js|jsx|go|py|vue)$' \
  | sort | uniq -c | sort -rn | head -25
```

Cruze o top de churn com o top de tamanho/complexidade (seção 1). A **interseção** é o alvo nº 1 das Fases 2 e 3. Se um arquivo aparece nas duas listas, comece por ele.

```bash
# Churn recente + curto prazo: o que está "quente" AGORA (últimos 90 dias)
git log --since="90 days ago" --name-only --pretty=format: \
  | grep -E '\.(php|ts|tsx|js|jsx|go|py)$' \
  | sort | uniq -c | sort -rn | head -15
```

---

## 3. Sinais rápidos de dívida

```bash
# Marcadores de dívida deixados no código
git grep -nE '\b(TODO|FIXME|HACK|XXX|WORKAROUND|@deprecated)\b' | head -50
git grep -nE '\b(TODO|FIXME|HACK)\b' | wc -l   # placar bruto

# Debug esquecido (vira SEC se logar dado sensível)
git grep -nE '\b(dd|dump|var_dump|ray)\s*\(' -- '*.php'
git grep -nE 'console\.(log|debug|error)\(' -- '*.ts' '*.tsx' '*.js' '*.jsx'
git grep -nE 'fmt\.Print(ln|f)?\(' -- '*.go'

# Código morto / comentado em bloco (heurística)
git grep -nE '^\s*//.*\b(function|class|def|func)\b' | head -20
```

---

## 4. Sinais rápidos de segurança

Não substitui `app-pentest`/`security-best-practices` — só levanta onde olhar.

```bash
# Segredos hardcoded (revisar manualmente os hits — muito falso-positivo)
git grep -nE '(api[_-]?key|secret|password|passwd|token|bearer|private[_-]?key)\s*[:=]' \
  -- ':!*.md' ':!*.lock' ':!*test*' | head -40

# Segredo commitado por engano no histórico (não só no HEAD)
git log -p --all -S 'BEGIN RSA PRIVATE KEY' --oneline | head

# SQL montado por concatenação (candidato a SQLi)
git grep -nE '(query|execute|raw|DB::(select|statement|raw))\(.*\$' -- '*.php'
git grep -nE 'Sprintf\(.*(SELECT|INSERT|UPDATE|DELETE)' -- '*.go'

# Render sem escape (candidato a XSS)
git grep -nE '\{!!|v-html|dangerouslySetInnerHTML' -- '*.blade.php' '*.vue' '*.tsx' '*.jsx'

# .env / arquivos sensíveis versionados por engano
git ls-files | grep -E '(\.env$|\.env\.|\.pem$|\.p12$|id_rsa|credentials)'
```

---

## 5. Dependências (dívida + CVE)

```bash
# PHP / Composer
composer outdated --direct
composer audit                       # CVEs conhecidas

# Node / npm
npm outdated
npm audit --omit=dev

# Go
go list -m -u all | grep '\['         # módulos com update disponível
govulncheck ./...                    # CVEs (se instalado)
```

Dependência com CVE conhecida = item `SEC`. Dependência muito atrasada em major = item `DEBT-dependência` (juros crescem: quanto mais atrasa, mais caro o upgrade).

---

## 6. Cobertura de teste por área

O objetivo não é % global — é **onde falta teste em código de alto churn/alto risco** (o cruzamento perigoso).

```bash
# Existe suíte? Roda? (gate de qualquer paydown depois)
composer test 2>/dev/null || php artisan test 2>/dev/null   # Laravel
npm test 2>/dev/null                                         # Node
go test ./... 2>/dev/null                                    # Go

# Razão teste:código por pasta (heurística grosseira de cobertura)
echo "cod:"  && git ls-files 'app/**/*.php'   | wc -l
echo "test:" && git ls-files 'tests/**/*.php' | wc -l
```

Hotspot da seção 2 **sem** teste correspondente → item `DEBT-teste` de alta prioridade: é onde uma mudança quebra silenciosamente.

---

## Saída da Fase 1

Uma lista curta de **alvos**, não conclusões:
- 3–8 hotspots (arquivo:área) da interseção churn × complexidade → entram nas Fases 2–3.
- Sinais de segurança para o `app-pentest` confirmar.
- Dependências com CVE / muito atrasadas.
- Buracos de teste em código quente.

Isso vira o roteiro das varreduras profundas. Não pontue severidade ainda — só aponte o dedo.
