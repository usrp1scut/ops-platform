import { ShieldCheck } from "lucide-react";

type PermissionListProps = {
  permissions: readonly string[];
  emptyLabel: string;
};

export function PermissionList({ permissions, emptyLabel }: PermissionListProps) {
  if (permissions.length === 0) {
    return <span className="muted">{emptyLabel}</span>;
  }

  return (
    <div className="permission-list">
      {permissions.map((permission) => (
        <span className="chip permission" key={permission}>
          <ShieldCheck size={14} aria-hidden="true" />
          {permission}
        </span>
      ))}
    </div>
  );
}
