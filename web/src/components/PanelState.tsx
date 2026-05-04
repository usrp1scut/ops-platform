import { AlertCircle, CheckCircle2, Clock3, ShieldAlert } from "lucide-react";
import { type LucideIcon } from "lucide-react";

type PanelStateKind = "empty" | "error" | "loading" | "permission" | "success";

type PanelStateProps = {
  kind: PanelStateKind;
  message: string;
};

const icons: Record<PanelStateKind, LucideIcon> = {
  empty: Clock3,
  error: AlertCircle,
  loading: Clock3,
  permission: ShieldAlert,
  success: CheckCircle2,
};

export function PanelState({ kind, message }: PanelStateProps) {
  const Icon = icons[kind];
  const isWarning = kind === "error" || kind === "permission";
  const isSuccess = kind === "success";

  return (
    <div className={`notice-row${isWarning ? " warn" : ""}${isSuccess ? " ok" : ""}`}>
      <Icon size={16} aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}
