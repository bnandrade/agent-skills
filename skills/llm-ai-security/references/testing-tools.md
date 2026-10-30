# Ferramentas & Harness de Teste de IA

IA e probabilistica: uma passada manual nao prova nada. A cobertura de verdade vem de **rodar em volume** e **regressao continua**. Estas sao as ferramentas padrao (2026) e como compo-las.

---

## garak — scanner de vulnerabilidade de LLM (NVIDIA)
Scanner tipo "nmap para LLMs": bateria ampla de probes (injecao, jailbreak, leakage, toxicidade, alucinacao).
```bash
python -m pip install garak
garak --model_type openai --model_name gpt-4o-mini --probes promptinject,leakreplay
garak --model_type rest -G rest_config.json    # aponta para seu proprio endpoint
```
- **Uso:** varredura ampla inicial e baseline. Bom para descobrir classes de fraqueza rapidamente.
- **Custom:** `rest` generator permite mirar seu proprio agente via HTTP.

## promptfoo — red team + eval harness (o mais util no dia a dia)
Framework de avaliacao e red teaming com plugins; integra em CI para **regressao**.
```bash
npx promptfoo@latest redteam init
npx promptfoo@latest redteam run
```
- Plugins de red team: `prompt-injection`, `pii`, `harmful`, `bola`/`bfla` (autorizacao), `rbac`, `hijacking`, `excessive-agency`.
- **Uso principal:** definir os testes de seguranca do SEU app (com seu system prompt e tools) e rodar a cada mudanca de prompt/modelo. E o harness de regressao.
- Gera relatorio com taxa de sucesso por categoria.

## PyRIT — Python Risk Identification Toolkit (Microsoft)
Framework de red teaming automatizado, forte em **multi-turn** (ataques que evoluem ao longo da conversa) e orquestracao.
- **Uso:** cenarios avancados, ataques adaptativos multi-turn, automacao de campanhas de red team. Curva maior; vale quando o alvo e critico.

## Deteccao (lado defensivo)
- **Rebuff**, **LLM Guard**, **NeMo Guardrails** — camadas de deteccao/guardrail. Uteis como defesa de profundidade (nao como unica barreira). Testar a eficacia = medir quanto derrubam a taxa de sucesso.

## scripts/inject-probe.sh (deste skill)
Check rapido e sem dependencia pesada: dispara uma bateria de probes de injecao contra um endpoint proprio e mede taxa de sucesso. Bom para um smoke test antes de trazer garak/promptfoo.

---

## Metodologia de harness (o que realmente protege)

1. **Baseline com garak** — varredura ampla para achar as classes de fraqueza.
2. **Harness proprio com promptfoo** — codificar os ataques relevantes ao SEU sistema (system prompt real, tools reais, RAG real), incluindo injecao **indireta** (documento envenenado no contexto).
3. **Medir taxa de sucesso**, nao pass/fail binario. Meta: derrubar a taxa para ~0% nos vetores criticos (excessive agency, exfiltracao).
4. **Regressao em CI** — rodar o harness a cada mudanca de prompt, modelo, tool ou fonte de RAG. Prompt e modelo mudam comportamento de seguranca silenciosamente; sem regressao, uma "melhoria" de prompt reabre um buraco.
5. **Multi-turn com PyRIT** para os alvos criticos — ataques que so funcionam ao longo de varias mensagens.

> Regra: trate seguranca de IA como trata teste de software — suite versionada, roda em CI, quebra o build se a taxa de sucesso de um ataque critico subir.
