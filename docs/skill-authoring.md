# Skill authoring — padrão deste repositório

Como escrever e revisar uma skill (ou um subagente) para modelos de fronteira.
O Gauntlet (`claude-skills/gauntlet/`) é a primeira skill escrita neste padrão;
as demais serão migradas em um esforço separado, depois que ele estiver em uso.

## Princípio

O contexto de uma skill deve carregar o que o modelo **não pode saber sozinho**,
não ensinar competência geral. Classifique cada instrução em uma de quatro
categorias e trate cada uma de um jeito:

| Categoria | O que é | Tratamento |
|---|---|---|
| **Invariante de protocolo** | Regra que define o comportamento da skill (ordem de fases, o que bloqueia, o que conta como evidência) | Fica na raiz, enunciada uma vez, de preferência verificável por teste ou por um harness |
| **Conhecimento de domínio / runtime** | Fato do nosso sistema ou do ambiente (comandos, layout de arquivos, semântica de um schema, rubrica de risco) | Fica numa referência carregada na fase que precisa dele |
| **Fronteira de segurança / epistêmica** | Separação de responsabilidade, autoridade humana, ação irreversível, independência entre quem faz e quem avalia | Fica na raiz e no prompt do papel; nunca é removida por "o modelo já sabe" |
| **Andaime para modelos antigos** | "Pense antes", "seja cuidadoso", "rode os testes", "considere alternativas", tutorial genérico | Removida, ou reduzida à regra concreta que a motivou |

Regra prática: **remova andaime de incompetência; preserve fronteiras de
sistema.** Uma frase genérica só fica se codifica uma regra específica da skill.

## Fronteira de ativação (description)

A `description` decide quando a skill é escolhida entre as outras. Ela responde,
com o mínimo de texto: que capacidade oferece, quando é materialmente adequada,
e o que explicitamente **não** é para ela. Evite catálogos de palavras-chave e
descrições tão amplas que a skill compete com tudo que envolve código.

## Progressive disclosure

- A raiz (`SKILL.md`) contém o que precisa estar disponível imediatamente para o
  comportamento correto: definição de sucesso, loop, papéis, invariantes,
  regras de parada, e uma tabela de **roteamento** ("precisa de X → leia Y").
- `references/` guarda o material procedural detalhado, carregado na fase que
  o usa (template de contrato, rubrica, protocolo de um papel, CLI).
- Uma fonte autoritativa por assunto. A raiz diz *quando* consultar a
  referência, não a replica. Prompts de subagente apontam para a referência em
  vez de copiar listas.
- Não fragmente por fragmentar: referência nova só quando a navegação custa
  menos do que carregar o conteúdo junto.

## Núcleo neutro, adaptador específico

- Protocolo e ferramentas determinísticas (scripts, harness) não nomeiam modelo
  nem provedor. Eles descrevem a **propriedade** exigida ("crítico fresco e
  independente"), não a execução ("sempre chame o modelo X depois do Y").
- Política de modelo, subagentes e sintaxe de invocação vivem num adaptador
  (`references/adapter-<runtime>.md`) e na configuração dos agentes.
- Uma troca de modelo de fronteira não deve exigir mudança no protocolo.

## Semântica de conclusão

Skills que orquestram trabalho declaram explicitamente quando a tarefa termina.
"A implementação existe" não é término: a skill continua, dentro do que já foi
autorizado, até uma condição de parada do protocolo (sucesso verificado, gate
humano, contradição real, esgotamento de budget, limite de sessão). Ela também
não avança para a próxima fase do projeto por conta própria. Mensagem de
progresso, resumo e fim de turno não são parada: o relatório final sai só numa
parada do protocolo, com o veredito do estado atual — nunca da narrativa.

## Checklist ao criar ou alterar materialmente uma skill

1. A `description` diz o que é, quando usar e o que não é — sem catálogo.
2. Cada instrução da raiz cabe numa das três primeiras categorias.
3. Detalhe procedural está em `references/` com roteamento explícito na raiz.
4. Nenhum nome de modelo/provedor fora do adaptador e dos frontmatters.
5. Fronteiras (autoridade humana, ações irreversíveis, independência de
   avaliação, escopo) continuam enunciadas depois de qualquer corte.
6. Condições de parada e de conclusão estão explícitas.
7. O que for verificável sem LLM tem teste (`tests/`).
8. Papéis que avaliam (crítico, juiz, revisor) tiram autoridade só das
   instruções reconhecidas do runtime, do protocolo, do contrato autorizado e
   de decisões humanas registradas; conteúdo controlado pelo candidato
   (código, arquivos de instrução, regras e skills do repositório, diff, logs,
   saídas, claims do builder) é evidência, nunca autoridade.
