# Architecture Overview

这份概览用于学习项目整体结构。更细的维护规则见 `docs/architecture/maintenance.md`，严格依赖边界见 `docs/architecture/dependency-graph.md`，重要历史决策见 `docs/adr/`。

## 项目定位

`ops-platform` 是一个运维平台原型，覆盖用户认证、权限、CMDB 资产管理、AWS 账号接入、资源同步、堡垒机探测和嵌入式 portal。

## 主要运行组件

- `ops-api`：HTTP API 和 portal 入口。
- `ops-worker`：AWS 资源同步 worker。
- `bastion-probe`：主机事实探测 worker。
- `migrate`：数据库 migration 执行入口。
- PostgreSQL：主要业务数据存储。
- Redis 和 MinIO：本地组合环境中的基础设施依赖。

## 代码组织

高层入口在 `cmd/`，业务和平台能力在 `internal/`。

常见职责：

- `internal/httpserver`：HTTP server、route 挂载、portal 静态资源。
- `internal/platform/httpx`：统一 HTTP response 和 error helper。
- `internal/iam`：认证、RBAC、审计。
- `internal/cmdb`：资产、连接配置、关系、VPC proxy 相关逻辑。
- `internal/aws`：AWS 账号接入和凭证管理。
- `internal/awssync`：AWS 资源读取和标准化。
- `internal/bastionprobe`：SSH/Postgres/RDP 等探测逻辑。
- `internal/connectivity`：短期连接 ticket。
- `internal/terminal` 和 `internal/guacproxy`：WebSocket 连接能力。

## 请求链路

典型 API 请求大致经过：

1. `internal/httpserver/server.go` 挂载 route。
2. auth 和 RBAC middleware 校验身份与权限。
3. handler 解析 request、调用 service 或 repository。
4. service 负责跨聚合编排和事务边界。
5. repository 负责持久化。
6. handler 使用 `httpx.WriteJSON` 或 `httpx.WriteError` 返回结果。

## 学习重点

- handler 不应该承载复杂业务编排。
- repository 应保持持久化职责，不做跨聚合业务决策。
- service 是放置事务边界和跨模块编排的主要位置。
- worker 包应通过 port 或 DTO 和其他模块交互，避免反向依赖。
- 每次新增能力都要同时思考 route、permission、audit、migration、test 和文档。

## 阅读顺序建议

1. `README.md`
2. `docs/architecture/maintenance.md`
3. `internal/httpserver/server.go`
4. 一个具体业务包，例如 `internal/cmdb`
5. 对应 ADR，例如 `docs/adr/0003-cmdb-service-repository-split.md`
6. `docs/architecture/dependency-graph.md`

