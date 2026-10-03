import { describe, expect, it } from "vitest";

import { mergeInstalledPlugins } from "./installedPlugins";
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

describe("mergeInstalledPlugins", () => {
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
});
