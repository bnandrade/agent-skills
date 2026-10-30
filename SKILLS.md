# Skills — Referencia Rapida

Catalogo completo das skills disponveis. Consulte para saber o que ja temos antes de criar algo novo.

> **Regra:** toda skill nova criada deve ser adicionada a este documento.

---

## Orquestracao de Entrega

### `pipeline-entrega`
Maestro do fluxo completo de entrega de projetos freelance (do briefing ao go-live) em 12 fases, invocando a skill certa em cada uma e parando nos gates humanos (go/no-go, aprovacoes do cliente, escolha de design, UAT). Mantem um dossie de estado por projeto e separa os artefatos comerciais (fora do repo do cliente) do tecnico. Destilada de um projeto de referência.
**Melhor para:** conduzir um projeto de ponta a ponta sem re-explicar o processo nem perder contexto entre sessoes — orquestra proposal-analyzer, software-architect, tlc-spec-driven, the-fool, os experts de stack, app-pentest, impeccable, tech-docs-vitepress e verify. Objetivo: mais projetos no mesmo tempo live, sem perder qualidade.

---

## Planejamento & Decisao

### `tlc-spec-driven`
Planejamento e implementacao de features em 4 fases adaptativas: Specify, Design, Tasks, Execute. Auto-ajusta profundidade pela complexidade. **v3.2 (upstream TLC):** Verifier independente (author != verifier, evidence-or-zero) que roda sozinho apos a ultima task, decision log persistente (`STATE.md`) e camada de lessons auto-melhoravel. Foco em feature (roadmap/init de projeto ficam com software-architect + dossie).
**Melhor para:** planejar e implementar uma feature complexa com rastreabilidade de requisitos, tasks atomicas (1 commit/task) e verificacao independente contra a spec.

### `the-fool`
Devil's advocate e red team. Desafia ideias, roda pre-mortems, stress-testa suposicoes, audita qualidade de evidencias e encontra pontos cegos.
**Melhor para:** validar uma decisao *antes* de se comprometer — encontra o que voce nao quer ouvir.

### `create-adr`
Cria Architecture Decision Records (ADRs) para documentar escolhas arquiteturais e seu racional.
**Melhor para:** registrar *por que* uma decisao foi tomada, nao apenas *o que* foi decidido.

### `software-architect`
Arquiteto full-stack para avaliar stacks, decidir arquitetura e projetar sistemas.
**Melhor para:** escolher entre tecnologias, definir boundaries de sistema, decisoes build-vs-buy, MVP vs escala.

---

## Codigo & Qualidade

### `tech-lead`
Tech lead de bolso para o dev solo: assume a saude do codebase INTEIRO (nao de um diff), caçando vulnerabilidades e divida tecnica de forma proativa, priorizando por risco x esforço e conduzindo o paydown com um ledger persistente (`HEALTH.md`). Enquadra, varre (hotspots via churn x complexidade), prioriza (P0–P3) e delega o trabalho pesado — orquestra app-pentest, security-best-practices, code-reviewer, refactoring-expert, testing-strategist, database-expert e the-fool.
**Melhor para:** raio-x de saude de um projeto, montar/atualizar o inventario de vulnerabilidades e debitos, decidir o que pagar agora vs aceitar, e retomar o plano de saneamento entre sessoes. O entregavel e o *plano ordenado*, nao a lista crua.

### `gauntlet` · _so Claude Code_
Loop adaptativo de build e verificacao guiado por evidencia (v2.5), para uma tarefa com **contrato
fechado**. A sessao principal e o **orquestrador**: escreve o contrato, triagem o risco em um tier
(LIGHT / STANDARD / ELEVATED / CRITICAL) e escolhe a verificacao mais barata que resolve a duvida:

```
Contrato + triagem → Build → Observar (diff/escopo) → Verificar (gates deterministicos, do mais barato)
→ Criticar independentemente so quando o tier/incerteza justifica → Adjudicar → Corrigir so gaps materiais
→ Repetir so enquanto converge → Parar em FIT_FOR_PURPOSE ou gate humano
```

| Papel | Subagente | Quando entra |
|---|---|---|
| Implementacao | `gauntlet-builder` | STANDARD+ (em LIGHT o orquestrador pode implementar) |
| Critico fresco, uma lente por invocacao (`general`, `security`, `data`, `concurrency`, `infra`, `destructive`, `api`, `ux`) | `gauntlet-critic` | 1 em STANDARD, 2 em ELEVATED/CRITICAL, so apos os gates passarem |
| Arbitro condicional (CONFIRMED / REFUTED / UNPROVEN) | `gauntlet-judge` | Achado disputado, criticos em conflito, estagnacao ou tier CRITICAL |

O harness `scripts/gauntlet.mjs` (Node, zero deps; exige work tree git) persiste tudo em
`.gauntlet/runs/<id>/` no repo alvo (excluido do git automaticamente): gates com log, diff,
resultados dos criticos, veredito e convergencia (IMPROVING / STAGNATING / REGRESSING). Toda
evidencia de critico/juiz e presa a uma identidade **arvore + contrato + spec dos gates**: mudou
qualquer um, a revisao e stale e nao conta. Ele recusa critico com gate falhando ou sem contrato,
veredito com evidencia desatualizada e rodada de correcao sem gap material (BLOCKER / CRITICAL /
MAJOR) ou fora do budget — MINOR e POLISH vao para backlog. Modelo/esforco vivem so no frontmatter
dos agentes (`references/adapter-claude-code.md`); o protocolo e neutro. Para **uma** execucao o
operador pode trocar modelos (`models:economy`, `builder:<m> critic:<m> judge:<m>`) — nada persiste
e o critico nunca fica mais fraco que o builder. Tambem por execucao, `external:<lente>` roda essa
lente num **revisor de outro provedor** (Codex CLI, sandbox read-only, via
`scripts/codex-critic.mjs`): ocupa o slot da lente, nao soma critico; se falhar (cota, timeout), a
lente cai na hora para o critico nativo (`--by gauntlet-critic:fallback`), registrado e reportado
— o fluxo nunca fica esperando a cota do outro provedor. Sem o token, tudo e nativo como antes.
Vive em `claude-skills/gauntlet/` + `claude-agents/`; `./install-gauntlet.sh` instala, `--check`
verifica, `--uninstall` remove; `./tests/run.sh` valida harness, configuracao e instalador.
**Melhor para:** mudanca em que errar sai caro e o contrato ja esta fechado — fix sensivel a
regressao, feature com criterios de aceite, alteracao que toca auth/dados/concorrencia/infra.
Nao e discovery de produto (isso e `pipeline-entrega`) nem critica de design (`impeccable`).
PASS tecnico **nao** e aprovacao humana: merge, deploy, passos destrutivos e aprovacao visual
continuam sendo decisao sua.

### `code-reviewer`
Revisor senior de codigo. Identifica code smells, problemas de seguranca e performance.
**Melhor para:** revisar PRs, auditar qualidade de codigo, checklist antes de merge.

### `refactoring-expert`
Especialista em refatoracao segura de codebases existentes.
**Melhor para:** atacar tech debt, migrar codigo legado, aplicar strangler fig pattern, reestruturar sem quebrar.

### `testing-strategist`
Estrategista de testes para decidir *o que* testar e *como*.
**Melhor para:** definir piramide de testes, estrategia de mocking, TDD, load testing, cobertura inteligente.

### `security-best-practices`
Review de seguranca especfico por linguagem e framework.
**Melhor para:** auditar seguranca em Python, JS/TS, Go — OWASP top 10, secrets, auth, injection.

---

## Seguranca Ofensiva & Pentest

### `app-pentest`
Auditoria de seguranca ofensiva (white/grey-box) da propria aplicacao — pensa como atacante para achar o furo antes que um adversario ache, e entao corrige. Inclui threat model, catalogo OWASP Web/API/LLM Top 10, playbook do stack (Laravel/React/RN/multi-tenant/IA), matriz de severidade explorabilidade x impacto, relatorio e o script `quick-recon.sh`.
**Melhor para:** blindar um projeto seu antes de produzir — cacar IDOR/BOLA, vazamento multi-tenant, SQLi, XSS, SSRF, mass assignment e prompt injection em agentes; cada finding com PoC nao-destrutiva, fix no stack real e reteste.

### `recon-osint`
Reconhecimento e enumeracao (recon/OSINT) — a fase 1 de todo pentest/bounty. Passivo (crt.sh, DNS, ASN, Wayback, Google/GitHub dorks, Shodan/Censys) + ativo (subdominios, hosts vivos, portas, servicos, fingerprint, crawling de endpoints). Produz um mapa de superficie de ataque que alimenta `app-pentest` e `bug-bounty`. Inclui `recon.sh` (pipeline passivo/ativo com fallback).
**Melhor para:** levantar e mapear a superficie de um alvo autorizado antes de testar — descobrir ativos esquecidos, staging exposto, `.git`/chaves vazadas, subdomain takeover. Separa com rigor passivo (nao toca o alvo) de ativo (exige escopo).

### `bug-bounty`
Workflow de caca em programas de bug bounty (alvo externo COM escopo) — do escopo ao report que paga. Escolher programa por ROI, respeitar escopo/regras/safe-harbor, priorizar alvos, cacar os bugs que pagam (IDOR/BOLA, ATO, SSRF, RCE, auth bypass, business logic), provar impacto/severidade (CVSS), triagem/dedup e escrever o report que o triador aceita. Consome `recon-osint` e reusa a tecnica do `app-pentest`. Inclui `scope-check.sh`.
**Melhor para:** transformar recon em bounty pago — priorizar alvos com menos olhos, encadear bugs para impacto critico, e escrever relatorios claros e reproduziveis sem inflar severidade.

### `llm-ai-security`
Red teaming de sistemas com LLM e agentes de IA — atacar para defender. OWASP LLM Top 10, prompt injection direto e indireto, jailbreak, envenenamento de RAG, vazamento de system prompt, insecure output handling e excessive agency / abuso de tools. Foco em seguranca de APLICACAO (agente sequestrado -> acao nao autorizada, exfiltracao), nao moderacao de conteudo. Teste automatizado (garak/promptfoo/PyRIT) + `inject-probe.sh`.
**Melhor para:** blindar agentes proprios (BHEN) e apps de IA contra sequestro e vazamento — ou AI red teaming como servico/bounty. Contraparte ofensiva do `agent-engineer`.

### `mobile-pentest`
Pentest de apps mobile (foco React Native/Expo, Android e iOS) — o app roda no dispositivo nao-confiavel do usuario. OWASP Mobile Top 10 / MASVS: segredos no bundle, armazenamento inseguro (AsyncStorage vs SecureStore), comunicacao/cert pinning, deep links, WebView, resiliencia a tampering/root. Combina analise estatica (decompile/bundle Hermes), dinamica (Frida/Objection) e de rede (proxy/MITM). Inclui `apk-triage.sh`.
**Melhor para:** blindar os apps RN que voce entrega antes de publicar — extrair segredos do bundle, achar token em texto plano, testar deep link forjavel e pinning contornavel. Backend/API fica com `app-pentest`.

---

## Navegacao & Debug

### `codenavi`
Navegador de codebases desconhecidas. Investiga com precisao e mantem knowledge base em `.notebook/`.
**Melhor para:** entrar num projeto que voce nunca viu e entender fluxos, encontrar bugs, implementar com confianca.

### `gh-fix-ci`
Debug de checks falhando em PRs no GitHub Actions.
**Melhor para:** quando o CI quebra — inspeciona logs, resume contexto de falha, propoe fix.

---

## Especialistas por Stack

### `laravel-expert`
Especialista senior em Laravel (ate v13). Eloquent, APIs, Sanctum, queues, Livewire/Inertia, AI SDK.
**Melhor para:** qualquer codigo Laravel — desde modelagem ate testes, performance e integracao com IA.

### `go-expert`
Especialista senior em Go. APIs, concorrencia, projetos, testes, performance.
**Melhor para:** escrever Go idiomatico, projetar APIs, lidar com goroutines/channels, otimizar.

### `frontend-expert`
Especialista frontend web. React 19, Vue 3, TypeScript, Tailwind, state management.
**Melhor para:** componentes web, SPA, forms, performance, bundler config, acessibilidade.

### `react-native-expert`
Especialista React Native + Expo. Navegacao, performance de listas, animacoes, modulos nativos.
**Melhor para:** apps mobile cross-platform com Expo Router, otimizacao de scroll/listas, bridges nativos.

### `database-expert`
Especialista em banco de dados. PostgreSQL, modelagem, queries, indices, pgvector, Redis.
**Melhor para:** queries complexas (CTEs, window functions, JSONB), indices, pgvector/embeddings, migrations.

---

## APIs & Integracao

### `api-designer`
Especialista em design de APIs. REST, GraphQL, gRPC, contratos, versionamento.
**Melhor para:** projetar contratos de API consistentes — paginacao, filtros, erros, OpenAPI spec.

### `agent-engineer`
Engenheiro de sistemas de agentes autonomos. Multi-agent, tools, memory/RAG, safety, orchestration.
**Melhor para:** arquitetar qualquer sistema agentico — do design de tools ate guardrails e avaliacao.

---

## Infra & DevOps

### `devops-engineer`
DevOps/SRE senior. Docker, CI/CD, deploy, monitoring, secrets, reverse proxy.
**Melhor para:** Dockerfiles, GitHub Actions, estrategias de deploy, alertas, gestao de secrets.

### `infra-specialist`
Especialista em infraestrutura de producao. Cloud providers, VPS, Cloudflare, SSL/TLS, networking.
**Melhor para:** setup de servidor do zero, hardening, Cloudflare, certificados, backup/DR, escolha de cloud.

---

## Documentacao & Diagramas

### `technical-writer`
Escritor tecnico senior. README, API docs, runbooks, RFCs, onboarding, changelogs.
**Melhor para:** documentacao clara e mantenvel — transforma conhecimento tacito em docs uteis.

### `mermaid-studio`
Criacao de diagramas Mermaid com validacao e rendering dual-engine (SVG/PNG/ASCII).
**Melhor para:** gerar diagramas profissionais — flowcharts, sequence, ERD, C4, AWS, mindmap e 20+ tipos.

### `tech-docs-vitepress`
Cria um site de documentacao (VitePress) destilado do codigo/telas reais, em duas variantes: (1) tecnica, para outro dev dar continuidade; (2) guia do usuario nao-tecnico por perfil, com screenshots automatizados via Puppeteer. Comprovada num monolito Laravel + Livewire; metodo stack-agnostico.
**Melhor para:** documentar um projeto pronto para handoff/entrega ao cliente — scaffold isolado do VitePress, fan-out de redatores que leem o codigo como fonte de verdade, e as armadilhas de build do VitePress. E a Fase 11 da `pipeline-entrega`.

---

## Design & UI

### `impeccable` · _externa — [pbakaus/impeccable](https://github.com/pbakaus/impeccable)_
Skill de design de interfaces que estende a `frontend-design` da Anthropic. Vocabulario visual real, deteccao de "AI slop" (27 regras), e 23 comandos (`craft`, `critique`, `audit`, `polish`, `bolder`, `quieter`, `distill`, `delight`, `typeset`, `colorize`, `animate`, `layout`...). Le `PRODUCT.md` + `DESIGN.md` (gravados na raiz do projeto) antes de cada comando.
**Melhor para:** refinar um design ja pronto em modo aberto ("o que melhorar?") — `/impeccable critique` e `/impeccable audit` dao diagnostico priorizado sem precisar de queixa previa. Tambem gera/refina UI ponta a ponta.
**Instalacao:** global via `npx impeccable skills install --providers=.claude` rodado a partir de `~` (instala em `~/.claude/skills/impeccable`). **Nao versionar no repo** — o conteudo e baixado no install e auto-atualiza com `npx impeccable skills update`. CLI de slop sem API key: `npx impeccable detect <dir|file|url>`.
**Fluxo:** Claude Design gera → `/impeccable init` (grava PRODUCT.md) → `/impeccable document` (grava DESIGN.md) → `/impeccable critique` / `audit` / `polish`.

### `ui-verifier`
Quality gate de **entrega** de interface: verifica uma UI renderizada contra o briefing/spec usando evidencia observavel (screenshots por viewport, DOM, console, Playwright, axe), quatro avaliadores independentes (brief fidelity, design system, visual, UX/funcional) e ciclos limitados de correcao (bounded Gauntlet Loop). Detecta conflito entre fontes de verdade mas nao decide — sobe para gate humano. Dois modos de execucao: full (app rodando) e degraded (so artefatos, nunca emite PASS — fecha em STOP + HUMAN).
**Melhor para:** antes de entregar/mergear uma tela que importa — "isso que esta na tela e o que foi especificado, e funciona como interface?". Complementar ao `impeccable`: **o impeccable julga a interface, o `ui-verifier` julga a entrega**. Delega a dimensao visual ao impeccable e nao tem vocabulario estetico proprio. Nao e revisao aberta de design nem checagem de rotina de CSS.

---

## Juridico & Compliance

### `revisao-juridica`
Orquestrador da pre-revisao juridica de um produto digital brasileiro em cinco fases: fatos do tratamento de dados e da oferta levantados do codigo e dos documentos com `arquivo:linha` → pesquisa das normas vigentes em fonte oficial com data de consulta → minutas → critica adversarial independente (revisor fresco com subagentes, passagem separada sem eles) → pacote para o advogado com minutas versionadas, matriz de tratamento, perguntas fechadas, riscos classificados (alto, medio, baixo) com norma e fato, e a lista do que ficou sem verificacao. Usa `privacidade-lgpd` e `direito-consumidor-digital`; nucleo neutro (vai para Claude e Codex).
**Melhor para:** levar a um advogado habilitado um dossie verificavel antes de lancar ou alterar um produto, em vez de perguntas soltas. Nao e parecer, nao substitui o advogado e nao publica, implanta nem envia nada sem a validacao dele e a decisao do responsavel.

### `privacidade-lgpd`
Pre-revisao de privacidade e protecao de dados (LGPD, regulamentos da ANPD, Estatuto Digital da Crianca e do Adolescente): bases legais, dados de criancas e quando o ECA Digital se aplica, cookies e consentimento, legitimo interesse, transferencia internacional, direitos do titular e prazos, retencao e eliminacao, encarregado e incidentes. Modelos de matriz de tratamento, de textos de banner de consentimento e de politica de privacidade e cookies. Cada afirmacao normativa cita fonte oficial com data de consulta; o que nao se confirma fica "nao verificado".
**Melhor para:** transformar o tratamento real de dados de um produto (o que o codigo faz) em minutas para o advogado validar e num mapa de lacunas antes de publicar.

### `direito-consumidor-digital`
Pre-revisao de direito do consumidor para produto ou servico digital: informacoes obrigatorias do comercio eletronico (Decreto 7.962/2013), oferta e publicidade (CDC arts. 30 a 38), publicidade dirigida a crianca (CDC, Conanda 163, Conar), arrependimento e a divergencia sobre conteudo digital personalizado, vicios e prazos de reclamacao, e quando o regulamento de SAC se aplica. Modelo de termos de uso. Fonte oficial e data de consulta em cada afirmacao normativa.
**Melhor para:** revisar pagina de venda, checkout e pos-venda de um produto digital e produzir a minuta de termos de uso para validacao por advogado.

---

## Negocios & Propostas

### `proposal-analyzer`
Analista de viabilidade de projetos SaaS calibrado pelo perfil do Bruno. Veredito go/no-go com cruzamento de capacidade, stack e historico.
**Melhor para:** decidir se um briefing de cliente vale aceitar — estimativa de ordem de grandeza, red flags tecnicos e comerciais, rascunho de resposta cordial ao cliente.

---

## Academico & Escrita

### `orientador-tcc`
Orientador academico senior para a versao final do TCC (artigo cientifico ABNT, 10-15 laudas). Segue as regras oficiais da apostila UniFatecie e protege contra plagio e referencia inventada.
**Melhor para:** sair do pre-projeto aprovado ate o trabalho pronto — estruturar o artigo, escrever introducao/desenvolvimento/consideracoes em norma culta, formatar citacoes e referencias ABNT, montar pre/pos-textuais e revisar com checklist antes da entrega.

---

## Conhecimento (The Brain)

### `brain-intake`
Adapter do fluxo de entrada curada do The Brain (`sys.curated-intake`, ADR-006): triagem, deduplicacao, verificacao contra a fonte primaria, uma Source v2 por documento, fronteira de dados, validador do corpus e proposta numa branch com pull request. Le o contrato vivo no proprio Brain em vez de reproduzi-lo; nucleo neutro (vai para Claude e Codex).
**Melhor para:** levar video, artigo, decisao ou marco de outro projeto, aprendizado de sessao ou um sinal da revisao periodica ate candidatos prontos para o Bruno aprovar. Nunca faz merge e so le os repositorios de outros projetos.

---

## Totais

| Categoria | Qtd |
|---|---|
| Orquestracao de Entrega | 1 |
| Planejamento & Decisao | 4 |
| Codigo & Qualidade | 6 |
| Seguranca Ofensiva & Pentest | 5 |
| Navegacao & Debug | 2 |
| Especialistas por Stack | 5 |
| APIs & Integracao | 2 |
| Infra & DevOps | 2 |
| Documentacao & Diagramas | 3 |
| Design & UI | 1 |
| Juridico & Compliance | 3 |
| Negocios & Propostas | 1 |
| Academico & Escrita | 1 |
| Conhecimento (The Brain) | 1 |
| **Total** | **37** (29 de autoria propria + 8 de terceiros) |

> **Dependencias externas (nao versionadas):** `impeccable` (design/UI) — instalada via `npx`, categoria "Design & UI".
>
> **So Claude Code:** `gauntlet` (codigo/qualidade) — depende de subagentes do Claude Code, entao
> vive em `claude-skills/` + `claude-agents/` e e instalada por `./install-gauntlet.sh`, fora do
> `install.sh` que distribui `skills/` para Claude e Codex.
