import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "../i18n";
import type { MyOrg } from "../lib/orgs";
import { OrgDefaultLanguage } from "./OrgDefaultLanguage";

const updateOrganization = vi.fn();
vi.mock("../lib/orgs", () => ({
  updateOrganization: (...args: unknown[]) => updateOrganization(...args),
}));
vi.mock("../lib/api", () => ({
  friendlyErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));
let canManage = true;
vi.mock("../lib/useCan", () => ({
  useCan: (key: string) => key === "org.settings.manage" && canManage,
}));

function org(overrides: Partial<MyOrg> = {}): MyOrg {
  return { id: 4, name: "Acme", slug: "acme", org_role: "admin", is_home: true, ...overrides };
}

function select(): HTMLSelectElement {
  return screen.getByLabelText("Default language for members") as HTMLSelectElement;
}

describe("OrgDefaultLanguage (#133)", () => {
  beforeEach(() => {
    canManage = true;
    updateOrganization.mockReset();
    updateOrganization.mockResolvedValue({ id: 4, name: "Acme", slug: "acme" });
  });
  afterEach(() => {
    cleanup();
    setLocale("en");
  });

  it("is hidden from anyone who can't manage the org's settings", () => {
    canManage = false;
    const { container } = render(<OrgDefaultLanguage org={org()} token="tok" />);
    expect(container.innerHTML).toBe("");
  });

  it("shows the org's default with en, tr and none", () => {
    render(<OrgDefaultLanguage org={org({ default_locale: "tr" })} token="tok" />);
    expect(screen.getByRole("heading", { name: "Default language" })).toBeTruthy();
    expect(select().value).toBe("tr");
    expect(Array.from(select().options).map((o) => [o.value, o.textContent])).toEqual([
      ["", "None (each member's browser language)"],
      ["en", "English"],
      ["tr", "Türkçe"],
    ]);
  });

  it("saves a new default and reports it", async () => {
    const onSaved = vi.fn();
    render(<OrgDefaultLanguage org={org()} token="tok" onSaved={onSaved} />);
    expect(select().value).toBe("");
    await act(async () => {
      fireEvent.change(select(), { target: { value: "tr" } });
    });
    expect(updateOrganization).toHaveBeenCalledWith(4, { default_locale: "tr" }, "tok");
    expect(select().value).toBe("tr");
    expect(screen.getByRole("status").textContent).toBe("Default language saved.");
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it("clears the default with null", async () => {
    render(<OrgDefaultLanguage org={org({ default_locale: "en" })} token="tok" />);
    await act(async () => {
      fireEvent.change(select(), { target: { value: "" } });
    });
    expect(updateOrganization).toHaveBeenCalledWith(4, { default_locale: null }, "tok");
  });

  it("puts the old value back with a clear error when the save fails", async () => {
    updateOrganization.mockRejectedValue(new Error("Forbidden"));
    const onSaved = vi.fn();
    render(<OrgDefaultLanguage org={org({ default_locale: "en" })} token="tok" onSaved={onSaved} />);
    await act(async () => {
      fireEvent.change(select(), { target: { value: "tr" } });
    });
    expect(select().value).toBe("en");
    expect(screen.getByRole("alert").textContent).toBe(
      "Couldn't save the default language, so the previous one is back. Forbidden",
    );
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("speaks Turkish", async () => {
    setLocale("tr");
    render(<OrgDefaultLanguage org={org()} token="tok" />);
    expect(screen.getByRole("heading", { name: "Varsayılan dil" })).toBeTruthy();
    const field = screen.getByLabelText("Üyeler için varsayılan dil") as HTMLSelectElement;
    expect(field.options[0].textContent).toBe("Yok (her üyenin tarayıcı dili)");
    await act(async () => {
      fireEvent.change(field, { target: { value: "tr" } });
    });
    expect(screen.getByRole("status").textContent).toBe("Varsayılan dil kaydedildi.");
  });
});
