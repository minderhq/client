import { useEffect } from "react";

/** Fallback for the `Referrer-Policy: no-referrer` header the static server
 * (nginx.conf) sets on routes whose URL carries a secret -- a password reset
 * token, an invite token: a `<meta name="referrer">` for as long as the page
 * is shown, restoring whatever was there before on the way out. */
export function useNoReferrer() {
  useEffect(() => {
    const existing = document.querySelector<HTMLMetaElement>('meta[name="referrer"]');
    const meta = existing ?? document.createElement("meta");
    const previous = existing?.content;
    meta.name = "referrer";
    meta.content = "no-referrer";
    if (!existing) document.head.appendChild(meta);
    return () => {
      if (existing) existing.content = previous ?? "";
      else meta.remove();
    };
  }, []);
}
