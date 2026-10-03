import { describe, expect, it } from "vitest";

import { ApiError } from "./api";
import {
  isExistingEmail,
  parseRegistrationMode,
  registrationErrorMessage,
  registrationRefusal,
} from "./registration";

describe("parseRegistrationMode", () => {
  it.each(["open", "invite", "closed"])("reads %s", (mode) => {
    expect(parseRegistrationMode(mode)).toBe(mode);
  });

  it("treats an unknown value as invite, like the API does", () => {
    expect(parseRegistrationMode("approval")).toBe("invite");
  });

  it("is unknown when the API doesn't report a mode", () => {
    expect(parseRegistrationMode(undefined)).toBeNull();
    expect(parseRegistrationMode("")).toBeNull();
    expect(parseRegistrationMode(42)).toBeNull();
  });
});

describe("registration errors", () => {
  it.each([
    ["invite_required", /by invitation only/],
    ["invite_invalid", /expired, been withdrawn, or already been used/],
    ["invite_email_mismatch", /different email address/],
    ["invite_cannot_create_account", /already has an account\. Sign in first/],
  ])("maps the %s refusal to a message", (code, text) => {
    const e = new ApiError(code, 403);
    expect(registrationRefusal(e)).toBe(code);
    expect(registrationErrorMessage(e)).toMatch(text);
  });

  it("only treats a 403 with a known code as a refusal", () => {
    expect(registrationRefusal(new ApiError("invite_invalid", 400))).toBeNull();
    expect(registrationRefusal(new ApiError("Forbidden", 403))).toBeNull();
    expect(registrationRefusal(new Error("invite_invalid"))).toBeNull();
  });

  it("passes the closed-mode refusal text through", () => {
    const e = new ApiError(
      "Self-registration is disabled on this instance; sign in with SSO.",
      403,
    );
    expect(registrationErrorMessage(e)).toBe(e.message);
  });

  it("recognises an email that already has an account", () => {
    expect(isExistingEmail(new ApiError("Email already exists", 409))).toBe(true);
    expect(isExistingEmail(new ApiError("Username already exists", 409))).toBe(false);
    expect(registrationErrorMessage(new ApiError("Email already exists", 409))).toMatch(
      /Sign in instead/,
    );
    expect(registrationErrorMessage(new ApiError("Username already exists", 409))).toBe(
      "Username already exists",
    );
  });
});
