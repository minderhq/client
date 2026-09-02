import { useState } from "react";

import { getTheme, setTheme, type Theme } from "../lib/theme";
import { iconButtonClass } from "../lib/ui";
import { Icon, type IconName } from "./Icon";

const ORDER: Theme[] = ["system", "light", "dark"];
const ICON: Record<Theme, IconName> = {
  system: "theme-system",
  light: "theme-light",
  dark: "theme-dark",
};
const LABEL: Record<Theme, string> = { system: "System", light: "Light", dark: "Dark" };

/** One button, cycling system -> light -> dark -> system. A 3-way toggle
 * (rather than a plain light/dark switch) keeps "follow my OS" available as
 * an explicit, nameable state instead of just "whatever it happened to boot
 * into." */
export function ThemeToggle() {
  const [theme, setThemeState] = useState<Theme>(() => getTheme());

  function cycle() {
    const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
    setTheme(next);
    setThemeState(next);
  }

  return (
    <button
      type="button"
      onClick={cycle}
      title={`Theme: ${LABEL[theme]} (click to change)`}
      aria-label={`Theme: ${LABEL[theme]}. Click to switch.`}
      className={iconButtonClass}
    >
      <Icon name={ICON[theme]} size={18} />
    </button>
  );
}
