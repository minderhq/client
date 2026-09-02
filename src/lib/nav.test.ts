import { describe, expect, it } from "vitest";

import { NAV_SECTIONS, entryIsActive, tabGroupForPath } from "./nav";

const graphEntry = NAV_SECTIONS.flatMap((s) => s.items).find(
  (i) => i.to === "/rag/graph",
)!;

const GRAPH_ROUTES = ["/rag/graph", "/rag/taxonomy-review", "/rag/entity-merges"];

describe("nav — Knowledge Graph grouping (#1230)", () => {
  it("keeps the Knowledge Graph entry active on all three graph surfaces", () => {
    for (const route of GRAPH_ROUTES) {
      expect(entryIsActive(graphEntry, route)).toBe(true);
    }
  });

  it("is not active on the golden-path Knowledge routes", () => {
    expect(entryIsActive(graphEntry, "/rag")).toBe(false);
    expect(entryIsActive(graphEntry, "/rag/pipelines")).toBe(false);
    expect(entryIsActive(graphEntry, "/rag/conversations")).toBe(false);
  });

  it("groups the three surfaces as tabs under one Knowledge Graph entry", () => {
    for (const route of GRAPH_ROUTES) {
      const group = tabGroupForPath(route);
      expect(group?.label).toBe("Knowledge Graph");
      expect(group?.tabs.map((t) => t.to)).toEqual(GRAPH_ROUTES);
    }
  });

  it("no tab group on the golden-path routes", () => {
    expect(tabGroupForPath("/rag")).toBeNull();
    expect(tabGroupForPath("/rag/pipelines")).toBeNull();
  });

  it("demotes the advanced surfaces out of the top-level Knowledge rows", () => {
    const knowledge = NAV_SECTIONS.find((s) => s.label === "Knowledge")!;
    const topLevel = knowledge.items.map((i) => i.to);
    // The golden path + the single grouped entry are top-level…
    expect(topLevel).toEqual([
      "/rag",
      "/rag/pipelines",
      "/rag/conversations",
      "/rag/graph",
    ]);
    // …Taxonomy Review / Entity Merge Review are reachable only as tabs.
    expect(topLevel).not.toContain("/rag/taxonomy-review");
    expect(topLevel).not.toContain("/rag/entity-merges");
  });
});
