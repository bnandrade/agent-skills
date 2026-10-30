# Selecao de Programa & ROI

Onde investir tempo determina o retorno mais que a habilidade tecnica. Um bom caçador num programa ruim ganha pouco; um caçador mediano num programa novo e amplo ganha bem.

---

## Plataformas

| Plataforma | Caracteristica | Nota |
|---|---|---|
| **HackerOne** | Maior base, muitos programas publicos e privados | Bom para comecar e construir reputacao |
| **Bugcrowd** | Forte em privados/managed, VRT proprio de severidade | Convites por desempenho |
| **Intigriti** | Forte na Europa, boa experiencia de triagem | Escopos frequentemente frescos |
| **YesWeHack** | Europa/Franca, crescente | Menos concorrencia que HackerOne em alguns escopos |
| **Synack Red Team** | Fechado, exige processo seletivo | Paga bem, menos concorrencia, mais compromisso |
| **VDP proprio** (self-hosted) | Empresa com `security.txt` / pagina de disclosure | As vezes so reconhecimento; bom para praticar |

> `security.txt` (em `https://alvo/.well-known/security.txt`) indica canal de disclosure — as vezes fora das plataformas.

## Criterios de escolha (ordenar por ROI)

1. **Amplitude do escopo.** Wildcard (`*.alvo.com`) e faixas amplas = mais superficie = mais chance de fruta nova. Escopo de 1 dominio unico e disputado.
2. **Faixa de payout.** Ler a tabela de bounty por severidade. Critico de US$100 vs US$10.000 muda tudo. VDP (so kudos) so vale para reputacao/pratica.
3. **Responsividade.** Metricas publicas: tempo medio de primeira resposta, tempo de resolucao, % de reports aceitos. Programa que demora meses ou dá muito N/A queima seu tempo.
4. **Maturidade / concorrencia.** Programa antigo e popular = fruta baixa ja colhida, muita gente. **Programas novos, aquisicoes recentes e assets recem-adicionados = ouro.**
5. **Publico vs privado.** Privados tem menos caçadores (menos dedup, mais bounty). Ganha-se acesso a privados com reputacao/signal nos publicos.
6. **Fit tecnico.** Escolher stack que voce domina (o Bruno: web/API/Laravel/React, IA). Vantagem em programas com essa superficie.

## Como ler o brief (antes de tocar qualquer coisa)

- **In-scope:** exatamente quais dominios/apps/IPs/mobile. So isso pode ser tocado.
- **Out-of-scope:** o que e proibido tocar (as vezes um subdominio especifico dentro de um wildcard).
- **Vulnerabilidades aceitas / nao-aceitas:** muitos excluem self-XSS, missing headers, rate limiting, CSV injection, etc. Reportar excluido = N/A garantido.
- **Regras de teste:** rate limit permitido, se pode usar automated scanning, se fornecem contas de teste (usar as fornecidas!), como criar contas.
- **Bonus:** o que o programa valoriza mais (as vezes pagam extra por certas areas).
- **Safe harbor:** existe? qual o texto? E sua protecao legal — leia.
- **Formato de report:** alguns exigem template especifico, idioma, CVSS.

## Estrategia de carreira (long game)

- **Comece por reputacao.** VDPs e programas publicos com escopo amplo para acumular signal e reports validos.
- **Signal destrava privados.** Reports de qualidade -> convites privados -> menos concorrencia -> mais bounty.
- **Especialize, nao pule.** Conhecer um programa profundamente (todos os assets, o comportamento, o historico de disclosure) rende mais que espalhar-se raso por dez.
- **Monitore mudancas.** Novos assets no escopo, aquisicoes (a empresa comprada entra no escopo), features lancadas. Automatize o alerta de novo escopo — chegar primeiro e metade do jogo.

## Onde estao os bugs (menos olhos = mais achados)

- Assets **recem-adicionados** ao escopo.
- **Aquisicoes recentes** — codigo/infra novos, ainda nao endurecidos, entrando sob o programa.
- **Features novas** — testadas por menos gente que o core.
- **APIs e mobile** — historicamente menos testados que o site web.
- **Subdominios esquecidos** que so o seu `recon-osint` mapeou (staging, admin, api-antiga).
- **Fluxos autenticados com multiplos papeis** (user/admin/org) — terreno fertil de IDOR/BOLA e broken access control.
