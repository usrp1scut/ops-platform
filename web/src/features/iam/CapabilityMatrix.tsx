import { useQuery } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import {
  getCapabilityMatrix,
  getCapabilityPrincipals,
  listIamUsers,
  resolveCapability,
  type MatrixCell,
  type ResolveResult,
} from "../../api/iam";
import { PanelState } from "../../components/PanelState";
import { buildAuditSearch } from "../../lib/launch";
import { formatScope, iamUserLabel } from "../../lib/iam";
import { useAuth } from "../auth/AuthProvider";

type SelectedCell = { permission: string; role: string };

function cellLabel(cell: MatrixCell | undefined): string {
  if (!cell || cell.state === "none") return "—";
  if (cell.state === "all") return "all";
  return formatScope(cell.scope);
}

function cellClass(cell: MatrixCell | undefined): string {
  if (!cell || cell.state === "none") return "cap-cell-none";
  if (cell.state === "all") return "cap-cell-all";
  return "cap-cell-partial";
}

export function CapabilityMatrix() {
  const auth = useAuth();
  const currentUserID = auth.identity?.user.id || "";
  const canReadIAM = auth.can("iam.user:read");
  const rootKey = ["iam", currentUserID, "capabilities"] as const;

  const [selected, setSelected] = useState<SelectedCell | null>(null);
  const [resolveUserID, setResolveUserID] = useState("");
  const [resolveCap, setResolveCap] = useState("");
  const [resolveRef, setResolveRef] = useState("");
  const [resolveResult, setResolveResult] = useState<ResolveResult | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);

  const matrix = useQuery({
    queryKey: [...rootKey, "matrix"],
    queryFn: getCapabilityMatrix,
    enabled: canReadIAM && Boolean(currentUserID),
  });
  const users = useQuery({
    queryKey: [...rootKey, "resolver-users"],
    queryFn: () => listIamUsers({}),
    enabled: canReadIAM && Boolean(currentUserID),
  });
  const principals = useQuery({
    queryKey: [...rootKey, "principals", selected?.permission ?? ""],
    queryFn: () => getCapabilityPrincipals(selected!.permission),
    enabled: canReadIAM && Boolean(selected?.permission),
  });

  const data = matrix.data;
  const selectedCell = useMemo<MatrixCell | undefined>(() => {
    if (!data || !selected) return undefined;
    return data.cells[selected.permission]?.[selected.role];
  }, [data, selected]);

  // Lightweight per-row hint without an extra request per row: how many
  // roles grant the capability at all. Precise users·roles comes from
  // /principals in the inspector when a cell is selected.
  function roleReach(permission: string): number {
    if (!data) return 0;
    const byRole = data.cells[permission] || {};
    return Object.values(byRole).filter((c) => c.state !== "none").length;
  }

  async function submitResolve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resolveUserID || !resolveCap) {
      setResolveError("Select a user and a capability.");
      return;
    }
    setResolving(true);
    setResolveError(null);
    setResolveResult(null);
    try {
      const result = await resolveCapability({
        user_id: resolveUserID,
        capability: resolveCap,
        resource_ref: resolveRef.trim() || undefined,
      });
      setResolveResult(result);
    } catch (error) {
      setResolveError(error instanceof Error ? error.message : "Resolve failed.");
    } finally {
      setResolving(false);
    }
  }

  if (!canReadIAM) {
    return <PanelState kind="permission" message="Permission required: iam.user:read" />;
  }
  if (matrix.isLoading) {
    return <PanelState kind="loading" message="Loading capability matrix" />;
  }
  if (matrix.isError || !data) {
    return (
      <PanelState
        kind="error"
        message={matrix.error instanceof Error ? matrix.error.message : "Failed to load matrix."}
      />
    );
  }

  const userItems = users.data?.items || [];
  const gridColumns = `minmax(240px, 1.4fr) repeat(${data.roles.length}, 1fr) 160px`;

  return (
    <>
      <article className="work-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Govern · capabilities</p>
            <h2>Capability matrix</h2>
          </div>
          {data.warnings.unscoped_grants > 0 ? (
            <span className="status-pill warn">
              <ShieldAlert size={14} aria-hidden="true" />
              {data.warnings.unscoped_grants} unscoped grant
              {data.warnings.unscoped_grants === 1 ? "" : "s"}
            </span>
          ) : (
            <span className="status-pill ok">no unscoped grants</span>
          )}
        </div>
        <p className="muted" style={{ marginTop: 0 }}>
          Who can do what, across which resources. Row = capability, column = role. Click a cell
          to see the scope and the roles that produce it.
        </p>

        <div className="cap-matrix-wrap">
          <div className="cap-matrix" style={{ gridTemplateColumns: gridColumns }}>
            <div className="cell h">Capability</div>
            {data.roles.map((role) => (
              <div className="cell h center" key={role.name}>
                {role.name}
              </div>
            ))}
            <div className="cell h center">Roles · today</div>

            {data.capabilities.map((cap) => (
              <Row
                key={cap.permission}
                permission={cap.permission}
                roles={data.roles}
                cells={data.cells[cap.permission] || {}}
                reach={roleReach(cap.permission)}
                selected={selected}
                onSelect={setSelected}
              />
            ))}
          </div>
        </div>
      </article>

      <div className="cap-inspector-grid">
        <article className="work-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Selected cell</p>
              <h2>
                {selected ? (
                  <>
                    <code>{selected.permission}</code> · role <code>{selected.role}</code>
                  </>
                ) : (
                  "Pick a cell"
                )}
              </h2>
            </div>
            {selectedCell ? (
              <span
                className={`status-pill ${
                  selectedCell.state === "all"
                    ? "ok"
                    : selectedCell.state === "partial"
                      ? "warn"
                      : "info"
                }`}
              >
                {selectedCell.state}
              </span>
            ) : null}
          </div>

          {!selected ? (
            <PanelState kind="empty" message="Select a matrix cell to inspect its sources." />
          ) : (
            <>
              <p className="muted" style={{ marginTop: 0 }}>
                Scope: <strong>{cellLabel(selectedCell)}</strong>
              </p>
              <div className="stack-1">
                {(selectedCell?.sources || []).length > 0 ? (
                  selectedCell!.sources!.map((src, i) => (
                    <div className="cap-source-row" key={`${src.kind}-${src.ref}-${i}`}>
                      <span>
                        <b>
                          {src.kind}:{src.ref}
                        </b>{" "}
                        · {formatScope(src.scope)}
                      </span>
                      <span className="micro">{src.kind}</span>
                    </div>
                  ))
                ) : (
                  <PanelState kind="empty" message="No role grants this capability." />
                )}
              </div>

              <p className="muted" style={{ marginBottom: 4 }}>
                Principals · today
              </p>
              {principals.isLoading ? (
                <PanelState kind="loading" message="Loading principals" />
              ) : principals.data ? (
                <span className="chip">{principals.data.summary.label}</span>
              ) : (
                <span className="muted">—</span>
              )}
            </>
          )}
        </article>

        <article className="work-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Answer my question</p>
              <h2>Can user X do Y on Z?</h2>
            </div>
            {resolveResult ? (
              <span className={`status-pill ${resolveResult.allowed ? "ok" : "warn"}`}>
                {resolveResult.allowed
                  ? resolveResult.expires_at
                    ? "yes · time-bounded"
                    : "yes"
                  : "no"}
              </span>
            ) : null}
          </div>

          <form className="cap-resolver-form" onSubmit={submitResolve}>
            <label className="form-field">
              <span>User</span>
              <select value={resolveUserID} onChange={(e) => setResolveUserID(e.target.value)}>
                <option value="">Select user</option>
                {userItems.map((u) => (
                  <option value={u.id} key={u.id}>
                    {iamUserLabel(u)}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>Capability</span>
              <select value={resolveCap} onChange={(e) => setResolveCap(e.target.value)}>
                <option value="">Select capability</option>
                {data.capabilities.map((c) => (
                  <option value={c.permission} key={c.permission}>
                    {c.permission}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>Resource (asset id or name, optional)</span>
              <input
                type="text"
                value={resolveRef}
                onChange={(e) => setResolveRef(e.target.value)}
                placeholder="prod-eks-node-…"
              />
            </label>
            <button type="submit" className="primary-button" disabled={resolving}>
              {resolving ? "Resolving" : "Resolve"}
            </button>
          </form>

          {resolveError ? <PanelState kind="error" message={resolveError} /> : null}

          {resolveResult ? (
            <div className="stack-1" style={{ marginTop: 12 }}>
              {resolveUserID ? (
                <Link
                  className="table-link"
                  to={`/audit${buildAuditSearch({ userID: resolveUserID })}`}
                  title="See this user's recorded sessions"
                >
                  See this user&rsquo;s sessions &rarr;
                </Link>
              ) : null}
              {resolveResult.expires_at ? (
                <p className="muted" style={{ margin: 0 }}>
                  Expires: {new Date(resolveResult.expires_at).toLocaleString()}
                </p>
              ) : null}
              {!resolveResult.allowed && resolveResult.denied_reason ? (
                <PanelState kind="error" message={resolveResult.denied_reason} />
              ) : null}
              {resolveResult.path.map((step, i) => (
                <div
                  className={`cap-path-step ${resolveResult.allowed ? "allow" : ""}`}
                  key={`${step.source}-${step.ref}-${i}`}
                >
                  <span>
                    <b>{step.capability}</b> · {step.source}:{step.ref}
                  </span>
                  <span className="micro">{step.note || formatScope(step.scope)}</span>
                </div>
              ))}
            </div>
          ) : null}
        </article>
      </div>
    </>
  );
}

function Row({
  permission,
  roles,
  cells,
  reach,
  selected,
  onSelect,
}: {
  permission: string;
  roles: { name: string }[];
  cells: Record<string, MatrixCell>;
  reach: number;
  selected: SelectedCell | null;
  onSelect: (cell: SelectedCell) => void;
}) {
  return (
    <>
      <div className="cell cap">
        <code>{permission}</code>
      </div>
      {roles.map((role) => {
        const cell = cells[role.name];
        const isSelected = selected?.permission === permission && selected?.role === role.name;
        return (
          <button
            type="button"
            className={`cell ${cellClass(cell)}${isSelected ? " selected" : ""}`}
            key={role.name}
            onClick={() => onSelect({ permission, role: role.name })}
          >
            {cellLabel(cell)}
          </button>
        );
      })}
      <div className="cell center">
        <span className="muted">
          {reach} role{reach === 1 ? "" : "s"}
        </span>
      </div>
    </>
  );
}
