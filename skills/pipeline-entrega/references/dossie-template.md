# Template — Dossiê do Projeto

O estado persistente do projeto e a fonte da verdade do maestro. Vive em `~/clientes/<projeto>/dossie.md` (fora do repo do cliente). Atualizado ao fim de cada fase. É o que permite retomar sem re-explicar nada.

---

```markdown
# Dossiê — <Projeto> (<Cliente>)

- **Cliente:** <nome / contato>
- **Início:** <YYYY-MM-DD>
- **Stack:** <Laravel+Livewire+Tailwind+Alpine+MySQL | +RN se mobile>
- **Repo técnico:** <caminho / URL do repo do projeto>
- **Pasta comercial:** ~/clientes/<projeto>/

## Estado

- **Fase atual:** <N — nome> (<em andamento | aguardando gate | bloqueada>)
- **Próximo gate:** <o que precisa ser decidido, por quem (Bruno/cliente)>
- **D0 (relógio):** <data em que materiais + 1ª parcela chegaram | ainda não disparou>

## Veredito & escopo

- **Viabilidade:** <GO | NO-GO | contra-proposta> (<data>)
- **Escopo (resumo):** <1-3 linhas + link p/ plano-produto>
- **Valor / prazo:** <R$ fechado / dias corridos> · **Incluído:** <...> · **Fora:** <Fase 2: ...>

## Gates (checklist das 12 fases)

- [ ] 1. Viabilidade — go/no-go
- [ ] 2. Pré-aprovação — cliente confirma escopo/valor
- [ ] 3. Contrato — cliente assina
- [ ] 4. Kickoff — materiais + 1ª parcela (D0)
- [ ] 5. Produto — valida com cliente (+ textos travados)
- [ ] 6. Arquitetura — aprova
- [ ] 7. Roadmap/specs — aprova plano de fases
- [ ] 8. Implementação — suite verde
- [ ] 9. Segurança — aprova fixes
- [ ] 10. Design — escolhe 1 de 3
- [ ] 11. Documentação — valida completude
- [ ] 12. UAT + entrega — cliente assina + go-live

## Frentes (paralelização)

- **Frente A (código, local):** <status — o que dá pra tocar sem depender do cliente>
- **Frente B (infra/deploy):** <bloqueada até D0 | liberada — status>

## Decisões-chave (log)

| Data | Decisão | Por quê |
|---|---|---|
| | | |

## Dúvidas pendentes

| # | Dúvida | Para (Bruno/cliente) | Status |
|---|---|---|---|
| | | | |

## Artefatos

- **Comercial** (nesta pasta): 01-viabilidade · 02-pre-aprovacao · 03-adendo-contrato · 04-kit-fechamento
- **Técnico** (repo): `.specs/` · `docs/adr/` · `docs/security/` · `docs/design_handoff/` · `docs/guia-usuario/` + `docs/tecnica/`

## Próximo passo
<a próxima ação concreta>
```

---

## Notas de uso
- **Sempre reler o dossiê ao iniciar/retomar** — é o primeiro passo de qualquer sessão do projeto.
- **Atualizar ao fim de cada fase** (fase, gate, decisões, dúvidas, próximo passo). Dossiê desatualizado = contexto perdido.
- **Dúvidas pendentes** com destino explícito (Bruno resolve na hora, ou vira item pro cliente).
- **Nunca commitar o dossiê no repo do cliente** — é comercial/interno.
