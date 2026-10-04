import { describe, expect, it } from "vitest";

import { ApiError } from "./api";
import {
  isExistingEmail,
  parseRegistrationMode,
  registrationModeFrom,
  registrationErrorMessage,
  registrationRefusal,
} from "./registration";

describe("parseRegistrationMode", () => {
  it.each([
    ["open", "open"],
    ["invite", "invite"],
    ["sso_only", "sso_only"],
    // `closed` is the permanent alias of `sso_only` (and what the API reports).
    ["closed", "sso_only"],
  ])("reads %s as %s", (value, mode) => {
    expect(parseRegistrationMode(value)).toBe(mode);
  });

  it.each(["approval", "CLOSED ", "Open", "inviteonly"])(
    "treats the unknown value %j as invite, never open",
    (value) => {
      expect(parseRegistrationMode(value)).toBe("invite");
    },
  );

  it("is unknown when the API doesn't report a mode", () => {
    expect(parseRegistrationMode(undefined)).toBeNull();
    expect(parseRegistrationMode("")).toBeNull();
    expect(parseRegistrationMode(42)).toBeNull();
  });
});

describe("registrationModeFrom", () => {
  it("reads the mode from a capabilities answer", () => {
    expect(
      registrationModeFrom({ password_reset_email: false, registration_mode: "closed" }),
    ).toBe("sso_only");
  });

  it("is unknown for a failed lookup or an API without the field", () => {
    expect(registrationModeFrom(null)).toBeNull();
    expect(registrationModeFrom({ password_reset_email: true })).toBeNull();
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
