import { createFileRoute } from "@tanstack/react-router";
import { LegalLayout } from "@/components/legal";
import { LEGAL_ENTITY_NAME } from "@/lib/legal-entity";
import { TERMS_INTRO, TERMS_LAST_UPDATED, TERMS_SECTIONS } from "@/lib/terms";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service — FlySales" },
      {
        name: "description",
        content: `The terms that govern your use of FlySales, the B2B sourcing and fulfilment platform operated by ${LEGAL_ENTITY_NAME}.`,
      },
      { property: "og:title", content: "Terms of Service — FlySales" },
      {
        property: "og:description",
        content: `The terms that govern your use of FlySales, the B2B sourcing and fulfilment platform operated by ${LEGAL_ENTITY_NAME}.`,
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <LegalLayout title="Terms of Service" lastUpdated={TERMS_LAST_UPDATED}>
      <p className="text-sm leading-relaxed text-foreground/90">{TERMS_INTRO}</p>

      <nav aria-label="Contents" className="mt-8 rounded-2xl border border-border bg-card p-5">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Contents
        </p>
        <ol className="mt-2 grid gap-1 sm:grid-cols-2">
          {TERMS_SECTIONS.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                {s.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="mt-10 space-y-8">
        {TERMS_SECTIONS.map((s) => (
          <section key={s.id} id={s.id} className="scroll-mt-20">
            <h2 className="text-base font-semibold tracking-tight">{s.title}</h2>
            <div className="mt-2 space-y-3">
              {s.paragraphs.map((p, i) => (
                <p key={i} className="text-sm leading-relaxed text-foreground/90">
                  {p}
                </p>
              ))}
              {s.bullets && (
                <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-foreground/90">
                  {s.bullets.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        ))}
      </div>
    </LegalLayout>
  );
}
