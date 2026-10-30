# agent-skills

> **English:** a short version of this README is in [`README.en.md`](README.en.md).

**O que é uma skill:** um arquivo `SKILL.md` no padrão [Agent Skills](https://agentskills.io), com instruções e referências que o agente de código carrega sozinho quando a tarefa pede (revisar um PR, modelar um banco, auditar segurança, escrever uma proposta).
**Para quem é:** quem usa [Claude Code](https://docs.anthropic.com/en/docs/claude-code) ou [Codex](https://github.com/openai/codex) no dia a dia e quer que o agente trabalhe com um especialista de cada área no bolso.
**Pré-requisitos:** `bash` e `git` em Linux (macOS não testado; Windows não suportado). O gauntlet precisa de Node >= 20.

São **37 skills**: 29 de autoria minha e 8 de terceiros, redistribuídas com crédito e licença (ver [Créditos](#créditos)). As skills em `skills/` funcionam no Claude Code **e** no Codex; o `gauntlet` e os subagentes em `claude-agents/` são **só Claude Code**.

> Uso pessoal, publicado como referência. Sem suporte garantido: issues e PRs são bem-vindos, mas não há compromisso de resposta ou de compatibilidade.

## Instalação

```bash
# Clonar por HTTPS
git clone https://github.com/bnandrade/agent-skills.git
cd agent-skills

# ou por SSH
git clone git@github.com:bnandrade/agent-skills.git
cd agent-skills

# Instalar as skills compartilhadas (symlinks em ~/.claude/skills e, se existir, ~/.codex/skills)
./install.sh

# Só Claude Code: instalar o gauntlet (subagentes em ~/.claude/agents + skill /gauntlet)
./install-gauntlet.sh

# Desinstalar (remove os symlinks, restaura o que havia antes)
./uninstall.sh
./install-gauntlet.sh --uninstall

# Validar o repositório (harness, configuração dos agentes, instalador)
./tests/run.sh
```

Os instaladores criam **symlinks** para dentro deste clone, então um `git pull` atualiza todas as skills. Antes de criar um symlink, qualquer pasta real que já ocupe o caminho vai para backup. Abra uma nova sessão do agente depois de instalar.

## Catálogo de skills

| Skill | Descrição | Quando usar |
|---|---|---|
| `tlc-spec-driven` | Planejamento + implementacao de features em 4 fases (Specify, Design, Tasks, Execute) — v3.2 | Planejar/implementar feature com rastreabilidade, commits atomicos e Verifier independente (evidence-or-zero) |
| `the-fool` | Devil's advocate, pre-mortem, red team | Desafiar ideias, stress test de decisoes, encontrar pontos cegos |
| `codenavi` | Navegador de codebases desconhecidas | Investigar fluxos, fix bugs, implementar em codigo desconhecido |
| `create-adr` | Architecture Decision Records | Documentar decisoes arquiteturais e seu racional |
| `mermaid-studio` | Diagramas Mermaid (SVG/PNG/ASCII) | Flowcharts, sequence, ERD, C4, AWS, mindmap e 20+ tipos |
| `gh-fix-ci` | Debug de CI no GitHub Actions | PRs com checks falhando |
| `security-best-practices` | Review de seguranca por stack | Auditar seguranca em Python, JS/TS, Go |
| `react-native-expert` | Especialista React Native + Expo | Componentes, navegacao, performance, modulos nativos |
| `go-expert` | Especialista senior em Go | APIs, concorrencia, projetos, testes, performance, deploy |
| `software-architect` | Arquiteto de software full-stack | Escolher stack, avaliar tecnologias, decisoes de arquitetura, MVP vs escala |
| `laravel-expert` | Especialista senior em Laravel 13 | Eloquent, APIs, Sanctum, queues, Livewire/Inertia, AI SDK, testing, performance |
| `devops-engineer` | DevOps/SRE senior | Docker, CI/CD, deploy, monitoring, secrets, infra, reverse proxy |
| `frontend-expert` | Especialista frontend web | React 19, Vue 3, TypeScript, Tailwind, state, testing, performance |
| `agent-engineer` | Engenheiro de agentes autonomos | Arquitetura multi-agent, tools, memory/RAG, safety, orchestration, eval |
| `infra-specialist` | Especialista em infraestrutura | Cloud providers, VPS hardening, Cloudflare, SSL/TLS, networking, backup/DR |
| `api-designer` | Design de APIs | REST, contratos, paginacao, filtros, erros, OpenAPI, versionamento |
| `database-expert` | Especialista em banco de dados | PostgreSQL, modelagem, queries, indices, pgvector, Redis, migrations |
| `code-reviewer` | Revisor de codigo | Code smells, checklist, seguranca, performance, PR best practices |
| `tech-lead` | Tech lead de bolso (saude do codebase inteiro) | Raio-x de vulnerabilidades + divida tecnica, priorizacao P0–P3 por risco x esforço, hotspots (churn x complexidade), ledger persistente `HEALTH.md`; orquestra app-pentest/code-reviewer/refactoring-expert |
| `testing-strategist` | Estrategista de testes | Test pyramid, TDD, mocking, load testing, test quality |
| `refactoring-expert` | Especialista em refatoracao | Strangler fig, tech debt, safe refactoring, migration, catalog |
| `technical-writer` | Escritor tecnico | README, API docs, runbooks, RFCs, onboarding, changelogs |
| `tech-docs-vitepress` | Site de documentacao (VitePress) para handoff | Docs tecnica (para outro dev) + guia do usuario por perfil com screenshots; destilado do codigo/telas reais; Fase 11 da pipeline-entrega |
| `proposal-analyzer` | Analista de viabilidade de projetos SaaS | Analisar briefing de cliente, veredito go/no-go, estimativa de ordem de grandeza, cruzamento com perfil do prestador |
| `orientador-tcc` | Orientador academico para escrita do TCC (artigo ABNT) | Desmembrar pre-projeto, escrever versao final, citacoes/referencias ABNT, revisao pre-entrega (regras UniFatecie) |
| `app-pentest` | Auditoria de seguranca ofensiva da propria app | Blindar projeto proprio, threat model, cacar IDOR/SQLi/XSS/SSRF/vazamento multi-tenant/prompt injection — com fix e reteste |
| `recon-osint` | Reconhecimento/OSINT e mapa de superficie de ataque | Fase 1 de pentest/bounty — enumerar subdominios/hosts/portas/tecnologias, OSINT passivo, achar exposicoes; alimenta app-pentest e bug-bounty |
| `bug-bounty` | Workflow de caca em programas de bug bounty | Escolher programa, respeitar escopo, priorizar alvos, provar impacto, triagem/dedup e escrever o report que paga (HackerOne/Bugcrowd) |
| `llm-ai-security` | Red teaming de seguranca de LLM e agentes de IA | OWASP LLM Top 10, prompt injection direto/indireto, jailbreak, RAG poisoning, excessive agency; blindar agentes proprios (BHEN) ou alvo autorizado |
| `mobile-pentest` | Pentest de apps mobile (React Native/Expo) | Segredos no bundle, storage inseguro, deep links, cert pinning, WebView, resiliencia; estatica+dinamica+rede; blindar apps proprios |
| `ui-verifier` | Quality gate de UI contra briefing/spec | Verificar se a tela entregue e o que foi especificado — evidencia observavel (screenshots/DOM/console/Playwright/axe), 4 avaliadores independentes e ciclos limitados de correcao; nao substitui o impeccable |
| `pipeline-entrega` | Maestro do fluxo de entrega (briefing → go-live) | Conduzir um projeto freelance de ponta a ponta em 12 fases, orquestrando as skills e parando nos gates humanos; dossie de estado por projeto |
| `privacidade-lgpd` | Pre-revisao de privacidade e protecao de dados (LGPD, ANPD, ECA Digital) com fonte oficial e data de consulta | Produto que trata dados pessoais precisa de matriz de tratamento, textos de banner de consentimento e politica de privacidade e cookies em minuta, para advogado validar; nao e parecer |
| `direito-consumidor-digital` | Pre-revisao de direito do consumidor para produto digital (comercio eletronico, oferta, publicidade e crianca, arrependimento, vicios, SAC) com fonte oficial e data de consulta | Produto digital vendido ou anunciado a consumidor precisa de minuta de termos de uso e mapa de lacunas da pagina de venda, do checkout e do pos-venda; nao e parecer |
| `revisao-juridica` | Orquestrador da pre-revisao juridica: fatos com arquivo:linha → normas vigentes → minutas → critica adversarial independente → pacote | Levar a um advogado um dossie verificavel de privacidade e consumo (minutas versionadas, matriz, perguntas fechadas, riscos alto/medio/baixo, o que ficou sem verificacao) antes de lancar ou alterar um produto; nao publica nada |
| `brain-intake` | Entrada curada do The Brain: conteudo novo vira candidato verificado, com Source por documento, numa branch com PR | Registrar video, artigo, decisao ou aprendizado de projeto no Brain conforme o `sys.curated-intake`; nunca faz merge nem torna nada canonico sozinho |
| `gauntlet` · _so Claude_ | Loop adaptativo build → verificar → criticar → corrigir, guiado por evidencia — v2.5 | Mudanca com contrato fechado em que errar sai caro: triagem de risco escolhe a profundidade (so gates deterministicos, +1 critico, +lente especializada, +juiz), harness persiste evidencia presa a arvore + contrato + gates e deriva convergencia, para em FIT_FOR_PURPOSE ou gate humano. Modelo por execucao opcional (`models:economy`); lente num revisor de outro provedor opcional (`external:<lente>`, Codex CLI). Nao e discovery de produto (use pipeline-entrega) |

Referência rápida por categoria, com "melhor para" de cada uma: [`SKILLS.md`](SKILLS.md).

## Gauntlet (só Claude Code)

O `gauntlet` é um loop de construir → verificar → criticar → corrigir guiado por evidência, para mudanças com contrato fechado em que errar sai caro. Ele depende de **subagentes** (`claude-agents/gauntlet-builder.md`, `gauntlet-critic.md`, `gauntlet-judge.md`), uma capacidade exclusiva do Claude Code, por isso vive em `claude-skills/` e tem instalador próprio:

```bash
./install-gauntlet.sh            # instala ou atualiza
./install-gauntlet.sh --check    # só relata o estado (sai 1 se divergente)
./install-gauntlet.sh --uninstall
```

O instalador é idempotente, preserva em backup qualquer arquivo real que já ocupe os caminhos de destino, remove symlinks de agentes que deixaram de existir no repositório e lê modelo e esforço do frontmatter dos agentes. O harness (`claude-skills/gauntlet/scripts/gauntlet.mjs`) exige Node >= 20 e um work tree git no projeto alvo. Opcionalmente, uma lente do crítico pode rodar no Codex CLI (`external:<lente>`); isso é um adaptador, o protocolo não nomeia modelo.

## Workflow de projeto

Fluxo para aplicar as skills em qualquer projeto, do MVP à produção, em dois trilhos (greenfield e projeto existente):

```
ENTENDER → AUDITAR → DESAFIAR → PLANEJAR → CORRIGIR → TESTAR → DOCUMENTAR → DEPLOY → MONITORAR
```

Guia completo em [`WORKFLOW.md`](WORKFLOW.md).

## Estrutura

```
skills/               # Skills compartilhadas (Claude Code + Codex)
  <nome-da-skill>/
    SKILL.md          # Prompt principal da skill (frontmatter: name, description, metadata)
    references/       # Contexto extra carregado sob demanda
    scripts/          # Scripts auxiliares
    assets/           # Recursos estáticos
claude-skills/        # Skills só do Claude Code
  gauntlet/
    SKILL.md          # Protocolo (neutro em relação a modelo)
    references/       # Contrato, triagem de risco, protocolo do crítico, harness, adapter, rationale
    scripts/
      gauntlet.mjs    # Harness: gates, identidade de evidência, veredito, convergência (Node >= 20, zero deps, git)
      codex-critic.mjs  # Adapter: roda uma lente no Codex CLI (revisor de outro provedor, read-only)
claude-agents/        # Subagentes do Claude Code (modelo/esforço no frontmatter)
tests/                # Validação do repo sem LLM: ./tests/run.sh
docs/                 # Padrão de escrita de skills (skill-authoring.md)
install.sh            # Instala symlinks das skills compartilhadas
uninstall.sh          # Remove os symlinks
install-gauntlet.sh   # Instala/verifica/remove os subagentes e a skill do gauntlet
SKILLS.md             # Referência rápida por categoria
WORKFLOW.md           # Mapa do processo
```

## Criando ou adaptando uma skill

1. Criar `skills/<nome>/` (ou `claude-skills/<nome>/` se a skill depender de capacidade exclusiva do Claude Code, como subagentes).
2. Escrever o `SKILL.md` com frontmatter `name`, `description` e `metadata` (autor, versão). O padrão de escrita está em [`docs/skill-authoring.md`](docs/skill-authoring.md).
3. Colocar material detalhado em `references/`, carregado só na fase que precisa dele.
4. Adicionar a skill à tabela acima e ao `SKILLS.md`, e rodar o instalador da categoria.

Algumas skills minhas carregam contexto do meu próprio setup (por exemplo `brain-intake`, que alimenta um sistema de conhecimento pessoal, e `proposal-analyzer`, calibrado por um perfil de prestador em `references/`). Elas servem como modelo: copie a estrutura e troque o perfil pelo seu.

## Créditos

Oito skills deste repositório foram escritas por outras pessoas e são redistribuídas com as licenças originais, que continuam valendo para elas:

| Skill | Autor | Licença |
|---|---|---|
| `codenavi` | [Felipe Rodrigues](https://github.com/felipfr) | CC-BY-4.0 |
| `mermaid-studio` | [Felipe Rodrigues](https://github.com/felipfr) | CC-BY-4.0 |
| `react-native-expert` | [Felipe Rodrigues](https://github.com/felipfr) | CC-BY-4.0 |
| `tlc-spec-driven` | [Felipe Rodrigues](https://github.com/felipfr) | CC-BY-4.0 |
| `create-adr` | [Tech Leads Club](https://github.com/tech-leads-club) | CC-BY-4.0 |
| `the-fool` | [Jeffallan](https://github.com/Jeffallan) | CC-BY-4.0 |
| `gh-fix-ci` | [openai/skills](https://github.com/openai/skills) | Apache-2.0 (`LICENSE.txt` na pasta) |
| `security-best-practices` | [openai/skills](https://github.com/openai/skills) | Apache-2.0 (`LICENSE.txt` na pasta) |

Algumas delas receberam pequenos ajustes de fronteira na `description` para não competir com as skills vizinhas; o conteúdo é dos autores.

## Licença

As 29 skills de minha autoria, o gauntlet, os instaladores, os testes e a documentação estão sob a licença [MIT](LICENSE). As skills de terceiros mantêm as licenças próprias listadas acima e em [`THIRD-PARTY.md`](THIRD-PARTY.md).
