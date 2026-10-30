# Ciclo de desenvolvimento — passo a passo (Bruno)

O fluxo de execução do Bruno, calibrado com a **tlc-spec-driven v3.2**. Dois ciclos: uma **feature** (dentro de um projeto existente) e um **produto novo** (greenfield). Serve tanto conduzido pela `pipeline-entrega` quanto solto no dia a dia.

## Princípios (valem para os dois)

1. **Roadmap ≠ feature.** A tlc v3.2 é *feature-focused* — ela largou a camada de roadmap/init de projeto. Planejamento de produto/milestones é da `software-architect` + dossiê. Uma feature = tlc; o produto inteiro = software-architect, depois tlc por feature.
2. **the-fool sobre o `design.md`, não sobre o rascunho.** Deixe a tlc produzir o Design e desafie *esse* artefato — é o que vira código. Desafiar um plano anterior é desafiar o que já mudou.
3. **Não pare nas tasks.** O salto da v3.2 está no **Execute** (1 task/commit com gate de teste) e no **Verifier independente** (author ≠ verifier, roda sozinho no fim). Gerar tasks e implementar por fora joga fora o melhor da skill.
4. **Verifier é automático.** Não peça — ele dispara após a última task, checa contra a spec, injeta falhas pra confirmar que os testes detectam, escreve `validation.md` e devolve veredito. Gaps viram fix tasks (loop até 3×).
5. **Setup de modelo recomendado pelo autor:** Opus planeja, Sonnet implementa.

---

## Ciclo A — Nova FEATURE (projeto existente)

1. **Demanda.** Descreva o que a feature precisa fazer (uma frase a um parágrafo). Sem escrever plano formal — a tlc faz isso melhor no passo 2.
2. **tlc → Specify** *(sempre)*. Rode a tlc. Ela mapeia o escopo com o **Requirement Closure Gate**: requisitos testáveis com IDs, casos de borda e **tabela de fora-de-escopo**. Cada área cinzenta é resolvida com você **ou** registrada como premissa assinada — nada sai ambíguo. → `spec.md`.
3. **tlc → Design** *(auto-pulado se não há decisão a tomar)*. Arquitetura, fluxo de dados, reúso de código, mitigação de áreas frágeis. → `design.md`.
4. **the-fool sobre o `design.md`.** Rode o the-fool (pre-mortem / red team) contra o design que a tlc produziu. Ajuste o `design.md` conforme os furos antes de quebrar em tasks. *(Chamado direto por você, ele pergunta o modo — normal.)*
5. **tlc → Tasks** *(auto-pulado se ≤3 passos óbvios)*. Tarefas atômicas com dependências, testes e critérios de verificação. → `tasks.md`. Se >~8 tasks, a tlc oferece sub-agentes (offer-then-confirm).
6. **tlc → Execute** *(sempre)*. Uma task por vez: o test runner precisa passar (**gate**) antes de cada **commit atômico**. Nunca enfraquecer/pular teste pra passar.
7. **Verifier** *(automático, sempre)*. Sub-agente novo e read-only checa resultado contra a spec + sensor de discriminação (injeta falhas). → `validation.md` (PASS/FAIL por critério). Gaps → fix tasks (até 3 iterações).
8. **Lições.** Cada falha grounded vira lição project-local (`.specs/STATE.md` / `LESSONS.md`) — a tlc fica mais afiada no seu projeto a cada uso.

> Estado/retomada: tudo em `.specs/STATE.md` (decisões AD-NNN + handoff). Pausou? Retoma lendo o STATE.md.

---

## Ciclo B — Novo PRODUTO (greenfield)

Um produto não é uma feature — é o pipeline. Se for **projeto de cliente**, isto mora dentro das 12 fases da `pipeline-entrega` (Fases 1–4 comerciais primeiro). Se for **produto pessoal**, comece no passo 1 abaixo.

1. **Produto (o quê).** Defina visão, usuários, telas e textos principais. Congela cedo (guiam os testes). *(Na pipeline: Fase 5, com `software-architect`.)*
2. **Arquitetura + decisões.** `software-architect` desenha a stack, a arquitetura e o **roadmap/milestones** (isto é dela agora, não da tlc). Red-team com **the-fool** (pre-mortem da arquitetura). Registre as escolhas duras com **create-adr**. *(Fases 6.)*
3. **Roadmap de features.** `software-architect` + dossiê quebram o produto em **features priorizadas** com dependências. *(Fase 7, nível roadmap.)*
4. **Por feature → rode o Ciclo A.** Para cada feature do roadmap, execute o **Ciclo A inteiro** (Specify → Design → the-fool → Tasks → Execute → Verify). *(Fases 7 spec-por-feature → 8 construção.)*
5. **Endurecimento & entrega.** `app-pentest` (segurança pré-deploy), `impeccable` (refino visual), `tech-docs-vitepress` (docs/handoff), `verify`/`run` (UAT + go-live). *(Fases 9–12.)*
6. **Pós-go-live.** O produto entra em manutenção → `tech-lead` assume a **saúde contínua** (vulnerabilidades + dívida, ledger `HEALTH.md`).

---

## Resumo de 1 linha

- **Feature:** tlc Specify → tlc Design → **the-fool no design.md** → tlc Tasks → **tlc Execute (gate/commit) → Verifier automático**.
- **Produto:** software-architect (arquitetura + roadmap, red-team the-fool, ADRs) → **Ciclo A por feature** → endurecimento/entrega → tech-lead na manutenção.
