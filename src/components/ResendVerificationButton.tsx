import { useEffect, useState } from "react";

import {
  formatWait,
  resendVerificationEmail,
  type ResendResult,
} from "../lib/emailVerification";
import { secondaryButtonClass } from "../lib/ui";
import { useTokenRef } from "../lib/useTokenRef";
import { StatusLine } from "./StatusLine";

/** A wait longer than this means the daily limit, not the short cooldown:
 * say so instead of counting down for hours. */
const LONG_WAIT_SECONDS = 3600;

/** "Send a new link" for the signed-in account, with the server's cooldown
 * (#2447): after a send, or a 429, the button stays disabled and counts down
 * the seconds the server asked for. `onAlreadyVerified` runs when the server
 * says there is nothing to confirm any more (already verified, or an SSO
 * account), so the page can let the user in. */
export function ResendVerificationButton({
  label = "Send a new link",
  onAlreadyVerified,
}: {
  label?: string;
  onAlreadyVerified: () => void;
}) {
  const tokenRef = useTokenRef();
  const [busy, setBusy] = useState(false);
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [message, setMessage] = useState<{ text: string; isError: boolean }>({
    text: "",
    isError: false,
  });

  const remaining = Math.max(0, Math.ceil((until - now) / 1000));
  const longWait = remaining > LONG_WAIT_SECONDS;

  useEffect(() => {
    if (until <= Date.now()) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [until]);

  function wait(seconds: number) {
    const t = Date.now();
    setNow(t);
    setUntil(t + seconds * 1000);
  }

  function show(result: ResendResult) {
    switch (result.kind) {
      case "sent":
        wait(result.retryAfterSeconds);
        setMessage({
          text: "We sent a new link. Links sent earlier no longer work.",
          isError: false,
        });
        return;
      case "rate_limited":
        wait(result.retryAfterSeconds);
        setMessage({
          text:
            result.retryAfterSeconds > LONG_WAIT_SECONDS
              ? "You've asked for the most links allowed today. Use the newest email, or try again later."
              : `Please wait ${formatWait(result.retryAfterSeconds)} before asking for another link.`,
          isError: true,
        });
        return;
      case "already_verified":
      case "not_applicable":
        setMessage({ text: "Your email address is already confirmed.", isError: false });
        onAlreadyVerified();
        return;
      case "undeliverable":
        setMessage({
          text: "We can't deliver email to this address. Ask an administrator for help.",
          isError: true,
        });
        return;
      case "unavailable":
        setMessage({
          text: "This server can't send verification emails. Ask an administrator for help.",
          isError: true,
        });
        return;
      case "error":
        setMessage({ text: result.message, isError: true });
    }
  }

  async function resend() {
    setBusy(true);
    setMessage({ text: "", isError: false });
    const result = await resendVerificationEmail(tokenRef.current);
    setBusy(false);
    show(result);
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={resend}
        disabled={busy || remaining > 0}
        className={`self-start ${secondaryButtonClass}`}
      >
        {busy
          ? "Sending…"
          : remaining > 0 && !longWait
            ? `${label} (${remaining}s)`
            : label}
      </button>
      <StatusLine isError={message.isError}>{message.text}</StatusLine>
    </div>
  );
}
