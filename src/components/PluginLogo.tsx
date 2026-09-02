/**
 * A plugin's own logo, from its SDK `DISPLAY.logo` (a lucide icon name). We map a
 * curated set of common icon names to their lucide components and fall back to a
 * puzzle piece for anything unknown — so a plugin can name any logo without
 * breaking the UI, and the trusted client owns which icons actually render (no
 * plugin-supplied markup). Colour comes from `DISPLAY.color`.
 */
import {
  Activity,
  Banknote,
  Bitcoin,
  Bot,
  Boxes,
  CloudSun,
  Coins,
  Database,
  Globe,
  type LucideIcon,
  Network,
  Newspaper,
  Puzzle,
  Radio,
  Rss,
  Server,
  Thermometer,
  Zap,
} from "lucide-react";

const LOGOS: Record<string, LucideIcon> = {
  puzzle: Puzzle,
  "cloud-sun": CloudSun,
  banknote: Banknote,
  bitcoin: Bitcoin,
  bot: Bot,
  boxes: Boxes,
  coins: Coins,
  database: Database,
  globe: Globe,
  network: Network,
  newspaper: Newspaper,
  radio: Radio,
  rss: Rss,
  server: Server,
  thermometer: Thermometer,
  activity: Activity,
  zap: Zap,
};

export interface PluginLogoProps {
  logo?: string | null;
  color?: string | null;
  size?: number | string;
  className?: string;
}

export function PluginLogo({
  logo,
  color,
  size = 16,
  className,
}: PluginLogoProps) {
  const Cmp = (logo && LOGOS[logo]) || Puzzle;
  return (
    <Cmp
      size={size}
      strokeWidth={2}
      className={className}
      style={color ? { color } : undefined}
      aria-hidden
    />
  );
}
