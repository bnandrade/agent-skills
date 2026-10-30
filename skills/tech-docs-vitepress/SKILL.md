---
name: tech-docs-vitepress
description: Cria um site de documentação (VitePress) para um projeto existente, destilado do código/telas reais, em duas variantes — (1) documentação TÉCNICA, para outro programador dar continuidade; (2) GUIA DO USUÁRIO / documentação de produto não técnica, por perfil e com screenshots automatizados, para onboarding e handoff. Use quando o usuário pedir "criar documentação técnica", "documentar o projeto", "site de docs", "docs para entregar/handoff", "guia do usuário", "manual do produto", "documentação de produto", "central de ajuda", "onboarding de novo usuário", "montar a documentação em VitePress", ou similar. Cobre: setup do VitePress isolado, estrutura de capítulos (por arquitetura ou por perfil), fan-out de redatores que leem o código/telas como fonte de verdade, captura de screenshots reais via Puppeteer, as armadilhas de build do VitePress e o checklist de verificação. NÃO use para um único README/ADR (use create-adr), para docs de API autogeradas (OpenAPI/Scribe), nem para design/UX de interface (use impeccable/frontend-design).
license: CC-BY-4.0
metadata:
  author: Bruno Andrade
  version: 1.1.0
---

# Documentação técnica em VitePress

Playbook para transformar um projeto existente num **site de documentação técnica** navegável (VitePress) que um programador novo lê e consegue dar continuidade. Pensado para **handoff/entrega ao cliente**. O conteúdo é **descritivo do que existe no código**, não proposta de mudanças.

Comprovado num monolito Laravel + Livewire, mas o método é **stack-agnóstico** — só a seção de capítulos muda conforme o domínio.

**Duas variantes** (mesma mecânica de VitePress isolado + fan-out): a **técnica** (público = devs; organizada por arquitetura; passos 0–7 abaixo) e o **guia do usuário** (público = usuários finais; organizada por perfil; com screenshots reais — ver as duas últimas seções). As duas podem conviver como sites isolados na mesma pasta `docs/` (ex.: `docs/tecnica/` e `docs/guia-usuario/`).

## Princípios

1. **Fonte de verdade é o código.** Cada afirmação sai de um arquivo real (cite o caminho). Se não está no código, não afirme. Verifique divergências (ex.: um accessor que existe mas não é usado).
2. **Auto-suficiente quando for entrega.** A doc não deve depender de specs/planejamento internos nem repetir dado comercial (valores, prazos, contrato). Reescreva o conhecimento limpo.
3. **Build verde é o gate.** Termine só quando `npm run docs:build` passa, sem links quebrados nem interpolações que quebrem o Vue.
4. **Isole o VitePress** do build da aplicação (pasta + `package.json` + `node_modules` próprios).

## Passo 0 — Alinhar com o usuário (antes de escrever)

Pergunte (ou confirme) três coisas, porque mudam o resultado:

- **Formato**: site VitePress (sidebar/busca/dark mode) × markdown puro × HTML único. Esta skill assume VitePress.
- **Escopo**: criar do zero auto-suficiente × consolidar docs existentes × só criar a nova sem tocar o resto. Se for entrega ao cliente, confirme **zero dado comercial**.
- **Idioma**: siga o idioma do projeto/cliente (pt-BR costuma ser o caso aqui).

## Passo 1 — Mapear o código (paralelo)

Lance **Explore agents em paralelo** para um retrato fiel antes de escrever:
- Arquitetura/stack: versões (package manifests), estrutura de pastas, rotas, middlewares, models/entidades, configs de infra.
- Domínio/fluxos: os fluxos de negócio ponta a ponta e os arquivos-chave de cada um.
- Operação/testes/docs: scripts de deploy/backup, comandos/CLI, suíte de testes, e docs já existentes para reaproveitar conhecimento.

## Passo 2 — Scaffold do VitePress (isolado)

Crie tudo sob uma pasta dedicada (ex.: `docs/tecnica/` ou `documentacao/`). **Raiz do VitePress = essa pasta** (não a `docs/` inteira, que pode conter PDFs/HTML que o VitePress tentaria varrer).

`package.json` (na pasta da doc):
```json
{
  "name": "<projeto>-docs",
  "private": true,
  "type": "module",
  "scripts": {
    "docs:dev": "vitepress dev",
    "docs:build": "vitepress build",
    "docs:preview": "vitepress preview"
  },
  "devDependencies": {
    "mermaid": "^11",
    "vitepress": "^1.6",
    "vitepress-plugin-mermaid": "^2"
  }
}
```

`.gitignore` (na pasta da doc — evita tocar o `.gitignore` raiz):
```
node_modules/
.vitepress/dist/
.vitepress/cache/
```

`.vitepress/config.mjs` — pontos essenciais:
```js
import { withMermaid } from 'vitepress-plugin-mermaid'

export default withMermaid({
  lang: 'pt-BR',
  title: '<Projeto> — Documentação Técnica',
  description: '...',
  cleanUrls: true,
  ignoreDeadLinks: true, // navegação canônica é a sidebar; evita falha por link inline
  themeConfig: {
    logo: '/logo.png',
    search: { provider: 'local' }, // busca offline, sem deps externas
    nav: [ /* atalhos de topo por seção */ ],
    sidebar: [ /* uma entrada por seção, espelhando a árvore de arquivos */ ],
  },
})
```

Tema com a marca do projeto: `.vitepress/theme/index.js` importa `'vitepress/theme'` + `./custom.css`; em `custom.css` defina `--vp-c-brand-1/2/3` (e variantes `.dark`) e o degradê do hero. Logo em `public/`. `index.md` com `layout: home` (hero + `features`).

Rode `npm install` (em background) enquanto escreve o conteúdo.

## Passo 3 — Estrutura de capítulos (adapte ao domínio)

Organize no estilo das docs do Laravel (Prólogo → Primeiros Passos → Conceitos → Módulos → Operação → Referência). Template:
- **Prólogo**: visão geral do produto; arquitetura (diagrama de componentes, decisões em prosa).
- **Primeiros Passos**: requisitos; instalação local passo a passo (leia os seeders para documentar logins demo certos); mapa comentado do código.
- **Arquitetura**: modelo de dados (tabelas + constraints + diagrama ER); autenticação/perfis/multi-tenancy; configuração transversal (feature flags etc.).
- **Módulos**: um capítulo por fluxo de negócio, com diagrama de fluxo.
- **Operação**: comandos/CLI; filas/jobs; deploy; backup/restore; troubleshooting.
- **Testes**: estratégia e como rodar.
- **Referência**: rotas/endpoints; glossário do vocabulário do produto.

## Passo 4 — Fan-out de redatores

Escreva em paralelo com **sub-agentes**, um por bloco de capítulos. Dê a cada um o **mesmo guia de estilo** e as **fontes de verdade** (arquivos a ler). Guia comum:
- Idioma do projeto; identificadores no original.
- Tom das docs do Laravel: conceito → trecho de código real **com o caminho do arquivo** → o "porquê" das decisões não óbvias.
- Diagramas de fluxo em ```mermaid```.
- Links internos **absolutos sem extensão** (`/secao/arquivo`) — combine os slugs ANTES para os agentes não inventarem caminhos.
- Restrições de entrega: zero dado comercial; auto-suficiente (não referenciar specs/ADRs internos); leia o código, não escreva de memória; reporte divergências entre o esperado e o real.

Você (orquestrador) faz o scaffold, `config.mjs`, `index.md` e a revisão final. Se um redator delegar coleta a sub-agentes e travar antes de escrever, **assuma a escrita** com o material já coletado.

## Passo 5 — Armadilhas do VitePress (causam falha de build)

- **Interpolação `{{ … }}`**: o VitePress compila `.md` como template Vue, então `{{ x }}` em texto/inline-code é interpretado e quebra se não for JS válido (ex.: `{{ $obj->prop }}`). Solução: manter exemplos com chaves duplas **só dentro de fences** ou reescrever sem as chaves cruas. Varra com `grep -rn '{{' docs --include='*.md'`.
- **Tags soltas** tipo `<Algo>` em prosa podem ser lidas como componente Vue — prefira backticks.
- **Linguagens de fence desconhecidas** geram aviso e fallback: use `ini`/`dotenv` para `.env`, `bash` para cron/shell (evite ```env e ```cron).
- **Links internos**: com `ignoreDeadLinks: true` o build não falha, mas a navegação quebra — valide mesmo assim (veja Passo 6). Use slugs reais.
- **Mermaid** precisa do `withMermaid()` + deps (`mermaid`, `vitepress-plugin-mermaid`); não é nativo.

## Passo 6 — Verificação

```bash
# Links internos quebrados (compara destinos referenciados × páginas reais)
real=$(find docs -name '*.md' -not -path '*/node_modules/*' | sed 's#docs/##;s#\.md$##' | sort -u)
refs=$(grep -rhoE '\]\(/[a-z0-9/-]+\)' docs --include='*.md' | sed -E 's#\]\(/##;s#\)##' | sort -u)
comm -23 <(echo "$refs") <(echo "$real")           # deve sair vazio

grep -rn '{{' docs --include='*.md'                 # interpolações cruas → 0
# Se for entrega: grep por valores/§comerciais, .specs, ADRs → 0

npm run docs:build                                   # tem de terminar "build complete"
```
Confira também que o build da **aplicação** segue intacto (a doc isolada não pode afetá-lo).

## Passo 7 — Commit

Commit só quando pedido. **Não** stageie `node_modules`/`dist`/`cache` (o `.gitignore` local cobre — confirme com `git diff --cached --name-only`). Inclua o `package-lock.json` da doc. Respeite a convenção de mensagem do repositório (em alguns, sem qualquer citação a IA).

## Variante: Guia do Usuário (não técnico)

Quando o alvo é o **usuário final** (onboarding de um novo colaborador, manual do produto), o método é o mesmo, com 4 diferenças:

- **Público e tom**: linguagem simples, sem jargão. Fale de "tela", "menu", "botão", "campo" — **nunca** de código, rota, tecnologia ou fornecedor (white-label). Orientado a tarefas: "para que serve → passo a passo → o que preencher em cada campo".
- **Estrutura por PERFIL**, não por arquitetura: uma seção por tipo de usuário (admin, operacional, etc.) + introdução + FAQ + glossário em linguagem de usuário. A sidebar agrupa por perfil.
- **Fonte de verdade = as telas/views** (não o código de domínio): os redatores leem os templates/components para extrair os rótulos, campos e botões reais. Continua valendo "não invente".
- **Screenshots reais** agregam muito aqui — ver seção abaixo. Defina a convenção de nomes (`/img/<area>-<tela>.png`) e passe aos redatores para inserirem `![alt](/img/...)` nos pontos certos.

Config: sem Mermaid (geralmente não precisa); `search: local`, mesmo tema/branding. É um **segundo site isolado** (`docs/guia-usuario/`), com seu próprio `package.json`.

## Screenshots automatizados (Puppeteer)

O passo que mais valoriza um guia de usuário. Pré-requisitos: app rodando, Chrome no sistema, `puppeteer` instalado (muitos projetos já têm via Browsershot — um `.puppeteerrc.cjs` com `skipDownload:true` indica que usam o Chrome do sistema).

Pipeline self-contained (rode em **background**, com timeout folgado):
1. **Suba o app** numa porta dedicada e **espere readiness** antes de capturar:
   ```bash
   export PHP_CLI_SERVER_WORKERS=4           # serve single-thread trava com subrequests do Livewire
   /usr/bin/php artisan serve --port=8000 >/tmp/serve.log 2>&1 &   # use o PHP com extensões, não um estático
   SERVE_PID=$!
   for i in $(seq 1 30); do [ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8000/login)" = 200 ] && break; sleep 1; done
   node capture-screenshots.cjs            # script na RAIZ (acha node_modules/puppeteer)
   kill $SERVE_PID
   ```
2. **Um contexto isolado por perfil** (`browser.createBrowserContext()`) para a sessão de um não vazar no outro; login por perfil (preencher form, esperar sair de `/login`). Viewport **desktop** para áreas logadas, **mobile** para telas mobile-first.
3. `page.screenshot({ fullPage: true })` → `public/img/<nome>.png`, **best-effort** (try/catch por tela, nunca aborte tudo por uma falha).
4. **Telas que exigem estado** (ex.: a última etapa de um fluxo): prepare o dado via SQL e **reverta depois**. **Telas de resultado** (ex.: tela de sucesso pós-submit): submeta o form pelo Puppeteer, capture, e **apague o registro criado**.
5. **Valide visualmente** 2-3 PNGs (abra a imagem) — garante que o login não falhou silenciosamente (senão você captura a tela de login achando que é o dashboard).
6. **Limpeza obrigatória**: reverta todo dado de teste (é banco de outra pessoa) e **remova o script de captura** (ele carrega tokens/ids do banco atual — não é portátil nem versionável).

Esqueleto do script (`node`, CommonJS):
```js
const puppeteer = require('puppeteer')
const CHROME = '/usr/bin/google-chrome', OUT = __dirname + '/docs/guia-usuario/public/img'
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--disable-dev-shm-usage'] })
async function login(page, email, senha) {
  await page.goto(BASE+'/login', { waitUntil: 'networkidle2' })
  await page.type('input[type=email]', email); await page.type('input[type=password]', senha)
  await Promise.all([ page.waitForNavigation().catch(()=>{}), page.click('button[type=submit]') ])
  await page.waitForFunction(() => !location.pathname.endsWith('/login')).catch(()=>{})
}
async function shot(page, path, file) { await page.goto(BASE+path,{waitUntil:'networkidle2'}); await new Promise(r=>setTimeout(r,900)); await page.screenshot({path:`${OUT}/${file}`,fullPage:true}) }
// 1 contexto por perfil: const ctx = await browser.createBrowserContext(); const page = await ctx.newPage(); await page.setViewport(DESKTOP); ...
```
Senha demo: leia os seeders (Laravel factory padrão = `password`). Pegue tokens/hash/ids do banco. Combine os **nomes dos arquivos de imagem ANTES** com os redatores para baterem com as referências `/img/...`.

## Snippets prontos

Reaproveite `package.json`, `config.mjs`, `theme/custom.css` e `index.md` dos exemplos acima — ajuste nome, cores da marca e a árvore de `sidebar` ao projeto.
