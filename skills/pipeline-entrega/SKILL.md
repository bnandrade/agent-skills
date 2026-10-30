---
name: pipeline-entrega
description: Orquestrador do fluxo completo de entrega de projetos de software (freelance solo do Bruno) — conduz um projeto do briefing do cliente ao go-live em 12 fases, invocando a skill certa em cada uma e PARANDO nos gates humanos (go/no-go, aprovacoes do cliente, escolha de design, UAT). Mantem o estado num dossie persistente e reusa as skills existentes (proposal-analyzer, software-architect, create-adr, database-expert, tlc-spec-driven, testing-strategist, the-fool, laravel/frontend/react-native-expert, app-pentest, impeccable, tech-docs-vitepress, verify). Use quando chega uma proposta/projeto novo, para estruturar e conduzir um projeto de ponta a ponta, ou para retomar um projeto em andamento. Triggers em "chegou uma proposta", "novo projeto do cliente", "vamos conduzir o projeto X", "estruturar um projeto novo", "pipeline de entrega", "tocar o projeto do inicio ao fim", "retomar o projeto X", "em que fase esta o projeto". NAO use para rodar UMA fase isolada — invoque a skill da fase direto (proposal-analyzer, tlc-spec-driven, app-pentest, impeccable...). Esta skill e o MAESTRO que encadeia as demais.
metadata:
  author: Bruno Andrade
  version: 1.0.0
---

# Pipeline de Entrega

O **maestro** do fluxo de entrega de projetos do Bruno (dev solo, freelance de complemento de renda). Conduz um projeto **do briefing do cliente ao go-live**, em 12 fases, invocando a skill certa em cada uma e **parando nos gates humanos**. O objetivo não é substituir o julgamento do Bruno — é remover o overhead de condução (não re-explicar o processo, não pular etapa, não perder contexto entre sessões) para ele **entregar mais projetos no mesmo tempo live**, sem perder qualidade.

Esta skill **não reimplementa** nada: ela rege. O trabalho pesado mora nas skills especializadas (destiladas de um projeto de referência). Ela só decide a ordem, invoca, mantém o estado e guarda os gates.

## Regras de operação (calibradas com o Bruno, 2026-07-01)

1. **Pipeline completo, sempre.** As 12 fases sempre acontecem — rápidas em projeto pequeno, mas nenhuma é pulada. Consistência acima de atalho.
2. **Pergunta na hora.** Dúvida ou bloqueio surgiu, pergunta imediatamente (HITL contínuo). Não acumula em lote. Se o Bruno souber, responde; se não, a dúvida vira item para levar ao cliente.
3. **Textos cedo, visual depois.** Textos e telas se congelam na Fase 5 (Produto) e guiam os testes; o refino visual (Claude Design → `impeccable`) é a Fase 10, pós-implementação.
4. **Comercial separado do técnico.** Fases 1–4 (viabilidade, proposta, contrato, kit) + o **dossiê** vivem numa pasta do Bruno (`~/clientes/<projeto>/` ou equivalente), **fora** do repo entregue ao cliente. O técnico (Fase 5+) vive no repo do projeto.
5. **Stack default.** Laravel + Livewire + Tailwind + Alpine + MySQL/Postgres; RN/Expo quando o projeto exige mobile. Funcionalidade primeiro, visual nos defaults até a Fase 10.

## Princípios Fundamentais

1. **Gates humanos são obrigatórios, não fricção.** go/no-go, aprovações do cliente, escolha de design, UAT — a skill PARA e espera. Pular um gate para ir mais rápido degrada a qualidade (o oposto do objetivo).
2. **A skill conduz; o Bruno e o cliente decidem.** Tudo que é decisão de negócio/produto/jurídico volta para o humano.
3. **Estado persistente no dossiê.** Todo projeto tem um dossiê (`dossie.md`) que registra fase atual, escopo, decisões, dúvidas pendentes, go/no-go, Frente A/B. É o que permite retomar sem re-explicar — o ganho de tempo real.
4. **Frente A vs Frente B.** Separar o trabalho de código (roda já, local, sem bloqueio) do de infra (espera materiais + 1ª parcela). O dev nunca fica parado esperando o cliente; o deploy sim.
5. **Rastreabilidade ponta a ponta.** Requisito → user story (WHEN/THEN) → task atômica → commit → teste. Suite verde é gate de todo commit.
6. **Reusa, não duplica.** Cada fase invoca a skill dona. A pipeline-entrega só orquestra.

## Onde vive o estado

```
~/clientes/<projeto>/           <- COMERCIAL (fora do repo do cliente)
  dossie.md                     <- estado do projeto (fonte da verdade do maestro)
  01-viabilidade.md
  02-pre-aprovacao.md
  03-adendo-contrato.md
  04-kit-fechamento.md

<repo-do-projeto>/              <- TECNICO (entregue ao cliente)
  .specs/                       <- tlc-spec-driven (STATE.md decisões/handoff, features/<feat>/spec|design|tasks|validation, LESSONS)
  docs/adr/                     <- create-adr
  docs/security/                <- app-pentest
  docs/design_handoff/          <- Claude Design + impeccable
  docs/guia-usuario/ docs/tecnica/  <- tech-docs-vitepress
```

## As 12 Fases

Detalhe operacional (objetivo, entrada, saída, artefato-modelo, gate) em `references/playbook-fases.md`. Templates dos artefatos comerciais em `references/templates-comerciais.md`. Template do dossiê em `references/dossie-template.md`.

| # | Fase | Skill invocada | Gate humano |
|---|---|---|---|
| **A. Aquisição** | | | |
| 1 | Viabilidade | `proposal-analyzer` | 🚦 go/no-go (Bruno) |
| 2 | Proposta / pré-aprovação | (template comercial) | ✅ cliente confirma escopo/valor |
| 3 | Contrato / adendo | (template jurídico) | ✍️ cliente assina |
| 4 | Kickoff / fechamento | (checklist) | 💰 materiais + 1ª parcela → **D0** |
| **B. Concepção** | | | |
| 5 | Produto (+ textos/telas congelados) | `software-architect` / `tlc-spec-driven` | ✅ valida com o cliente |
| 6 | Arquitetura + ADRs | `software-architect` + `create-adr` + `database-expert`, red-team `the-fool` | 🔎 aprova arquitetura |
| 7 | Roadmap + specs por feature | `software-architect` (roadmap/milestones) + `tlc-spec-driven` (spec por feature, com Verifier) + `testing-strategist` | ✅ aprova o plano de fases |
| **C. Construção** | | | |
| 8 | Implementação (Frente A vs B) | `laravel-expert` / `frontend-expert` / `react-native-expert` (+ subagentes) | 🧪 suite verde por commit |
| **D. Endurecimento & entrega** | | | |
| 9 | Segurança | `app-pentest` (+ `mobile-pentest` / `llm-ai-security` conforme) | 🔒 aprova fixes |
| 10 | Design (refino visual) | Claude Design (3 direções) → `impeccable`* | 🎨 escolhe 1 de 3 |
| 11 | Documentação | `tech-docs-vitepress` | 📄 valida completude |
| 12 | UAT + entrega | `verify`* + `run`* / deploy | 📦 cliente assina UAT + go-live |

\* `impeccable` (externa, instalada via npx) e `verify`/`run` (nativas do harness) **não são versionadas neste repo**; as demais skills da tabela são.

> **Pós-go-live (manutenção).** Entregue o projeto e ele entra em manutenção: a `tech-lead` assume a **saúde contínua** do codebase (vulnerabilidades + dívida técnica, ledger `HEALTH.md`). Num **intake brownfield** (retomada/expansão de projeto existente), um raio-x da `tech-lead` **antes da Fase 5/6** dá o mapa da dívida herdada. A Fase 9 continua sendo o pentest pontual pré-deploy (`app-pentest`).

## Ciclo de desenvolvimento por feature (Fases 7–8)

Dentro da construção, cada feature segue o fluxo refinado do Bruno (calibrado com a **tlc-spec-driven v3.2**) — passo a passo completo em `references/ciclo-dev.md`:

**tlc Specify → tlc Design → `the-fool` desafia o `design.md` → tlc Tasks → tlc Execute (gate de teste + commit atômico por task) → Verifier independente automático.**

Três regras que mudam a qualidade: (1) o `the-fool` desafia o **`design.md` que a tlc produz**, não um rascunho anterior; (2) **não parar nas tasks** — o Execute (1 task/commit com gate) e o Verifier independente (author ≠ verifier, roda sozinho no fim) são o ganho da v3.2; (3) **roadmap/milestones é da `software-architect`**, não da tlc (que é *feature-focused*). O ciclo de **produto novo** (greenfield) também está em `references/ciclo-dev.md`.

## Protocolo de condução

### Ao iniciar um projeto novo
1. Criar `~/clientes/<projeto>/dossie.md` a partir de `references/dossie-template.md`.
2. Registrar o briefing recebido e marcar **Fase 1**.
3. Conduzir fase a fase, sempre atualizando o dossiê ao fim de cada uma.

### Em cada fase
1. **Ler o dossiê** para saber onde está e o que já foi decidido.
2. **Invocar a skill da fase** (ou usar o template comercial) para produzir o artefato-modelo.
3. **Perguntar na hora** qualquer dúvida/bloqueio (regra 2): Bruno responde ou vira item para o cliente.
4. **Parar no gate**: apresentar o que a fase produziu e o que o gate exige (decisão do Bruno ou do cliente). Não avançar sem o gate cumprido.
5. **Atualizar o dossiê**: fase concluída, decisões, dúvidas resolvidas/pendentes, próximo passo.

### Ao retomar um projeto
1. Ler o dossiê → dizer em que fase está, o que está pendente e qual o próximo gate.
2. Continuar de onde parou.

## Regras de Output

1. **O dossiê é a fonte da verdade** — sempre atualizado ao fim de cada fase; é o que torna o projeto retomável.
2. **Um gate por vez, explícito.** Ao chegar num gate, deixar claro: o que decidir, quem decide (Bruno/cliente), e o que trava se não decidir.
3. **Comercial nunca vai pro repo do cliente** (regra 4). Técnico sim.
4. **Frente A não espera Frente B.** Enquanto materiais/pagamento não chegam, tocar o que é código puro.
5. **Não reimplementar** o que uma skill já faz — invocar e integrar o artefato.
6. **Output em PT-BR.**

## Regras Críticas

- **NUNCA pule um gate humano** para ganhar velocidade.
- **NUNCA comece implementação (Fase 8) antes do D0** (materiais + 1ª parcela) — só Frente A (código local) pode adiantar; nada de infra/deploy.
- **NUNCA coloque artefato comercial/contratual no repo do cliente.**
- **NUNCA avance de fase sem atualizar o dossiê.**
- **SEMPRE pergunte na hora** o que não souber — não invente escopo nem decisão de cliente.
- **SEMPRE trave textos na Fase 5** (os testes dependem deles); o visual refina só na Fase 10.
- **SEMPRE rode a suite (verde) como gate de cada commit** na Fase 8.

## Calibração — o projeto de referência

Todo o pipeline foi destilado de um **projeto de referência** (Laravel 13 + Livewire 4) que percorreu o fluxo inteiro e deixou o artefato de cada fase. Ao conduzir um projeto novo, comparar com ele:
- Viabilidade → `analise-viabilidade`; pré-aprovação → `documento-pre-aprovacao`; produto → `plano-produto`; kit → `kit-fechamento`; adendo → `adendo-contrato`.
- Técnico → `.specs/` (PROJECT/ARCHITECTURE/DATABASE/ROADMAP + features fN/{spec,design,tasks} + TESTING) + `docs/adr/`.
- Endurecimento → `docs/security/audit`, `docs/design_handoff`, `docs/guia-usuario` + `docs/tecnica`, `validacao-uat`.

O projeto de referência é o exemplar; um projeto novo copia a **estrutura** dos artefatos e preenche a narrativa própria. Recalibrar esta skill a cada projeto real concluído — como o `proposal-analyzer` calibrou com o EventMenu Pro.
