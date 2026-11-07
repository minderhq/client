import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MyOrg } from "../lib/orgs";
import { OrgChatRetention } from "./OrgChatRetention";

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
  return screen.getByLabelText("Keep members' chat history for") as HTMLSelectElement;
}

describe("OrgChatRetention (#172)", () => {
  beforeEach(() => {
    canManage = true;
    updateOrganization.mockReset();
    updateOrganization.mockResolvedValue({ id: 4, name: "Acme", slug: "acme" });
  });
  afterEach(cleanup);

  it("is hidden from anyone who can't manage the org's settings", () => {
    canManage = false;
    const { container } = render(<OrgChatRetention org={org()} token="tok" />);
    expect(container.innerHTML).toBe("");
  });

  it("shows the server default (1 year) when the org has no value yet, and null as Forever", () => {
    const { rerender } = render(<OrgChatRetention org={org()} token="tok" />);
    expect(select().value).toBe("365");
    rerender(<OrgChatRetention org={org({ chat_history_retention_days: null })} token="tok" />);
    expect(select().value).toBe("");
  });

  it("saves a new period, and Forever as null", async () => {
    const onSaved = vi.fn();
    render(<OrgChatRetention org={org({ chat_history_retention_days: 365 })} token="tok" onSaved={onSaved} />);

    await act(async () => {
      fireEvent.change(select(), { target: { value: "30" } });
    });
    expect(updateOrganization).toHaveBeenLastCalledWith(4, { chat_history_retention_days: 30 }, "tok");
    expect(screen.getByText("Chat history setting saved.")).toBeTruthy();

    await act(async () => {
      fireEvent.change(select(), { target: { value: "" } });
    });
    expect(updateOrganization).toHaveBeenLastCalledWith(4, { chat_history_retention_days: null }, "tok");
    expect(onSaved).toHaveBeenCalledTimes(2);
  });

  it("puts the previous value back when the save fails", async () => {
    updateOrganization.mockRejectedValue(new Error("forbidden"));
    render(<OrgChatRetention org={org({ chat_history_retention_days: 90 })} token="tok" />);

    await act(async () => {
      fireEvent.change(select(), { target: { value: "30" } });
    });
    expect(select().value).toBe("90");
    expect(
      screen.getByText("Couldn't save the chat history setting, so the previous one is back. forbidden"),
    ).toBeTruthy();
  });
});
