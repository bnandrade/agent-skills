# Modelo — matriz de tratamento

Uma linha por operação de tratamento (finalidade + conjunto de dados + fluxo).
A matriz serve de registro das operações exigido do controlador e do operador (LGPD, art. 37) [F1]
e é a peça central do pacote para o advogado. Exemplo abaixo é fictício.

## Cabeçalho

- Produto e versão do código analisada: `[PREENCHER: repositório, commit]`
- Controlador: `[PREENCHER: razão social, CNPJ]` — porte declarado: `[PREENCHER]` (ver `encarregado-e-incidentes.md`)
- Data do levantamento: `[AAAA-MM-DD]` — versão da matriz: `v0.1-minuta`
- Estado: minuta de pré-revisão para validação por advogado habilitado

## Colunas

| Coluna | Como preencher |
|---|---|
| ID | M-01, M-02… |
| Operação e finalidade | Verbo + objeto + para quê, na linguagem do titular ("enviar o pedido para a gráfica imprimir") |
| Titulares | Comprador, destinatário, criança retratada, visitante do site… |
| Dados | Lista exata; marcar dado sensível (LGPD, art. 5º, II) [F1] e dado de criança ou adolescente |
| Origem do fato | `arquivo:linha` ou documento e trecho; sem origem, a linha não entra |
| Base legal | Hipótese dos arts. 7º ou 11 da LGPD [F1] + justificativa curta + fonte |
| Teste de balanceamento | Só para legítimo interesse: finalidade, necessidade, balanceamento e salvaguardas [F2] |
| Compartilhamento | Operadores e terceiros (nome, papel, país) |
| Transferência internacional | País + mecanismo (ver `transferencia-internacional.md`) |
| Retenção | Prazo + gatilho de início + fundamento (ver `direitos-e-ciclo-de-vida.md`) |
| Segurança | Medidas observadas no código (criptografia, controle de acesso, logs) |
| Lacuna e risco preliminar | Divergência entre fato e norma, com a norma [F<n>] e risco alto, médio ou baixo |
| Pergunta | Pergunta fechada ao responsável ou ao advogado, se houver |

## Exemplo de linha (fictício)

| ID | Operação e finalidade | Titulares | Dados | Origem | Base legal | Retenção | Lacuna |
|---|---|---|---|---|---|---|---|
| M-01 | Entregar o pedido no endereço informado | Comprador | Nome, endereço, telefone | `app/Pedidos/Checkout.php:42` | Execução de contrato a pedido do titular (LGPD, art. 7º, V) [F1] | `[PREENCHER]` | Prazo de retenção sem fundamento — médio |

## Regras

- Uma linha sem origem de fato ou sem base com fonte não é entregue: vira pergunta.
- A matriz descreve o que o produto faz hoje; o que se pretende fazer entra marcado como "planejado".
- Toda alteração gera nova versão (`v0.2-minuta`…) com nota do que mudou.

## Fontes

- [F1] Lei nº 13.709/2018 (LGPD), texto compilado, arts. 5º, 7º, 11 e 37 — https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm — consultado em 2026-10-15
- [F2] ANPD, Guia orientativo Hipóteses legais de tratamento de dados pessoais – Legítimo interesse, fev. 2024, teste de balanceamento — https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/copy_of_guia_legitimo_interesse.pdf/@@display-file/file — consultado em 2026-10-15
