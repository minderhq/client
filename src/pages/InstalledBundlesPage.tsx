import { useCallback, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { BundleCard } from "../components/BundleCard";
import { CardListSkeleton } from "../components/CardListSkeleton";
import { useConfirm } from "../components/ConfirmDialog";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { InfoCallout } from "../components/InfoCallout";
import { LoadError } from "../components/LoadError";
import { PageHeader } from "../components/PageHeader";
import { StatusLine } from "../components/StatusLine";
import { apiFetch, friendlyErrorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  type Bundle,
  type BundleImportPlan,
  type BundlesResponse,
  type ReconcileResponse,
  bundleAdminReason,
  bundlesToStateExport,
  outcomeSummary,
  parseBundleStateExport,
  planBundleImport,
} from "../lib/bundles";
import { ROUTES } from "../lib/routes";
import { fieldHintClass, secondaryButtonClass } from "../lib/ui";
import { useAsyncResource } from "../lib/useAsyncResource";

/** Downloads `data` as a JSON file -- a real browser download (this is the
 * actual product, not a sandboxed preview), not an in-page viewer. */
function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function PreviewGroup({
  title,
  note,
  items,
}: {
  title: string;
  note?: string;
  items: string[];
}) {
  if (items.length === 0) return null;
  return (
    <div className="mt-2 first:mt-0">
      <p className="font-medium">{`${title} (${items.length})`}</p>
      {note && <p className="text-xs text-gray-500 dark:text-gray-400">{note}</p>}
      <ul className="ml-5 list-disc">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

/** The confirm dialog's preview of an import: what will be enabled, what will
 * be disabled, and what the file mentions but won't change. */
function ImportPreview({ plan }: { plan: BundleImportPlan }) {
  return (
    <>
      <PreviewGroup
        title="Will be enabled"
        items={plan.changes.filter((c) => c.enabled).map((c) => c.name)}
      />
      <PreviewGroup
        title="Will be disabled"
        note="Services no other enabled bundle claims will stop."
        items={plan.changes.filter((c) => !c.enabled).map((c) => c.name)}
      />
      <PreviewGroup title="Already as requested" items={plan.unchanged} />
      <PreviewGroup
        title="Skipped"
        items={plan.skipped.map((s) => `${s.name} (${s.reason})`)}
      />
    </>
  );
}

function skippedSummary(plan: BundleImportPlan): string {
  return plan.skipped.length > 0
    ? `skipped: ${plan.skipped.map((s) => `${s.name} (${s.reason})`).join(", ")}`
    : "";
}

export function ExportImportPanel({
  bundles,
  token,
  isAdmin,
  onChanged,
}: {
  bundles: Bundle[];
  token: string;
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const fileInputId = useId();
  const importReasonId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { confirm, dialog } = useConfirm();
  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);
  const [busy, setBusy] = useState(false);
  const importReason = bundleAdminReason(isAdmin, !!token, "import bundle state");

  function handleExport() {
    const ts = new Date().toISOString().slice(0, 10);
    downloadJson(`minder-bundles-${ts}.json`, bundlesToStateExport(bundles));
  }

  function finish(message: string, error = false) {
    setStatus(message);
    setIsError(error);
    setBusy(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  /** Read the file, preview what it would change, and apply only once the
   * admin confirms (#2195) -- importing used to fire the enable/disable calls
   * the moment a file was picked. Cancel makes no request. */
  async function handleImportFile(file: File) {
    if (!isAdmin) return; // the input is disabled for non-admins; belt and braces
    setBusy(true);
    setIsError(false);
    setStatus("Reading file…");
    let plan: BundleImportPlan;
    try {
      const text = await file.text();
      plan = planBundleImport(bundles, parseBundleStateExport(JSON.parse(text)));
    } catch (e) {
      finish(e instanceof Error ? e.message : "Could not read that file as bundle state.", true);
      return;
    }

    if (plan.changes.length === 0) {
      const skipped = skippedSummary(plan);
      finish(skipped ? `Nothing to change — ${skipped}` : "Nothing to change.");
      return;
    }

    setStatus("Review the changes to apply…");
    const count = plan.changes.length;
    const ok = await confirm({
      title: `Apply ${count} bundle change${count === 1 ? "" : "s"}?`,
      message:
        "Importing this file will make these changes. Bundles the file doesn't mention are left as they are.",
      details: <ImportPreview plan={plan} />,
      confirmLabel: `Apply ${count} change${count === 1 ? "" : "s"}`,
      danger: plan.changes.some((c) => !c.enabled),
    });
    if (!ok) {
      finish("Import cancelled — nothing was changed.");
      return;
    }

    const applied: string[] = [];
    const errors: string[] = [];
    for (const { name, enabled } of plan.changes) {
      setStatus(`Applying ${name} → ${enabled ? "enabled" : "disabled"}…`);
      try {
        await apiFetch(
          `/v1/bundles/${encodeURIComponent(name)}/${enabled ? "enable" : "disable"}`,
          { method: "POST", token },
        );
        applied.push(name);
      } catch (e) {
        errors.push(`${name}: ${friendlyErrorMessage(e)}`);
      }
    }
    const parts = [
      applied.length > 0 ? `applied: ${applied.join(", ")}` : "",
      skippedSummary(plan),
      errors.length > 0 ? `errors: ${errors.join("; ")}` : "",
    ].filter(Boolean);
    finish(parts.join(" — "), errors.length > 0);
    onChanged();
  }

  return (
    <section className="mb-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900">
      {dialog}
      <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
        <Icon name="download" size={16} className="shrink-0 text-indigo-500 dark:text-indigo-400" />
        Export / Import
      </h2>
      <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
        Export the current enabled/disabled state of every bundle as a JSON
        file — the same shape the host's own <code>bundles.state.json</code>{" "}
        uses. Import previews what a previously exported (or hand-written)
        file would change and, once you confirm, calls enable/disable for
        whatever differs from the current state; bundles not mentioned in the
        file are left untouched.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={handleExport} className={secondaryButtonClass}>
          <Icon name="download" size={15} /> Export current state
        </button>
        <label htmlFor={fileInputId} className="sr-only">
          Import bundle state from a JSON file
        </label>
        <input
          id={fileInputId}
          ref={fileInputRef}
          type="file"
          accept="application/json"
          disabled={!isAdmin || busy}
          aria-describedby={importReason ? importReasonId : undefined}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleImportFile(file);
          }}
          className="text-xs text-gray-600 file:mr-2 file:rounded-md file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-gray-700 hover:file:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-60 dark:text-gray-400 dark:file:bg-gray-800 dark:file:text-gray-300 dark:hover:file:bg-gray-700"
        />
      </div>
      {importReason && (
        <p id={importReasonId} className={fieldHintClass}>
          {importReason}
        </p>
      )}
      <StatusLine isError={isError} className="mt-2">
        {status}
      </StatusLine>
    </section>
  );
}

/** Bundles currently enabled — export/import and the docker-version detail
 * per claimed service live here rather than on Discover service bundles, since both
 * are specifically about the bundles you're actually running. */
export function InstalledBundlesPage() {
  const { token, role } = useAuth();
  const isAdmin = role === "admin";
  const reconcileReasonId = useId();
  const reconcileReason = bundleAdminReason(isAdmin, !!token, "reconcile");
  const bundlesRes = useAsyncResource((signal) =>
    apiFetch<BundlesResponse>("/v1/bundles", { signal }),
  );
  const bundles = bundlesRes.data?.bundles ?? [];
  const installed = bundles.filter((b) => b.enabled);
  const orphaned = bundlesRes.data?.orphaned ?? [];

  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);
  const [reconciling, setReconciling] = useState(false);

  const setStatusMsg = useCallback((msg: string, err = false) => {
    setStatus(msg);
    setIsError(err);
  }, []);

  async function handleReconcile() {
    setReconciling(true);
    setStatusMsg("Reconciling…");
    try {
      const res = await apiFetch<ReconcileResponse>("/v1/bundles/reconcile", {
        method: "POST",
        token,
      });
      setStatusMsg(`Reconciled: ${outcomeSummary(res)}`);
      bundlesRes.reload();
    } catch (e) {
      setStatusMsg(friendlyErrorMessage(e), true);
    }
    setReconciling(false);
  }

  return (
    <>
      <PageHeader
        icon="bundles"
        title="Installed service bundles"
        subtitle="Service bundles currently turned on, the Docker image each claimed service actually runs, and export/import for the whole set. Disabling, reconciling or importing requires an admin account."
      />

      {bundlesRes.data && (
        <ExportImportPanel
          bundles={bundles}
          token={token}
          isAdmin={isAdmin}
          onChanged={bundlesRes.reload}
        />
      )}

      <StatusLine isError={isError}>
        {status || (bundlesRes.loading ? "Loading service bundles…" : "")}
      </StatusLine>
      {bundlesRes.error && (
        <LoadError
          title="Couldn't load the service bundles."
          message={bundlesRes.error}
          what="service bundles"
          onRetry={bundlesRes.reload}
        />
      )}

      {orphaned.length > 0 && (
        <div className="mb-4">
          <InfoCallout icon="warning">
            Orphaned services (claimed by no enabled bundle, should be
            stopped): {orphaned.join(", ")}. Run Reconcile below to clean these
            up.
          </InfoCallout>
        </div>
      )}

      <div className="mb-4">
        <button
          onClick={handleReconcile}
          disabled={!isAdmin || reconciling}
          aria-describedby={reconcileReason ? reconcileReasonId : undefined}
          className={secondaryButtonClass}
        >
          <Icon name="reset" size={15} className={reconciling ? "animate-spin" : undefined} />
          {reconciling ? "Reconciling…" : "Reconcile"}
        </button>
        {reconcileReason && (
          <p id={reconcileReasonId} className={fieldHintClass}>
            {reconcileReason}
          </p>
        )}
      </div>

      <h2 className="mb-2 text-base font-semibold text-gray-900 dark:text-gray-100">
        Enabled bundles
      </h2>
      {bundlesRes.loading && !bundlesRes.data && <CardListSkeleton />}
      {bundlesRes.data && !bundlesRes.error && installed.length === 0 && (
        <EmptyState>
          No service bundles are enabled yet — see{" "}
          <Link to={ROUTES.discoverServiceBundles} className="underline hover:text-indigo-600 dark:hover:text-indigo-400">
            Discover service bundles
          </Link>
          .
        </EmptyState>
      )}
      {installed.map((b) => (
        <BundleCard
          key={b.name}
          bundle={b}
          token={token}
          isAdmin={isAdmin}
          onChanged={bundlesRes.reload}
        />
      ))}
    </>
  );
}
