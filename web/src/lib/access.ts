import { hasPermission } from "./permissions";

export type AccessCapability = {
  id: string;
  label: string;
  permission: string;
};

export const accessCapabilities: AccessCapability[] = [
  {
    id: "view-requests",
    label: "View requests",
    permission: "bastion.request:read",
  },
  {
    id: "request",
    label: "Request access",
    permission: "bastion.request:write",
  },
  {
    id: "approve",
    label: "Approve requests",
    permission: "bastion.grant:write",
  },
  {
    id: "review",
    label: "Review grants",
    permission: "bastion.grant:read",
  },
];

export function accessCapabilityState(granted: readonly string[] | undefined) {
  return accessCapabilities.map((capability) => ({
    ...capability,
    allowed: hasPermission(granted, capability.permission),
  }));
}
