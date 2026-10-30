# Template — Report de AI Red Teaming

Findings de IA tem uma particularidade: sao **probabilisticos**. Todo achado carrega uma **taxa de sucesso**, nao um simples "existe/nao existe". Output em PT-BR; prompts/payloads no original.

---

```markdown
# Relatorio de AI Red Teaming — <Nome do Sistema/Agente>

- **Data:** <YYYY-MM-DD>
- **Alvo:** <app/agente; ex.: BHEN agente de suporte>
- **Modelo:** <provedor/modelo/versao>
- **Componentes:** <tools, RAG, memoria, multi-agente — o que esta em escopo>
- **Ambiente:** <producao / staging / replica isolada>
- **Autorizacao:** <sistema proprio / contrato / bounty de IA / lab>

## Sumario Executivo

<2-4 frases: postura de seguranca do sistema de IA, achados por severidade, e o
risco #1 (quase sempre excessive agency ou exfiltracao via injecao indireta).>

| Severidade | Qtd |
|---|---|
| 🔴 Critico | 0 |
| 🟠 Alto | 0 |
| 🟡 Medio | 0 |
| 🟢 Baixo | 0 |

## Arquitetura & Superficie (resumo)

- **Tools e privilegios:** <lista; efeito colateral de cada>
- **Fontes de conteudo externo:** <RAG, email, web, output de tool, memoria>
- **Fronteiras de confianca:** <onde dado nao-confiavel encontra instrucao/tool>

## Findings

### [AI-01] <Titulo> — 🔴 Critico
- **Categoria:** <LLM01 Prompt Injection (indireta) + LLM06 Excessive Agency>
- **Severidade:** 🔴 Critico — impacto <acao/dado> x consistencia
- **Taxa de sucesso:** <7/10 tentativas> (modelo <versao>, temperatura <x>)
- **Vetor:** <direto / indireto via RAG / via memoria / multi-agente>
- **PoC:**
  - **Prompt/payload injetado:**
    \`\`\`
    <o texto exato; se indireto, onde foi plantado>
    \`\`\`
  - **Comportamento observado:** <o agente chamou `send_email` com destinatario arbitrario / vazou X / renderizou Y>
- **Impacto:** <o que o atacante consegue — na ACAO ou no DADO, nao "falou errado". Calibrar pelo privilegio da tool e sensibilidade do dado.>
- **Defesa recomendada:** <arquitetural: menor privilegio / HITL / isolamento / validacao de output — nao apenas "reforcar o prompt">
- **Reteste:** <Pendente / Confirmado: taxa caiu para 0/50 apos aplicar HITL em send_email>

### [AI-02] <...> — 🟠 Alto
<mesma estrutura>

## Observacoes de robustez (nao-vulnerabilidades)

- <comportamentos de safety/qualidade sem impacto de aplicacao — separados dos findings de seguranca>

## Anexo — Metodo

- **Ferramentas:** <garak, promptfoo, inject-probe.sh, PyRIT — o que rodou>
- **Volume:** <N probes x M repeticoes; como a taxa foi medida>
- **Nao testado / fora de escopo:** <...>
```

---

## Notas de uso

- **Taxa de sucesso e obrigatoria.** "Funcionou 1x em 3" e diferente de "funcionou 30x em 30" — muda a severidade e a urgencia.
- **Impacto na acao/dado, nunca na "fala".** O que separa vulnerabilidade de reclamacao de qualidade.
- **Defesa arquitetural.** Se a unica recomendacao e "melhore o system prompt", o finding esta mal resolvido.
- **Reteste em volume.** Fix so confirmado quando a taxa de sucesso cai para perto de zero numa bateria grande.
- **Onde salvar:** perguntar ao Bruno. Sugestao: `docs/security/ai-redteam-<sistema>-<data>.md`.
```
