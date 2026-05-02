# Architecture Decision Records

Short notes documenting the load-bearing structural decisions made during the
2026-04 refactor (`docs/design/architecture-refactor-v1.md`). Each ADR is
intentionally terse: context → decision → consequences. Append, do not edit
once accepted; supersede with a new ADR if the call changes.

Use `0000-template.md` when drafting a new ADR.

| ID  | Title                                                | Status   |
| --- | ---------------------------------------------------- | -------- |
| 0001 | Layered packages and dependency rules                | Accepted |
| 0002 | Unified connectivity ticket service                  | Accepted |
| 0003 | CMDB service / repository split                      | Accepted |
| 0004 | AWS sync depends on AssetWriter port                 | Accepted |
| 0005 | Portal modularization via classic `<script>` files   | Accepted |
| 0006 | Bastion proxy is fail-closed                         | Accepted |
| 0007 | aws-sdk-go v1 retained (v2 migration deferred)       | Accepted |
| 0008 | SSH proxy package extracted from cmdb                | Accepted |
| 0009 | JIT bastion access via grants and requests           | Accepted |
| 0010 | AWS asset uniqueness and cloud-wide index risk       | Accepted |
