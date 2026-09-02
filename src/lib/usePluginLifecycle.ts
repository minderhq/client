import { useState } from "react";

import { apiFetch, friendlyErrorMessage } from "./api";
import type { useConfirm } from "../components/ConfirmDialog";

/** Install/enable/disable/uninstall against `/v1/marketplace/plugins/{id}/*`
 * -- identical logic PluginCard (AvailablePluginsPage) and InstalledPluginCard
 * (InstalledPluginsPage) each hand-rolled separately. Only the confirm-dialog
 * copy and which actions apply differ between the two call sites; the status/
 * error bookkeeping and API calls are exactly the same. */
export function usePluginLifecycle({
  pluginId,
  displayName,
  token,
  confirm,
  onInstalled,
  onUninstalled,
  onToggleEnabled,
}: {
  pluginId: string;
  displayName: string;
  token: string;
  confirm: ReturnType<typeof useConfirm>["confirm"];
  onInstalled?: () => void;
  onUninstalled?: (pluginId: string) => void;
  onToggleEnabled?: (pluginId: string, enabled: boolean) => void;
}) {
  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);
  const [busy, setBusy] = useState(false);

  async function install(): Promise<boolean> {
    setBusy(true);
    setStatus("Installing…");
    setIsError(false);
    let ok = false;
    try {
      await apiFetch(`/v1/marketplace/plugins/${pluginId}/install`, {
        method: "POST",
        token,
      });
      setStatus("");
      onInstalled?.();
      ok = true;
    } catch (e) {
      setStatus(friendlyErrorMessage(e));
      setIsError(true);
    }
    setBusy(false);
    return ok;
  }

  async function uninstall(): Promise<boolean> {
    const confirmed = await confirm({
      title: "Uninstall plugin?",
      message: `This removes "${displayName}" and disables anything it was doing (data already collected is kept).`,
      danger: true,
    });
    if (!confirmed) return false;
    setBusy(true);
    setStatus("Uninstalling…");
    setIsError(false);
    let ok = false;
    try {
      await apiFetch(`/v1/marketplace/plugins/${pluginId}/uninstall`, {
        method: "DELETE",
        token,
      });
      setStatus("");
      onUninstalled?.(pluginId);
      ok = true;
    } catch (e) {
      setStatus(friendlyErrorMessage(e));
      setIsError(true);
    }
    setBusy(false);
    return ok;
  }

  async function toggleEnabled(currentlyEnabled: boolean): Promise<boolean> {
    const nextEnabled = !currentlyEnabled;
    setBusy(true);
    setStatus(nextEnabled ? "Enabling…" : "Disabling…");
    setIsError(false);
    let ok = false;
    try {
      await apiFetch(
        `/v1/marketplace/plugins/${pluginId}/${nextEnabled ? "enable" : "disable"}`,
        { method: "POST", token },
      );
      setStatus("");
      onToggleEnabled?.(pluginId, nextEnabled);
      ok = true;
    } catch (e) {
      setStatus(friendlyErrorMessage(e));
      setIsError(true);
    }
    setBusy(false);
    return ok;
  }

  return { status, isError, busy, install, uninstall, toggleEnabled };
}
