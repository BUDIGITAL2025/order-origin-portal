# Named clients for the sourcing agent (contact data still walled)

The agent stops seeing "Client #xxxx" and starts seeing the company name and the contact person's first name, on everything assigned to them. Everything commercial and every contact channel stays blocked on the server, not just hidden from the menu.

## 1. Named client identity

A single server-side resolver turns a workspace into a safe identity card: company name (the entity's legal name, falling back to the workspace name) and the contact person's first name only. It returns nothing else — no email, phone, address, store URL, fiscal data.

This replaces the masked handle in:

- the desk queue rows and the quote detail header
- the purchases list and the purchase detail header
- the conversation header on assigned quotes
- the agent's earnings/tier lines

## 2. New desk section "My clients"

A new tab in the desk, one card per client the agent manages:

- company name and contact first name
- open quotes, purchases in progress, unread client messages
- tier progress: paid units and units to the next fee rate
- quick links into each quote conversation and each purchase

Built from quotes assigned to the agent plus their per-client tier rows, so a client the agent has quoted but not yet been paid for still appears.

## 3. What stays walled (server-side)

Unchanged and re-verified: the agent's reads never select client email, phone, addresses, store URLs, fiscal/legal details, wallet or billing data, final client prices or FlySales margin. The client-site URL masking on requests stays exactly as is. Scope is unchanged: only quotes, purchases and conversations assigned to them; other agents' work stays invisible; admin sees everything.

## 4. Conversation

The agent keeps posting as "FlySales Sourcing Team". Nothing changes for the client.

## 5. Terms

One line added to the collaborator terms panel (invitation email and the desk's terms/earnings page): clients and their data belong to FlySales; contacting or soliciting clients outside the platform is not permitted. The invite email paragraph that says "client identities are never shown to you" is rewritten to the new reality: named clients, no contact channels, no client prices.

## Technical notes

- New `clientIdentityFor(admin, storeIds)` in `src/lib/client-identity.server.ts`: joins `stores → entities → profiles`, returns `{ company, contact_first_name }` per store/entity, with a neutral fallback when nothing is set. It is the only place a name is resolved, so the projection stays auditable.
- `src/lib/sourcing.functions.ts`: queue and `sourcingGetQuote` return `client` as the identity card instead of the `Client #` handle; `getSourcingDeskContext` clients gain company names.
- `src/lib/po.functions.ts`: `agentView` swaps `clientLabel(store_id)` for the resolved company; the PO document and supplier email are untouched (they must stay client-free).
- `src/lib/quote-thread.functions.ts`: `sourcingListQuoteMessages` returns the company name as `client_label`; `clientShortLabel` stays for any path that must remain anonymous.
- New `src/lib/desk-clients.functions.ts` + route `src/routes/_authenticated/desk/clients.tsx`, added to `DESK_TABS`.
- `src/lib/email-templates.server.ts`: invite copy + terms row.

## Verification

Signed in as the agent: Gato Preto shows by name on its assigned quotes and as its own card in My clients; the conversation and the PO flow work end to end; and direct calls to every desk server function are checked for email, phone, address, store URL, client price, margin and wallet figures — none present.
