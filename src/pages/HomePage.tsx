import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { HealthStrip } from "../components/HealthStrip";
import { Icon, type IconName } from "../components/Icon";
import { InfoCallout } from "../components/InfoCallout";
import { Skeleton } from "../components/Skeleton";
import { apiFetch, type Paginated } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { BundlesResponse } from "../lib/bundles";
import { type KbReadiness, kbReady, primaryAction } from "../lib/journey";
import { openWebUiUrl } from "../lib/links";
import { cardClass, cardHoverClass, chipClass, primaryButtonClass, sectionLabelClass } from "../lib/ui";
import { useAsyncResource } from "../lib/useAsyncResource";

export interface HomeStats {
  kbCount: number;
  /** KBs with at least one ingested document + vectors (#1227) — this, not
   * kbCount, is what makes the "build a pipeline" step meaningful. */
  readyKbCount: number;
  pipelineCount: number;
  bundlesEnabled: number;
  bundlesTotal: number;
  modelCount: number;
}

interface StatCardProps {
  to: string;
  icon: IconName;
  label: string;
  value: number | string | null;
  loading: boolean;
}

function StatCard({ to, icon, label, value, loading }: StatCardProps) {
  return (
    <Link to={to} className={`group flex flex-col gap-2 ${cardClass} ${cardHoverClass}`}>
      <span className="flex items-center justify-between">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-100 dark:bg-indigo-950/50 dark:text-indigo-300 dark:ring-indigo-900">
          <Icon name={icon} size={16} />
        </span>
        <Icon
          name="arrow"
          size={15}
          className="text-gray-300 transition group-hover:translate-x-0.5 group-hover:text-indigo-500 dark:text-gray-600"
        />
      </span>
      <span className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {label}
      </span>
      {loading && value === null ? (
        <Skeleton className="h-8 w-12" />
      ) : (
        <span className="text-3xl font-bold text-gray-900 dark:text-gray-100">
          {value ?? "—"}
        </span>
      )}
    </Link>
  );
}

function PrimaryActionCard({ stats, loading }: { stats: HomeStats | null; loading: boolean }) {
  // The journey logic (which next step) lives in lib/journey so this card and
  // the on-page GoldenPathStepper can never suggest different things (#1226).
  const action = primaryAction(
    stats && {
      kbCount: stats.kbCount,
      readyKbCount: stats.readyKbCount,
      pipelineCount: stats.pipelineCount,
    },
  );
  return (
    <Link
      to={action.to}
      className={`group mb-6 flex items-center gap-4 overflow-hidden rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-white p-5 shadow-sm ring-1 ring-black/[0.02] transition hover:-translate-y-0.5 hover:border-indigo-400 hover:shadow-md dark:border-indigo-900/70 dark:from-indigo-950/40 dark:to-gray-900 dark:ring-white/[0.02]`}
    >
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm shadow-indigo-600/30">
        <Icon name={action.icon} size={22} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-indigo-600 dark:text-indigo-400">
          Suggested next step
        </p>
        <h2 className="mt-0.5 text-base font-semibold text-gray-900 dark:text-gray-100">
          {loading && stats === null ? <Skeleton inline className="h-5 w-48" /> : action.title}
        </h2>
        <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-400">
          {loading && stats === null ? (
            <Skeleton inline className="mt-1 h-4 w-72" />
          ) : (
            action.body
          )}
        </p>
      </div>
      <Icon
        name="arrow"
        size={20}
        className="shrink-0 text-indigo-600 transition group-hover:translate-x-1 dark:text-indigo-400"
      />
    </Link>
  );
}

interface QuickAction {
  to: string;
  icon: IconName;
  label: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  { to: "/ask", icon: "ask", label: "Ask a question" },
  { to: "/rag", icon: "knowledge-bases", label: "New knowledge base" },
  { to: "/rag/pipelines", icon: "pipelines", label: "New pipeline" },
  { to: "/platform", icon: "models", label: "Pull a model" },
];

function QuickActions() {
  return (
    <section className="mb-6">
      <h2 className={`mb-2 ${sectionLabelClass}`}>Quick actions</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {QUICK_ACTIONS.map((a) => (
          <Link
            key={a.to}
            to={a.to}
            className={`group flex items-center gap-2.5 ${cardClass} ${cardHoverClass} !p-3.5`}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-600 transition group-hover:bg-indigo-50 group-hover:text-indigo-600 dark:bg-gray-800 dark:text-gray-300 dark:group-hover:bg-indigo-950/50 dark:group-hover:text-indigo-300">
              <Icon name={a.icon} size={17} />
            </span>
            <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
              {a.label}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

interface ExploreLink {
  to: string;
  icon: IconName;
  label: string;
}

const EXPLORE_LINKS: ExploreLink[] = [
  { to: "/plugins/available", icon: "plugins", label: "Plugins" },
  { to: "/ai-tools/available", icon: "ai-tools", label: "AI Tools" },
  { to: "/bundles/available", icon: "bundles", label: "Bundles" },
  { to: "/rag/graph", icon: "graph", label: "Knowledge Graph" },
  { to: "/platform/voice", icon: "voice", label: "Voice" },
  { to: "/platform/status", icon: "status", label: "Status" },
];

function ExploreSection() {
  return (
    <section className="mb-6">
      <h2 className={`mb-2 ${sectionLabelClass}`}>More to explore</h2>
      <div className="flex flex-wrap gap-2">
        {EXPLORE_LINKS.map((l) => (
          <Link key={l.to} to={l.to} className={chipClass}>
            <Icon name={l.icon} size={15} className="text-gray-400" />
            {l.label}
          </Link>
        ))}
      </div>
    </section>
  );
}

function Callouts(): ReactNode {
  return (
    <div className="flex flex-col gap-3">
      <InfoCallout icon="models">
        {openWebUiUrl ? (
          <a className="font-medium underline" href={openWebUiUrl}>
            OpenWebUI
          </a>
        ) : (
          <span className="font-medium">OpenWebUI</span>
        )}
        's own Admin Panel → Connections → Ollama → Manage offers the same
        pull/delete against this same Ollama instance too, with more
        per-model settings (system prompts, parameters) if you're already
        there for chat.
      </InfoCallout>
      <InfoCallout icon="warning">
        OpenWebUI's own "Knowledge" feature is a separate, disconnected
        system — it has no access to Minder's actual RAG pipeline (knowledge
        bases, chunking, or the HyDE/Self-RAG/corrective retrieval methods
        above). Use Knowledge Bases and RAG Pipelines for the real thing.
      </InfoCallout>
    </div>
  );
}

/** Task-first home dashboard (replacing the old static sitemap-as-cards
 * LandingPage): what's actually going on in this installation right now
 * (health, counts) and the one next step most worth taking, with full
 * navigation demoted to a compact "More to explore" strip since the sidebar
 * already covers that job. */
export function HomePage() {
  const { isAuthenticated, username, token } = useAuth();
  const stats = useAsyncResource<HomeStats>(
    (signal) =>
      Promise.all([
        // knowledge-bases is owner-scoped + JWT-gated now (tenancy) — pass the
        // token. limit=100 (not 1) so we can count the READY ones (#1227), not
        // just how many exist — the journey's pipeline step needs a non-empty KB.
        apiFetch<Paginated<KbReadiness>>("/v1/rag/knowledge-bases?limit=100", {
          signal,
          token,
        }),
        // JWT-gated (owner-scoped): 401s without the token, which would reject
        // the whole stats Promise.all and blank every count on the dashboard.
        apiFetch<Paginated<unknown>>("/v1/rag/pipeline?limit=1", { signal, token }),
        apiFetch<BundlesResponse>("/v1/bundles", { signal }),
        apiFetch<Paginated<unknown>>("/v1/models?limit=1", { signal }),
      ]).then(([kbs, pipelines, bundles, models]) => ({
        kbCount: kbs.total,
        readyKbCount: kbs.items.filter(kbReady).length,
        pipelineCount: pipelines.total,
        bundlesEnabled: bundles.bundles.filter((b) => b.enabled).length,
        bundlesTotal: bundles.count,
        modelCount: models.total,
      })),
    { deps: [token] },
  );

  return (
    <>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {isAuthenticated ? `Welcome back, ${username}` : "Minder"}
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {isAuthenticated
              ? "Here's what's running right now."
              : "Browsing is open for everyone — log in on any page to make changes."}
          </p>
        </div>
        <Link to="/ask" className={primaryButtonClass}>
          <Icon name="ask" size={16} />
          Ask a question
        </Link>
      </div>

      <HealthStrip />
      <PrimaryActionCard stats={stats.data} loading={stats.loading} />

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          to="/rag"
          icon="knowledge-bases"
          label="Knowledge Bases"
          value={stats.data?.kbCount ?? null}
          loading={stats.loading}
        />
        <StatCard
          to="/rag/pipelines"
          icon="pipelines"
          label="Pipelines"
          value={stats.data?.pipelineCount ?? null}
          loading={stats.loading}
        />
        <StatCard
          to="/bundles/installed"
          icon="bundles"
          label="Bundles Enabled"
          value={stats.data ? `${stats.data.bundlesEnabled}/${stats.data.bundlesTotal}` : null}
          loading={stats.loading}
        />
        <StatCard
          to="/platform"
          icon="models"
          label="Models"
          value={stats.data?.modelCount ?? null}
          loading={stats.loading}
        />
      </div>

      <QuickActions />
      <ExploreSection />
      <Callouts />
    </>
  );
}
