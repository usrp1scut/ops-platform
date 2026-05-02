# ADR-0007: aws-sdk-go v1 retained (v2 migration deferred)

Status: Accepted (2026-04-28)

## Context

`internal/awssync` imports `github.com/aws/aws-sdk-go` v1 (ec2, rds,
credentials, session). Upstream support ended 2025-07-31 — staticcheck
SA1019 flags every import. v2 (`aws-sdk-go-v2`) has different
configuration, paginator, and credential-chain shapes; the migration is
non-trivial.

## Decision

Do not migrate as part of the 2026-04 architecture refactor.

The refactor's scope is *boundary* work: where the AWS code lives, what it
talks to, how it's tested. Swapping the SDK underneath is orthogonal and
would balloon the diff, blur review, and risk the refactor's stability
goals. The Phase-3 port abstraction (`AssetWriter`) means the SDK upgrade
can be done inside `awssync` without touching cmdb.

## Consequences

- Known upstream EOL risk: bug fixes from AWS will stop arriving. The SDK
  still functions; AWS API endpoints are unchanged.
- staticcheck SA1019 must be silenced or filtered in any future CI gate
  until the migration ships.
- Tracked as a follow-up item; should be its own initiative with its own
  test plan (re-record VCR fixtures, retest each resource type).
