import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { apiFetch } from "../lib/api";
import { useAuth } from "../lib/auth";
import { NAV_DESTINATIONS } from "../lib/nav";
import { getTheme, setTheme, type Theme } from "../lib/theme";
import { kbdClass } from "../lib/ui";
import { useDebouncedValue } from "../lib/useDebouncedValue";
import { Icon, type IconName } from "./Icon";

interface Command {
  id: string;
  label: string;
  sublabel: string;
  icon: IconName;
  group: string;
  keywords: string;
  to?: string;
  run?: () => void;
}

/** ⌘K / Ctrl-K jump-to across the whole app. Built from the same NAV_SECTIONS
 * the sidebar uses (so every page is reachable) plus a handful of verb-first
 * quick actions. A 25-page tree is faster to search than to click through;
 * this is the keyboard-first path power users expect from an ops console. */
export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const { role, token } = useAuth();
  const isAdmin = role === "admin";
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listboxId = useId();

  const commands = useMemo<Command[]>(() => {
    const nav: Command[] = NAV_DESTINATIONS.filter(
      (dest) => !dest.adminOnly || isAdmin,
    ).map((dest) => ({
      id: `nav:${dest.to}:${dest.label}`,
      label: dest.label,
      sublabel: dest.description ?? `Go to ${dest.group}`,
      icon: dest.icon,
      group: dest.group,
      keywords: dest.keywords ?? "",
      to: dest.to,
    }));
    const cycleTheme = () => {
      const order: Theme[] = ["system", "light", "dark"];
      const next = order[(order.indexOf(getTheme()) + 1) % order.length];
      setTheme(next);
    };
    const actions: Command[] = [
      { id: "act:ask", label: "Ask a question", sublabel: "Query your knowledge", icon: "ask", group: "Actions", keywords: "chat rag query", to: "/ask" },
      { id: "act:kb", label: "New knowledge base", sublabel: "Upload documents", icon: "knowledge-bases", group: "Actions", keywords: "create add upload", to: "/rag" },
      { id: "act:pipe", label: "New pipeline", sublabel: "Combine knowledge bases", icon: "pipelines", group: "Actions", keywords: "create add", to: "/rag/pipelines" },
      { id: "act:model", label: "Pull a model", sublabel: "Ollama model lifecycle", icon: "models", group: "Actions", keywords: "download install ollama", to: "/platform" },
      { id: "act:theme", label: "Toggle theme", sublabel: "System / light / dark", icon: "theme-dark", group: "Actions", keywords: "dark light mode appearance", run: cycleTheme },
    ];
    return [...actions, ...nav];
  }, [isAdmin]);

  const staticResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    const terms = q.split(/\s+/);
    return commands.filter((c) => {
      const hay = `${c.label} ${c.sublabel} ${c.group} ${c.keywords}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }, [commands, query]);

  // Live resource search (#1210): find a specific KB / pipeline / plugin by
  // name, not just pages. Debounced; navigates to the resource's list page with
  // a ?q= filter the page applies, since these resources have no per-item route.
  const [resources, setResources] = useState<Command[]>([]);
  const debouncedQuery = useDebouncedValue(query.trim(), 250);
  useEffect(() => {
    if (!open || debouncedQuery.length < 2) {
      setResources([]);
      return;
    }
    const ctrl = new AbortController();
    const q = debouncedQuery.toLowerCase();
    const noToken = Promise.resolve({ items: [] as { id: string; name: string }[] });
    Promise.allSettled([
      token
        ? apiFetch<{ items: { id: string; name: string }[] }>(
            "/v1/rag/knowledge-bases?limit=100",
            { token, signal: ctrl.signal },
          )
        : noToken,
      token
        ? apiFetch<{ items: { id: string; name: string }[] }>(
            "/v1/rag/pipeline?limit=100",
            { token, signal: ctrl.signal },
          )
        : noToken,
      apiFetch<{ plugins: { name: string; display_name: string }[] }>(
        `/v1/marketplace/plugins/search?q=${encodeURIComponent(debouncedQuery)}&limit=5`,
        { signal: ctrl.signal },
      ),
    ]).then(([kbs, pipes, plugins]) => {
      if (ctrl.signal.aborted) return;
      const out: Command[] = [];
      if (kbs.status === "fulfilled") {
        for (const kb of kbs.value.items
          .filter((k) => k.name.toLowerCase().includes(q))
          .slice(0, 5)) {
          out.push({
            id: `kb:${kb.id}`,
            label: kb.name,
            sublabel: "Open in Knowledge Bases",
            icon: "knowledge-bases",
            group: "Knowledge base",
            keywords: "",
            to: `/rag?q=${encodeURIComponent(kb.name)}`,
          });
        }
      }
      if (pipes.status === "fulfilled") {
        for (const p of pipes.value.items
          .filter((x) => x.name.toLowerCase().includes(q))
          .slice(0, 5)) {
          out.push({
            id: `pipe:${p.id}`,
            label: p.name,
            sublabel: "Open in Pipelines",
            icon: "pipelines",
            group: "Pipeline",
            keywords: "",
            to: `/rag/pipelines?q=${encodeURIComponent(p.name)}`,
          });
        }
      }
      if (plugins.status === "fulfilled") {
        for (const pl of (plugins.value.plugins ?? []).slice(0, 5)) {
          const name = pl.display_name || pl.name;
          out.push({
            id: `plugin:${pl.name}`,
            label: name,
            sublabel: "Open in Plugins",
            icon: "plugins",
            group: "Plugin",
            keywords: "",
            to: `/plugins/available?q=${encodeURIComponent(name)}`,
          });
        }
      }
      setResources(out);
    });
    return () => ctrl.abort();
  }, [open, debouncedQuery, token]);

  const results = useMemo(
    () => [...staticResults, ...resources],
    [staticResults, resources],
  );

  // Reset query/selection each time the palette opens, and focus the input.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      // Focus after paint so the element exists and the browser doesn't
      // steal focus back to the trigger button.
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [open]);

  // Clamp selection whenever the result set shrinks under it.
  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, results.length - 1)));
  }, [results.length]);

  // Keep the highlighted row scrolled into view during arrow navigation.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  function select(cmd: Command | undefined) {
    if (!cmd) return;
    onClose();
    if (cmd.to) navigate(cmd.to);
    else cmd.run?.();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (results.length ? (a + 1) % results.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (results.length ? (a - 1 + results.length) % results.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      select(results[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]"
      role="presentation"
      onMouseDown={onClose}
    >
      <div
        className="fixed inset-0 bg-gray-950/40 backdrop-blur-sm animate-[fade-in_0.15s_ease-out_both]"
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(e) => e.stopPropagation()}
        className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-lg ring-1 ring-black/5 animate-[pop_0.16s_cubic-bezier(0.34,1.56,0.64,1)_both] dark:border-gray-800 dark:bg-gray-900"
      >
        <div className="flex items-center gap-2.5 border-b border-gray-200 px-4 dark:border-gray-800">
          <Icon name="search" size={18} className="shrink-0 text-gray-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded="true"
            aria-controls={listboxId}
            aria-autocomplete="list"
            placeholder="Search pages and actions…"
            className="w-full bg-transparent py-3.5 text-sm text-gray-900 outline-none placeholder:text-gray-400 dark:text-gray-100"
          />
          <kbd className={kbdClass}>Esc</kbd>
        </div>

        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label="Results"
          className="max-h-[52vh] overflow-y-auto p-2"
        >
          {results.length === 0 && (
            <li className="px-3 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
              No matches for “{query}”.
            </li>
          )}
          {results.map((cmd, i) => {
            const isActive = i === active;
            return (
              <li key={cmd.id} data-index={i} role="option" aria-selected={isActive}>
                <button
                  type="button"
                  onMouseMove={() => setActive(i)}
                  onClick={() => select(cmd)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition ${
                    isActive
                      ? "bg-indigo-50 dark:bg-indigo-950/60"
                      : "hover:bg-gray-50 dark:hover:bg-gray-800/60"
                  }`}
                >
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                      isActive
                        ? "bg-indigo-100 text-indigo-600 dark:bg-indigo-900/60 dark:text-indigo-300"
                        : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                    }`}
                  >
                    <Icon name={cmd.icon} size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                      {cmd.label}
                    </span>
                    <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
                      {cmd.sublabel}
                    </span>
                  </span>
                  <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                    {cmd.group}
                  </span>
                  {isActive && (
                    <Icon name="enter" size={14} className="shrink-0 text-indigo-500" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
