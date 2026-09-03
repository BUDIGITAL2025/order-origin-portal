# Criar itens de inventário manualmente

Adaptação do pedido ao FlySales: o portal não é Next.js, por isso a funcionalidade entra na página **Inventory** que já existe (cliente e admin), com os nossos padrões: server functions autenticadas, `Dialog` do shadcn, toasts do sonner, design system Figtree + lime.

## O que o cliente vai poder fazer

- Botão **"+ Adicionar produto"** na barra de filtros da página Inventory (mesmo estilo do botão primário existente).
- Abre um diálogo com o formulário:
  - SKU (obrigatório — tem de bater certo com o SKU da loja)
  - Nome do produto (obrigatório)
  - Tags (texto livre separado por vírgulas)
  - Quantidade em armazém (inteiro ≥ 0, obrigatório)
  - Reservado (default 0) e A caminho (default 0)
  - Peso + unidade (g / kg)
  - Lead time de produção em dias (obrigatório)
  - **Rotas de envio** repetíveis: destino, handling time (dias), checkbox "Principal" (só uma; se nenhuma, a primeira). Botões para adicionar/remover linhas (mínimo uma).
  - Linha informativa calculada em tempo real: "Lead time total: X dias (produção Yd + envio para {destino}: Zd)".
- Validação no cliente antes de submeter; aviso (não bloqueante) se o SKU já existir na tabela carregada. A validação definitiva é no servidor.
- Depois de gravar: fecha o diálogo, toast de sucesso e a tabela recarrega. Erro do servidor (ex. SKU duplicado no workspace) aparece em toast.

## Colunas novas na tabela

A tabela partilhada de inventário passa a mostrar, além do que já tem: **Reservado**, **A caminho**, **Peso**, **Lead time total** (produção + handling da rota principal, ex. "55d") e **Vendas (30d)**. O estado (Healthy / Reorder soon / Reorder now) já existe como chip colorido e mantém-se. A barra/valor de stock passa a usar o stock vendável (armazém − reservado) quando existir.

Cálculos derivados continuam do lado do servidor: vendável, velocidade de vendas, cobertura e estado. O formulário nunca os envia.

## Detalhes técnicos

**Base de dados (uma migração)**
- `products`: novas colunas `tags text[] not null default '{}'`, `weight numeric`, `weight_unit text` (g|kg, via trigger de validação).
- Nova tabela `product_shipping_routes` (product_id, destination, handling_time_days, is_default) com GRANTs, RLS pela cadeia store → entity → account, e índice único parcial garantindo uma só rota principal por produto.
- Nova tabela `manual_stock_levels` (store_id, sku, in_warehouse, reserved, incoming, updated_at) para stock introduzido à mão, separado dos `inventory_snapshots` que vêm do fulfilment — assim uma sincronização nunca apaga o que o cliente escreveu.
- RPC `upsert_manual_inventory_item(...)` security definer: valida a posse do workspace, cria/atualiza o produto (SKU único por workspace), grava rotas e nível de stock manual numa só transação.

**Servidor**
- `src/lib/inventory.functions.ts`: nova server function `createInventoryItem` com `requireSupabaseAuth` + validação zod (SKU 1–64, nome 1–200, inteiros ≥ 0, pelo menos uma rota válida) a chamar a RPC.
- `src/lib/inventory.server.ts`: `computeWorkspaceInventory()` passa a juntar os níveis manuais aos snapshots do middleware (manual tem prioridade para o SKU quando existe), e a devolver `reserved`, `incoming`, `sellable`, `weight`, `weight_unit`, `tags`, `routes` e `total_lead` na linha.
- Rotas de envio entram no cascade de lead times como "handling" da rota principal; a origem P/S/W visível ao admin mantém-se.

**Interface**
- Novo `src/components/inventory-item-dialog.tsx` (formulário + rotas repetíveis + resumo do lead time).
- `src/components/inventory-table.tsx`: colunas novas, uso de `sellable`.
- `src/routes/_authenticated/_client/inventory.tsx`: botão, diálogo, invalidação da query. A página admin herda as colunas novas.

**Não mexer**: sync com o middleware, simulador, Safe Mode, histórico de sincronizações e diagnóstico por SKU ficam exatamente como estão.
