# Reference layout for quotes + sourcing collaborators in the conversation

Nota: `docs/ux-reference-sp-lite.md` continua a não existir no projeto. Sigo a anatomia descrita no seu pedido (duas colunas, barra fixa, cartões comparáveis) com o nosso design system. Se enviar o ficheiro, ajusto detalhes.

## 1. Apresentação da página de cotação

- Duas colunas fixas: ofertas ~60% à esquerda, conversa ~40% à direita, alturas iguais e scroll independente em cada uma.
- Barra de ação fixa no fundo da coluna das ofertas: "Cancel request" e o botão de dois estados ("Select an offer" desativado → "Accept selected offer").
- Cartões de oferta: selecionado com fundo tingido de lima, contorno lima e etiqueta "Selected"; os restantes neutros. Os campos ficam alinhados na mesma ordem e altura em todos os cartões, para comparar na vertical.
- Chip de contagem decrescente ao lado do estado, âmbar abaixo de 24h.
- Eventos automáticos na conversa passam a separadores centrados com etiqueta e hora, em vez de linhas de texto soltas.
- Tipografia Figtree, acento `#A2FF00`, chips e densidade atuais — a anatomia da referência, a nossa pele.

## 2. Colaborador de sourcing na conversa (anonimizado nos dois sentidos)

- O colaborador vê e responde apenas nas conversas das cotações que lhe estão atribuídas.
- Para o colaborador, o cliente aparece como "Client #<id curto>": sem nome, empresa, loja ou país além dos países-alvo da cotação. A vista do desk nunca renderiza campos de identidade do cliente.
- Para o cliente, as respostas do colaborador aparecem como "FlySales Sourcing Team" com o nosso avatar de marca; nunca um nome pessoal.
- A vista do colaborador nunca mostra preços finais nem margens, incluindo dentro da conversa.
- O admin vê tudo, responde em qualquer conversa como "FlySales", e o autor real fica sempre gravado internamente para auditoria.
- Pedidos tipificados (fotos de fábrica, tabela de tamanhos, lista de materiais, nova variante) entram na fila do colaborador dessa cotação; "preço demasiado alto" vai para o colaborador **e** para o admin.
- Emails: colaborador avisado de novas mensagens do cliente nas suas cotações; cliente avisado das respostas (remetente "FlySales"); admin avisado apenas em pedidos de preço, não em cada mensagem.

## Detalhes técnicos

Base de dados (uma migração):

- `quote_messages.author_role` passa a aceitar `sourcing` (atualizar a check constraint) e ganha `read_by_sourcer_at`.
- Políticas RLS: colaborador ativo lê e insere em `quote_messages` apenas quando `quote_requests.assigned_sourcer = auth.uid()`; sem acesso a preços de cliente (as colunas de preço vivem em `quote_lines`, já fechadas ao colaborador).
- `quote_intents`: leitura para o colaborador atribuído; sem alteração de escrita.

Servidor:

- `src/lib/quote-thread.functions.ts`: novas `sourcingListQuoteMessages`, `sourcingPostQuoteMessage`, `markQuoteThreadReadBySourcer` — guardadas por `requireCollaborator` + `assigned_sourcer`. A leitura devolve apenas `author_role`, corpo, anexos e hora; nunca identidade do cliente.
- `src/lib/quote-thread.server.ts`: helper `clientShortLabel(quoteId)` (`Client #` + 8 primeiros carateres do store id), `notifySourcerOfClientMessage()` e ajuste de `notifyClientOfReply()` para o rótulo do remetente.
- `src/lib/quote-intents.functions.ts`: encaminhamento por tipo — todos os tipos notificam o colaborador atribuído; `price_too_high` e `stop_quoting` também notificam o admin.
- `src/lib/email-templates.server.ts`: novo `sourcingMessageEmail()`.

Interface:

- `src/components/quote-thread.tsx`: `mode` passa a `client | admin | sourcing`; rótulos de autor por papel (`FlySales Sourcing Team` para o cliente), avatar de marca, separadores de sistema centrados.
- `src/components/quote-offer-cards.tsx`: estado selecionado em lima, alinhamento idêntico, barra fixa com Cancel + CTA de dois estados.
- `src/routes/_authenticated/_client/quotes/$id.tsx`: layout 60/40 com scrolls independentes e chip de contagem decrescente.
- `src/routes/_authenticated/desk/quote.$id.tsx`: painel de conversa com cabeçalho "Client #…", sem qualquer preço final.

## Verificação

Três sessões reais (cliente, colaborador, admin) numa cotação atribuída: o colaborador vê o cliente mascarado e responde; o cliente recebe como "FlySales Sourcing Team"; a vista do colaborador não mostra preços finais em lado nenhum, incluindo a conversa; o admin vê a identidade completa e consegue intervir. Confirmar ainda o encaminhamento dos pedidos tipificados e que o admin não recebe email em mensagens normais.
