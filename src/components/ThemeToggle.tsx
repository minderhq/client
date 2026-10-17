import { useState } from "react";

import { useI18n } from "../i18n";
import { getTheme, setTheme, type Theme } from "../lib/theme";
import { iconButtonClass } from "../lib/ui";
import { Icon, type IconName } from "./Icon";

const ORDER: Theme[] = ["system", "light", "dark"];
const ICON: Record<Theme, IconName> = {
  system: "theme-system",
  light: "theme-light",
  dark: "theme-dark",
};

/** One button, cycling system -> light -> dark -> system. A 3-way toggle
 * (rather than a plain light/dark switch) keeps "follow my OS" available as
 * an explicit, nameable state instead of just "whatever it happened to boot
 * into." */
export function ThemeToggle() {
  const [theme, setThemeState] = useState<Theme>(() => getTheme());
  const { t } = useI18n();
  const label = t(`theme.${theme}`);

  function cycle() {
    const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
    setTheme(next);
    setThemeState(next);
  }

  return (
    <button
      type="button"
      onClick={cycle}
      title={t("theme.toggleTitle", { theme: label })}
      aria-label={t("theme.toggleLabel", { theme: label })}
      className={iconButtonClass}
    >
      <Icon name={ICON[theme]} size={18} />
    </button>
  );
}
