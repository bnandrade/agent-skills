# Templates Comerciais (fases sem skill dona)

As fases 2, 3 e 4 não têm skill especializada — são template + checklist, destilados do projeto de referência. Ficam na pasta comercial do prestador (`~/clientes/<projeto>/`), nunca no repo do cliente. Tudo em PT-BR, linguagem clara para o cliente.

---

## Fase 2 — Pré-aprovação (`02-pre-aprovacao.md`)

Comunica o escopo ao cliente em prosa não-técnica e trava o "de acordo".

```markdown
# <Projeto> — Proposta / Pré-aprovação

## O que entendi que você precisa
<reformulação clara do pedido do cliente, sem jargão.>

## O que o sistema vai ter (MVP)
1. <módulo em linguagem de negócio>
2. ...
(numerar; cada item é uma capacidade que o cliente reconhece.)

## Infraestrutura e custos mensais
- Onde roda: <provedor / porte do servidor>
- Custos recorrentes (separados da entrega): <servidor, domínio, e-mail, etc. R$/mês>

## Suporte e garantia
- Garantia: <período> — correção de defeitos do que foi entregue.
- Suporte pós-entrega: <modelo / valor, se houver>

## Expansões futuras (Fase 2 — avaliadas caso a caso)
- <itens fora do MVP, com estimativa de ordem de grandeza>

## Investimento e prazo
- Valor: <R$ fechado> · Pagamento: <ex.: 50% início / 50% entrega>
- Prazo: <dias corridos> a partir do D0 (materiais + 1ª parcela)
- **Incluído:** <...>  ·  **Não incluído:** <licenças, tokens de IA, infra recorrente>
```
**Gate:** cliente confirma ("está OK assim?").

---

## Fase 3 — Adendo contratual (`03-adendo-contrato.md`)

Ajusta cláusulas sensíveis antes da assinatura. Sugerir validação com advogado nas de multa/rescisão/vínculo.

```markdown
# <Projeto> — Ajustes de Contrato

## Contexto
Valor <R$>, parcelas <datas>, garantia <período>. Pontos a ajustar antes de assinar:

## Ajustes propostos
1. **Início do prazo** — conta a partir da 1ª parcela paga + materiais entregues (não da assinatura).
2. **Multa por atraso** — só imputável à parte culpada; recíproca.
3. **Rescisão por atraso** — por culpa exclusiva; devolução proporcional ao não-entregue.
4. **Anexo com a proposta fechada** — o escopo aprovado vira anexo do contrato.
5. **Ausência de vínculo empregatício** — se PF (prestação de serviço, não emprego).

## Texto para enviar ao cliente
<parágrafo cordial e claro explicando os ajustes e por quê protegem os dois.>

## Redação formal (colar no contrato)
<cláusulas redigidas, prontas.>

## Pendências
- [ ] datas confirmadas  - [ ] anexo da proposta  - [ ] validação jurídica
```
**Gate:** cliente aprova as cláusulas + assina.

---

## Fase 4 — Kit de fechamento (`04-kit-fechamento.md`)

Operacionaliza o D0: coleta materiais, recebe 1ª parcela, dispara o relógio.

```markdown
# <Projeto> — Kit de Fechamento

## Mensagem pro cliente (copiar/colar — WhatsApp/e-mail)
<pedido claro dos itens, deixando explícito o que trava o início do prazo.>

## Checklist de bloqueadores (controle interno)
| Item | Trava o D0? | Prazo | Status |
|---|---|---|---|
| <logo / identidade> | sim | | ⬜ |
| <textos/cartilha/termo> | sim | | ⬜ |
| <acessos/credenciais de terceiros> | sim | | ⬜ |
| 1ª parcela (PIX) | **sim** | | ⬜ |

## Fluxo de recepção
1. Item chega → conferir.
2. Todos os bloqueadores OK + PIX confirmado → **dispara D0**, agenda D5 (walking skeleton) e D<N> (entrega).

## Conversas a ter durante o projeto (pauta)
- <pontos legais / LGPD / expectativas / data de entrega>

## Lembretes de postura (pre-mortem)
- Escopo é escopo — não recalcular no meio.
- Critério de execução binário: está no escopo aprovado ou não está.
```
**Gate:** materiais + 1ª parcela em mãos → **D0 dispara** (libera a Frente B / infra).

---

> As fases 5+ usam artefatos gerados pelas skills técnicas (tlc-spec-driven, create-adr, app-pentest, tech-docs-vitepress…) — não precisam de template aqui; a `pipeline-entrega` apenas invoca a skill e integra o artefato no repo do projeto.
