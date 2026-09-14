# Admin team roles (owner / collaborator / reader)

Replace the single "admin" flag with three internal staff levels for @budigital.org accounts, enforced on the server, plus an owners-only Team page.

## How staff is decided

- Any account whose **verified** email ends in `@budigital.org` is internal staff. It never gets client onboarding, wallet or subscription prompts — on first sign-in it lands straight in the admin console.
- New staff start as **reader**. `flavio@budigital.org` and `info@budigital.org` are permanent **owners** and cannot be demoted, deactivated or removed by anyone.
- Any other email can never become staff — checked in the database, not just in the interface.

## The three levels

| | Owner | Collaborator | Reader |
|---|---|---|---|
| Read the whole console | yes | yes | yes |
| Day-to-day work (quotes, pricing, clients, fulfilment, inbound, purchase orders, supplier payments, catalog imports, disputes) | yes | yes | no |
| Team management, module grants, pricing/plan config, deletes and archives, payment-mode visibility | yes | no | no |

Every blocked action fails on the server with a clear message ("your role is read-only", "owners only") — hiding menu items is only cosmetic on top of that.

## Team page (owners only)

`Admin → Team`: list of staff with email, level, status and last active; change level; deactivate / reactivate; invite a new `@budigital.org` member by branded email (same Resend path and logging as the sourcing invites). Every level change, deactivation and invite writes an audit line: who changed whom, from what to what, when.

## Unchanged

Sourcing agents keep their separate external desk and fee tiers. Client accounts are untouched. This only governs the admin console.

## reis@budigital.org

That account **does not exist** — it was deleted in the pre-launch cleanup (it was the "Zé Reis" sourcing test account, previously a sourcing collaborator, no financial history). So instead of repairing it, I will send it a fresh staff invite at reader level, and report the result. Tell me if you would rather it start as collaborator.

## Technical notes

- New enum `staff_level` and table `staff_members` (user_id, email, level, status, last_active_at, invited_by, timestamps) with RLS + grants; reads go through security-definer helpers `is_staff()`, `staff_level()`.
- A trigger on account creation/email-verification inserts the staff row for the domain and also grants the existing `admin` role, so the ~130 current `requireAdmin` call sites keep working unchanged.
- A guard trigger makes the two perpetual owners un-demotable and un-deletable at database level.
- `src/lib/admin.server.ts` gains `requireStaffRead` (any level), keeps `requireAdmin` as write-level (owner/collaborator, rejects reader) and adds `requireOwner`. Read-only server functions (`method: "GET"`) switch to `requireStaffRead`; team management, cleanup/deletes, module grants and plan/fee config switch to `requireOwner`.
- New `src/lib/staff.functions.ts` / `staff.server.ts`, new route `src/routes/_authenticated/admin/team.tsx`, nav entry shown only to owners, `getMyContext` returns the staff level.

## Verification

1. Sign in as the invited reader → admin console loads read-only; a mutation attempt is refused server-side.
2. Owner promotes him to collaborator → he can price a quote, but `/admin/team` is refused.
3. Attempt to demote `flavio@budigital.org` → fails.
4. A client account calling `/admin/team` → refused.
