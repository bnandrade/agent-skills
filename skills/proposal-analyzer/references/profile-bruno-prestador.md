# Perfil do Prestador — Bruno Andrade

> Arquivo de referência consumido pela skill `proposal-analyzer` (e futuramente `proposal-writer`)
> para avaliar viabilidade de projetos e gerar propostas comerciais.
>
> **Última atualização:** 2026-05-18 (entrevista inicial)
> **Versão:** 1.0

---

## 1. Identidade Profissional

| Campo | Valor |
|---|---|
| Modo de operação | Solo — faz tudo sozinho, sem time fixo, sem rede de parceiros pontuais ativa |
| Forma jurídica | PJ Simples Nacional |
| Tempo de mercado | 10+ anos |
| Posicionamento | Generalista sênior — problem solver |
| Diferencial competitivo principal | Senioridade técnica + decisão arquitetural |

---

## 2. Capacidade Operacional

| Campo | Valor |
|---|---|
| Horas/semana disponíveis | até 20h |
| Projetos paralelos | 3+ (reconhece risco de qualidade) |
| Disponibilidade próximos 3 meses | parcialmente comprometido |
| Aceita deadline duro? | Sim, com folga de prazo + premium no preço |

**Implicação para a skill:**
- Capacidade realista por projeto é ~6-7h/semana se 3 estão ativos.
- Para projetos que demandem dedicação maior, sinalizar conflito de capacidade.

---

## 3. Modelo Comercial

| Campo | Valor |
|---|---|
| Valor-hora referencial | R$ [X]-[Y]/h (preencher com a sua faixa) |
| Modelo de contrato preferido | Híbrido — adapta conforme projeto |
| Forma de pagamento | Flexível, conforme cliente aceitar |
| Ticket mínimo | Sem mínimo — aceita de quick wins a projetos grandes |
| Faixa típica histórica | **R$ 5-30k em projetos de 1-2 meses** |

**Implicação para a skill:**
- Projetos significativamente acima do histórico (5x+) devem ser sinalizados como "salto de porte" — não é proibido, mas exige análise extra de risco.
- O valor-hora deve servir como **piso de cálculo**, com premium aplicado por: urgência, risco, complexidade técnica, criticidade do negócio.

---

## 4. Stack Vendável (entrega com confiança em produção)

### Backend
- **Laravel + PHP** (com Livewire, Inertia, Filament)

### Frontend Web
- **React / Next.js + TypeScript**

### Mobile
- **React Native / Expo** (cross-platform iOS+Android)

### IA / Agentes
- **Especialista** — multi-agente, RAG, memory, orquestração
- Portfolio: BHEN (AI agency self-hosted, 17 agentes em produção)

### Infraestrutura / Deploy
- **VPS** (Hetzner, DigitalOcean) + Docker + Caddy/Nginx
- **PaaS sobre VPS:** Coolify, Forge, Ploi
- **Cloudflare** (DNS, WAF, R2, Workers, Tunnels)

### Stacks NÃO vendáveis como entrega
- **Go** — tem conhecimento mas não posiciona como entrega para cliente
- **Cloud nativa AWS/GCP/Azure** — não opera com confiança em serviços gerenciados pesados (RDS, ECS, Lambda, etc)
- **Apps nativos Swift/Kotlin** — mobile sempre via React Native

**Implicação para a skill:**
- Toda proposta deve usar stack acima como ponto de partida.
- Se briefing exigir cloud nativa AWS/GCP ou app nativo Swift/Kotlin, sinalizar como **divergência de stack** e propor alternativa (Coolify/Cloudflare e React Native respectivamente) com justificativa técnica.

---

## 5. Filtros — Projetos que NÃO aceita

### Tipos de projeto rejeitados
- Sustentação de sistemas legados em PHP/Java antigos

### Setores/temas rejeitados
- Apostas, cassino, cripto especulativo

---

## 6. Red Flags de Cliente (recusa ou aplica premium pesado)

1. **"Pago depois que vender" / equity como pagamento**
   - Cliente sem capital, propondo modelo condicional ao sucesso.
   - Ação: recusar.

2. **Escopo aberto + prazo fixo + preço fixo**
   - Triângulo de ferro impossível — algo precisa ser flexível.
   - Ação: forçar negociação ou recusar.

3. **Comparação com "orçamento de primo programador"**
   - Cliente price-shopping, não entende valor técnico.
   - Ação: educar; se persistir, recusar.

4. **Excesso de stakeholders sem decisor claro**
   - Sócios em conflito, comitê, indecisão crônica.
   - Ação: exigir decisor único antes de propor.

---

## 7. Processo e Operação

| Campo | Valor |
|---|---|
| Metodologia | Sprints curtos (1-2 sem) + demo + Linear/Jira |
| Build vs buy | **Transparência total** — prefere perder o projeto a entregar algo desnecessário. Reputação > contrato forçado. |
| Manutenção pós-entrega | Caso a caso (definir por projeto no contrato) |

**Implicação para a skill:**
- Toda análise de viabilidade deve incluir seção "Build vs Buy" — investigar se já existe SaaS pronto para o problema.
- Se existir alternativa pronta de qualidade, mencionar ao cliente na proposta.

---

## 8. Regras de Decisão (calibração da skill)

### Sem teto rígido — avalia caso a caso, mas alerta nos limiares:

| Sinal | Limiar | Ação da skill |
|---|---|---|
| Duração estimada | > 6 meses | Alertar e exigir justificativa de capacidade/parceria |
| Valor estimado | > R$ 100k | Alertar (5x acima do histórico) e exigir análise de risco extra |
| Plataformas exigidas | > 2 (web + mobile + outras) | Alertar e propor escopo reduzido na contra-proposta |
| Stack divergente do vendável | qualquer item | Sinalizar e propor alternativa equivalente |
| Capacidade requerida | > 20h/sem em fase única | Alertar conflito com capacidade atual |

### Veredito automático "no-go" quando:
- Projeto exige nicho rejeitado (apostas/cripto/cassino)
- Cliente apresenta red flag #1 (pago depois que vender)
- Cliente exige escopo+prazo+preço fixos e não negocia
- Combinação: **porte 10x+ acima do histórico + duração > 12 meses + execução solo obrigatória**
  - **Caso de referência:** EventMenu Pro (2026-05-18) — R$ 300-800k estimado, 12-16 meses, 3 plataformas, multitenancy, IA. Recusado.

---

## 9. Portfólio

> ⚠️ **A definir.** Bruno vai descrever projetos relevantes para citar em propostas SaaS.
>
> Notas internas: existem referências a BHEN, Aurelia, gira-app, the-brain-app na memória,
> mas Bruno preferiu não confirmar quais podem ser citados publicamente.

---

## 10. Observações Críticas (registradas na entrevista)

### Tensão capacidade vs ambição
- 20h/sem com 3+ projetos paralelos = ~6h por projeto.
- Não há rede de parceiros pontuais ativa para aliviar carga.
- A skill deve ser conservadora ao estimar capacidade real.

### Gap de stack vs demanda de mercado
- Mercado de SaaS médio/grande costuma exigir apps nativos e cloud AWS/GCP.
- Stack vendável (RN + VPS/Coolify) é adequada para SaaS pequeno-médio com clientes que aceitam essa escolha.
- A skill deve qualificar o cliente quanto à flexibilidade de stack antes de propor.

### Decisão histórica de calibração — EventMenu Pro (2026-05-18)
- Briefing recebido para SaaS de buffets/catering: 3 módulos, 3 plataformas, 4 fases, IA, multitenancy, rastreabilidade legal.
- **Veredito: no-go** — porte 10-20x acima do histórico, duração 12-16 meses, execução solo inviável.
- Esse caso fica como **paradigma de no-go** para a skill comparar projetos futuros.
