# Dívida técnica — taxonomia e como estimar

A dívida técnica é uma metáfora financeira: você toma emprestado tempo agora (uma solução rápida) e paga **juros** depois (cada mudança futura fica mais lenta e arriscada). Como toda dívida, parte vale a pena carregar e parte precisa ser quitada. O trabalho do tech lead é saber qual é qual.

## Os quatro tipos (por que a dívida foi contraída)

Útil para não julgar. Nem toda dívida é preguiça.

| Quadrante | Origem | Exemplo | Como tratar |
|---|---|---|---|
| **Deliberada + prudente** | "Sabemos o certo, mas entregamos rápido de propósito" | MVP com validação fraca para validar mercado | Legítima. Registrar e pagar quando o produto provar valor. |
| **Deliberada + imprudente** | "Não temos tempo pra fazer certo" (e nunca volta) | Copiar-colar em vez de abstrair, sabendo que vai doer | Perigosa. Priorizar o paydown antes que componha. |
| **Acidental + prudente** | "Agora que terminamos, sabemos como deveria ter sido" | Design que só ficou claro depois de construir | Normal e saudável. Refatorar quando o custo aparecer. |
| **Acidental + imprudente** | "O que é design em camadas?" | Bug estrutural por não saber o padrão | Educar + refatorar. Costuma vir em cluster. |

## Os subtipos (onde a dívida mora) — usar no campo Tipo do ledger

- **`código`** — smells locais: função gigante, duplicação, nomes ruins, aninhamento profundo, tratamento de erro faltando, números mágicos. A `code-reviewer` acha; a `refactoring-expert` paga.
- **`arquitetura`** — acoplamento errado, camada furada (controller falando com o banco), abstração ausente ou vazando, God Object, dependência circular. Mais caro; toca muitos módulos.
- **`teste`** — código crítico sem cobertura, teste frágil/lento, mock demais escondendo bug, suíte que ninguém roda. `testing-strategist`.
- **`dependência`** — lib desatualizada, major atrasado, pacote abandonado, CVE conhecida (esta cruza para `SEC`). Juros crescem sozinhos com o tempo.
- **`dados`** — schema sem constraint/índice, migração pendente, desnormalização perigosa, coluna "temporária" que virou permanente, tipo errado. `database-expert`.
- **`doc`** — README mentindo, decisão não registrada (falta ADR), setup não reproduzível, contrato de API sem spec.
- **`conhecimento` / bus-factor** — só o Bruno entende aquele módulo; nenhuma nota; "não encoste que quebra". Para o dev solo é dívida real: é o eu-do-futuro que esqueceu. Paga-se com doc + teste + simplificação.

## Estimar a DOR (juros × alcance)

Não precisa de número exato — precisa de ordem de grandeza para ordenar. Pergunte:

**Juros — quanto custa por mês NÃO consertar?**
- Isso me faz **lento** toda vez que mexo perto? (fricção recorrente)
- Isso **gera bug** repetidamente? (olhe o `git log` — quantos fixes já tocaram esse arquivo?)
- Isso **bloqueia** uma feature que eu quero fazer?
- Os juros são **compostos**? (quanto mais espero, mais caro fica — típico de dependência e arquitetura)

**Alcance (blast radius) — quão longe vai?**
- Quantos módulos/telas dependem disso?
- Se eu mexer, quantos lugares posso quebrar?
- É um arquivo-folha isolado ou um nó central?

**Dor = Juros × Alcance.** Alta dor: te atrasa toda semana E toca meio sistema. Baixa dor: incomoda uma vez por trimestre num canto isolado.

## Estimar o ESFORÇO de pagar

- **XS** (< 2h): renomear, extrair função, adicionar constraint, bumpar dep menor.
- **S** (meio dia): extrair classe, cobrir com testes, quebrar uma função grande.
- **M** (1–3 dias): refatorar um módulo, trocar uma dependência major, introduzir uma camada.
- **L** (> 3 dias / arriscado): reescrever subsistema, migração de dados grande, mudança arquitetural ampla. Requer plano da `refactoring-expert` e possivelmente ADR.

## O cruzamento (vira a Prio do ledger)

```
              ESFORÇO baixo         ESFORÇO alto
DOR alta   │  P0/P1 — faça já    │  P1 — planeje (fatie)
           │  (o melhor ROI)     │  (strangler fig, incremental)
DOR baixa  │  P2 — quick win     │  P3 — aceite & documente
           │  (agrupe em lote)   │  (só paga se encostar)
```

- **Dor alta + esforço baixo** = o ouro. Faça primeiro, sempre.
- **Dor alta + esforço alto** = fatie. Nunca "big rewrite" de primeira — `refactoring-expert` com strangler fig, pagando por pedaços.
- **Dor baixa + esforço baixo** = quick wins; não interrompa fluxo por eles, agrupe num lote de faxina.
- **Dor baixa + esforço alto** = **won't-fix consciente**. Registre como `aceito`, não gaste um dia nisso.

## Dívida que se ACEITA (e como registrar)

Aceitar é decisão legítima — o erro é aceitar *sem registrar*. No ledger, status `aceito` + uma linha de racional:

> `DEBT-021` — Duplicação nos dois fluxos de checkout. **Aceito**: os fluxos vão divergir no Q3 (novo gateway), abstrair agora seria abstração errada. Reavaliar quando o gateway entrar.

Se a decisão for arquitetural e cara de reverter, promova a justificativa a um ADR (`create-adr`). Trade-off de risco/negócio → **pare e confirme com o Bruno** antes de marcar `aceito`.

## Cuidado com o viés (passe pelo `the-fool`)

O maior erro do dev revisando o próprio código é **confundir "não é como eu faria" com "está errado"**. Antes de gravar um `DEBT`, teste:
- Isso custa **dinheiro/tempo/risco** de verdade, ou só ofende meu gosto?
- Se um colega tivesse escrito, eu chamaria de dívida ou de estilo?
- Tem **evidência** (um bug real, uma mudança que doeu, um churn alto), ou é hipótese?

Gosto é do linter. Só entra no ledger o que tem custo demonstrável.
