# ADR-0010: AWS asset uniqueness and cloud-wide index risk

Status: Accepted (2026-05-01)

## Context

AWS sync writes observed EC2, VPC, security group, and RDS resources into
`cmdb_asset`. Early implementations matched rows by `source='aws'` plus
`external_id`. That was not safe enough:

- AWS IDs are not platform-global; different AWS accounts can share the same
  resource-looking ID.
- RDS `DBInstanceIdentifier` is user-controlled and can overlap with an EC2,
  VPC, or security group identifier in the same account and region.
- A SELECT-then-INSERT upsert can race when `ops-worker` and an API-triggered
  sync run at the same time.

## Decision

AWS sync identity is:

```text
source + account_id + region + type + external_id
```

`internal/cmdb/aws_writer.go` uses a single `INSERT ... ON CONFLICT DO UPDATE`
for AWS sync upserts. The conflict target includes `type` and is backed by a
partial unique index over live, non-empty external IDs.

This keeps separate rows for:

- Same `external_id` in different AWS accounts.
- Same `external_id` in different AWS regions.
- Same `external_id` across different AWS resource types.

## Deferred Risk

Migration `0021_cmdb_asset_cloud_unique.sql` widens the partial unique index
from AWS-only rows to every non-manual source:

```sql
WHERE source <> 'manual'
```

That is intentionally left as known risk for now. The current product path only
has an AWS syncer, but `CreateAsset` can still create arbitrary non-manual
sources such as `csv`, `import`, or future cloud provider names. If a historic
database already contains duplicate live rows for a non-AWS, non-manual source
with the same `(source, account_id, region, type, external_id)`, migration
`0021` can fail when it creates the unique index.

The migrate command runs all SQL files in one transaction, so this failure
should roll back cleanly instead of leaving a half-applied index state.
However, Docker Compose and Kubernetes startup still depend on migration
success, so the platform may fail to start until the duplicated rows are
deduped or `0021` is adjusted.

## Consequences

- AWS sync correctness and concurrency safety are handled by the composite
  unique key plus `ON CONFLICT`.
- Cloud-wide uniqueness remains a design placeholder, not a fully proven import
  contract.
- Before adding another syncer or generic import source, revisit `0021` and do
  one of:
  - keep the uniqueness index provider-specific (`source='aws'`, then one
    explicit index per syncer);
  - add a pre-index dedupe step for all `source <> 'manual'` rows;
  - introduce provider-specific source registration with explicit uniqueness
    semantics.

