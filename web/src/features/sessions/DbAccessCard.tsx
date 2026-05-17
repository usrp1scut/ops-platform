import { Copy, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { Asset } from "../../api/cmdb";

type DbProtocol = "mysql" | "postgres" | "redis";

export type DbAccessInfo = {
  asset: Asset;
  protocol: DbProtocol;
  ticket: string;
  expiresAt: string;
  username: string;
  database: string;
};

const DEFAULT_LOCAL_PORT: Record<DbProtocol, number> = {
  mysql: 13306,
  postgres: 15432,
  redis: 16379,
};

function wsBase() {
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${window.location.host}`;
}

function clientCommand(protocol: DbProtocol, port: number, username: string, database: string) {
  const user = username || "<user>";
  switch (protocol) {
    case "mysql":
      return `mysql -h 127.0.0.1 -P ${port} -u ${user} -p`;
    case "postgres":
      return `psql "host=127.0.0.1 port=${port} user=${user} dbname=${database || "<db>"}"`;
    case "redis":
      return `redis-cli -h 127.0.0.1 -p ${port}`;
  }
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="db-access-cmd">
      <div className="db-access-cmd-head">
        <span className="eyebrow">{label}</span>
        <button
          type="button"
          className="secondary-button compact"
          onClick={() => {
            void navigator.clipboard?.writeText(value);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          }}
        >
          <Copy size={13} aria-hidden="true" />
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <pre className="db-access-pre">{value}</pre>
    </div>
  );
}

export function DbAccessCard({ info, onClose }: { info: DbAccessInfo; onClose: () => void }) {
  const [port, setPort] = useState(DEFAULT_LOCAL_PORT[info.protocol]);
  const [secondsLeft, setSecondsLeft] = useState(() =>
    Math.max(0, Math.round((new Date(info.expiresAt).getTime() - Date.now()) / 1000)),
  );

  useEffect(() => {
    const t = window.setInterval(() => {
      setSecondsLeft(Math.max(0, Math.round((new Date(info.expiresAt).getTime() - Date.now()) / 1000)));
    }, 1000);
    return () => window.clearInterval(t);
  }, [info.expiresAt]);

  const tunnelCmd = useMemo(
    () =>
      `websocat --binary tcp-listen:127.0.0.1:${port} ${wsBase()}/ws/v1/cmdb/assets/${encodeURIComponent(
        info.asset.id,
      )}/db?ticket=${info.ticket}`,
    [port, info.asset.id, info.ticket],
  );
  const clientCmd = useMemo(
    () => clientCommand(info.protocol, port, info.username, info.database),
    [info.protocol, port, info.username, info.database],
  );

  const expired = secondsLeft <= 0;

  return (
    <div className="sessions-launch-modal" role="dialog" aria-modal="true" aria-label="Database access">
      <button type="button" className="sessions-launch-backdrop" aria-label="Close" onClick={onClose} />
      <div className="sessions-launch-card db-access-card">
        <div className="sessions-launch-head">
          <div>
            <p className="eyebrow">{info.protocol.toUpperCase()} access</p>
            <h2>{info.asset.name || info.asset.id}</h2>
          </div>
          <button type="button" className="icon-button compact-icon" onClick={onClose} title="Close" aria-label="Close">
            <X size={14} aria-hidden="true" />
          </button>
        </div>

        <p className="muted">
          DB sessions run through your own client. Start the tunnel, then connect on the local port. The ticket is
          single-use and must be redeemed within{" "}
          <strong className={expired ? "inline-error" : ""}>{expired ? "expired" : `${secondsLeft}s`}</strong>
          {expired ? " — close and reconnect to get a fresh one." : "; the tunnel then stays up until you stop it."}
        </p>

        <label className="form-field">
          <span>Local port</span>
          <input
            type="number"
            value={port}
            min={1}
            max={65535}
            onChange={(event) => {
              const n = Number.parseInt(event.target.value, 10);
              if (!Number.isNaN(n) && n > 0 && n < 65536) setPort(n);
            }}
          />
        </label>

        <CopyRow label="1 · Start tunnel (keep running)" value={tunnelCmd} />
        <CopyRow label="2 · Connect with your client" value={clientCmd} />

        <p className="muted">
          Password is not included — your client will prompt for it (saved on the asset's connection profile).
        </p>

        <div className="sessions-launch-foot">
          <button type="button" className="primary-button" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
