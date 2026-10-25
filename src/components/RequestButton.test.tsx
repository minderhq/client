import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RequestButton } from "./RequestButton";

let mockAuth = { token: "tok", activeTenantId: "7", tenantId: "7" };
vi.mock("../lib/auth", () => ({ useAuth: () => mockAuth }));

const fetchMock = vi.fn();

function reply(status: number, body: unknown) {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  );
}

function sentBody(): Record<string, unknown> {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toMatch(/\/v1\/access-requests$/);
  expect(init.method).toBe("POST");
  return JSON.parse(String(init.body));
}

function renderButton(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  mockAuth = { token: "tok", activeTenantId: "7", tenantId: "7" };
});

describe("RequestButton", () => {
  it("asks for the model by name, sends a model_request and says where the answer shows", async () => {
    renderButton(<RequestButton kind="model_request" />);
    fireEvent.click(screen.getByRole("button", { name: "Request a model" }));
    expect(screen.getByRole("dialog", { name: "Ask for a model" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    expect(screen.getByRole("alert").textContent).toBe("Enter the model you need.");
    expect(fetchMock).not.toHaveBeenCalled();

    reply(202, { id: 1, kind: "model_request", status: "pending" });
    fireEvent.change(screen.getByLabelText("Which model do you need?"), { target: { value: " llama3.1:8b " } });
    fireEvent.change(screen.getByLabelText("Note (optional)"), { target: { value: "For contracts" } });
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));

    expect(await screen.findByText(/Request sent/)).toBeTruthy();
    expect(sentBody()).toEqual({
      kind: "model_request",
      organization_id: 7,
      subject: "llama3.1:8b",
      note: "For contracts",
    });
    expect(screen.getByRole("link", { name: "View my requests" }).getAttribute("href")).toBe("/account/requests");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    const done = screen.getByRole("button", { name: "Requested" }) as HTMLButtonElement;
    expect(done.disabled).toBe(true);
  });

  it("sends a plugin_install for the plugin it sits on", async () => {
    renderButton(<RequestButton kind="plugin_install" subject="Weather" name="Weather" />);
    fireEvent.click(screen.getByRole("button", { name: "Request install: Weather" }));
    expect(screen.getByRole("dialog", { name: "Ask an admin to install Weather" })).toBeTruthy();
    expect(screen.queryByLabelText("Which model do you need?")).toBeNull();

    reply(202, { id: 2, kind: "plugin_install", status: "pending" });
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    await screen.findByText(/Request sent/);
    expect(sentBody()).toEqual({ kind: "plugin_install", organization_id: 7, subject: "Weather" });
  });

  it("sends a team_join with the team, routed to the team's admins", async () => {
    renderButton(<RequestButton kind="team_join" teamId={3} name="Sales" />);
    fireEvent.click(screen.getByRole("button", { name: "Ask to join: Sales" }));
    expect(screen.getByText(/The team's admins get this request/)).toBeTruthy();

    reply(202, { id: 3, kind: "team_join", status: "pending" });
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    await screen.findByText(/Request sent/);
    expect(sentBody()).toEqual({ kind: "team_join", organization_id: 7, team_id: 3 });
  });

  it("says so when the same request is still pending", async () => {
    renderButton(<RequestButton kind="plugin_install" subject="Weather" name="Weather" />);
    fireEvent.click(screen.getByRole("button", { name: "Request install: Weather" }));
    reply(409, { detail: "access_request_exists" });
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "You already asked for this. Your request is still pending.",
      ),
    );
  });

  it("shows when a rejected request can be sent again, with the reason", async () => {
    renderButton(<RequestButton kind="plugin_install" subject="Weather" name="Weather" />);
    fireEvent.click(screen.getByRole("button", { name: "Request install: Weather" }));
    reply(409, {
      detail: {
        code: "request_cooldown",
        cooldown_until: "2026-11-20T10:00:00+00:00",
        decision_reason: "We use another one",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert.textContent).toMatch(/You can ask for this again on .*2026/));
    expect(alert.textContent).toMatch(/Reason: We use another one/);
  });

  it("renders nothing outside an organization", () => {
    mockAuth = { token: "tok", activeTenantId: "", tenantId: "" };
    const { container } = renderButton(<RequestButton kind="model_request" />);
    expect(container.textContent).toBe("");
  });
});
