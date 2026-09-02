import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { usePluginLifecycle } from "./usePluginLifecycle";

const apiFetch = vi.fn();

vi.mock("./api", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  friendlyErrorMessage: (e: unknown) => (e instanceof Error ? e.message : "error"),
}));

function setup(overrides: Partial<Parameters<typeof usePluginLifecycle>[0]> = {}) {
  const onInstalled = vi.fn();
  const onUninstalled = vi.fn();
  const onToggleEnabled = vi.fn();
  const confirm = overrides.confirm ?? vi.fn().mockResolvedValue(true);
  const hook = renderHook(() =>
    usePluginLifecycle({
      pluginId: "p1",
      displayName: "Weather Plus",
      token: "tok",
      onInstalled,
      onUninstalled,
      onToggleEnabled,
      ...overrides,
      confirm,
    }),
  );
  return { ...hook, onInstalled, onUninstalled, onToggleEnabled, confirm };
}

describe("usePluginLifecycle", () => {
  it("install() calls the install endpoint and reports success", async () => {
    apiFetch.mockResolvedValue({});
    const { result, onInstalled } = setup();

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.install();
    });

    expect(apiFetch).toHaveBeenCalledWith("/v1/marketplace/plugins/p1/install", {
      method: "POST",
      token: "tok",
    });
    expect(ok).toBe(true);
    expect(onInstalled).toHaveBeenCalled();
    expect(result.current.status).toBe("");
    expect(result.current.isError).toBe(false);
  });

  it("install() surfaces a failure via status/isError and returns false", async () => {
    apiFetch.mockRejectedValue(new Error("boom"));
    const { result, onInstalled } = setup();

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.install();
    });

    expect(ok).toBe(false);
    expect(result.current.status).toBe("boom");
    expect(result.current.isError).toBe(true);
    expect(onInstalled).not.toHaveBeenCalled();
  });

  it("uninstall() asks for confirmation and skips the call if declined", async () => {
    const { result, confirm } = setup({ confirm: vi.fn().mockResolvedValue(false) });

    await act(async () => {
      await result.current.uninstall();
    });

    expect(confirm).toHaveBeenCalled();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("uninstall() calls the uninstall endpoint and notifies the caller when confirmed", async () => {
    apiFetch.mockResolvedValue({});
    const { result, onUninstalled } = setup();

    await act(async () => {
      await result.current.uninstall();
    });

    expect(apiFetch).toHaveBeenCalledWith("/v1/marketplace/plugins/p1/uninstall", {
      method: "DELETE",
      token: "tok",
    });
    expect(onUninstalled).toHaveBeenCalledWith("p1");
  });

  it("toggleEnabled(false) enables the plugin", async () => {
    apiFetch.mockResolvedValue({});
    const { result, onToggleEnabled } = setup();

    await act(async () => {
      await result.current.toggleEnabled(false);
    });

    expect(apiFetch).toHaveBeenCalledWith("/v1/marketplace/plugins/p1/enable", {
      method: "POST",
      token: "tok",
    });
    expect(onToggleEnabled).toHaveBeenCalledWith("p1", true);
  });

  it("toggleEnabled(true) disables the plugin", async () => {
    apiFetch.mockResolvedValue({});
    const { result, onToggleEnabled } = setup();

    await act(async () => {
      await result.current.toggleEnabled(true);
    });

    expect(apiFetch).toHaveBeenCalledWith("/v1/marketplace/plugins/p1/disable", {
      method: "POST",
      token: "tok",
    });
    expect(onToggleEnabled).toHaveBeenCalledWith("p1", false);
  });

  afterEach(() => {
    apiFetch.mockReset();
  });
});
