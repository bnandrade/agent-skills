# Playbook das 12 Fases

Destilado de um projeto de referência (o exemplar). Cada fase: **objetivo · skill · entrada · saída · artefato-modelo (seções) · gate**. As fases técnicas 6–7 são o `tlc-spec-driven` em ação — aqui vai só o essencial; o detalhe mora na própria skill.

---

## BLOCO A — Aquisição (comercial; artefatos na pasta comercial do prestador)

### Fase 1 — Viabilidade
- **Objetivo:** decidir se vale pegar o projeto antes de investir em proposta.
- **Skill:** `proposal-analyzer`.
- **Entrada:** briefing do cliente (PDF/Word/áudio/texto) + perfil do prestador.
- **Saída:** `01-viabilidade.md` — veredito go/no-go/contra-proposta, estimativa de ordem de grandeza, red flags, perguntas pendentes, YAML de handoff.
- **Gate:** 🚦 **go/no-go do Bruno.** No-go → gerar recusa cordial e parar.

### Fase 2 — Proposta / Pré-aprovação
- **Objetivo:** comunicar escopo, custos e prazo ao cliente em linguagem não-técnica, e travar o "de acordo".
- **Skill:** template comercial (ver `templates-comerciais.md`).
- **Entrada:** veredito GO + respostas às perguntas pendentes.
- **Saída:** `02-pre-aprovacao.md` — entendimento, módulos do MVP em prosa, infra/custos mensais, suporte/garantia, investimento/prazo, incluído vs não-incluído.
- **Gate:** ✅ **cliente confirma** escopo e valor ("entendi assim, está OK?").

### Fase 3 — Contrato / Adendo
- **Objetivo:** proteger ambas as partes em cláusulas sensíveis antes de assinar.
- **Skill:** template jurídico (ver `templates-comerciais.md`).
- **Entrada:** proposta aprovada + esboço de contrato.
- **Saída:** `03-adendo-contrato.md` — ajustes (início do prazo atrelado à 1ª parcela + materiais, multa recíproca, rescisão por culpa, anexo com escopo, vínculo se PF), texto pro cliente, redação formal.
- **Gate:** ✍️ **cliente assina.** (Cláusulas jurídicas: sugerir validação com advogado.)

### Fase 4 — Kickoff / Fechamento
- **Objetivo:** operacionalizar o início — coletar materiais, receber 1ª parcela, disparar o relógio.
- **Skill:** checklist (ver `templates-comerciais.md`).
- **Entrada:** contrato assinado.
- **Saída:** `04-kit-fechamento.md` — mensagem pronta pro cliente, checklist de bloqueadores (o que trava o D0), fluxo de recepção, pauta de conversas, lembretes de postura (escopo é escopo).
- **Gate:** 💰 **materiais + 1ª parcela em mãos → dispara D0.** Só a partir daqui a Frente B (infra) pode começar.

---

## BLOCO B — Concepção (técnico; artefatos no repo do projeto)

### Fase 5 — Produto (+ congelar textos/telas)
- **Objetivo:** documento-mestre do produto; **congelar textos e telas** que vão guiar os testes (regra "textos cedo").
- **Skill:** `software-architect` (design de produto) / `tlc-spec-driven` (specify).
- **Saída:** `plano-produto` — visão/modelo de negócio, perfis × permissões, módulos do MVP, regras de negócio, infra/LGPD/retenção, fora de escopo, premissas/gaps. + lista de **textos travados** (fonte da verdade dos testes de conteúdo).
- **Gate:** ✅ **valida com o cliente** (evita surpresa no dev).

### Fase 6 — Arquitetura + ADRs
- **Objetivo:** estilo arquitetural, stack por camada, modelo de dados e decisões duráveis.
- **Skills:** `software-architect` (ARCHITECTURE) + `database-expert` (DATABASE) + `create-adr` (ADRs) + `the-fool` (red-team do plano).
- **Saída:** `.specs/project/{PROJECT,ARCHITECTURE,DATABASE}.md` + `docs/adr/NNN-*.md` (formato Nygard: contexto, drivers, ≥2 opções, decisão, consequências, status Accepted/Superseded).
- **Gate:** 🔎 **aprova a arquitetura** (segurança, LGPD, infra).

### Fase 7 — Roadmap + specs por feature
- **Objetivo:** quebrar a visão em milestones e cada feature em spec→design→tasks, com estratégia de testes.
- **Skills:** `tlc-spec-driven` (ROADMAP + features) + `testing-strategist` (TESTING).
- **Saída:** `.specs/project/ROADMAP.md` (milestones, **Frente A vs B** por feature) + `.specs/features/fN/{spec,design,tasks}.md` (user stories WHEN/THEN, code-reuse, tasks atômicas com done-when/tests/gate/commit) + `.specs/codebase/TESTING.md` (diamond, mapa de risco).
- **Gate:** ✅ **aprova o plano de fases** (timeline + critérios).

---

## BLOCO C — Construção

### Fase 8 — Implementação
- **Objetivo:** executar as tasks, funcionalidade primeiro, visual nos defaults.
- **Skills:** `laravel-expert` / `frontend-expert` / `react-native-expert` conforme o stack; subagentes para features independentes em paralelo.
- **Regra:** **Frente A (código local)** roda desde já; **Frente B (infra/deploy)** só após D0. Tasks atômicas → commits rastreáveis → **suite verde é gate de cada commit**.
- **Saída:** código + testes (feature/unit/smoke conforme o TESTING).
- **Gate:** 🧪 **suite verde** e features do milestone concluídas.

---

## BLOCO D — Endurecimento & entrega

### Fase 9 — Segurança
- **Objetivo:** achar e corrigir vulnerabilidades antes de produção.
- **Skills:** `app-pentest` (web); `mobile-pentest` se houver app RN; `llm-ai-security` se houver IA/agente.
- **Saída:** `docs/security/audit-<data>.md` (veredito, findings priorizados, fixes) — fixes numa branch `security/pre-deploy-hardening`.
- **Gate:** 🔒 **aprova os fixes** (e valida no browser o que puder quebrar, ex.: CSP).

### Fase 10 — Design (refino visual)
- **Objetivo:** transformar o visual default em UI profissional (regra "visual depois").
- **Skills:** Claude Design (gera 3 direções) → `impeccable` (refina tokens/componentes).
- **Saída:** `docs/design_handoff/` — design system, telas, tokens Tailwind, componentes prontos. (Textos já vêm travados da Fase 5.)
- **Gate:** 🎨 **escolhe 1 de 3 direções.**

### Fase 11 — Documentação
- **Objetivo:** guias navegáveis para usuário final e para outro dev.
- **Skill:** `tech-docs-vitepress`.
- **Saída:** `docs/guia-usuario/` (por perfil, com screenshots) + `docs/tecnica/` (visão, dados, segurança, operação/deploy, testes) + runbooks.
- **Gate:** 📄 **valida completude** com o cliente.

### Fase 12 — UAT + Entrega
- **Objetivo:** validar a experiência real e entregar/operacionalizar.
- **Skills:** `verify` (navegação manual dos fluxos) + `run`/deploy (Forge/runbook).
- **Saída:** roteiro de UAT (casos por perfil, marcados ⭐ DEMO) + apresentação + runbooks de operação; app em produção.
- **Gate:** 📦 **cliente assina o UAT + go-live/cutover.**

---

## Nota de encadeamento
Aquisição trava escopo/valor/proteção; Concepção vira o plano executável; Construção entrega código testado (Frente A adianta, B espera D0); Endurecimento deixa seguro, bonito, documentado e validado. "Projeto pronto" = seguro (auditado) + testado (automático + UAT) + documentado (2 públicos) + visualmente consistente + operável (runbook) — e o cliente consegue tocar sozinho.
