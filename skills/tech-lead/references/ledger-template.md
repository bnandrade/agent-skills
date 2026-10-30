# Template do ledger de saúde (`HEALTH.md`)

Copiar para `docs/HEALTH.md` no repo do projeto (ou raiz, se não houver `docs/`). É a fonte da verdade da saúde técnica — sobrevive entre sessões. Atualizar ao fim de cada varredura e ao pagar cada item.

---

```markdown
# HEALTH — <nome do projeto>

> Ledger de saúde técnica. Mantido pela skill `tech-lead`.
> Última varredura: <AAAA-MM-DD> · Stack: <ex: Laravel 13 + Livewire + MySQL>
> O que dói se quebrar: <ex: dados de denúncia (LGPD), isolamento multi-empresa>

## Placar

| Frente | P0 | P1 | P2 | P3/aceito | Pagos |
|---|---|---|---|---|---|
| Segurança (SEC) | 0 | 1 | 2 | 0 | 3 |
| Dívida (DEBT)   | 0 | 2 | 4 | 3 | 5 |

**Veredito:** <uma frase — ex: "Sólido; 1 vulnerabilidade alta e 2 dívidas caras de arquitetura a planejar.">

---

## Itens abertos

| ID | Tipo | Título | Evidência | Sev/Dor | Esforço | Prio | Status | Dona |
|---|---|---|---|---|---|---|---|---|
| SEC-004 | SEC | IDOR em GET /api/invoices/{id} — sem checar owner | `InvoiceController.php:52` | Alta (impacto alto × explor. fácil) | S | P1 | aberto | app-pentest |
| DEBT-014 | DEBT-arquitetura | OrderService faz 6 coisas, muda toda sprint, sem teste | `OrderService.php:1-240` | Alta (juros alto × alcance alto) | M | P1 | aberto | refactoring-expert |
| DEBT-015 | DEBT-dependência | Guzzle 2 majors atrás; upgrade fica mais caro a cada mês | `composer.json:18` | Média | S | P2 | aberto | laravel-expert |
| DEBT-016 | DEBT-teste | Fluxo de pagamento (alto churn) sem nenhum teste | `app/Billing/*` | Alta | M | P1 | aberto | testing-strategist |

## Aceitos / won't-fix (dívida consciente)

| ID | Título | Racional | Reavaliar quando |
|---|---|---|---|
| DEBT-021 | Duplicação nos 2 fluxos de checkout | Vão divergir no Q3 (novo gateway); abstrair agora = abstração errada | Gateway novo entrar |

## Pagos (histórico)

| ID | Título | Pago em | Commit |
|---|---|---|---|
| SEC-001 | SQLi no filtro de busca | 2026-06-30 | `a1b2c3d` |
| DEBT-009 | God Object no ReportBuilder | 2026-07-02 | `e4f5g6h` |

---

## Plano de paydown (próximo ciclo)

1. **SEC-004** (P1, S) — fix + reteste via `app-pentest`. Gate: suite verde.
2. **DEBT-016** (P1, M) — cobrir Billing antes de tocar nele (`testing-strategist` → expert de stack).
3. **DEBT-014** (P1, M) — refatorar OrderService por strangler fig (`refactoring-expert`), **depois** de DEBT-016 dar rede de segurança.
4. Lote de quick wins (P2, XS/S): DEBT-015 + faxina de `dd()`/TODOs.

## Log de varreduras

- **2026-07-16** — 1ª varredura completa. 4 SEC + 9 DEBT levantados; hotspots: OrderService, Billing, InvoiceController.
```

---

## Convenções

- **IDs estáveis e sequenciais por frente** (`SEC-001`, `DEBT-001`). Nunca reciclar um ID; item morto vira `won't-fix`, não some.
- **Referenciar o ID no commit** que paga (`fix(SEC-004): checa owner no invoice`) — liga o ledger ao histórico.
- **Evidência sempre `arquivo:linha`** e um cenário de falha em uma frase. Sem isso, não entra.
- **Fechar na hora.** Pagou → move para "Pagos" com data e commit **na mesma sessão**. Ledger desatualizado reporta saúde falsa.
- **Reavaliar os `aceito`** nas datas-gatilho — dívida aceita não é dívida esquecida.
