# Template — Report de Bug Bounty (o que paga)

O report e o produto. Este template segue o que triadores de HackerOne/Bugcrowd/Intigriti esperam. Escrever **para quem vai reproduzir e pagar**: claro, factual, reproduzivel, sem exagero. Confirmar o idioma exigido pelo programa (muitos pedem ingles).

---

```markdown
# <Titulo: classe da vuln + impacto + endpoint>
# ex.: IDOR em GET /api/v2/users/{id}/documents permite ler documentos de qualquer usuario

## Severidade
- **CVSS 3.1:** <score> (<Critical/High/Medium/Low>)
- **Vetor:** CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N
- **CWE:** CWE-<id> (<nome>)

## Resumo
<2-3 frases: o que e a falha, onde esta, e qual o impacto direto. O triador
decide a prioridade lendo isto.>

## Asset afetado
- **Alvo (in-scope):** <dominio/endpoint exato>
- **Parametro/entrada:** <qual>

## Passos para reproduzir
1. <passo exato, do zero, com as duas contas de teste se aplicavel>
2. <request completo — metodo, URL, headers, body>
3. <o que observar na resposta que prova a falha>

## Prova de conceito
\`\`\`http
<request minimo que demonstra o impacto>
\`\`\`
<resposta relevante / screenshot / video curto. PoC minima e nao-destrutiva.>

## Impacto
<O que um atacante realmente consegue — quantificado e no pior caso realista
dentro das regras. Ex.: "qualquer usuario autenticado le os documentos (PII,
contratos) de todos os demais, de forma enumeravel, sem interacao da vitima.">

## Remediacao
<Correcao concreta recomendada — valida ownership no servidor, deriva o dono
do usuario autenticado, adiciona controle de acesso no endpoint.>

## Referencias
- OWASP: <link WSTG/Top 10 relevante>
- <qualquer material de apoio>
```

---

## Como escrever para ser aceito (e pago) rapido

- **Titulo vende.** Classe + impacto + local. "IDOR permite ler PII de qualquer usuario" > "IDOR encontrado".
- **Reproduzivel por qualquer um.** Passos numerados, requests completos, contas de teste identificadas. Se o triador nao reproduz, vira "Needs More Info" ou fecha.
- **Impacto quantificado, no ponto certo.** Nem inflar (queima reputacao e vira downgrade), nem subestimar. Demonstrar o pior caso plausivel dentro das regras.
- **PoC minima e etica.** Um registro prova IDOR; nao dumpe a base. Comando inofensivo prova RCE; nao toque em dados reais.
- **Sem ruido.** Nada de encher de teoria. O triador quer: onde, como reproduzir, qual o impacto, como corrigir.
- **Um bug por report.** Nao empacotar varios achados num report so (dificulta triagem e pagamento). Cadeia e a excecao — ai conte a historia completa da cadeia num report.
- **Severidade honesta com vetor CVSS.** Mostrar o calculo. Se o programa usa VRT (Bugcrowd), mapear para a categoria deles.
- **Follow-up cordial.** Responder rapido a pedidos de info. Em duplicado/N/A, pedir esclarecimento educado — nunca hostil. Relacionamento vira convite privado.

## Diferenca para o report do app-pentest

O `app-pentest/report-template.md` e uma **auditoria interna** (varios findings, para o dono corrigir). Este e um **report externo unico** para o triador de um programa: foco em reproduzir + impacto + severidade aceita pela plataforma, um bug por vez.
