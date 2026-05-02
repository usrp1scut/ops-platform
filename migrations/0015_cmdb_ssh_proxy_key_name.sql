-- Proxies created by VPC-proxy promotion inherit their credentials from the
-- source asset's EC2 KeyPair (same pattern as assets: no per-target private
-- key stored, resolved on demand from the keypair store). Store the key name
-- on the proxy so dialProxy can look it up.

ALTER TABLE cmdb_ssh_proxy
    ADD COLUMN IF NOT EXISTS key_name TEXT NOT NULL DEFAULT '';
