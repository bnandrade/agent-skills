# Pacote para o advogado

Carregar na fase 5, e na fase 3 para versionar as minutas.

## Por que o destinatário é um advogado

- Consultoria, assessoria e direção jurídicas são atividades privativas de advocacia, e a advocacia é privativa dos inscritos na OAB (Lei nº 8.906/1994, arts. 1º, II, e 3º) [F1].
- O pacote é insumo para esse profissional decidir; não é parecer e não o substitui.

## Estrutura

1. **Capa** — produto, versão do código (commit), data, escopo revisado, fora do
   escopo e o texto de fronteira abaixo.
2. **Resumo** — até dez linhas: o que o produto faz com dados e com a venda, as
   decisões pendentes mais importantes, contagem de riscos por classe.
3. **Minutas com versão** — cada minuta com identificador, versão (`v0.1-minuta`,
   `v0.2-minuta`…), data e nota curta do que mudou; o advogado devolve sobre a
   versão identificada, e é a versão validada por ele que segue para a decisão
   do responsável.
4. **Matriz de tratamento** — no modelo da skill privacidade-lgpd, com
   `arquivo:linha` em cada linha.
5. **Perguntas fechadas** — separadas em "para o advogado" e "para o
   responsável"; cada uma com alternativas (sim ou não, ou opções), o fato e a
   norma que a motivam e o efeito de cada resposta na minuta.
6. **Pontos de risco classificados** — tabela abaixo.
7. **Sem verificação** — tudo que ficou "não verificado": a afirmação, por que não
   foi verificada (fonte inacessível, ausência de fonte oficial, divergência sem
   posição oficial) e o que o advogado precisa confirmar. A seção existe mesmo
   vazia.
8. **Fontes** — lista consolidada no formato da convenção, com as datas de
   consulta.
9. **Registro da crítica** — achados da fase 4, como foram resolvidos e o que
   ficou como risco ou pergunta.

## Pontos de risco

| ID | Classe | Ponto | Fato e origem | Norma | Consequência possível | Proposta na minuta | Decisão necessária |
|---|---|---|---|---|---|---|---|
| R-01 | alto | (exemplo) cookies de publicidade carregam antes do consentimento | FT-07, `resources/views/layout.blade.php:12` | `[F<n>]` com dispositivo | sanção administrativa; consentimento inválido | bloquear até a escolha no banner | responsável aprova a mudança |

Classes:

- **Alto** — prática atual ou planejada aparentemente contrária a norma vigente
  expressa, ou ausência de requisito obrigatório, com exposição a sanção,
  nulidade de cláusula ou dano a titular ou consumidor; também qualquer
  tratamento de dados de crianças sem base e salvaguardas registradas.
- **Médio** — requisito cumprido em parte, interpretação divergente sem posição
  oficial, ou dependência de fato ainda não confirmado.
- **Baixo** — melhoria de transparência ou de redação, ou boa prática de guia
  orientativo sem obrigação expressa.

Cada ponto cita a norma (`[F<n>]` com o dispositivo) e o fato (ID da ficha e
origem). Ponto sem os dois não entra na tabela: vira pergunta ou item da seção
"sem verificação".

## Texto de fronteira

Na capa e no rodapé de cada minuta:

> Minuta de pré-revisão elaborada a partir do código e de documentos do produto,
> para validação por advogado habilitado. Não é parecer jurídico nem
> aconselhamento jurídico. Nada deste pacote deve ser publicado, implantado ou
> enviado a terceiros sem a validação do advogado e a decisão do responsável.
> Normas consultadas nas datas indicadas; verificar a vigência na data de uso.

## Fontes

- [F1] Lei nº 8.906/1994 (Estatuto da Advocacia e da OAB), arts. 1º e 3º — https://www.planalto.gov.br/ccivil_03/leis/l8906.htm — consultado em 2026-10-15
