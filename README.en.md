# agent-skills

Short English version. The full README, catalog and workflow are in Portuguese: [`README.md`](README.md).

**What a skill is:** a `SKILL.md` file in the [Agent Skills](https://agentskills.io) format, with instructions and references that a coding agent loads on its own when the task calls for it (reviewing a PR, modeling a database, auditing security, writing a proposal).
**Who it is for:** people who use [Claude Code](https://docs.anthropic.com/en/docs/claude-code) or [Codex](https://github.com/openai/codex) every day.
**Prerequisites:** `bash` and `git` on Linux (macOS untested; Windows unsupported). The gauntlet needs Node >= 20.

**37 skills**: 29 written by me, 8 by other people, redistributed with credit and their original licenses (see Credits below). Everything in `skills/` works in Claude Code **and** Codex; the `gauntlet` and the agents in `claude-agents/` are **Claude Code only**.

> Personal setup, published as a reference. No guaranteed support.

## Install

```bash
git clone https://github.com/bnandrade/agent-skills.git   # or git@github.com:bnandrade/agent-skills.git
cd agent-skills
./install.sh              # symlinks into ~/.claude/skills and, if present, ~/.codex/skills
./install-gauntlet.sh     # Claude Code only: agents in ~/.claude/agents + the /gauntlet skill
./tests/run.sh            # validate the repository (no LLM needed)
```

`./uninstall.sh` and `./install-gauntlet.sh --uninstall` remove the symlinks and restore whatever was there before. Open a new agent session after installing.

## What is inside

- **Stack experts:** `laravel-expert`, `go-expert`, `frontend-expert`, `react-native-expert`, `database-expert`, `api-designer`, `agent-engineer`.
- **Code quality:** `code-reviewer`, `refactoring-expert`, `testing-strategist`, `tech-lead`, `ui-verifier`, `gauntlet` (Claude Code only: an evidence-driven build → verify → critique → fix loop with independent critics).
- **Planning:** `tlc-spec-driven`, `the-fool`, `create-adr`, `software-architect`, `pipeline-entrega` (end-to-end freelance delivery, in Portuguese).
- **Security:** `app-pentest`, `recon-osint`, `bug-bounty`, `llm-ai-security`, `mobile-pentest`, `security-best-practices`.
- **Infra and DevOps:** `devops-engineer`, `infra-specialist`, `gh-fix-ci`.
- **Docs and diagrams:** `technical-writer`, `tech-docs-vitepress`, `mermaid-studio`, `codenavi`.
- **Brazilian law (in Portuguese):** `privacidade-lgpd`, `direito-consumidor-digital`, `revisao-juridica`.
- **Other:** `proposal-analyzer`, `orientador-tcc`, `brain-intake`.

Most skills written by me are in Brazilian Portuguese; the third-party ones are in English. Agents handle both.

## Credits

| Skill | Author | License |
|---|---|---|
| `codenavi`, `mermaid-studio`, `react-native-expert`, `tlc-spec-driven` | [Felipe Rodrigues](https://github.com/felipfr) | CC-BY-4.0 |
| `create-adr` | [Tech Leads Club](https://github.com/tech-leads-club) | CC-BY-4.0 |
| `the-fool` | [Jeffallan](https://github.com/Jeffallan) | CC-BY-4.0 |
| `gh-fix-ci`, `security-best-practices` | [openai/skills](https://github.com/openai/skills) | Apache-2.0 (`LICENSE.txt` in each folder) |

## License

[MIT](LICENSE) for the 29 skills written by Bruno Andrade, the gauntlet, the installers, tests and docs. Third-party skills keep their own licenses.
