import { describe, expect, it } from "vitest";

import { mergeInstalledPlugins, needsCatalogFallback } from "./installedPlugins";
import type { CatalogPlugin, RuntimePlugin } from "./marketplace";
import type { Installation } from "./types";

function inst(o: Partial<Installation> = {}): Installation {
  return {
    installation_id: "i1",
    plugin_id: "id-weather",
    version: null,
    status: "installed",
    enabled: true,
    installed_at: "2026-01-01T00:00:00Z",
    last_updated_at: "2026-01-01T00:00:00Z",
    name: "weather",
    display_name: "Weather",
    description: null,
    current_version: null,
    pricing_model: "free",
    base_tier: "community",
    category_id: null,
    author: null,
    requires_services: [],
    ...o,
  };
}

function rt(o: Partial<RuntimePlugin> = {}): RuntimePlugin {
  return {
    name: "weather",
    version: "1.0.0",
    description: "",
    author: "",
    status: "enabled",
    enabled: true,
    dependencies: [],
    capabilities: [],
    data_sources: [],
    databases: [],
    registered_at: "2026-01-01T00:00:00Z",
    health_status: "unknown",
    last_health_check: null,
    ...o,
  };
}

function cat(o: Partial<CatalogPlugin> = {}): CatalogPlugin {
  return {
    id: "id-weather",
    name: "weather",
    display_name: "Weather",
    description: null,
    author: "Minder",
    repository_url: null,
    distribution_type: "git",
    docker_image: null,
    current_version: "1.0.0",
    pricing_model: "free",
    base_tier: "community",
    status: "approved",
    featured: false,
    download_count: 0,
    rating_average: null,
    rating_count: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    published_at: null,
    developer_id: null,
    category_id: null,
    requires_services: [],
    screenshots: [],
    origin: "first_party",
    ...o,
  };
}

// The fixtures above are the pre-#2219 shapes (no install_source /
// marketplace_plugin_id / configurable, no installation origin): an older
// backend. These are the same payloads from a backend with #2219.
function rtNew(o: Partial<RuntimePlugin> = {}): RuntimePlugin {
  return rt({
    install_source: "vendored",
    repository_url: null,
    marketplace_plugin_id: "id-weather",
    configurable: false,
    ...o,
  });
}

function instNew(o: Partial<Installation> = {}): Installation {
  return inst({ origin: "first_party", repository_url: null, ...o });
}

describe("mergeInstalledPlugins on an older backend (legacy fallback)", () => {
  it("returns nothing when nothing is loaded", () => {
    expect(mergeInstalledPlugins(null, null, null)).toEqual([]);
    expect(mergeInstalledPlugins([], [], [])).toEqual([]);
  });

  it("is the union of runtime and installations, de-duplicated by name", () => {
    const entries = mergeInstalledPlugins(
      [inst(), inst({ plugin_id: "id-news", name: "news", display_name: "News" })],
      [rt(), rt({ name: "calendar" })],
      null,
    );
    expect(entries.map((e) => e.name)).toEqual(["calendar", "news", "weather"]);
    const weather = entries.find((e) => e.name === "weather")!;
    expect(weather.installation?.plugin_id).toBe("id-weather");
    expect(weather.runtime?.name).toBe("weather");
    const calendar = entries.find((e) => e.name === "calendar")!;
    expect(calendar.installation).toBeNull();
    expect(calendar.runtime).not.toBeNull();
  });

  it("keeps the first of duplicate names within one list", () => {
    const entries = mergeInstalledPlugins(
      [inst({ installation_id: "a" }), inst({ installation_id: "b" })],
      [rt({ version: "1.0.0" }), rt({ version: "9.9.9" })],
      null,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].installation?.installation_id).toBe("a");
    expect(entries[0].installedVersion).toBe("1.0.0");
  });

  it("joins the catalog by marketplace id for installs and by name for runtime-only plugins", () => {
    const entries = mergeInstalledPlugins(
      [inst({ plugin_id: "id-renamed", name: "old-name", display_name: "Renamed" })],
      [rt({ name: "calendar" })],
      [
        cat({ id: "id-renamed", name: "new-name", origin: "submitted" }),
        cat({ id: "id-cal", name: "calendar", display_name: "Calendar", origin: "first_party" }),
      ],
    );
    expect(entries.find((e) => e.name === "old-name")!.source).toBe("submitted");
    const calendar = entries.find((e) => e.name === "calendar")!;
    expect(calendar.source).toBe("first_party");
    expect(calendar.displayName).toBe("Calendar");
  });

  it("derives the source from the catalog row and leaves it null without one", () => {
    const entries = mergeInstalledPlugins(
      null,
      [rt({ name: "weather" }), rt({ name: "private-thing" }), rt({ name: "unlisted" })],
      [
        cat(),
        cat({ id: "id-p", name: "private-thing", repository_url: "https://git.example.com/x" }),
      ],
    );
    const byName = Object.fromEntries(entries.map((e) => [e.name, e.source]));
    expect(byName).toEqual({ weather: "first_party", "private-thing": "private_git", unlisted: null });
  });

  it("prefers the running version, then the install record's; listed from the catalog, then the record", () => {
    const [both] = mergeInstalledPlugins(
      [inst({ version: "1.0.0", current_version: "1.0.0" })],
      [rt({ version: "1.2.0" })],
      [cat({ current_version: "1.3.0" })],
    );
    expect(both.installedVersion).toBe("1.2.0");
    expect(both.listedVersion).toBe("1.3.0");

    const [recordOnly] = mergeInstalledPlugins(
      [inst({ version: "1.0.0", current_version: "1.1.0" })],
      null,
      null,
    );
    expect(recordOnly.installedVersion).toBe("1.0.0");
    expect(recordOnly.listedVersion).toBe("1.1.0");

    const [unknown] = mergeInstalledPlugins([inst({ version: " " })], null, null);
    expect(unknown.installedVersion).toBeNull();
    expect(unknown.listedVersion).toBeNull();
  });

  it("falls back to the plugin name for display and takes requires_services from the install, then the catalog", () => {
    const entries = mergeInstalledPlugins(
      [inst({ requires_services: ["influxdb"] })],
      [rt({ name: "bare" }), rt({ name: "listed" })],
      [cat({ id: "id-l", name: "listed", display_name: "Listed", requires_services: ["qdrant"] })],
    );
    const byName = Object.fromEntries(entries.map((e) => [e.name, e]));
    expect(byName.bare.displayName).toBe("bare");
    expect(byName.bare.requiresServices).toEqual([]);
    expect(byName.listed.requiresServices).toEqual(["qdrant"]);
    expect(byName.weather.requiresServices).toEqual(["influxdb"]);
  });

  it("sorts by display name, case-insensitively", () => {
    const entries = mergeInstalledPlugins(
      null,
      [rt({ name: "b" }), rt({ name: "A" }), rt({ name: "c" })],
      null,
    );
    expect(entries.map((e) => e.displayName)).toEqual(["A", "b", "c"]);
  });

  it("still joins a runtime plugin to a same-named row by name (all it has)", () => {
    const entries = mergeInstalledPlugins(
      [inst({ plugin_id: "id-jokes", name: "jokes", display_name: "Jokes (submitted)" })],
      [rt({ name: "jokes" })],
      [cat({ id: "id-jokes", name: "jokes", origin: "submitted" })],
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].source).toBe("submitted");
  });
});

describe("mergeInstalledPlugins with #2219's fields", () => {
  it("badges a running plugin from install_source", () => {
    const entries = mergeInstalledPlugins(
      null,
      [
        rtNew({ name: "weather" }),
        rtNew({
          name: "crm",
          install_source: "git",
          repository_url: "https://git.example.com/team/crm",
          marketplace_plugin_id: null,
        }),
        rtNew({ name: "hook", install_source: "manifest", marketplace_plugin_id: null }),
      ],
      null,
    );
    const byName = Object.fromEntries(entries.map((e) => [e.name, e.source]));
    expect(byName).toEqual({ weather: "first_party", crm: "private_git", hook: "manifest" });
  });

  it("gives no badge for a null or unknown install_source with nothing else to go on", () => {
    const entries = mergeInstalledPlugins(
      null,
      [
        rtNew({ name: "a", install_source: null, marketplace_plugin_id: null }),
        rtNew({ name: "b", install_source: "mindhub", marketplace_plugin_id: null }),
        rtNew({ name: "c", install_source: "something_new", marketplace_plugin_id: null }),
      ],
      // Even if a catalog with a third-party URL were around, no heuristic.
      [cat({ id: "id-a", name: "a", repository_url: "https://git.example.com/a" })],
    );
    expect(entries.map((e) => e.source)).toEqual([null, null, null]);
  });

  it("falls back to the installation's origin when install_source is null", () => {
    const [entry] = mergeInstalledPlugins(
      [instNew({ plugin_id: "id-jokes", name: "jokes", origin: "submitted" })],
      [rtNew({ name: "jokes", install_source: null, marketplace_plugin_id: "id-jokes" })],
      null,
    );
    expect(entry.source).toBe("submitted");
  });

  it("badges an installation-only plugin from its origin", () => {
    const entries = mergeInstalledPlugins(
      [
        instNew({ plugin_id: "id-a", name: "a", display_name: "A" }),
        instNew({ plugin_id: "id-b", name: "b", display_name: "B", origin: "submitted" }),
        instNew({ plugin_id: "id-c", name: "c", display_name: "C", origin: "community" }),
      ],
      [],
      null,
    );
    expect(entries.map((e) => [e.name, e.source])).toEqual([
      ["a", "first_party"],
      ["b", "submitted"],
      ["c", null],
    ]);
  });

  it("joins runtime to an installation by marketplace_plugin_id, across a rename", () => {
    const entries = mergeInstalledPlugins(
      [instNew({ plugin_id: "id-weather", name: "old-weather", display_name: "Weather" })],
      [rtNew({ name: "weather", marketplace_plugin_id: "id-weather" })],
      null,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("weather"); // the registry's name, for /config
    expect(entries[0].installation?.plugin_id).toBe("id-weather");
    expect(entries[0].key).toBe("runtime:weather");
  });

  it("takes listed version and needs from the installation record, with no catalog", () => {
    const [entry] = mergeInstalledPlugins(
      [instNew({ current_version: "1.3.0", requires_services: ["influxdb"] })],
      [rtNew({ version: "1.2.0" })],
      null,
    );
    expect(entry.catalog).toBeNull();
    expect(entry.installedVersion).toBe("1.2.0");
    expect(entry.listedVersion).toBe("1.3.0");
    expect(entry.requiresServices).toEqual(["influxdb"]);
  });

  it("shows a runtime-only plugin under its registry name, with no listed version", () => {
    const [entry] = mergeInstalledPlugins(null, [rtNew({ name: "telegraf" })], null);
    expect(entry.displayName).toBe("telegraf");
    expect(entry.listedVersion).toBeNull();
    expect(entry.source).toBe("first_party");
  });

  it("joins a vendored plugin whose catalog id isn't resolved yet to its own first-party record", () => {
    const entries = mergeInstalledPlugins(
      [instNew({ plugin_id: "id-weather", name: "weather" })],
      [rtNew({ name: "weather", marketplace_plugin_id: null })],
      null,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].installation?.plugin_id).toBe("id-weather");
  });

  // #2193 pinned these as known limitations of joining by name; with
  // marketplace_plugin_id on GET /v1/plugins (#2219) each one is fixed.
  describe("name collisions (fixed by joining on marketplace_plugin_id)", () => {
    const submittedJokes = instNew({
      plugin_id: "id-jokes",
      name: "jokes",
      display_name: "Jokes (submitted)",
      origin: "submitted",
      current_version: "9.0.0",
      repository_url: "https://github.com/someone/jokes",
    });

    it("a git install named like a submission keeps its own badge, name and version", () => {
      const entries = mergeInstalledPlugins(
        [submittedJokes],
        [
          rtNew({
            name: "jokes",
            version: "0.1.0",
            install_source: "git",
            marketplace_plugin_id: null,
          }),
        ],
        null,
      );
      const running = entries.find((e) => e.runtime)!;
      expect(running.installation).toBeNull();
      expect(running.source).toBe("private_git");
      expect(running.displayName).toBe("jokes");
      expect(running.installedVersion).toBe("0.1.0");
      expect(running.listedVersion).toBeNull(); // not the submission's 9.0.0
    });

    it("the submission's install stays its own card, not merged into the runtime plugin", () => {
      const entries = mergeInstalledPlugins(
        [submittedJokes],
        [rtNew({ name: "jokes", install_source: "manifest", marketplace_plugin_id: null })],
        null,
      );
      expect(entries).toHaveLength(2);
      const keys = entries.map((e) => e.key);
      expect(new Set(keys).size).toBe(2);
      const record = entries.find((e) => e.installation)!;
      expect(record.runtime).toBeNull();
      expect(record.source).toBe("submitted");
      expect(record.listedVersion).toBe("9.0.0");
    });

    it("a vendored plugin whose sync was refused (id null) isn't taken over by a same-named submission", () => {
      const entries = mergeInstalledPlugins(
        [submittedJokes],
        [rtNew({ name: "jokes", install_source: "vendored", marketplace_plugin_id: null })],
        null,
      );
      expect(entries).toHaveLength(2);
      expect(entries.find((e) => e.runtime)!.source).toBe("first_party");
      expect(entries.find((e) => e.installation)!.source).toBe("submitted");
    });

    it("a plugin linked to another row by id is never joined by name", () => {
      const entries = mergeInstalledPlugins(
        [submittedJokes, instNew({ plugin_id: "id-own", name: "own", display_name: "Own" })],
        [rtNew({ name: "jokes", marketplace_plugin_id: "id-own" })],
        null,
      );
      const running = entries.find((e) => e.runtime)!;
      expect(running.installation?.plugin_id).toBe("id-own");
      expect(entries.find((e) => e.key === "installation:id-jokes")?.runtime).toBeNull();
    });
  });
});

describe("needsCatalogFallback", () => {
  it("is false for #2219 payloads, and when nothing loaded", () => {
    expect(needsCatalogFallback(null, null)).toBe(false);
    expect(needsCatalogFallback([], [])).toBe(false);
    expect(needsCatalogFallback([instNew()], [rtNew()])).toBe(false);
    // null values are answers, not missing fields
    expect(
      needsCatalogFallback(
        [instNew({ repository_url: null })],
        [rtNew({ install_source: null, marketplace_plugin_id: null })],
      ),
    ).toBe(false);
  });

  it("is true when either service predates #2219", () => {
    expect(needsCatalogFallback(null, [rt()])).toBe(true); // old registry
    expect(needsCatalogFallback([inst()], null)).toBe(true); // old marketplace
    expect(needsCatalogFallback([instNew()], [rtNew(), rt({ name: "x" })])).toBe(true);
    const partial = rtNew();
    delete partial.marketplace_plugin_id;
    expect(needsCatalogFallback(null, [partial])).toBe(true);
  });
});
