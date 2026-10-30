# Decision Framework

Framework estruturado para avaliar e tomar decisões de tecnologia e arquitetura.

---

## Table of Contents

1. [O Processo de Decisão](#1-o-processo-de-decisao)
2. [Coleta de Contexto](#2-coleta-de-contexto)
3. [Avaliação de Opções](#3-avaliacao-de-opcoes)
4. [Matriz de Decisão](#4-matriz-de-decisao)
5. [Análise de Trade-offs](#5-analise-de-trade-offs)
6. [Validação da Decisão](#6-validacao-da-decisao)
7. [Anti-Patterns de Decisão](#7-anti-patterns-de-decisao)

---

## 1. O Processo de Decisão

```
Context → Constraints → Options → Trade-offs → Decision → Validation
```

### 1.1 Regras do Processo

- **Nunca pule a coleta de contexto.** Decisões sem contexto são chutes.
- **Limite as opções a 2-3.** Mais do que isso paralisa a decisão.
- **Toda decisão tem trade-offs.** Se parece perfeita, você está ignorando algo.
- **Decisões são reversíveis até certo ponto.** Identifique o "ponto sem volta".
- **Documente o "porquê", não só o "quê".** Futuro-você vai agradecer.

### 1.2 Tipos de Decisão

| Tipo | Reversibilidade | Tempo de análise | Exemplo |
|---|---|---|---|
| **Type 1** — porta de mão única | Difícil de reverter | Dias/semanas | Linguagem principal, banco de dados, cloud provider |
| **Type 2** — porta de mão dupla | Fácil de reverter | Horas | Library de componentes, ORM, ferramenta de deploy |

**Type 1** merece análise profunda. **Type 2** merece uma decisão rápida — não otimize.

---

## 2. Coleta de Contexto

### 2.1 Perguntas Obrigatórias

Antes de qualquer recomendação, coletar:

**Produto:**
- O que o produto faz? (elevator pitch em 2 frases)
- Qual o estágio? (ideia | MVP | validado | scaling | maduro)
- Qual o prazo? (2 semanas | 1-3 meses | 6+ meses)
- Quantos usuários esperados? (10 | 100 | 1.000 | 10.000 | 100.000+)
- Quais as features core? (CRUD, real-time, upload, pagamento, chat, etc.)

**Time:**
- Quantos devs? (solo | 2-5 | 5-15 | 15+)
- Quais tecnologias o time domina?
- Existe código/infra existente? (greenfield vs brownfield)
- O time tem experiência com DevOps/infra?

**Constraints:**
- Budget para infra? (zero | < R$500/mês | < R$5.000/mês | enterprise)
- Compliance? (LGPD, HIPAA, PCI-DSS, SOC2)
- Requisitos de disponibilidade? (99% | 99.9% | 99.99%)
- Precisa funcionar offline?
- Tem requisitos de real-time? (< 100ms latência)
- Mobile é necessário? (agora | futuro | nunca)

### 2.2 Contexto Implícito

Informações que você pode inferir (mas deve confirmar):

- Dev solo + prazo curto = priorize produtividade sobre performance
- MVP = priorize velocidade sobre escalabilidade
- Produto validado com receita = pode investir em infra robusta
- Time com expertise em X = use X, a menos que haja razão forte contra
- Budget zero = PaaS grátis (Vercel, Railway, Render tier free)

---

## 3. Avaliação de Opções

### 3.1 Critérios de Avaliação

Para cada tecnologia candidata, avaliar:

| Critério | Peso (MVP) | Peso (Scale) | Como avaliar |
|---|---|---|---|
| **Team Fit** | ALTO | MEDIO | O time já usou? Quanto tempo para produtividade? |
| **Produtividade** | ALTO | MEDIO | Quanto código/config para uma feature típica? |
| **Maturidade** | MEDIO | ALTO | Anos em produção? Tamanho da comunidade? CVEs recentes? |
| **Escalabilidade** | BAIXO | ALTO | Limites conhecidos? Caso de uso em escala? |
| **Ecossistema** | MEDIO | ALTO | Libraries, ferramentas, integrações disponíveis? |
| **Custo operacional** | MEDIO | ALTO | Hosting, licenças, manutenção, monitoring? |
| **Hiring** | BAIXO | ALTO | Consigo contratar devs com essa skill? |

### 3.2 Avaliação Rápida (MVP)

Para MVPs, pese apenas 3 critérios:

1. **O time sabe usar?** → Se sim, use.
2. **Resolve o problema?** → Se sim, use.
3. **É mantido e documentado?** → Se sim, use.

Se respondeu "sim" 3 vezes, pare de analisar e comece a construir.

### 3.3 Avaliação Profunda (Produto Validado)

Para produtos validados, adicione:

4. **Qual o custo de migrar depois?** → Se alto, invista mais tempo na decisão agora.
5. **Qual o maior risco técnico?** → Mitigue antes de começar.
6. **O ecossistema suporta as integrações que preciso?** → Teste antes de comprometer.

---

## 4. Matriz de Decisão

### 4.1 Template

Quando comparando 2-3 opções para uma camada:

```
## [Camada]: API Framework

| Critério           | Laravel (PHP) | Django (Python) | Express (Node) |
|--------------------|:---:|:---:|:---:|
| Team Fit           | ★★★★★ | ★★☆☆☆ | ★★★☆☆ |
| Produtividade      | ★★★★★ | ★★★★☆ | ★★★☆☆ |
| Maturidade         | ★★★★★ | ★★★★★ | ★★★★☆ |
| Escalabilidade     | ★★★☆☆ | ★★★☆☆ | ★★★★☆ |
| Ecossistema        | ★★★★☆ | ★★★★☆ | ★★★★★ |
| Custo operacional  | ★★★★☆ | ★★★★☆ | ★★★★☆ |

→ Recomendação: **Laravel** — team fit e produtividade são decisivos neste contexto.
```

### 4.2 Quando NÃO Usar Matriz

- Se uma opção domina em **todos** os critérios → não precisa de matriz
- Se o time já usa e funciona → não precisa de análise
- Se é uma decisão Type 2 (facilmente reversível) → escolha rápido

---

## 5. Análise de Trade-offs

### 5.1 Todo Trade-off Tem Duas Faces

Nunca apresente um trade-off como apenas negativo. Mostre o que se ganha:

```
RUIM: "Laravel não escala bem"
BOM:  "Laravel lida com ~500 req/s por instância. Para seu cenário
       (100 users), é mais que suficiente. Se chegar a 10k+ concurrent,
       pode horizontalizar com load balancer ou extrair serviços críticos."
```

### 5.2 Trade-off Template

```
Escolha: [tecnologia escolhida]
Ganha:   [o que essa escolha otimiza]
Perde:   [o que essa escolha sacrifica]
Mitiga:  [como minimizar a perda]
Revisa:  [quando reconsiderar essa decisão]
```

### 5.3 Trade-offs Universais

| Otimiza para... | Sacrifica... |
|---|---|
| Velocidade de entrega | Flexibilidade futura |
| Performance máxima | Produtividade do dev |
| Consistência de dados | Latência (em distribuídos) |
| Simplicidade | Features avançadas |
| Custo baixo | Conveniência operacional |
| Autonomia dos times | Padronização |
| Type-safety | Verbosidade / curva de aprendizado |

---

## 6. Validação da Decisão

### 6.1 Checklist Pré-Commit

Antes de finalizar uma decisão arquitetural:

- [ ] O contexto foi coletado? (produto, time, constraints)
- [ ] Pelo menos 2 opções foram consideradas?
- [ ] Trade-offs foram explicitados?
- [ ] A decisão está alinhada com o estágio do produto?
- [ ] O time consegue executar com essa escolha?
- [ ] O custo está dentro do budget?
- [ ] Existe um plano se a decisão se mostrar errada?

### 6.2 Sinais de Decisão Ruim

- "Todo mundo está usando" → hype, não justificação
- "É a tecnologia do futuro" → especulação, não evidência
- "Nunca vamos precisar mudar" → overconfidence
- "É mais complexo, mas vale a pena" → sem contexto de pra quem vale
- Ninguém no time usou em produção → risco alto
- A decisão foi tomada em 5 minutos para um problema Type 1

### 6.3 Integração com Outras Skills

Após decidir:

1. **`the-fool`** — stress-test: "se esse componente falhar, o que acontece?"
2. **`create-adr`** — documentar: contexto, decisão, consequências
3. **`tlc-spec-driven`** — planejar: fases de implementação
4. **`mermaid-studio`** — visualizar: diagrama da arquitetura

---

## 7. Anti-Patterns de Decisão

### 7.1 Resume-Driven Development

Escolher tecnologia porque "fica bom no currículo" em vez de resolver o problema.

**Sintoma:** Kubernetes para um app com 3 usuários.

### 7.2 Hype-Driven Development

Adotar a tecnologia da moda sem avaliar fit.

**Sintoma:** Reescrever tudo em Rust porque "é rápido" quando o bottleneck é I/O de banco.

### 7.3 Golden Hammer

Usar a mesma tecnologia para tudo porque é a que o time conhece.

**Sintoma:** MongoDB para dados altamente relacionais.

**Nota:** Golden hammer é um anti-pattern, mas para MVPs, usar o que o time sabe é frequentemente a decisão **correta**. O anti-pattern é quando o custo de forçar a ferramenta errada excede o custo de aprender a certa.

### 7.4 Analysis Paralysis

Analisar infinitamente sem decidir.

**Sintoma:** 3 semanas comparando React vs Vue vs Svelte vs Solid para uma landing page.

**Cura:** Decisões Type 2 devem ser tomadas em horas, não dias.

### 7.5 Premature Scaling

Arquitetar para 1 milhão de usuários quando você tem 10.

**Sintoma:** Microservices, event sourcing, CQRS, Kafka — para um MVP.

### 7.6 Ignoring the Cliff

Escolher a opção mais simples sem considerar limites conhecidos.

**Sintoma:** SQLite para um SaaS multi-tenant com writes concorrentes pesados.

**Equilíbrio:** Simplifique, mas conheça os limites do que você escolheu.
