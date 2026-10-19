import { beforeEach } from "vitest";

import { clearReadCache } from "../lib/readCache";

// The shared read cache (#141) is module state: without this, a response one
// test's fetch mock returned would be served to the next test in the file.
beforeEach(() => {
  clearReadCache();
});
