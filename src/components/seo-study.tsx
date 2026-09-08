/**
 * Full SEO study — the Phase 3 tab.
 *
 * One button turns a domain into a complete dossier, produced by a background
 * job. The admin confirms the worst-case cost, the study starts, and they can
 * walk away: the cron tick advances it. The dossier below is readable while it
 * is still being built, each section labelled with the phase that produced it.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Download,
  FileSearch,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Chip, EmptyCell, PanelHeader, TableShell, ToolBar, Value } from "@/components/admin-ui";
import { asArr, asNum, asRec, downloadCsv, int, type Rec, usd } from "@/components/seo-common";
import { friendlyError } from "@/lib/errors";
import {
  getSeoStudy,
  listSeoStudies,
  seoStudyEstimate,
  seoStudyPdf,
  startSeoStudy,
  tickSeoStudy,
} from "@/lib/seo-study.functions";
import { toast } from "sonner";

const PHASES = [
  { key: "overview", label: "Overview" },
  { key: "keywords", label: "Keywords" },
  { key: "competitors", label: "Competitors" },
  { key: "gap", label: "Gap opportunities" },
  { key: "backlinks", label: "Backlinks" },
  { key: "onpage", label: "Technical / on-page" },
  { key: "synthesis", label: "Synthesis" },
] as const;

const RUNNING = new Set(["queued", "running"]);

function statusChip(status: string) {
  if (status === "done") {
    return (
      <Chip tone="success">
        <CheckCircle2 className="h-3 w-3" /> complete
      </Chip>
    );
  }
  if (status === "partial") {
    return (
      <Chip tone="warning">
        <AlertTriangle className="h-3 w-3" /> partial
      </Chip>
    );
  }
  if (status === "failed") {
    return (
      <Chip tone="danger">
        <XCircle className="h-3 w-3" /> failed
      </Chip>
    );
  }
  return (
    <Chip tone="info">
      <Loader2 className="h-3 w-3 animate-spin" /> running
    </Chip>
  );
}

function when(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" });
}

// ---------------------------------------------------------------------------
// root
// ---------------------------------------------------------------------------

export function SeoStudyTab({
  locationCode,
  languageCode,
  marketLabel,
  market,
  studyId,
  onOpen,
  onSpend,
}: {
  locationCode: number;
  languageCode: string;
  marketLabel: string;
  market: React.ReactNode;
  studyId: string | undefined;
  onOpen: (id: string | undefined) => void;
  onSpend: () => void;
}) {
  if (studyId) return <StudyDossierView jobId={studyId} onBack={() => onOpen(undefined)} />;
  return (
    <StudyLauncher
      locationCode={locationCode}
      languageCode={languageCode}
      marketLabel={marketLabel}
      market={market}
      onOpen={onOpen}
      onSpend={onSpend}
    />
  );
}

// ---------------------------------------------------------------------------
// launcher + list
// ---------------------------------------------------------------------------

function StudyLauncher({
  locationCode,
  languageCode,
  marketLabel,
  market,
  onOpen,
  onSpend,
}: {
  locationCode: number;
  languageCode: string;
  marketLabel: string;
  market: React.ReactNode;
  onOpen: (id: string) => void;
  onSpend: () => void;
}) {
  const queryClient = useQueryClient();
  const estimateFn = useServerFn(seoStudyEstimate);
  const listFn = useServerFn(listSeoStudies);
  const startFn = useServerFn(startSeoStudy);
  const tickFn = useServerFn(tickSeoStudy);

  const [target, setTarget] = React.useState("");
  const [confirming, setConfirming] = React.useState(false);

  const estimate = useQuery({
    queryKey: ["seo-study-estimate"],
    queryFn: () => estimateFn(),
    staleTime: 5 * 60_000,
  });

  const studies = useQuery({
    queryKey: ["seo-studies"],
    queryFn: () => listFn(),
    refetchInterval: (query) =>
      (query.state.data ?? []).some((s) => RUNNING.has(s.status)) ? 10_000 : false,
  });

  const anyRunning = (studies.data ?? []).some((s) => RUNNING.has(s.status));

  // While a study is open in the browser, nudge the pipeline forward so the
  // admin sees phases land without waiting for the next cron minute. The job
  // lease makes a collision with the cron harmless.
  React.useEffect(() => {
    if (!anyRunning) return;
    const timer = setInterval(() => {
      void tickFn({ data: {} }).then(
        () => queryClient.invalidateQueries({ queryKey: ["seo-studies"] }),
        () => undefined,
      );
    }, 20_000);
    return () => clearInterval(timer);
  }, [anyRunning, tickFn, queryClient]);

  const start = useMutation({
    mutationFn: () => startFn({ data: { target, locationCode, languageCode, marketLabel } }),
    onSuccess: (res) => {
      toast.success("Study started — it runs in the background, roughly 5-15 minutes.");
      onSpend();
      void queryClient.invalidateQueries({ queryKey: ["seo-studies"] });
      void tickFn({ data: { jobId: res.jobId } }).catch(() => undefined);
      onOpen(res.jobId);
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  const total = estimate.data?.total ?? 0;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border bg-card p-4">
        <PanelHeader
          title="Full SEO study"
          description="One domain in, a complete dossier out: rankings, competitors, keyword gap, backlinks and a technical crawl, plus a written synthesis."
        />
        <ToolBar>
          <Input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="example.pt"
            className="h-9 w-64"
            onKeyDown={(e) => {
              if (e.key === "Enter" && target.trim()) setConfirming(true);
            }}
          />
          {market}
          <Button
            className="gap-2"
            disabled={!target.trim() || start.isPending || !estimate.data}
            onClick={() => setConfirming(true)}
          >
            {start.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileSearch className="h-4 w-4" />
            )}
            Run full study
            <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-[11px] tabular-nums">
              up to {usd(total)}
            </span>
          </Button>
        </ToolBar>
        {estimate.data && (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {estimate.data.lines.map((line) => (
              <Chip key={line.label}>
                {line.label} · {usd(line.cost)}
              </Chip>
            ))}
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Worst case — anything already in the server-side cache is served free, so the real charge
          is usually lower. Nothing fires until you confirm.
        </p>
      </div>

      <div>
        <PanelHeader
          title="Studies"
          description="Every study ever run. Open one at any time — a running study shows the sections it has already collected."
          actions={
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => void studies.refetch()}
            >
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
          }
        />
        <TableShell>
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Domain</th>
                <th className="px-3 py-2 text-left font-medium">Market</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-left font-medium">Phase</th>
                <th className="px-3 py-2 text-right font-medium">Progress</th>
                <th className="px-3 py-2 text-right font-medium">Cost so far</th>
                <th className="px-3 py-2 text-left font-medium">Started</th>
              </tr>
            </thead>
            <tbody>
              {(studies.data ?? []).map((study) => (
                <tr
                  key={study.id}
                  className="cursor-pointer border-b border-border/60 last:border-0 hover:bg-muted/40"
                  onClick={() => onOpen(study.id)}
                >
                  <td className="px-3 py-2 font-medium">{study.target}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    <Value>{study.market}</Value>
                  </td>
                  <td className="px-3 py-2">{statusChip(study.status)}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    <Value>{study.phase}</Value>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{study.progress}%</td>
                  <td className="px-3 py-2 text-right tabular-nums">{usd(study.totalCost)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{when(study.createdAt)}</td>
                </tr>
              ))}
              {studies.data?.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-sm text-muted-foreground">
                    No studies yet. Run the first one above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </TableShell>
      </div>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Run a full study on {target || "this domain"}?</AlertDialogTitle>
            <AlertDialogDescription>
              This runs {PHASES.length} phases against the DataForSEO API and will charge up to{" "}
              <strong>{usd(total)}</strong> in {marketLabel}. It takes roughly 5-15 minutes and
              keeps running if you close this page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => start.mutate()}>Start the study</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// dossier
// ---------------------------------------------------------------------------

function SectionHeader({
  title,
  section,
}: {
  title: string;
  section: { status: string; phase: string; collectedAt: string; error?: string } | undefined;
}) {
  return (
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
      {section == null ? (
        <Chip>
          <Clock className="h-3 w-3" /> not collected yet
        </Chip>
      ) : section.status === "ok" ? (
        <Chip tone="success">
          collected at “{section.phase}” · {when(section.collectedAt)}
        </Chip>
      ) : section.status === "pending" ? (
        <Chip tone="info">
          <Loader2 className="h-3 w-3 animate-spin" /> collecting…
        </Chip>
      ) : (
        <Chip tone="danger">skipped — {section.error ?? "phase failed"}</Chip>
      )}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">
        {value === "—" ? <EmptyCell /> : value}
      </div>
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-border bg-card p-4">{children}</div>;
}

function StudyDossierView({ jobId, onBack }: { jobId: string; onBack: () => void }) {
  const getFn = useServerFn(getSeoStudy);
  const tickFn = useServerFn(tickSeoStudy);
  const pdfFn = useServerFn(seoStudyPdf);

  const study = useQuery({
    queryKey: ["seo-study", jobId],
    queryFn: () => getFn({ data: { jobId } }),
    refetchInterval: (query) =>
      query.state.data && RUNNING.has(query.state.data.job.status) ? 8_000 : false,
  });

  const running = study.data ? RUNNING.has(study.data.job.status) : false;

  React.useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      void tickFn({ data: { jobId } }).then(
        () => study.refetch(),
        () => undefined,
      );
    }, 15_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, jobId, tickFn]);

  const pdf = useMutation({
    mutationFn: () => pdfFn({ data: { jobId, rebuild: true } }),
    onSuccess: (res) => {
      window.open(res.url, "_blank", "noopener");
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  if (study.isLoading) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading the dossier…
      </div>
    );
  }
  if (!study.data) {
    return (
      <div className="p-8 text-sm text-muted-foreground">
        This study no longer exists.{" "}
        <button className="underline" onClick={onBack}>
          Back to the list
        </button>
      </div>
    );
  }

  const { job, sections } = study.data;
  const sec = (key: string) => sections[key];
  const data = (key: string): Rec => asRec(sections[key]?.data);

  const overview = data("overview");
  const keywords = asArr(data("keywords")["rows"]);
  const competitors = asArr(data("competitors")["rows"]);
  const gapRows = asArr(data("gap")["rows"]);
  const backlinks = data("backlinks");
  const onpage = data("onpage");
  const synthesis = data("synthesis");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button variant="ghost" size="sm" className="-ml-2 gap-1.5" onClick={onBack}>
            <ArrowLeft className="h-3.5 w-3.5" /> All studies
          </Button>
          <h2 className="mt-1 text-lg font-semibold tracking-tight">{job.target}</h2>
          <p className="text-xs text-muted-foreground">
            {job.market} · started {when(job.createdAt)}
            {job.finishedAt ? ` · finished ${when(job.finishedAt)}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {statusChip(job.status)}
          <Chip tone="primary">charged {usd(job.totalCost)}</Chip>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            disabled={pdf.isPending}
            onClick={() => pdf.mutate()}
          >
            {pdf.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            Download PDF
          </Button>
        </div>
      </div>

      {running && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium">{job.phase ?? "Queued"}</span>
            <span className="tabular-nums text-muted-foreground">{job.progress}%</span>
          </div>
          <Progress value={job.progress} className="h-1.5" />
          <p className="mt-2 text-xs text-muted-foreground">
            Running in the background — you can close this page and come back. Sections appear here
            as each phase completes.
          </p>
        </div>
      )}

      {job.status === "partial" && job.error && (
        <div className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-xs text-warning-foreground">
          <strong>Partial dossier.</strong> {job.error}
        </div>
      )}

      {/* ---------------- synthesis ---------------- */}
      <Panel>
        <SectionHeader title="Synthesis" section={sec("synthesis")} />
        {asArr(synthesis["headline"]).length > 0 ? (
          <ul className="space-y-1.5 text-sm">
            {asArr(synthesis["headline"]).map((line, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                <span>{String(line)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Waiting for the earlier phases.</p>
        )}
      </Panel>

      {/* ---------------- overview ---------------- */}
      <Panel>
        <SectionHeader title="Overview" section={sec("overview")} />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Kpi label="Organic keywords" value={int(asNum(overview["organicKeywords"]))} />
          <Kpi
            label="Est. traffic / month"
            value={int(
              asNum(overview["organicEtv"]) == null
                ? null
                : Math.round(asNum(overview["organicEtv"])!),
            )}
          />
          <Kpi label="Positions 1-3" value={int(asNum(overview["pos1_3"]))} />
          <Kpi label="Positions 4-10" value={int(asNum(overview["pos4_10"]))} />
          <Kpi label="Positions 11-100" value={int(asNum(overview["pos11_100"]))} />
          <Kpi label="Paid keywords" value={int(asNum(overview["paidKeywords"]))} />
        </div>
      </Panel>

      {/* ---------------- keywords ---------------- */}
      <Panel>
        <SectionHeader title="Top ranked keywords" section={sec("keywords")} />
        {keywords.length > 0 ? (
          <>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {int(asNum(data("keywords")["totalCount"]))} keywords in total · showing the top{" "}
                {keywords.length} by estimated traffic
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  downloadCsv(
                    `${job.target}-keywords`,
                    ["Keyword", "Position", "Volume", "Est. visits", "URL"],
                    keywords.map((raw) => {
                      const k = asRec(raw);
                      return [k["keyword"], k["position"], k["volume"], k["etv"], k["url"]];
                    }),
                  )
                }
              >
                CSV
              </Button>
            </div>
            <TableShell className="max-h-[420px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 border-b border-border bg-muted/60 text-[11px] uppercase tracking-wide text-muted-foreground backdrop-blur">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Keyword</th>
                    <th className="px-3 py-2 text-right font-medium">Pos</th>
                    <th className="px-3 py-2 text-right font-medium">Volume</th>
                    <th className="px-3 py-2 text-right font-medium">Est. visits</th>
                    <th className="px-3 py-2 text-left font-medium">URL</th>
                  </tr>
                </thead>
                <tbody>
                  {keywords.map((raw, i) => {
                    const k = asRec(raw);
                    return (
                      <tr key={i} className="border-b border-border/60 last:border-0">
                        <td className="px-3 py-1.5">{String(k["keyword"] ?? "")}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          <Value>{asNum(k["position"])}</Value>
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {int(asNum(k["volume"]))}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {int(asNum(k["etv"]) == null ? null : Math.round(asNum(k["etv"])!))}
                        </td>
                        <td className="max-w-[280px] truncate px-3 py-1.5 text-xs text-muted-foreground">
                          {String(k["url"] ?? "").replace(/^https?:\/\//, "")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableShell>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Not collected.</p>
        )}
      </Panel>

      {/* ---------------- competitors ---------------- */}
      <Panel>
        <SectionHeader title="Competitors" section={sec("competitors")} />
        {competitors.length > 0 ? (
          <TableShell>
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Domain</th>
                  <th className="px-3 py-2 text-right font-medium">Shared keywords</th>
                  <th className="px-3 py-2 text-right font-medium">Avg position</th>
                  <th className="px-3 py-2 text-right font-medium">Their keywords</th>
                  <th className="px-3 py-2 text-right font-medium">Their traffic</th>
                </tr>
              </thead>
              <tbody>
                {competitors.map((raw, i) => {
                  const c = asRec(raw);
                  return (
                    <tr key={i} className="border-b border-border/60 last:border-0">
                      <td className="px-3 py-1.5 font-medium">{String(c["domain"] ?? "")}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {int(asNum(c["intersections"]))}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {asNum(c["avgPosition"])?.toFixed(1) ?? "—"}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {int(asNum(c["keywords"]))}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {int(asNum(c["etv"]) == null ? null : Math.round(asNum(c["etv"])!))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableShell>
        ) : (
          <p className="text-sm text-muted-foreground">Not collected.</p>
        )}
      </Panel>

      {/* ---------------- gap ---------------- */}
      <Panel>
        <SectionHeader title="Gap opportunities" section={sec("gap")} />
        {gapRows.length > 0 ? (
          <>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Keywords with 50+ monthly searches that a competitor ranks for and {job.target} does
                not.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  downloadCsv(
                    `${job.target}-gap`,
                    [
                      "Keyword",
                      "Volume",
                      "CPC",
                      "Competitor position",
                      "Your position",
                      "Competitor",
                    ],
                    gapRows.map((raw) => {
                      const g = asRec(raw);
                      return [
                        g["keyword"],
                        g["volume"],
                        g["cpc"],
                        g["competitorPosition"],
                        g["yourPosition"],
                        g["competitor"],
                      ];
                    }),
                  )
                }
              >
                CSV
              </Button>
            </div>
            <TableShell className="max-h-[420px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 border-b border-border bg-muted/60 text-[11px] uppercase tracking-wide text-muted-foreground backdrop-blur">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Keyword</th>
                    <th className="px-3 py-2 text-right font-medium">Volume</th>
                    <th className="px-3 py-2 text-right font-medium">CPC</th>
                    <th className="px-3 py-2 text-right font-medium">Their pos</th>
                    <th className="px-3 py-2 text-right font-medium">Your pos</th>
                    <th className="px-3 py-2 text-left font-medium">Competitor</th>
                  </tr>
                </thead>
                <tbody>
                  {gapRows.map((raw, i) => {
                    const g = asRec(raw);
                    return (
                      <tr key={i} className="border-b border-border/60 last:border-0">
                        <td className="px-3 py-1.5">{String(g["keyword"] ?? "")}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {int(asNum(g["volume"]))}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {asNum(g["cpc"]) == null ? "—" : usd(asNum(g["cpc"]), 2)}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          <Value>{asNum(g["competitorPosition"])}</Value>
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {asNum(g["yourPosition"]) == null ? (
                            <Chip tone="warning">not ranking</Chip>
                          ) : (
                            asNum(g["yourPosition"])
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-xs text-muted-foreground">
                          {String(g["competitor"] ?? "")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableShell>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Not collected.</p>
        )}
      </Panel>

      {/* ---------------- backlinks ---------------- */}
      <Panel>
        <SectionHeader title="Backlinks" section={sec("backlinks")} />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Kpi label="Backlinks" value={int(asNum(backlinks["backlinks"]))} />
          <Kpi label="Referring domains" value={int(asNum(backlinks["referringDomains"]))} />
          <Kpi label="Main domains" value={int(asNum(backlinks["referringMainDomains"]))} />
          <Kpi label="Domain rank" value={int(asNum(backlinks["rank"]))} />
          <Kpi label="Broken backlinks" value={int(asNum(backlinks["brokenBacklinks"]))} />
          <Kpi label="Spam score" value={int(asNum(backlinks["spamScore"]))} />
        </div>
      </Panel>

      {/* ---------------- onpage ---------------- */}
      <Panel>
        <SectionHeader title="Technical / on-page" section={sec("onpage")} />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Kpi label="Pages crawled" value={int(asNum(onpage["pagesCrawled"]))} />
          <Kpi label="On-page score" value={asNum(onpage["onPageScore"])?.toFixed(1) ?? "—"} />
          <Kpi label="Broken pages" value={int(asNum(onpage["brokenPages"]))} />
          <Kpi label="Broken resources" value={int(asNum(onpage["brokenResources"]))} />
        </div>
        {asArr(onpage["issues"]).length > 0 && (
          <TableShell className="mt-3">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Issue</th>
                  <th className="px-3 py-2 text-left font-medium">Severity</th>
                  <th className="px-3 py-2 text-right font-medium">Pages affected</th>
                </tr>
              </thead>
              <tbody>
                {asArr(onpage["issues"]).map((raw, i) => {
                  const issue = asRec(raw);
                  const severity = String(issue["severity"] ?? "low");
                  return (
                    <tr key={i} className="border-b border-border/60 last:border-0">
                      <td className="px-3 py-1.5">{String(issue["label"] ?? "")}</td>
                      <td className="px-3 py-1.5">
                        <Chip
                          tone={
                            severity === "high"
                              ? "danger"
                              : severity === "medium"
                                ? "warning"
                                : "neutral"
                          }
                        >
                          {severity}
                        </Chip>
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {int(asNum(issue["pages"]))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableShell>
        )}
      </Panel>

      {/* ---------------- pages ---------------- */}
      {(asArr(synthesis["strongestPages"]).length > 0 ||
        asArr(synthesis["weakestPages"]).length > 0) && (
        <Panel>
          <SectionHeader title="Strongest and weakest pages" section={sec("synthesis")} />
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">Strongest</div>
              <ul className="space-y-1 text-xs">
                {asArr(synthesis["strongestPages"]).map((raw, i) => {
                  const p = asRec(raw);
                  return (
                    <li key={i} className="truncate">
                      <span className="font-medium">
                        {String(p["url"] ?? "").replace(/^https?:\/\//, "")}
                      </span>{" "}
                      <span className="text-muted-foreground">— {String(p["note"] ?? "")}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">Needs work</div>
              <ul className="space-y-1 text-xs">
                {asArr(synthesis["weakestPages"]).map((raw, i) => {
                  const p = asRec(raw);
                  return (
                    <li key={i} className="truncate">
                      <span className="font-medium">
                        {String(p["url"] ?? "").replace(/^https?:\/\//, "")}
                      </span>{" "}
                      <span className="text-muted-foreground">— {String(p["note"] ?? "")}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </Panel>
      )}
    </div>
  );
}
