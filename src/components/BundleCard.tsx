import { useId, useState } from "react";

import {
  type Bundle,
  type BundleService,
  BUNDLE_TOGGLE_ACTION,
  bundleAdminReason,
  type DisableResponse,
  type EnableResponse,
  otherClaimants,
  outcomeSummary,
} from "../lib/bundles";
import { apiFetch, friendlyErrorMessage } from "../lib/api";
import { Icon } from "./Icon";
import {
  badgeClass,
  cardClass,
  fieldHintClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "../lib/ui";
import { useConfirm } from "./ConfirmDialog";
import { StatusBadge } from "./StatusBadge";
import { StatusLine } from "./StatusLine";

function ServiceRow({
  service,
  bundleName,
}: {
  service: BundleService;
  bundleName: string;
}) {
  const others = otherClaimants(service, bundleName);
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-600 dark:text-gray-400">
      <span
        className={`inline-block h-2 w-2 rounded-full ${
          service.active ? "bg-green-500" : "bg-gray-300 dark:bg-gray-600"
        }`}
        aria-hidden="true"
      />
      {/* The dot above is color-only and aria-hidden -- a screen-reader user
        needs this text to tell an active service from an inactive one. */}
      <span className="sr-only">
        {service.active ? "Active" : "Inactive"}
      </span>
      {service.name}
      {service.image && (
        <code className="rounded bg-gray-100 px-1 py-0.5 text-[11px] text-gray-500 dark:bg-gray-800 dark:text-gray-400">
          {service.image}
        </code>
      )}
      {!service.image && (
        <span className="text-gray-500 dark:text-gray-400" title="Built locally, no pulled image">
          (custom build)
        </span>
      )}
      {others.length > 0 && (
        <span className="text-gray-500 dark:text-gray-400">
          (also claimed by: {others.join(", ")} — disabling this bundle won't stop it)
        </span>
      )}
    </li>
  );
}

/** The one visible "why can't I enable or disable bundles?" line a bundle
 * list shows above its cards; each card's button references it by `id`
 * (BundleCard's `adminNoteId`). */
export function BundleAdminNote({ id, reason }: { id: string; reason: string }) {
  return (
    <p
      id={id}
      className="mb-3 flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400"
    >
      <Icon name="lock" size={14} className="shrink-0" />
      {reason}
    </p>
  );
}

/** Enable/disable card shared by both Available Bundles (shows disabled
 * bundles, "Enable" action) and Installed Bundles (shows enabled bundles,
 * "Disable" action) -- the toggle logic already adapts to bundle.enabled, so
 * one component serves both pages; only which bundles get passed in differs. */
export function BundleCard({
  bundle,
  token,
  isAdmin,
  onChanged,
  adminNoteId,
}: {
  bundle: Bundle;
  token: string;
  isAdmin: boolean;
  onChanged: () => void;
  /** Id of a page-level note saying why a non-admin can't enable or disable
   * bundles. A list page shows that reason once, instead of on every card,
   * and each card's button points at it with aria-describedby (#2195). When
   * omitted (a card on its own), the card shows the reason itself. */
  adminNoteId?: string;
}) {
  const { confirm, dialog } = useConfirm();
  const reasonId = useId();
  const disabledReason = bundleAdminReason(isAdmin, !!token, BUNDLE_TOGGLE_ACTION);
  const actionLabel = bundle.enabled ? "Disable" : "Enable";
  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleToggle() {
    if (bundle.enabled) {
      // Disabling is the one direction that can silently do less than it
      // looks like -- a service kept alive by another enabled bundle stays
      // running even though THIS bundle now shows "disabled". Say that up
      // front instead of only in the small print next to each service.
      const willStop = bundle.services.filter(
        (s) => otherClaimants(s, bundle.name).length === 0,
      );
      const willStay = bundle.services.filter(
        (s) => otherClaimants(s, bundle.name).length > 0,
      );
      const lines = [
        willStop.length > 0
          ? `Will stop: ${willStop.map((s) => s.name).join(", ")}.`
          : "No services will actually stop -- every one is still claimed by another enabled bundle.",
        willStay.length > 0
          ? `Will keep running (claimed by another enabled bundle too): ${willStay
              .map((s) => `${s.name} (${otherClaimants(s, bundle.name).join(", ")})`)
              .join(", ")}.`
          : "",
      ].filter(Boolean);
      const ok = await confirm({
        title: `Disable "${bundle.name}"?`,
        message: lines.join(" "),
        confirmLabel: "Disable",
        danger: willStop.length > 0,
      });
      if (!ok) return;
    }
    setBusy(true);
    setStatus(bundle.enabled ? "Disabling…" : "Enabling…");
    setIsError(false);
    try {
      const res = await apiFetch<EnableResponse | DisableResponse>(
        `/v1/bundles/${encodeURIComponent(bundle.name)}/${bundle.enabled ? "disable" : "enable"}`,
        { method: "POST", token },
      );
      setStatus(outcomeSummary(res));
      onChanged();
    } catch (e) {
      setStatus(friendlyErrorMessage(e));
      setIsError(true);
    }
    setBusy(false);
  }

  return (
    <section className={`mb-4 ${cardClass}`}>
      {dialog}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
              <Icon name="bundles" size={16} className="shrink-0 text-indigo-500 dark:text-indigo-400" /> {bundle.name}
            </h3>
            {bundle.core && <span className={badgeClass}>core</span>}
            <StatusBadge
              icon={bundle.enabled ? "check" : "close"}
              label={bundle.enabled ? "Enabled" : "Disabled"}
              tone={bundle.enabled ? "success" : "neutral"}
            />
          </div>
          <ul className="mt-2 flex flex-col gap-1">
            {bundle.services.map((s) => (
              <ServiceRow key={s.name} service={s} bundleName={bundle.name} />
            ))}
          </ul>
        </div>
        {bundle.core ? (
          // There's no "Disable" button to explain: say why in visible text.
          <div className="max-w-[14rem] text-right">
            <p className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-gray-600 dark:text-gray-300">
              <Icon name="lock" size={13} className="shrink-0" />
              Always on
            </p>
            <p className={fieldHintClass}>
              Core is the always-on kernel, so it can't be disabled.
            </p>
          </div>
        ) : (
          <div className="flex max-w-[14rem] flex-col items-end">
            <button
              onClick={handleToggle}
              disabled={!isAdmin || busy}
              aria-label={`${actionLabel} ${bundle.name}`}
              aria-describedby={
                disabledReason ? (adminNoteId ?? reasonId) : undefined
              }
              className={bundle.enabled ? secondaryButtonClass : primaryButtonClass}
            >
              {actionLabel}
            </button>
            {disabledReason && !adminNoteId && (
              <p id={reasonId} className={`${fieldHintClass} text-right`}>
                {disabledReason}
              </p>
            )}
          </div>
        )}
      </div>
      {status && <StatusLine isError={isError} className="mt-2">{status}</StatusLine>}
    </section>
  );
}
