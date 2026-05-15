import { Monitor, Moon, Sun } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { useTheme, type ThemeMode } from "../hooks/useTheme";

const LABEL: Record<ThemeMode, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

const ICON: Record<ThemeMode, LucideIcon> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
};

const ORDER: ThemeMode[] = ["system", "light", "dark"];

export function ThemeToggle() {
  const { mode, cycleMode, resolvedTheme } = useTheme();
  const Icon = ICON[mode];
  // "System (Dark)" is more helpful than just "System" when the operator
  // is debugging why their UI looks the way it does.
  const detail = mode === "system" ? ` (${resolvedTheme})` : "";
  const next = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length];

  return (
    <button
      type="button"
      className="icon-button theme-toggle"
      onClick={cycleMode}
      title={`Theme: ${LABEL[mode]}${detail}. Click for ${LABEL[next]}.`}
      aria-label={`Theme: ${LABEL[mode]}${detail}`}
    >
      <Icon size={16} aria-hidden="true" />
    </button>
  );
}
