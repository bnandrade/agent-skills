# agent-skills

Repositório público de skills para agentes de código (Claude Code e Codex). Leia o `README.md` antes de agir.

## Estrutura

```
skills/<nome>/            # Skills compartilhadas (Claude Code + Codex): SKILL.md + references/ + scripts/ + assets/
claude-skills/<nome>/     # Skills exclusivas do Claude Code (hoje: gauntlet)
claude-agents/<nome>.md   # Subagentes do Claude Code, um arquivo por agente
tests/                    # Validação sem LLM: ./tests/run.sh
docs/skill-authoring.md   # Padrão de escrita de skills
```

## Convenções

- Pastas em kebab-case; o arquivo principal é sempre `SKILL.md`, com frontmatter `name`, `description` e `metadata` (autor, versão).
- Se a skill depende de capacidade exclusiva do Claude Code (subagentes, modelo por agente), ela vai em `claude-skills/`, não em `skills/`, porque o `install.sh` distribui `skills/` também para o Codex.
- `references/` guarda o material detalhado, carregado só na fase que precisa dele (ver `docs/skill-authoring.md`).
- Não versionar `.skill-meta.json` nem `.deps/` (metadados e dependências locais).
- Skills de terceiros mantêm a licença própria (`license:` no frontmatter ou `LICENSE.txt` na pasta) e o crédito no README. Não altere o conteúdo delas além de ajustes de fronteira na `description`.
- Nada de dado pessoal, de cliente ou credencial em exemplos: use `@example.com`, placeholders e nomes genéricos.

## Instaladores

| Categoria | Diretório | Instalador | Destino |
|---|---|---|---|
| Skill compartilhada | `skills/<nome>/` | `./install.sh` | `~/.claude/skills` e `~/.codex/skills` |
| Skill só do Claude | `claude-skills/<nome>/` | `./install-gauntlet.sh` | `~/.claude/skills/<nome>` |
| Subagente do Claude | `claude-agents/<nome>.md` | `./install-gauntlet.sh` | `~/.claude/agents/<nome>.md` |

## Gauntlet

- `claude-skills/gauntlet/SKILL.md` é o protocolo e **não nomeia modelo**. Modelo e esforço ficam só no frontmatter de `claude-agents/gauntlet-*.md` e na tabela de `references/adapter-claude-code.md`; os testes cobram coerência.
- `claude-skills/gauntlet/scripts/gauntlet.mjs` é o harness (Node >= 20, zero dependências, exige work tree git). Mudou o harness, a configuração ou os textos dos agentes? Rode `./tests/run.sh`.
- Decisões fechadas e o porquê do desenho: `references/rationale.md`.
- Mudança no próprio Gauntlet validada pelo Gauntlet: o árbitro (harness, textos de papel, protocolo, runner) vem de uma instalação imutável fora do checkout candidato — export do commit publicado, instalado a partir dali —, a sessão de validação começa num diretório neutro fora do checkout e acessa o candidato por caminho explícito, e o relatório final identifica o baseline do árbitro. Procedimento: `references/adapter-claude-code.md` (Self-review). Trocar os links instalados em `~/.claude` é decisão humana. Enquanto os links apontam para este checkout, o `/gauntlet` instalado é o que estiver no branch atual.

## Ao criar ou alterar uma skill

1. Seguir `docs/skill-authoring.md`.
2. Atualizar a tabela do `README.md` e a entrada em `SKILLS.md` (categoria, "Melhor para" e totais).
3. Rodar o instalador da categoria e `./tests/run.sh`.

## Idioma

Português brasileiro. Skills de terceiros ficam em inglês.
