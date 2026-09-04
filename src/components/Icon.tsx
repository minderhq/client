import {
  Activity,
  Archive,
  ArrowRight,
  Bot,
  Boxes,
  CreditCard,
  Building2,
  Check,
  ChevronsUpDown,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  CircleUser,
  ClipboardCheck,
  Command,
  Copy,
  CornerDownLeft,
  ExternalLink,
  FileText,
  Filter,
  GitMerge,
  Globe,
  Info,
  KeyRound,
  Layers,
  LayoutDashboard,
  Library,
  Lock,
  LogIn,
  LogOut,
  Mail,
  type LucideIcon,
  type LucideProps,
  Menu,
  MessagesSquare,
  Mic,
  Monitor,
  Moon,
  Network,
  PackageCheck,
  Pencil,
  Plus,
  Puzzle,
  RotateCcw,
  Search,
  Send,
  Settings,
  Sparkles,
  Star,
  Store,
  Sun,
  Tags,
  Download,
  Eye,
  Link2,
  Play,
  ScrollText,
  Trash2,
  TriangleAlert,
  Undo2,
  Upload,
  Users,
  UsersRound,
  Volume2,
  Wand2,
  Workflow,
  X,
  Zap,
} from "lucide-react";

/**
 * One semantic icon registry for the whole app. Pages, nav config, and the
 * command palette reference these stable string names instead of importing
 * lucide symbols directly, so:
 *   - the icon behind a concept ("pipelines", "ask") is swapped in ONE place,
 *   - config objects (Sidebar SECTIONS, command palette actions) can carry an
 *     `icon: IconName` string without importing components,
 *   - stroke width / default size stay consistent everywhere (the old app used
 *     bare emoji, which render at inconsistent sizes and can't inherit color).
 *
 * These replace the emoji that used to stand in for icons across the app —
 * emoji can't take `currentColor`, so they never matched the surrounding text
 * tone in dark mode and looked out of place next to real UI chrome.
 */
export const ICONS = {
  home: LayoutDashboard,
  ask: Sparkles,
  billing: CreditCard,
  // RAG
  "knowledge-bases": Library,
  pipelines: Workflow,
  graph: Network,
  taxonomy: Tags,
  merge: GitMerge,
  conversations: MessagesSquare,
  // Plugins
  plugins: Puzzle,
  "available-plugins": Store,
  installed: PackageCheck,
  submit: Upload,
  review: ClipboardCheck,
  licenses: KeyRound,
  // AI tools
  "ai-tools": Zap,
  // Bundles
  bundles: Boxes,
  // Platform
  models: Bot,
  status: Activity,
  voice: Mic,
  backups: Archive,
  users: Users,
  teams: UsersRound,
  settings: Settings,
  // Chrome / affordances
  search: Search,
  command: Command,
  "theme-system": Monitor,
  "theme-light": Sun,
  "theme-dark": Moon,
  user: CircleUser,
  logout: LogOut,
  login: LogIn,
  arrow: ArrowRight,
  external: ExternalLink,
  info: Info,
  warning: TriangleAlert,
  help: CircleHelp,
  copy: Copy,
  check: Check,
  send: Send,
  enter: CornerDownLeft,
  close: X,
  "chevron-right": ChevronRight,
  "chevron-down": ChevronDown,
  menu: Menu,
  plus: Plus,
  delete: Trash2,
  edit: Pencil,
  reset: RotateCcw,
  filter: Filter,
  lock: Lock,
  globe: Globe,
  layers: Layers,
  file: FileText,
  mail: Mail,
  speaker: Volume2,
  play: Play,
  download: Download,
  wand: Wand2,
  undo: Undo2,
  mic: Mic,
  upload: Upload,
  eye: Eye,
  link: Link2,
  star: Star,
  org: Building2,
  "chevron-updown": ChevronsUpDown,
  audit: ScrollText,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

export interface IconProps extends Omit<LucideProps, "ref"> {
  name: IconName;
}

/** Render a registry icon by name. Defaults to 1em so it scales with the
 * surrounding text; `size`/`className` override as usual. `aria-hidden` is on
 * by default since icons here are decorative next to a text label — pass an
 * explicit `aria-label` (and `aria-hidden={false}`) for a standalone icon. */
export function Icon({ name, size = "1em", strokeWidth = 2, ...rest }: IconProps) {
  const Cmp = ICONS[name];
  return <Cmp size={size} strokeWidth={strokeWidth} aria-hidden {...rest} />;
}
