import { type MutableRefObject, useRef } from "react";

import { useAuth } from "./auth";

/** The current access token behind a ref, for loaders keyed on `sessionKey`
 * rather than on the token itself (#55). The token string changes on every
 * silent refresh (#53); a callback that reads `tokenRef.current` when it runs
 * always authenticates with the latest token without having to be recreated
 * -- and so without refetching -- each time the token is refreshed. */
export function useTokenRef(): MutableRefObject<string> {
  const { token } = useAuth();
  const ref = useRef(token);
  ref.current = token;
  return ref;
}
