import { CheckCircle2, ShieldCheck } from "lucide-react";

import { useAuth } from "../auth/AuthProvider";

type ModulePlaceholderProps = {
  title: string;
  area: string;
  permission: string;
  workflows: string[];
};

export function ModulePlaceholder({ title, area, permission, workflows }: ModulePlaceholderProps) {
  const auth = useAuth();
  const allowed = auth.can(permission);

  return (
    <section className="page-section">
      <div className="page-header">
        <div>
          <p className="eyebrow">{area}</p>
          <h1>{title}</h1>
        </div>
        <span className={`status-pill ${allowed ? "ok" : "warn"}`}>
          <ShieldCheck size={14} aria-hidden="true" />
          {allowed ? permission : `Needs ${permission}`}
        </span>
      </div>

      <div className="work-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Migration queue</p>
            <h2>Legacy workflow parity</h2>
          </div>
          <span className="status-pill">queued</span>
        </div>
        <div className="workflow-list">
          {workflows.map((workflow) => (
            <div className="workflow-row" key={workflow}>
              <CheckCircle2 size={16} aria-hidden="true" />
              <span>{workflow}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
