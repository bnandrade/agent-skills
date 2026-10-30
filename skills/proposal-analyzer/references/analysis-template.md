# Template de Análise de Viabilidade

> Formato literal que a skill `proposal-analyzer` deve produzir. Validado com o caso EventMenu Pro (2026-05-18).
>
> Substitua todo `[entre colchetes]` pelo conteúdo gerado. Mantenha a ordem das seções.

---

# 📋 ANÁLISE DE VIABILIDADE — [Nome do Projeto]

**Briefing analisado:** [Nome do briefing, versão, data]
**Cliente:** [Nome ou descrição do cliente + tipo: end-user / vendor / híbrido]
**Data da análise:** [YYYY-MM-DD]
**Perfil do prestador aplicado:** Bruno Andrade — v[X.Y]

---

## 🚦 Veredito Executivo

> ### **[GO | NO-GO | CONTRA-PROPOSTA]** — [frase de uma linha justificando]
>
> [1-2 parágrafos com a razão central da decisão. Sempre cite números: gap de porte, duração, capacidade. Termine com uma frase clara: "A combinação aciona X" ou "O fit técnico justifica seguir com Y".]

**Confiança da análise:** [Alta / Média / Baixa]. [Frase explicando — múltiplos sinais convergem, ou há ambiguidade no briefing.]

---

## 1. Entendimento do Projeto

**O que é:** [1-2 frases descrevendo o produto/sistema.]

**Problema do cliente:** [Qual dor está sendo resolvida.]

**Escopo funcional declarado:**
- [Lista bullets do que o briefing pede]
- [Incluir todas as features explícitas]
- [Mencionar features de IA separadamente]
- [Mencionar integrações externas separadamente]

**O que o cliente pede explicitamente na proposta:**
[Listar o que o cliente quer ver na resposta — stack, prazo, equipe, manutenção, etc.]

---

## 2. Análise Técnica — Red Flags

### 🔴 Críticos

**RF-T1. [Nome do red flag]**
- [Descrição do que foi identificado no briefing]
- **Impacto:** [horas extras, complexidade, dependências, custo recorrente]
- **Ação sugerida:** [contra-proposta, pergunta, premium, recusa parcial]

**RF-T2. [Próximo]**
- ...

### 🟡 Atenção

**RF-T[N]. [Nome]**
- [breve]

### 🟢 OK

[Listar pontos onde a stack vendável do prestador cobre bem.]

---

## 3. Análise Comercial — Red Flags

### 🔴 Críticos

**RF-C1. [Nome do red flag comercial]**
- [Descrição]
- **Implicação:** [...]
- **Pergunta crítica ao cliente:** [...]

### 🟡 Atenção

**RF-C[N]. [Nome]**
- [breve]

### Build vs Buy

> Obrigatório quando cliente é end-user.

**SaaS prontos no nicho [X]:**
- [Concorrente 1] — [diferencial, preço estimado]
- [Concorrente 2] — [...]
- [Concorrente 3] — [...]

**Cálculo de ROI grosseiro:**
- 12-24 meses de SaaS pronto: R$ [X] - R$ [Y]
- Construir do zero: R$ [W] - R$ [Z]
- **Diferencial:** [quando vale construir? quando NÃO vale?]

---

## 4. Estimativa de Ordem de Grandeza

> ⚠️ Estimativa **grosseira para análise de viabilidade**, não para proposta comercial. Pressupõe stack do prestador ([listar stack pressuposta]).

| Fase | Escopo | Duração (mês calendário, dedicação 30h/sem) | Esforço (horas) |
|---|---|---:|---:|
| Fase 1 | [...] | [X-Y meses] | [Nh-Mh] |
| Fase 2 | [...] | [...] | [...] |
| Fase 3 | [...] | [...] | [...] |
| Fase N | [...] | [...] | [...] |
| **Total** | **Projeto completo** | **[X-Y meses]** | **[Nh-Mh]** |

**Tradução em valor (valor-hora do perfil):**
- Piso (sem premium): **R$ [X]k - R$ [Y]k**
- Realista (com premium de risco, integrações, IA): **R$ [W]k - R$ [Z]k**
- **NÃO inclui:** licenças (WhatsApp BSP recorrente, tokens IA), suporte pós-lançamento, hospedagem recorrente

**Tradução em capacidade do prestador:**
- [X]h/sem por [Y] meses = [dedicação exclusiva / encaixa / inviável]
- Capacidade declarada: 20h/sem com 3+ projetos paralelos = ~6h por projeto
- **Conclusão:** [cabe / não cabe / cabe com ajuste]

---

## 5. Cruzamento com Perfil do Prestador

| Dimensão | Demanda do projeto | Capacidade/preferência do prestador | Veredito |
|---|---|---|---|
| Porte (R$) | [estimativa] | Histórico R$ 5-30k | [🟢/🟡/🔴 + texto] |
| Duração | [meses] | Alerta > 6 meses, sem teto rígido | [...] |
| Capacidade requerida | [horas/sem] | 20h/sem com 3+ paralelos | [...] |
| Stack backend | [...] | Laravel/PHP | [...] |
| Stack frontend web | [...] | React/Next + TS | [...] |
| Stack mobile | [...] | React Native | [...] |
| Stack IA | [...] | Especialista | [...] |
| Stack infra | [...] | VPS/Coolify/Cloudflare | [...] |
| Modelo de contrato | [...] | Híbrido | [...] |
| Setor | [...] | Verificar rejeitados | [...] |
| Red flags de cliente | [observado no briefing] | 4 red flags definidos no perfil | [...] |

**Score final:** [N vermelhos críticos / M amarelos / O verdes]. [Gatilho automático acionado? Sim/Não. Qual?]

---

## 6. Perguntas Pendentes ao Cliente

> Listadas mesmo em caso de no-go — Bruno pode mudar de ideia ou querer contra-proposta.

**Sobre o negócio:**
1. [Pergunta crítica 1]
2. [...]

**Sobre o escopo:**
1. [Pergunta crítica 1]
2. [...]

**Sobre prazo e orçamento:**
1. [Pergunta crítica 1]
2. [...]

**Sobre operação:**
1. [Pergunta crítica 1]
2. [...]

---

## 7. Recomendações

### 7a. Recomendação primária — [Recusar / Aceitar / Contra-propor]

[Justificativa em 1-2 parágrafos.]

**Resposta sugerida ao cliente** (rascunho — Bruno revisa antes de enviar):

> Olá [Nome],
>
> [Reconhecimento da qualidade do briefing, se aplicável.]
>
> [Posicionamento honesto: o que cabe, o que não cabe, e por quê. Sem desculpas longas — vai direto.]
>
> [Em caso de recusa: oferecer 2-3 caminhos alternativos:]
> 1. **Build vs buy** — sugerir SaaS prontos relevantes
> 2. **Indicação** — agências/parceiros que operam nesse porte
> 3. **Contra-proposta enxuta** — MVP recortado, prazo curto, valor compatível com perfil
>
> [Em caso de aceite: agradecer + listar perguntas pendentes + propor call de 30 min para alinhamento antes da proposta formal.]
>
> [Em caso de contra-proposta: descrever recorte + valor + prazo + critérios para escalar depois.]
>
> [Sempre fecha com disponibilidade para call/conversa.]
>
> Abraço,
> Bruno

### 7b. Recomendação secundária — [se aplicável]

[Outra rota possível, geralmente uma contra-proposta de escopo reduzido.]

### 7c. Recomendação descartada — [se aplicável]

[Por que NÃO seguir o caminho óbvio. Útil quando há tentação de aceitar e a skill quer reforçar a recusa.]

---

## 8. Saída Estruturada (YAML — handoff para proposal-writer)

```yaml
projeto: [Nome]
data_analise: [YYYY-MM-DD]
cliente:
  nome: [...]
  tipo: [end-user | vendor | hibrido]
  setor: [...]
veredito: [go | no-go | contra-proposta]
confianca: [alta | media | baixa]
score_red_flags:
  tecnicos_criticos: [N]
  tecnicos_atencao: [N]
  comerciais_criticos: [N]
  comerciais_atencao: [N]
estimativa:
  valor_min_brl: [N]
  valor_max_brl: [N]
  duracao_min_meses: [N]
  duracao_max_meses: [N]
  horas_min: [N]
  horas_max: [N]
gaps:
  porte_vs_historico: [Nx acima/dentro]
  duracao_vs_alerta: [sim/nao]
  capacidade_vs_disponivel: [sim/nao]
  stack_divergente:
    - [item 1]
    - [item 2]
gatilhos_automaticos_acionados:
  - [item 1]
  - [item 2]
build_vs_buy:
  cliente_e_end_user: [sim/nao]
  saas_prontos_relevantes:
    - [concorrente 1]
    - [concorrente 2]
  recomendacao_buy: [sim/nao/condicional]
proxima_acao_sugerida: [recusar | aceitar | contra-propor | pedir-clarificacao]
tempo_para_resposta_cliente_horas: [24 | 48 | 72]
```

---

## Pós-output: persistência

Ao final da análise, sempre perguntar:

> Onde quer salvar essa análise?
> 1. `~/code/brain-proposals/analyses/<nome>-<YYYY-MM-DD>.md` (se o repo existir)
> 2. `~/Documents/proposals/<nome>.md`
> 3. Apenas exibir no chat (você copia)
> 4. Outro caminho (especificar)

Nunca salvar sem confirmação.
