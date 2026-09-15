<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## End-to-end verification runs

Any E2E/verification run creates its data only under a store flagged `is_test = true`
and named `E2E Store <timestamp>`, with accounts on `@flysales-test.invalid`.
Every run must finish by executing `bun scripts/e2e-cleanup.ts`, which deletes the
disposable rows and archives (never deletes) anything a wallet movement, receipt
or commission row points at.
