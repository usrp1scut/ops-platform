# Ops Platform 架构改造设计文档（V1）

Date: 2026-04-26
Author: Codex + Team
Scope: 后端服务边界重构、模块依赖收敛、前端门户可维护性治理（不改变产品功能范围）

## 1. 背景与目标

当前代码已快速覆盖 IAM、CMDB、AWS Sync、堡垒机探测、终端/RDP 会话与门户页面，功能面完整，但出现明显的“模块交织、边界不清、职责外溢”现象。继续在现结构上叠加需求，会逐步进入：

- 改动回归面过大，定位问题成本显著上升。
- 包间依赖方向失控，测试和替换实现困难。
- 一个模块变更牵动多条链路，发布风险升高。

本次改造目标不是“重写”，而是“在保持业务连续的前提下收敛架构边界”，形成可持续演进的结构。

## 2. 现状问题诊断

### 2.1 关键问题清单

1. 领域模块边界被打穿（P1）
- `awssync` 直接依赖 `cmdb.Repository` 并调用 CMDB 规则逻辑，导致同步模块承担资产治理职责。
- 后果：AWS 同步与 CMDB 规则强耦合，任一方改动都可能破坏另一方。

2. 连接接入链路能力重复（P1）
- Terminal 与 Guac/RDP 各自维护 ticket 生命周期与并发控制逻辑。
- 后果：鉴权行为、过期策略、并发阈值、审计点位不一致，难统一治理。

3. CMDB 包职责过载（P2）
- 一个包同时负责：资产 CRUD、连接凭据、探测状态、关系拓扑、VPC Proxy 提升/降级、HTTP handler、会话审计元信息。
- 后果：代码体积过大，认知负担高，review 与测试难度持续增加。

4. DAO 层承载业务编排（P2）
- VPC Proxy promote/demote、peer propagation 等跨表策略编排直接放在 repository 层。
- 后果：数据访问与业务策略耦合，后续策略变化将反复侵入存储层。

5. 传输层基础能力重复（P2）
- `writeJSON/writeError` 等响应辅助在多个模块重复定义。
- 后果：错误响应结构、日志行为、可观测性增强点无法统一推进。

6. Portal 单文件过大（P2）
- `app.js` 4k+ 行，混合状态管理、API 适配、复杂视图与交互逻辑。
- 后果：前端改造/排错成本高，局部改动容易引入连锁回归。

7. 模型语义耦合过深（P3）
- `cmdb/model.go` 聚合了多类对象（资产、连接、proxy、探测、关系）。
- 后果：模型变更容易触发无关编译与序列化兼容风险。

### 2.2 根因总结

- 以“功能直达”为优先，缺少跨模块依赖规则。
- 缺少应用服务层（UseCase）承载业务编排，导致 handler 与 repository 两端膨胀。
- 缺少统一的“连接接入域”（ticket/session/dial/proxy），同类能力按协议分散实现。
- 前端未进行模块化切分，业务增长直接堆入单文件。

## 3. 改造原则

1. 先收敛边界，再做性能优化。
2. 保持 API 向后兼容优先，避免一次性破坏客户端。
3. 引入应用服务层承载业务编排，repository 只处理持久化。
4. 依赖单向流动：`delivery -> application -> domain -> infrastructure`。
5. 同类能力统一实现（ticket/session/response/error model）。
6. 每个阶段必须可独立发布、可回滚、可观测。

## 4. 目标架构（To-Be）

### 4.1 逻辑分层

- Delivery 层
  - HTTP API（REST）
  - WebSocket gateway
  - Portal static delivery
- Application 层
  - 资产管理用例
  - 连接管理用例
  - 探测编排用例
  - AWS 同步用例
  - 会话签发与审计用例
- Domain 层
  - Asset / Relation / Connectivity / SessionAudit / IAM
  - 领域规则、状态转换、校验
- Infrastructure 层
  - Postgres repositories
  - AWS SDK adapter
  - SSH/RDP dial adapter
  - Crypto/Key/HostKey adapter

### 4.2 目标 bounded context

1. `asset`（原 CMDB 核心）
- 管理资产、关系、标签/系统标签、筛选与分页。
- 不包含连接凭据加解密细节和会话接入流程。

2. `connectivity`（新增核心域）
- 管理资产连接配置、SSH Proxy、协议解析、拨号准备。
- 统一 ticket/token 颁发与校验。
- 统一 terminal/rdp 的会话并发限制策略。

3. `probe`（可独立子域）
- 资产探测执行与探测状态回写。
- 不直接暴露 HTTP；由 `connectivity`/`asset` 用例触发。

4. `sync`（AWS）
- 聚焦“云资源采集与标准化映射”。
- 通过端口接口写入资产（AssetUpsertPort），不直接依赖 CMDB repository 实现。

5. `sessionaudit`
- 统一 terminal/rdp 审计写入、查询。
- 由 connectivity 使用，不分散在多个 handler。

### 4.3 包结构建议

建议目标目录（示例）：

```text
internal/
  app/
    asset/
    connectivity/
    probe/
    sync/
    sessionaudit/
  domain/
    asset/
    connectivity/
    session/
  infra/
    postgres/
      assetrepo/
      connectivityrepo/
      sessionrepo/
    aws/
    ssh/
    rdp/
  delivery/
    http/
    ws/
  platform/
    config/
    security/
    middleware/
```

说明：
- `internal/cmdb` 不再继续扩展为大一统目录，逐步迁移到 `app/domain/infra` 三层。
- `internal/httpserver/server.go` 仅做装配，不写业务判断。

## 5. 依赖规则（必须遵守）

1. `sync` 不允许 import `cmdb` repository 实现包。
2. `delivery` 不允许直接访问 SQL。
3. `repository` 不承载业务流程编排（如 promote/demote）。
4. `terminal` 与 `guacproxy` 不允许各自维护 ticket 存储；统一走 connectivity ticket service。
5. 响应封装、错误模型、审计写入接口统一。

建议通过 CI 加入静态规则检查（可先脚本版，后续引入 lint 规则）：
- 包依赖白名单。
- 禁止某些 import 路径组合。

## 6. 重点改造设计

### 6.1 Connectivity 统一接入层

#### 设计
- 提供统一接口：
  - `IssueTicket(user, asset, protocol)`
  - `ConsumeTicket(token)`
  - `AcquireSession(user)` / `ReleaseSession`
  - `ResolveTarget(asset, protocol)`
- Terminal 与 RDP handler 仅做协议桥接，不再维护 ticket map。

#### 收益
- 鉴权/并发/超时策略统一。
- 便于未来横向扩展（Redis ticket store、多实例共享）。
- 审计点位稳定，避免协议维度重复实现。

### 6.2 CMDB 拆层

#### 设计
- `AssetService`（application）承载：
  - 资产 CRUD
  - 关系管理
  - VPC Proxy promote/demote 编排
- `AssetRepository`（infra）仅保留 SQL CRUD。
- `ConnectivityRepository` 单独管理 connection/proxy/probe status。

#### 收益
- 编排逻辑离开 repository，测试粒度清晰。
- 资产域与连接域边界明确，避免模型继续膨胀。

### 6.3 AWS Sync 解耦

#### 设计
- 引入端口：
  - `AssetUpsertPort`
  - `RelationUpsertPort`
  - `ProxyPropagationPort`（可选）
- `sync` 只依赖端口，不 import 具体 CMDB 包。
- 由装配层注入 adapter（当前可由现有实现适配）。

#### 收益
- 同步流程可替换/复用。
- CMDB 内部重构不会反向破坏 sync。

### 6.4 API 响应与错误模型统一

#### 设计
- 统一 `delivery/http/response`：
  - `Success(data, meta)`
  - `Error(code, message, trace_id)`
- 逐步替换模块内重复 `writeJSON/writeError`。

#### 收益
- 客户端处理模型统一。
- 日志、审计、trace 可标准化接入。

### 6.5 Portal 模块化

#### 设计
- 将 `app.js` 分解为：
  - `state/store`
  - `api/client`
  - `views/cmdb`
  - `views/connectivity`
  - `views/aws`
  - `views/iam`
- 保持无构建工具优先，可先 ES modules 分文件。

#### 收益
- 前端需求并行开发可行。
- 降低单点改动回归风险。

## 7. 分阶段实施路线

### Phase 0：基线冻结与护栏（1 周）— ✅ 部分完成（2026-04-26）
- 输出依赖规则文档与 CI 检查脚本。
- 增加改造期间的回归测试基线：auth、cmdb list、connection save/test、aws sync trigger。
- DoD：主干可稳定运行，基线测试可重复执行。
- 已完成：
  - `internal/platform/httpx/response.go` 落地，9 处重复 `writeJSON/writeError` 已清理。
  - `internal/httpserver/response.go` 孤儿文件删除。
  - `scripts/check-deps.sh` 上线（STRICT=2 通过；DEBT=4 可见，将随 Phase 1-3 翻转为 STRICT）。
- 待办：基线回归测试脚本。

### Phase 1：Connectivity 抽取（1-2 周）— ✅ 完成（2026-04-26）
- 抽出 ticket/session 限流服务，替换 terminal/guacproxy 内部实现。
- 保持原 API 不变。
- DoD：terminal/rdp 共用一套 ticket service，行为一致。
- 已完成：
  - `internal/connectivity/ticket.go` 落地，提供 `IssueTicket/ConsumeTicket` + 后台 GC。
  - `terminal.Service` 仅保留 `AcquireSession/IdleTimeout`，`terminal.Handler` 注入 `*connectivity.TicketService`。
  - `guacproxy.Handler` 删除自有 ticket map / gcLoop，复用同一 TicketService。
  - `httpserver.Server` 单实例 TicketService 注入两端。
  - `scripts/check-deps.sh` Phase 1 规则翻为 STRICT，3 条 STRICT 全部通过。

### Phase 2：CMDB 拆层（2-3 周）— ✅ 完成（2026-04-26）
- 新增 `AssetService`/`ConnectivityService`。
- 将 promote/demote、relations 编排迁移到 service 层。
- repository 缩减为纯持久化。
- DoD：`repository` 不含跨聚合业务流程。
- 已完成：
  - `internal/cmdb/vpcproxy_service.go` 落地，`VPCProxyService.Promote/Demote/ReapplyPropagation` 持有跨聚合编排与事务边界。
  - `internal/cmdb/vpcproxy.go` 仅保留 `*sql.Tx` 上的纯持久化 helper。
  - `cmdb.Handler`、`awssync.Service`、`cmd/ops-worker` 均改为依赖服务层；awssync 暴露 `VPCProxyReapplier` 端口（为 Phase 3 解耦预热）。
  - `scripts/check-deps.sh` Phase 2 规则翻为 STRICT，4/4 STRICT 通过。
- 待办：`AssetService`（CRUD/连接/探活编排）后续视需要继续拆。

### Phase 3：Sync 解耦（1-2 周）— ✅ 完成（2026-04-26）
- `awssync` 改为依赖端口接口。
- 通过 adapter 调用资产写入与关系更新。
- DoD：`awssync` 不再 import `cmdb` 具体实现。
- 已完成：
  - `internal/awssync/port.go` 落地 `AssetUpsert` DTO 与 `AssetWriter` 端口（`UpsertAsset`、`LinkAWSRelations`）。
  - `internal/cmdb/aws_writer.go` 提供 adapter，承接原 awssync 内的 `cmdb_asset` / `cmdb_asset_relation` SQL。
  - `awssync.Service` 不再持有 `*sql.DB` 与 `*cmdb.Repository`，构造签名改为 `(cfg, accounts, AssetWriter, VPCProxyReapplier)`。
  - `DeriveOSFamily`（AWS AMI 知识）迁入 awssync；`DefaultUsernameForOSFamily` 留在 cmdb。
  - `httpserver.Server` 与 `cmd/ops-worker` 装配 `cmdb.NewAWSWriter(repo)`。
  - `scripts/check-deps.sh` Phase 3 两条规则翻为 STRICT，6/6 STRICT 全通过、0 DEBT。

### Phase 4：响应模型与门户模块化（2 周） ✅完成
- 统一 response/error 输出（已完成，使用 `internal/platform/httpx`）。
- 拆分 portal 脚本模块（已完成）：
  - 新建 `internal/httpserver/ui/portal/modules/`，从 `app.js` 抽出 `theme.js / hostkeys.js / keypairs.js / bastions.js` 共 4 个模块。
  - `app.js` 去掉 IIFE 包裹，所有文件以经典 `<script>` 加载，共享脚本作用域；模块只声明函数，应用启动时从 `bootstrap()` 调用。
  - `app.js` 行数从 4286 降至 3766（−520 行 / −12%）。
  - `scripts/check-deps.sh` 新增 STRICT 规则：`internal/httpserver/ui/portal/app.js` 不得超过 3800 行（强制后续新功能拆模块）。
- DoD：新增前端需求不再修改单一超大文件。

### Phase 5：收口与清理（1 周） ✅完成
- 删除废弃路径与重复实现：
  - 集成测试基建落地（Phase 0 历史欠款）：
  - `test/integration/` 引入 build-tag 隔离的端到端 harness，进程内启 ops-api，复用本地 docker-compose Postgres 上独立的 `ops_platform_test` 库。
  - 7 条基线冒烟全过：healthz / 本地登录→token 可用 / 资产列表 / hostkeys 列表 / AWS sync 状态 / 401 路径 / `PATCH {"tags":...}` 兼容回归。
  - `scripts/test-integration.sh` 一行启动；`docs/architecture/maintenance.md` 记下使用方式。
- `staticcheck -checks U1000` 全包扫描无未引用符号 — 前序 Phase 替换时即时清理已基本到位。
  - 顺手清掉两条 staticcheck 风格警告（S1016 `PromoteOptions(req)` 直接转换；SA6005 `strings.EqualFold`）。
  - aws-sdk-go v1 (SA1019) 因迁移成本与本次 refactor 范围解耦，记入 ADR-0007 作为已知技术债。
- 补齐 ADR、维护文档、依赖图：
  - 新建 `docs/adr/` 目录，覆盖 7 个 load-bearing 决策（分层依赖、ticket 服务、cmdb service/repo 拆分、awssync 端口、portal 模块化、proxy fail-closed、aws-sdk-go v1 滞留）。
  - `docs/architecture/dependency-graph.md` 落地 internal 包依赖快照 + STRICT 规则索引 + 故意保留的"逆向边"说明。
  - `docs/architecture/maintenance.md` 落地"加新功能去哪个包/做哪些事"的运维守则。
- DoD：代码结构与文档一致，旧实现无遗留调用。

## 7.1 已知技术债（refactor 范围之外）

- `aws-sdk-go v1` → v2 迁移（ADR-0007）。
- `internal/cmdb` 仍偏大一统：`AssetService` 应用层、与 `bastionprobe → cmdb` 的端口化都是后续独立 phase 的工作。
- 端到端"pg via proxy 真的释放 SSH 会话"的集成测试需要 sshd + pgsql 测试 infra，待该 infra 落地再补。

## 8. 兼容性与迁移策略

1. API 兼容
- 改造期内保持现有路由与字段。
- 如需新增字段，优先向后兼容扩展，不做破坏式重命名。

2. 数据兼容
- 数据库迁移保持可重复执行（`IF NOT EXISTS` 风格）。
- 涉及字段语义调整时提供 backfill SQL 与回滚说明。

3. 灰度与回滚
- 每阶段可独立上线。
- 保留旧实现一个发布窗口，通过 feature flag 切换后再删除。

## 9. 风险与缓解

1. 业务中断风险
- 缓解：保留 API 兼容层，阶段发布，关键链路冒烟测试。

2. 重构跨度大导致周期失控
- 缓解：按 Phase 交付，每阶段有清晰 DoD，不做跨阶段大合并。

3. 团队并行开发冲突
- 缓解：先冻结“包边界规则”，并以模块 ownership 分工。

## 10. 验收标准

### 10.1 架构验收
- `awssync` 不直接依赖 `cmdb` 具体实现。
- `terminal` 和 `guacproxy` 不再有独立 ticket 存储。
- repository 层不包含复杂业务编排。
- HTTP 响应辅助只保留一处统一实现。

### 10.2 工程验收
- `go test ./...` 持续通过。
- 关键 API 与 WebSocket 流程冒烟测试通过。
- CI 包依赖规则检查通过。

### 10.3 可维护性验收
- Portal 单文件拆分，单文件复杂度下降。
- 新增一个连接协议或同步资源类型时，不需要跨 5+ 包修改。

## 11. 本文档对应的下一步动作

1. 建立 `Phase 0` 任务清单与 owner。
2. 为 `connectivity` 抽取先出最小接口草案（ticket/session/resolve）。
3. 在不改 API 的前提下，先替换 terminal/guacproxy 的 ticket 实现。
4. 再进入 CMDB service/repository 分离。

