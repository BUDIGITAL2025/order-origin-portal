# Multi-offer quotes, quote conversation and structured requests

Nota: `docs/ux-reference-sp-lite.md` não existe no projeto — sigo os padrões descritos no seu pedido e o design system atual. Se tiver esse documento, envie-o e ajusto os detalhes visuais.

## O que passa a existir

**Para si (equipa FlySales)**

- Cada pedido de cotação pode ter até 3 propostas ("Opção A/B/C"). O fornecedor fica registado internamente e nunca aparece ao cliente.
- Por opção: fornecedor, custo EXW, envio/unidade, IOSS, MOQ, prazo de produção, prazo de envio (aceita decimais, ex. 8,8 dias), notas, indicador de qualidade (baixo/médio/alto) e margem.
- Marca uma opção como "Recomendada" e escolhe quais publica.
- Uma conversa por cotação com o cliente (texto + imagens), com eventos automáticos na linha do tempo.
- Nova fila "Pedidos especiais" com o tipo, a cotação e a empresa — acionável e mensurável, com email de aviso.

**Para o cliente**

- Cartões de oferta empilhados com a mesma estrutura para comparar na vertical: preço por país, MOQ, prazo de produção, prazo de envio, taxa de disputas (quando houver histórico) e barra de qualidade em 3 segmentos.
- Variantes que uma opção não cobre aparecem riscadas com $0,00 — a ausência é informação.
- Seleção tipo rádio; o rodapé mostra "Select an offer" desativado até haver escolha, depois "Accept selected offer". A confirmação diz a consequência: passa a ser o preço fechado e o produto e SKUs são criados no catálogo.
- Conversa ao lado das ofertas, no mesmo ecrã, com scroll independente, anexos, "Download all images" e fixar mensagens.
- Menu "Special request": preço demasiado alto, adicionar país (até 3), tabela de tamanhos, fotos de fábrica, lista de materiais, nova variante, parar de cotar. Cada um regista evento na conversa, entra na fila de pedidos e envia email.
- "As minhas cotações" ganha vistas: Todas · Ação necessária · Novas mensagens · A expirar (<24h), com contagem decrescente (âmbar abaixo de 24h).
- Painel inicial ganha o widget "Cotações abertas": foto, produto, melhor preço, tempo restante e ligação direta.

## Compatibilidade

As seis cotações da Loja do Gato Preto (e qualquer outra já publicada) aparecem como uma única opção, já selecionada, com conversa disponível. Aceitar continua a criar produto e SKUs exatamente como hoje.

## Detalhes técnicos

Base de dados (uma migração):

- `quote_options`: `quote_request_id`, `letter` (A/B/C), `supplier_id`, `quality` (1-3), `recommended`, `published`, `archived_at`, `shipping_lead_days numeric`, `production_lead_days numeric`, `moq`, `margin_pct`, `internal_notes`, timestamps. RLS: leitura pelo dono do workspace apenas quando `published`; escrita admin/service role.
- `quote_lines.option_id uuid null` + índice. Linhas antigas sem opção continuam a funcionar (sintetizadas como Opção A no servidor).
- `quote_messages`: `quote_request_id`, `author_user_id`, `author_role` (client/admin), `kind` (message/system), `system_code`, `body`, `attachments text[]`, `pinned`, `read_by_client_at`, `read_by_admin_at`.
- `quote_intents`: `quote_request_id`, `store_id`, `type` (enum com os sete intents), `payload jsonb`, `status` (open/handled), `created_by`, timestamps.
- GRANTs explícitos em todas as tabelas novas; colaboradores de sourcing sem qualquer política sobre `quote_messages`/`quote_intents`.
- `quote_option_accept(p_option_id)`: função security definer que valida propriedade e validade, aceita as linhas da opção reutilizando a lógica de `respond_to_quote_lines` (produto + SKUs inalterados) e arquiva as restantes opções.

Servidor:

- `src/lib/quote-offers.functions.ts` — cliente: listar opções publicadas (colunas seguras, sem fornecedor nem custos), aceitar opção; admin/owner: CRUD de opções, margem, recomendada, publicar.
- `src/lib/quote-thread.functions.ts` — mensagens, anexos assinados, fixar, marcar lido; eventos de sistema escritos pelo servidor nos momentos de publicar/atualizar/aceitar/estender validade.
- `src/lib/quote-intents.functions.ts` — criar intent (cliente), fila e resolução (admin).
- Emails pelo `email-templates.server.ts` existente, idempotentes por `(quote, message_id)`, com deep-link.
- Taxa de disputas por fornecedor calculada no servidor a partir do histórico de disputas ligado a produtos originados nesse fornecedor; se não houver dados suficientes, o sinal não é mostrado.

Interface:

- `src/components/quote-offer-cards.tsx`, `src/components/quote-thread.tsx`, `src/components/special-request-menu.tsx`.
- Reescrita de `src/routes/_authenticated/_client/quotes/$id.tsx` (ofertas + conversa lado a lado), atualização de `src/routes/_authenticated/_client/sourcing/quotes.tsx` (vistas + countdown), `src/routes/_authenticated/admin/quotes/$id.tsx` (opções, margem, recomendada, publicar), `src/routes/_authenticated/desk/quote.$id.tsx` (sourcing por opção, sem conversa) e nova rota `src/routes/_authenticated/admin/requests.tsx`.
- `src/components/open-quotes-widget.tsx` passa a mostrar foto, melhor preço e tempo restante.

## Verificação

Cotação com 2 opções (preços, prazos e qualidade diferentes, uma variante riscada na opção B), publicar, entrar como cliente, comparar, enviar "Request factory photos" (fila + evento + email), responder como admin com imagem, selecionar e aceitar a opção B, confirmar que o produto fica ligado a B, ver a contagem decrescente no painel e confirmar que as seis cotações do Gato Preto continuam corretas como opção única.
