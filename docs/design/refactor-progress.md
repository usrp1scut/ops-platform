# Refactor Progress

## 2026-05-16 · 阶段 0：准备

- 先完成一次只读代码地图，作为后续按方案 A（Operate / Inventory / Govern）迁移的基线；该阶段性地图已被后续进度记录与现行架构文档吸收，不再单独保留。
- 已梳理当前路由、`AppShell` 侧栏、现有路由到未来三分区的归属、`Sessions` 的 Live / Audit 切换实现，以及 `IAM` 页面的 hook / API 数据链路。
- 本阶段严格停在准备工作：未修改任何业务代码，未提前新增 `Connect` / `Audit` 路由，也未调整现有导航结构。
- 验证：逐项对照 `router.tsx`、`AppShell.tsx`、`SessionsPage.tsx`、`AssetsPage.tsx`、`IamPage.tsx` 与 `api/iam.ts`；本阶段为文档整理，未运行代码测试。

## 2026-05-16 · 阶段 1：侧栏分组 + 路由别名

- `AppShell` 按方案 A 重组为 `Operate / Inventory / Govern` 三分区，并把 `Profile` 下沉为底部独立账户区，先让全局导航长成目标形状。
- 在不新增真实路由的前提下，先把 `Connect` 挂到现有 `/portal/cmdb`，把 `Audit` 挂到 `/portal/sessions?mode=audit`；`Connect` 标记 `new`，`Audit` 保持无徽章。
- 为了让占位期的导航状态保持诚实，`Sessions` 与 `Audit` 会按 `mode=audit` 区分高亮，`Connect` 作为别名入口不会和 `CMDB` 同时显示为当前页。
- 顺手修复了 `Sessions` 左侧资产树在 live workspace 中无法吃满剩余高度的问题：仅在 Sessions rail 作用域内解除通用 `.asset-tree` 的高度上限，没有扩大到业务页面重构。
- 本阶段严格停在阶段 1：未新增独立 `Connect` / `Audit` 页面，未改动 `features/` 下既有页面逻辑。
- 验证：`cd web && npm run typecheck`、`cd web && npm run build` 通过；浏览器手测确认三分区导航、`Audit` 占位跳转，以及资产树高度修复均正常。

## 2026-05-16 · 阶段 2：Sessions / Audit 拆分

- 新增独立的 `/portal/audit` 页面，将原先嵌在 `SessionsPage` 中的 Audit 模式迁出，保留现有筛选栏、统计卡片、记录表格与录屏 `Inspect` 能力，数据层暂不重构。
- `SessionsPage` 移除 Live / Audit 顶部切换，只保留实时会话工作区，并在右上角新增 `Open Audit →` 入口。
- 旧地址 `/portal/sessions?mode=audit` 现在会自动重定向到 `/portal/audit`，侧栏 Govern 分组下的 `Audit` 也从占位链接切换为真实路由。
- 本阶段严格停在阶段 2：未提前实现阶段 2.5 的多会话标签页，也未扩展到新的 Connect 页面或后端接口调整。
- 验证：`cd web && npm run typecheck`、`cd web && npm run build` 通过；浏览器手测确认旧路径重定向、`Open Audit →` 跳转、Audit 表格与 `Inspect` 录屏预览均可用。
- 回填更正（记于 2026-05-16，事实早于本条）：阶段 2.5 多会话标签页**已实现**，落地于 `fdb2ff7 feat(web): turn Sessions Live and Assets pages into real workspaces`（2026-05-12，早于本进度文档撰写）。`SessionsPage` 现为 `liveSessions: LiveSession[]` + `activeLiveID` 的并发多会话工作区：每会话一个 `live-session-tabs` 标签可切换/关闭，`live-session-stage` 以 `hidden` 切换渲染各 pane，关闭当前标签自动跳 `next[0]`。即"阶段 2.5"非长期延后，后续待办清单不应再列此项。

## 2026-05-16 · 阶段 3：Connect 新页

- 新增 `web/src/features/connect/ConnectPage.tsx`，按设计评审第 10 页落地三栏布局：左 360px 资产树、中部所选资产详情头部 + 连接面板、右侧三张上下文卡片（近期使用 / 谁有访问权 / 标签）。
- 把原先内联在 `SessionsPage` 的 asset rail 抽成共享组件 `web/src/features/sessions/AssetRail.tsx`（保留 env→vpc→host 分组、搜索、bastion 标记、两行行样式），`SessionsPage` 改为消费它且 Live 行为保持不变（点击=启动、SSH/RDP 切换、刷新照旧）；`ConnectPage` 复用同一组件，点击=选中并高亮。
- 详情头部：资产名 + 状态 pill + `Open SSH` / `Open RDP` / `View in CMDB`；连接面板按是否有 grant 分支——有 grant 显示倒计时（`formatGrantTimeRemaining`）与 `Open SSH`/`Open RDP`，无 grant 同位置显示 `Request access`（跳 `/access`）。
- 顶栏中央放 ⌘K 搜索框样式，功能先指向现有 CMDB 搜索（点击跳 `/cmdb`）。
- 数据层不新增接口：rail 复用 `listAssets({limit:500})`、详情复用 `getAsset`、grant 复用 `listMyActiveBastionGrants`，查询键与 CMDB/Access 一致以共享 react-query 缓存。
- 路由：`/portal/` 默认路由从 Overview 改为 Connect（index `<Navigate to="/connect">`，新增 `/connect`、`/overview` 两条路由）。
- 取舍说明（待 review 确认）：设计要求“Connect 设为默认路由”与“Overview 侧栏项不动”存在冲突——Overview 原本就是 index（`to:"/"`）。为同时满足“Connect 是默认落地页”且“Overview 仍可达且仍是 Operate 第一项”，把侧栏 Overview 指向新增的 `/overview`，位置/顺序保持第一项不动，但 `to` 必然随默认路由迁移而改变；Connect 占位别名升级为真实 `/connect`，保留 `new` 徽章。
- 本阶段严格停在阶段 3：未重构数据层，未新增后端接口，未触碰其它 `features/` 页面逻辑（仅 `SessionsPage` 因抽取 rail 做了等价替换）。
- 后续待办（需后端，未来阶段）：右侧卡片当前为"诚实受限"实现 —— "近期使用"缺"按资产查会话历史"接口，仅显示资产更新/创建时间 + 指向 Audit 的链接；"谁有访问权"缺"按资产列出全部授权人"接口，仅显示当前用户自己的 grant。若要显示真实的"该资产最近被谁连过 / 谁有权访问"，需后端新增对应按-资产查询接口。
- 验证：`cd web && npm run typecheck`、`cd web && npm run build` 通过；本环境未跑浏览器手测（worktree 无运行实例），建议 review 时在浏览器确认 Connect 三栏、rail 选中高亮、grant 分支与 Sessions Live rail 回归。

## 2026-05-16 · 阶段 4：IAM 能力矩阵（设计文档，先和后端谈）

- 本阶段严格不写代码：仅对照设计评审第 11 页（IAM redesign，11/14）、`web/src/features/iam/IamPage.tsx` 与数据层 `web/src/api/iam.ts` / `web/src/lib/iam.ts`，产出 `docs/design/iam-matrix-spec.md`。
- 规格覆盖六项要求：矩阵行（capability，来源 = 所有角色 `permissions[].permission` 并集，待后端补权威目录）、矩阵列（role，来源 `listIamRoles`）、单元格三态与数据层字段映射、需新增的后端接口签名（capabilities 目录 / matrix / principals / resolve）、能力解析器 `POST /iam/resolve` 接口设计、UI 先 / 后端先 / 并行的增量计划。
- 关键判断（需 review 确认）：当前 `RolePermission` 只有 `resource/action/permission`，**没有 scope 字段**，因此设计稿的 `partial scope`、principals 计数、来源 base/ad-hoc、unscoped 待审等要素当前数据层完全无法表达——这决定了实施必须“UI-only 降级版”与“后端 scope/grant 能力”并行，而不是 UI 等后端。
- 本阶段严格停在阶段 4：未实现任何代码，未改 `IamPage` 写流程，未做跨页深链。
- 验证：本阶段为设计文档整理，无代码改动，未运行 typecheck / build；已逐项与设计评审第 11 页核对（见规格末尾对应表）。

## 2026-05-16 · 阶段 4b：IAM 能力矩阵后端（scope 列 + 鉴权评估器）

- 按 review 决策（选项 C：scope 列 + 全局鉴权）落地后端。改动均为**纯增量、向后兼容**：新增 `iam_role_permission.scope_json`（迁移 `0022`，可空，NULL = unscoped = 现状行为），所有既有权限行读出来都是 “all”，现有鉴权行为零变化。
- 新增数据模型（`internal/iam/model.go`）：`Scope` / `ScopeConstraint`（dimension/op/values，op = in|not_in|eq，AND 组合）、`ScopedPermission`、`PermissionSource`，以及矩阵/目录/principals/resolve 的响应 DTO；`UserIdentity` 增加 `ScopedPermissions`（`Permissions []string` 保留为粗粒度向后兼容字段）。
- 新增**唯一权威评估器** `internal/iam/authz.go` 的 `UserIdentity.Authorize(permission, ResourceAttrs) Decision`：admin 直通；无授权拒绝；unscoped 放行；有 scope 时按资源属性 OR-跨角色匹配。in/eq 缺属性 fail-closed，not_in 缺属性放行。enforcement 与 `/resolve` 共用它，二者不可能不一致。
- `repository.go`：`IdentityForUser` / `ListRolePermissions` 读出 `scope_json` 并聚合（任一角色 unscoped 则该权限整体放宽为 all）。新增 `capability_repository.go`：`ListCapabilities`（权威目录 = 所有角色权限的 (resource,action) 并集）、`CapabilityMatrix`（行=能力 列=角色 格=all/partial/none + sources，`warnings.unscoped_grants` = 当前有效 bastion_grant 数）、`CapabilityPrincipals`（按能力统计用户数/角色数；无 group 概念，诚实地用 role 作分组并在 label 标注）、`ResolveCapability`（组合角色 scoped 权限 + 按资产查 cmdb_asset 的 env/source + 按 (user,asset) 查有效 bastion_grant，返回 allow/deny + 产生该结论的 path + grant 有效期）。
- 新增端点（`admin_handler.go`，均 `iam.user:read` 网关）：`GET /api/v1/iam/capabilities`、`GET /api/v1/iam/matrix`、`GET /api/v1/iam/capabilities/{permission}/principals`、`POST /api/v1/iam/resolve`。
- 新增 enforcement 原语 `RequireScopedPermission(resource, action, attrsFrom)`（`middleware.go`），委托给同一个 `Authorize`。
- **架构说明**：`RequirePermission` 是静态 per-route 中间件，**无法得知请求针对哪个具体资产/env**，因此“全局鉴权”不可能靠改一个中间件完成——真正的 scope 强制必须在“已加载资源”的边界逐处接入。本轮按 review 决策（先接最关键的 bastion 取票 chokepoint）完成了该接入；cmdb 资产写等其余边界仍为后续步骤，强制原语已就绪。
- **bastion 取票路径已接入 scope 强制**（本轮，按 review 决策）：新增 `bastion.RequireSessionAuthorization(repo, action, paramName)` 取代两条取票路由原先的 `RequireActiveGrant`，授权改为三个 OR 分支按序判定——① `system:admin` 直通；② 持有 `bastion.session:<ssh|rdp>` 角色能力且目标资产 env/source 满足其 scope（经**同一个 `iam.UserIdentity.Authorize` 评估器**，与 `/resolve` 不可能不一致）；③ 既有 JIT grant（同样的 `needs_grant` 403 响应）。**纯增量、零行为变更**：当前所有 `scope_json=NULL` 且无角色持有 `bastion.session:*`，分支 ② 对非 admin 恒为假，等价于改动前的 admin-or-grant 网关。设计为 OR 而非 AND，因为纯 grant 用户可能没有任何角色能力，用角色权限 AND-门会切断 JIT 流程。
- 删除已被取代的 `bastion.RequireActiveGrant`（死代码；在敏感路径上保留一个非 scope 版网关是隐患）；新增 `bastion.Repository.AssetScopeAttrs`（raw SQL 取 cmdb_asset.env/source，资产缺失返回 ok=false 回退到 grant 检查，不硬失败连接路径）。
- **cmdb 资产写路径已接入 scope 强制**（后续步骤 A，按 review 决策）：cmdb handler 新增 `withScopedAssetWrite` 中间件，所有带 `{assetID}` 的写路由（`PATCH`/`DELETE` 资产、connection upsert/resolve/test、probe upsert/run、relations 创建/删除、promote/demote vpc-proxy）由它取代 `withWriteAuth`——按路径 assetID 查出资产 env/source，经**同一个 `iam.UserIdentity.Authorize`** 判定 `cmdb.asset:write`。`CreateAsset`（无既有资产）在 handler 内按请求体 env/source 做同样判定（受 `writeMW!=nil` 守卫，保留无鉴权测试构造的既有行为）。`Authorize` 完全涵盖原 `RequirePermission`（admin 直通、has-permission 经粗粒度 `Permissions` 兜底、unscoped==放行），故所有 `scope_json=NULL` 时行为与改动前完全一致。
- **请求审批 / 直接授予已接入 scope 强制**（后续步骤 B，按 review 决策）：设计稿的 `access.request:approve env≠prod` 在本代码库映射为门控审批的 `bastion.grant:write`。在两个**创建访问**的边界做 scope 细化——`approveRequest`（按 `{requestID}` join 出请求所指资产的 env/source）与 `createGrant`（按 body `asset_id` 查资产 env/source），均经**同一个 `iam.UserIdentity.Authorize("bastion.grant:write", attrs)`**。`revokeGrant` / `rejectRequest` 保持粗粒度——撤销/拒绝是“移除/否决访问”，永远安全，不应被 scope 拦。`createGrant` 与 `approveRequest` 同权限同强制，避免 scoped approver 绕开 env 限制走直接授予。新增 `bastion.Repository.RequestAssetScopeAttrs`（join bastion_request→cmdb_asset，缺失返回 ok=false 回退粗粒度，不硬失败）；新增共享 `enforceGrantScope` 助手。同样**纯增量、零行为变更**（scope_json 全 NULL 时 `Authorize` 等价于 `RequirePermission`）。
- 严格停在后端：未改前端 `IamPage`，未接入矩阵 UI（属阶段 4c，已与 review 约定单独过）。选项 C 的全部访问相关强制边界（bastion 取票、cmdb 资产写、请求审批/直接授予）均已接入；强制原语 `RequireScopedPermission` 仍保留备其它边界后续使用。
- 验证补充：`go build ./...`、`go vet ./...` 通过；`go test ./internal/...` 通过（含 `internal/httpserver` 路由测试、`internal/cmdb`、`internal/bastionprobe`；`internal/iam`/`internal/bastion` 无既有测试文件）。本环境仍无 DB/浏览器，未做运行期手测。建议 review 时验证：① scoped `cmdb.asset:write source=aws` 下对 `source=manual` 资产写应 403、`source=aws` 应放行；② scoped `bastion.grant:write env≠prod` 下审批/直接授予 prod 资产的请求应 403、非 prod 应放行，且 revoke/reject 不受 scope 影响；③ 无任何 scope 数据时三处边界（取票/cmdb 写/审批授予）回归与改动前完全一致。

## 2026-05-16 · 阶段 4c：IAM 能力矩阵前端

- `web/src/api/iam.ts` 新增 4 个端点的客户端与类型：`listCapabilities` / `getCapabilityMatrix` / `getCapabilityPrincipals` / `resolveCapability`，类型与后端 DTO 一一对应。
- `web/src/lib/iam.ts` 新增 `formatScope`，把 `Scope` 渲染成密集标签（`env=default,dev`、`source=aws`、`env≠prod`，空 scope = `all`）。
- 新增 `web/src/features/iam/CapabilityMatrix.tsx`：按设计评审第 11 页落地——① 能力矩阵网格（行=capability，列=role，格 = all/partial/none，partial 显示 scope 文案，点击选中）；② 顶部 `unscoped grants` 警示 pill（来自 `warnings.unscoped_grants`）；③ Selected cell 检查面板（该格 scope + sources 来自矩阵数据，principals 选中时按需拉 `/principals`）；④ "Can user X do Y on Z" 能力解析器卡片（用户下拉来自 `listIamUsers`、能力下拉来自矩阵、可选资源 ref，提交 `/resolve` 显示 allow/deny + path + 有效期）。
- "Roles & users still editable, but secondary"：`IamPage` 顶部加 `Capabilities | Users & roles` 视图切换，默认 `Capabilities` 显示矩阵；`Users & roles` 保留原有用户/角色绑定/角色权限全部既有面板与 Refresh，不动其逻辑。
- 诚实取舍：矩阵右列 "Roles · today" 仅按矩阵 cell 显示有多少角色授予该能力（轻量、无 per-row 请求）；精确的 `users·roles` 标签在选中 cell 时经 `/principals` 拉取并显示在检查面板。顶部资源/来源过滤 pill 后端暂不支持，故未渲染以免误导。
- 严格停在 4c：未改后端，未做跨页深链（Sessions/Audit/IAM 互跳属后续）。
- 验证：worktree 缺 `web/node_modules`，已将其 junction 到主仓库 `B:\code\ops-platform\web\node_modules`（package.json 与主仓库逐字节一致；node_modules 已被 gitignore，不影响 diff）后，`npm run typecheck`、`npm run build` 均通过。本环境无浏览器，未做手测；建议 review 时在浏览器确认矩阵渲染、cell 选中/检查面板、解析器卡片，以及 `Users & roles` 视图回归。
- 验证：`go build ./...` 通过；`go vet ./...` 通过；`internal/iam`、`internal/bastion` 无既有测试文件（与现状一致，未新增）。本环境无数据库/浏览器，未做运行期手测；建议 review 时跑迁移 0022 并验证：四个新端点、bastion 取票路径回归（无 scope 数据时连接行为应与改动前完全一致）、以及给某角色配 scoped `bastion.session:ssh` 后的分支 ②。

## 2026-05-16 · 阶段 5：跨页深链（Sessions / Audit / IAM 互跳，纯前端）

- 背景：阶段 3/4c 都点名"跨页深链属后续"。当前对象（资产 / 用户）在页面间没有连贯身份传递——`AuditPage` 的筛选只能手填 UUID、不读 URL；`IamPage` 选中用户也不读 URL；跨页只能人肉抄 UUID。本阶段把"发现问题→追溯权限→回看行为"的安全运维闭环用深链缝起来，零后端改动。
- 使能改动（A）：
  - `web/src/lib/launch.ts` 新增 `buildAuditSearch({assetID,userID,status})`，与既有 `buildLaunchSearch` 同风格集中参数名（`asset`/`user`/`status`，与 launch 的 `launch`/`protocol` 刻意区分；`status=all` 省略以保持链接短）。
  - `AuditPage`：新增 `useSearchParams` 同步 effect，挂载与导航时把 `asset`/`user`/`status` 作为筛选初值（status 仅接受 active/closed/error，否则 all；`user` 仍受既有 `canReadAllSessions` 经 `effectiveUserID` 门控）。手动改筛选不写 URL，故 effect 只在真实导航时触发，不会覆盖用户的页内修改。
  - `IamPage`：惰性初始化——`?user=<id>` 时 `selectedUserID` 预选该用户并把 `view` 切到 `directory`（capabilities 矩阵无 per-user 面板）。
  - `router.tsx`：`?mode=audit` 重定向到 `/audit` 时保留其余 query（原先直接丢）。
- 三条互跳链接（B）：
  - Sessions Live → Audit：每个 live session tab 在关闭按钮前新增 `History` 图标链 → `/audit?asset=<asset.id>`；无上下文的 `Open Audit →` 保留。
  - Audit → IAM / Audit：审计表 User 单元格 → `/iam?user=<user_id>`，Asset 单元格 → `/audit?asset=<asset_id>`（同页经 effect 重筛、可分享）；id 缺失时回退为纯文本。
  - IAM 解析器 → Audit：resolve 出结果且选了用户时新增 "See this user's sessions →" → `/audit?user=<resolveUserID>`。
  - 新增 `.table-link` 样式（`app.css`）：常态继承文字色，hover/focus 显 accent + 下划线，用于表格内不破坏密度的链接。
- 严格停在阶段 5：未改后端，未新增接口；除上述链接外未改 `features/` 既有页面逻辑（`AuditPage` 筛选改为 URL-seed 但 Apply/Reset 行为不变）；阶段 2.5 多会话标签页、Connect 右侧卡片真实数据、IAM 过滤 pill 仍属后续。
- 验证：`cd web && npm run typecheck`、`cd web && npm run build` 均通过（bundle >500kB 警告为既有，与本次无关）。本环境无浏览器，未做手测；建议 review 时在浏览器确认：① live tab 的 Audit 图标跳转并按资产预筛；② 审计表点用户名落到 IAM directory 视图并预选该用户、点资产名同页重筛；③ 解析器结果的 "See this user's sessions →" 落到按用户预筛的 Audit；④ 旧 `/portal/sessions?mode=audit&asset=…` 重定向后仍带 query；⑤ 直接打开 `/audit`（无参数）回归与改动前一致。

## 2026-05-16 · 阶段 6：Audit 筛选选择器（去掉手粘 UUID，纯前端）

- 背景：调研各模块功能缺口后，与 review 约定先做最高频且零风险的一项——`AuditPage` 的 User/Asset 筛选原是裸 UUID 文本框（`Filter by user UUID` / `Filter by asset UUID`），实际没法用；这与刚交付的阶段 5 深链互补（深链负责"带上下文跳进来"，本阶段负责"在页内手动选"）。
- 决策（与 review 确认）：用户选择器**数据源取自当前已加载的会话行**（`sessionItems` 去重），而非 `listIamUsers`——后者需 `iam.user:read`，而 Audit 的"全部会话"只需 `bastion.session:read`，两权限不必然同持；且唯一值得筛的用户就是在表里出现过的人。资产选择器用 `listAssets`（页面本就需要 `cmdb.asset:read`，无新增权限）。
- `AuditPage`：
  - User 字段：文本框 → `<select>`，选项 = 当前会话行里出现过的用户（`user_name||user_id`，按 label 排序去重）；空选项随权限显示 `Any user` / `Own sessions only`，disabled 条件与原先一致（`!canReadAllSessions`）。
  - Asset 字段：文本框 → 搜索框 + `<select>`。搜索框驱动 `listAssets({limit:30,query})`（**不带 status 过滤**——被审计的会话可能指向已停用/删除资产）；选项标签 `name (env / ip)`。
  - 两个选择器都保留"当前已选但不在候选里"的合成项（`selected: <id>`）——保证 URL 深链（阶段 5 的 `?asset=`/`?user=`）或选后改搜索词时，select 仍能正确回显当前筛选值。
  - `effectiveAssetID`/`effectiveUserID`、`applyFilters`/`resetFilters`、URL seeding effect 全部不变；选择器只是改了 `draftFilters.assetID/userID` 的录入方式。
- 严格停在阶段 6：未改后端，未新增接口；未碰 Audit 表格/录屏/统计卡片；调研清单里的 Connect 右栏真实数据、Overview 仪表盘、Audit RDP 录屏回放等仍属后续。
- 验证：`cd web && npm run typecheck`、`cd web && npm run build` 均通过（同上既有 bundle 警告）。本环境无浏览器，未做手测；建议 review 时在浏览器确认：① 资产搜索框输入后下拉收敛、选中即筛；② 用户下拉只列当前结果里的人、选中即筛；③ 阶段 5 深链 `/audit?asset=…` / `?user=…` 进来时两个 select 正确回显（含不在候选时的 `selected:` 合成项）；④ 无 `bastion.session:read` 时 User 选择器仍正确禁用并显示 `Own sessions only`；⑤ Reset 清空回全量。

## 2026-05-17 · 阶段 7：Connect 右栏真实数据（纯前端）

- 背景：阶段 3 起 Connect 右栏 "Recent usage / Who has access" 为"诚实受限"占位（只显示资产时间戳 / 只显示当前用户自己的 grant）。调研一度认为需新后端接口，但**核实发现 `listSessions` 与 `bastion listGrants` 后端均已支持 asset 过滤**，且 `listGrants` 已对无 `bastion.grant:write` 的调用者做自限（强制 user_id=自己）。结论：**零 Go 改动，纯前端接现有接口**即可。
- 决策（与 review 确认的划界）："Who has access" **只显示活跃 JIT grant**，不含"靠角色 scoped 权限常驻可访问"的人——那属 IAM 能力解析（已暂停）。卡片底部加一句 "Standing role-based access isn't shown here — see IAM" 诚实说明，保留 "Manage access →"。
- `web/src/api/bastion.ts`：新增 `listAssetActiveGrants(assetID, limit)` → `/api/v1/bastion/grants?asset_id=&active=true`（**刻意不传 user_id**，依赖后端已有自限：有 `bastion.grant:write`/admin 看全部，否则只回自己——诚实降级而非报错）。
- `web/src/features/connect/ConnectPage.tsx`：
  - 新增两个 query：`recentSessions = listSessions({assetID, limit:5})`（权限同页面 `cmdb.asset:read`；后端对无 `bastion.session:read` 者自限为本人会话）、`assetGrants = listAssetActiveGrants(assetID)`。
  - **Recent usage 卡**：改为渲染最近 5 条会话（开始时间 / 用户 / 状态 pill，复用 `lib/sessions` 的 `sessionStatus`/`sessionStatusTone`），含 loading/error/empty 三态；无 `bastion.session:read` 时加 "Showing only your own sessions" 诚实说明；"Open Audit →" 升级为深链 `/audit?asset=<id>`（复用阶段 5 `buildAuditSearch`）。
  - **Who has access 卡**：改为列出该资产**全部活跃 grant**（自己显示为 "You"，含 `formatGrantTimeRemaining`），三态齐全；无 `bastion.grant:write` 时加 "Showing only your own grant…" 诚实说明 + IAM 常驻访问划界说明。
  - `activeGrant`（Connection 面板用）及其 `myActiveGrants` 来源不变。
- `web/src/styles/app.css`：新增 `.connect-recent-list/.connect-access-list` 等紧凑列表样式，沿用 connect-card 既有密度，未改其它。
- 严格停在阶段 7：零后端改动、无新接口、无迁移；未碰 Connect 左栏 rail / Connection 面板 / Tags 卡 / ⌘K（⌘K 仍 navigate→/cmdb，属后续）；IAM 常驻访问解析按划界明确不做。
- 验证：`cd web && npm run typecheck`、`cd web && npm run build` 均通过（同上既有 bundle 警告）。本环境无浏览器，未手测；建议 review 时在浏览器确认：① 选资产后 Recent usage 列出真实近 5 条会话、Open Audit 深链带 `?asset=`；② Who has access 列出该资产活跃 grant；③ 用 `bastion.grant:write` 与不用时分别看到"全部 / 仅自己 + 诚实说明"；④ 无 `bastion.session:read` 时 Recent usage 显示自限说明且仅本人会话；⑤ 切换资产时两卡随 `selectedAssetID` 正确刷新、空资产回到占位文案。

## 2026-05-17 · 阶段 8：Connect ⌘K 真实搜索（纯前端）

- 背景：调研清单项。Connect header 的 ⌘K 与按钮原本只是 `navigate("/cmdb")`——一个"假"快捷键，并未实现"找资产并连接"这条设计 handoff 强调的一等路径。
- 决策：⌘K 打开一个**页内命令面板**（不跳走），选中资产即在 Connect 选定（`setSelectedAssetID`）。数据源**复用已缓存的 `railAssets`（limit 500）做客户端即时过滤**——零新增网络请求、结果即时，且与左栏 rail 同一搜索字段集（复用 `lib/launch` 的 `filterConnectableAssets`，纯文本过滤不丢非连接型资产）。
- `web/src/features/connect/ConnectPage.tsx`：
  - 新增 `paletteOpen/paletteQuery/paletteActive` 状态 + `paletteInputRef`；全局 keydown effect 改为 ⌘/Ctrl+K → `setPaletteOpen(true)`（**移除原"输入框内不触发"的回避**——带修饰键的 ⌘K 本就该在任何焦点下打开面板，这是命令面板预期），Esc → 关闭。
  - 打开时 effect 清空 query/active 并 focus 输入框。
  - 面板：搜索框 + 结果 listbox（最多 20 条，`name` + `env · ip/type`）；键盘 ArrowUp/Down 移动高亮、Enter 选中高亮项、Esc 关闭、点击/悬停选中；backdrop 点击关闭。`activeIndex` 对结果长度做 clamp，hover 与键盘高亮一致。
  - 状态分支齐全：无 `cmdb.asset:read` 显权限提示；rail 加载中显 loading（避免加载时误显示"无匹配"）；空结果显 empty。
  - header 按钮 onClick 改为 `setPaletteOpen(true)`，title 改为 "Search assets (⌘K)"。`navigate` 仍用于 openLive / View in CMDB / Manage access 等，未移除。
  - a11y：每个选项 `id=connect-palette-opt-<i>`，combobox 输入设 `aria-activedescendant` 指向当前高亮项（屏幕阅读器能听到 ↑↓ 高亮变化）；新增 effect 在高亮变化时 `scrollIntoView({block:"nearest"})` 把高亮项滚入视口（已可见时为 no-op，hover 不抖动）。
- `web/src/styles/app.css`：新增 `.connect-palette-*` 一组样式（顶部锚定的命令面板，结构沿用 sessions-launch modal 模式，复用既有 token：`--shadow-lg`/`--color-bg-overlay`/`--radius-md`/`--color-bg-subtle` 等）。
- 严格停在阶段 8：零后端、无新接口；未碰左栏 rail / Connection / Tags / 右栏卡；面板搜索范围与 rail 同为 limit-500 窗口（>500 的车队同样受限，与 rail 一致，非本阶段引入的回归）。
- 验证：`cd web && npm run typecheck`、`cd web && npm run build` 均通过（同上既有 bundle 警告）。本环境无浏览器，未手测；建议 review 时确认：① ⌘K / 点按钮均打开面板且输入框自动聚焦；② 输入即时过滤、↑↓ 移动高亮、Enter/点击选中后面板关闭且 Connect 选定该资产；③ Esc 与 backdrop 均能关闭；④ 在 rail 搜索框聚焦时按 ⌘K 仍能打开面板；⑤ 无 `cmdb.asset:read` 时面板显权限提示。

## 2026-05-17 · 阶段 9：Overview 运维仪表盘（纯前端）

- 背景：调研清单项。OverviewPage 原为静态欢迎页（API 健康 + 角色/权限计数 + 硬编码状态条），名不副实的"概览"。
- 决策：与阶段 7/8 同思路——**纯前端组合现有接口，零新后端聚合**。核实 `ListAssetsResponse.total` 已存在（用 `listAssets({limit:1}).total` 取总数，不拉全量）；`listSessions`/`listMyActiveBastionGrants`/`listPendingBastionRequests` 均现成，后端对无权用户自限（诚实降级）。
- `web/src/features/overview/OverviewPage.tsx` 重写：
  - 5 个指标卡（复用既有 `metric-card`）：API health（保留）、Assets 总数、Active sessions（`sessionCounts`，无 `bastion.session:read` 时标题转 "(yours)" 并显诚实说明）、My active grants（含最近到期 `formatGrantTimeRemaining`）、Pending requests（无 `bastion.grant:write` 时标题转 "(yours)"，对齐后端自限）。
  - 每卡按自身权限**独立降级**：缺权限显 `—` + "no access" pill，加载显 `…`，互不阻塞，不报错。抽出 `MetricCard` 小组件 + `metricValue` 助手。
  - **替换掉原低价值的 Identity/Permissions 计数块**；签到信息收进底部 Platform status 面板的一行。
  - 新增 **Recent activity** 面板（`profile-grid` 两栏复用）：最近 5 条会话（时间/用户/资产/状态 pill），资产名深链 `/audit?asset=`（复用阶段 5 `buildAuditSearch`），面板头 "Open Audit →"。
  - Refresh 按钮改为 `refreshAll()`：刷新全部已启用 query；`refreshing` 聚合各 query `isFetching`。sessions/health 30s 自动刷新。
- 布局：Overview 原本一直用居中受限的 `page-section`（非本次回归）。仪表盘是宽网格 + 两栏面板，挂载时给 `body` 加 `fullwidth-mode` 类（与 Connect/CMDB/IAM 同一既有机制）撑满页面，卸载移除。
- `web/src/styles/app.css`：新增 `.overview-activity*` 紧凑列表样式，沿用既有密度与 token。
- 严格停在阶段 9：零后端、无新接口、无迁移；指标全部由现有列表接口客户端派生（assets 用 total，其余计数受各自 limit 上限与后端自限约束——诚实，与全站一致）；Audit RDP 录屏回放、Sessions rail env 过滤仍属后续。
- 验证：`cd web && npm run typecheck`、`cd web && npm run build` 均通过（同上既有 bundle 警告）。本环境无浏览器，未手测；建议 review 时确认：① 各卡按权限正确显数/降级（用不同权限账号）；② Active sessions / Pending requests 无对应"看全部"权限时标题为 "(yours)" 且数值与 Audit/Access 自己视角一致；③ My active grants 的 "next …" 取最早到期；④ Recent activity 列最近 5 条且资产名深链带 `?asset=`；⑤ Refresh 一次刷新全部、refreshing 文案与禁用态正确。

## 2026-05-17 · 阶段 10：RDP 会话录制与回放（设计文档，先和 review 谈）

- 本阶段严格不写代码：仅对照调研清单 "Audit RDP 录屏回放（L）"、`internal/guacproxy/*`、`internal/terminal/*`（SSH 录屏基线）、`internal/sessions/*`、`internal/storage/*`、`web/src/features/audit/AuditPage.tsx`、`web/src/lib/guacamole.ts`，产出 `docs/design/rdp-recording-spec.md`。
- 关键纠正（调研清单判断有误）：guacproxy **全包无任何录屏代码**，RDP 仅写审计行、`has_recording` 恒为 false、Inspect 对 RDP 从不显示。真盲区不是"录了播不了"，是"**RDP 根本没录**"——需新建采集→存储→分发→回放整条管线，名副其实 L。
- 规格覆盖：当前 SSH/RDP 实现基线（事实）、两个本质架构抉择（采集 A 代理侧 tee vs B guacd recording-path；回放 A 浏览器内 `Guacamole.SessionRecording` vs B 服务端 `guacenc`→mp4，均给推荐与代价）、数据/存储 key/权限分发/容量取舍、隐私取舍（仅录 server→client，与 SSH 对齐）、分阶段实施计划 10a–10d、六项待 review 确认清单。
- 推荐基线：采集 A + 回放 A（对称、自包含、复用现有 MinIO/`SetRecording`/`/recording` 鉴权、零新基建），但最终选型与容量/保留策略待 review 拍板后方可进入 10a。
- 验证：本阶段为设计文档整理，无代码改动，未运行 typecheck / build。
- 回填更正（记于 2026-05-17，标题"先和 review 谈"已过时）：阶段 10 实现**已完整落地**，由另一会话提交于 `c0abeb1 feat: RDP session recording capture, playback, retention (phase 10)`（位于本 spec 提交 `d2d08c9` 与阶段 11 之间；该提交未回写本进度文档，故在此回填）。按 spec 推荐基线落地——**10a 采集**：guacproxy 把 server→client Guacamole 流 tee 到录制文件（client→server 不录，与 SSH cast 隐私取舍一致），会话结束传对象存储并挂审计行，与 SSH recorder 对称（`internal/guacproxy/recorder.go`、`handler.go`）；**10b 分发**：`/recording` 按存储产物真实扩展名命名，Audit UI 区分 cast/guac，不再对非 cast 硬抛 `parseAsciicast`；**10c 回放**：浏览器内 `Guacamole.SessionRecording` 播放器（play/pause/seek，`web/src/features/audit/RdpRecordingPlayer.tsx`），SSH cast 预览不变；额外加单会话大小上限 `OPS_RECORDING_MAX_BYTES`（截在最后一条完整指令，保持可播放前缀）与保留 janitor `OPS_RECORDING_RETENTION_DAYS`（`internal/sessions/recordingjanitor.go`，覆盖 SSH+RDP），两开关默认关、存量部署不变；迁移 `0016`。**10d（guacenc→mp4 导出）按计划延后**，`rdp-recording-spec.md` 保留。即阶段 10 不再是"待 review 的设计文档"，代码已 ship。

## 2026-05-17 · 阶段 11：Sessions/Connect rail env+tag 过滤（纯前端）

- 背景：调研清单收尾项。共享组件 `AssetRail`（Sessions Live 与 Connect 共用）此前只有名称/IP 文本搜索，缺与 CMDB 对齐的 facet 过滤；rail 本就按 env→vpc 分组，env facet 与之天然契合。
- 决策：env 过滤 + tag 过滤都做（用户拍板，已知 tag 异构稀疏复杂度警告）；做成 `AssetRail` **内部状态**（纯视图过滤，无父组件需要它）——`SessionsPage`/`ConnectPage` **零改动、零风险**，两页同时受益。
- `web/src/lib/launch.ts`：新增资产域 helper（与 `buildAssetTree`/`isConnectableAsset` 同处）——`assetEnvKey(asset)`（`asset.env || "default"`，与 `buildAssetTree` env 命名 1:1）、`assetMatchesTag(asset, needle)`（合并 system_tags+labels+tags，按 key / value / `key:value` 子串大小写不敏感匹配，空 needle = 全通过；处理缺失 map 与 null 值）。
- `web/src/features/sessions/AssetRail.tsx`：新增内部 `envFilter`/`tagFilter` 状态；`envOptions` 由 connectableAssets distinct `assetEnvKey` 派生排序；新增 `facetFiltered`（env 精确匹配 + tag 子串）插在既有文本搜索与 `buildAssetTree` 之前；header 加 `sessions-rail-facets` 行（env `<select>` + tag `<input>`，均带 aria-label、`!canRead` 时禁用）。空过滤为 no-op，行为与改动前一致。
- `web/src/styles/app.css`：新增 `.sessions-rail-facets` 紧凑行样式（沿用既有 rail 密度与 token，select ≤50% 宽、tag input flex:1）。
- 严格停在阶段 11：零后端、无新接口；未改 `SessionsPage`/`ConnectPage`/AuditPage；过滤为纯客户端视图层，不影响选中/启动/深链等既有行为。
- 验证：`cd web && npm run typecheck`、`cd web && npm run build` 均通过（同上既有 bundle 警告）。本环境无浏览器，未手测；建议 review 时确认：① env 下拉收敛到对应环境且与树 env 分组一致；② tag 输入按 key/value/`key:value` 子串过滤；③ env+tag 叠加为 AND；④ 清空两者回全量；⑤ Sessions Live 与 Connect 两处 rail 均生效且选中/启动/高亮行为不回归。

## 2026-05-17 · 阶段 12：Sessions 支持 VNC/Telnet + 会话权限合并为 bastion.session:connect（前后端）

- 背景：用户要 Sessions 支持更多连接类型。调研确认 guacd 的 rdp/vnc/telnet 走同一握手与图形流，guacproxy 主流程协议无关（仅 `select rdp` 与 per-arg 取值是 RDP 专有），前端 RdpSessionPane 可全复用。数据库/k8s 属大新子系统、与"内部运维控制台非 PAM"定位冲突，本期不做。
- 鉴权模型决策（用户拍板 iii + A/B/C/D，开发阶段硬切、无兼容窗口）：把 per-protocol 的 `bastion.session:ssh`/`:rdp` **合并为单一 `bastion.session:connect`**——SSH/RDP/VNC/Telnet 同属"经堡垒机+guacd 的交互式远程会话"风险类。A：接受权限放大（原 :ssh-only 迁移后得 connect=含 rdp/vnc/telnet）。B：不做向后兼容，直接改。C：scope 取并集（迁移时任一源行无 scope 或两者 scope 不同 → connect 行 unscoped）。D：ConnectPage 两个 resolveCapability 合并为单个 `:connect`。
- 后端 · 权限合并：
  - `internal/iam/capability_repository.go`：内置能力目录 `bastion.session` 的 `ssh`+`rdp` 两行 → 单行 `connect`（保留 `read`）；`isBastionSessionCapability` → `== "bastion.session:connect"`。
  - `internal/httpserver/server.go`：terminal 与 rdp 取票两条路由的 `RequireSessionAuthorization` action 由 `ssh`/`rdp` 改为 `connect`（`RequireSessionAuthorization` 自身构造 `bastion.session:<action>`，无需改）。
  - `migrations/0023_bastion_session_connect.sql`：防御性迁移（实际无角色 seed 持 ssh/rdp，内置目录在代码侧），把任何运行时 `iam_role_permission` 的 `bastion.session` `ssh|rdp` 行按 C 规则并为 `connect` 行后删除旧行；idempotent、fresh DB 上 no-op。
  - `test/integration/iam_capability_test.go`：目录断言改为期望 `bastion.session:connect`。
- 后端 · VNC/Telnet：
  - `internal/cmdb/repository.go`：连接档 protocol 白名单加 `vnc`/`telnet`；默认端口 vnc 5900 / telnet 23；vnc/telnet 仅 password 鉴权；vnc 允许空 username（VNC 无用户概念）。
  - `internal/bastionprobe/service.go`：`ResolveAssetRDP` 由"仅 rdp"放开为 rdp/vnc/telnet（各自默认端口），`RDPResolution` 新增 `Protocol` 带出。
  - `internal/guacproxy`：`DialRDP(ctx, addr, protocol, params)` 用 `select <protocol>`（空回退 rdp）；`OpenRDP` 传 `res.Protocol`。`params.value` 对未知 vnc/telnet arg 返回 ""（guacd 用其默认），无需改。
- 前端：
  - `web/src/lib/permissions.ts`：knownPermissions 的 `bastion.session:ssh`+`:rdp` → 单 `bastion.session:connect`。
  - `web/src/lib/launch.ts`：`LaunchProtocol` 扩为 `ssh|rdp|vnc|telnet`；`parseLaunchParams` 协议改为"建议性"（未知/缺省不再 return null，落 ssh），因真正协议由连接档定。
  - `web/src/features/connect/ConnectPage.tsx`（D）：`sshAccess`+`rdpAccess` 两个 resolve 合并为单 `connectAccess`（`bastion.session:connect`），派生量按单结果重算；`canOpenSSH`/`canOpenRDP` 均 = 单一 connect 权限。
  - `web/src/features/sessions/SessionsPage.tsx`（option A）：移除手动协议状态/`railProtocolToggle`/AssetRail `protocolToggle`；`launchTerminal` 不再收 protocol 入参，改为读连接档 `profile.protocol` 决定（ssh→terminal 票据+SshTerminalPane；rdp/vnc/telnet→guac 票据+RdpSessionPane，pane 渲染本就是 `kind==="ssh"?Ssh:Rdp` 二元判断，自动适配）；凭据预检 ssh→hasSSHCredentials 否则 has_password；auto-launch 按 assetID（忽略 URL protocol）。
- 严格停在阶段 12：未做数据库/k8s 连接类型；未新增 per-protocol 权限（按 iii 合并）。诚实遗留（建议后续）：ConnectPage 仍保留 "Open SSH"/"Open RDP" 两个按钮、均由单一 connect 权限门控且实际协议由连接档决定——在 option A 下两按钮语义冗余，按 D 只动了权限查询、未重排该（另一会话在改的）文件的按钮 UX，留作后续协调。
- 验证：`go build ./...`、`go vet`（含 `-tags=integration ./test/...`）、`go test ./internal/...` 通过；`cd web && npm run typecheck`、`npm run build` 通过（既有 bundle 警告）。本环境无 guacd/浏览器/DB，未做运行期手测；建议 review 时：① 跑迁移 0023；② 配 vnc/telnet 连接档并各开一次会话确认 guacd `select` 正确、录屏（阶段10a tee 协议无关）生成；③ 给某角色配 scoped `bastion.session:connect` 验证取票三分支与 `/resolve` 一致；④ 确认 ssh-only 老角色合并后获得 connect（A 放大）符合预期；⑤ Connect 页访问判定与 Sessions 按连接档协议启动回归。

## 2026-05-17 · 阶段 13：数据库会话访问代理 MySQL/PG/Redis（L1，设计文档，先和 review 谈）

- 本阶段严格不写代码：产出 `docs/design/db-session-broker-spec.md`。
- 定位把关（依 `project_positioning` 记忆 + ADR 0011）：带录制/SQL 过滤/Web 查询台的 DB 会话是 JumpServer 式 PAM 支柱，与"内部运维控制台、非 PAM"冲突；用户已选 **L1=轻量 TCP 访问代理**（仅受控建链 + 审计元数据，用户自带 mysql/psql/redis-cli），L2/L3 明确不在本规格、若做属产品定位变更需另立项。
- 关键发现：`postgres` 仅在连接档+主机探测里，**无任何交互式 DB 会话通路**；mysql/redis 连白名单都没有。鉴权（阶段 12 已并的 `bastion.session:connect`）、票据（`connectivity.TicketService`）、到内网（`guacproxy/tunnel.go` sshForwarder）、字节代理（guac `bridge` 形态）、审计（`sessions.Start/End`）、连接档（postgres 已就绪）基建基本齐备。
- 规格覆盖：当前基线（事实）、核心架构分叉（A ws 桥+本地 helper〔推荐〕/ B 复用 ssh -L 退化 / C 跳板监听〔不建议〕）、复用映射、前端关键差异（DB 会话无浏览器渲染器→不入 live pane，改"DB 访问"卡：端点+倒计时+客户端命令模板+显式结束）、严格不做边界、分阶段 13a–13d、六项待 review 确认清单。
- 推荐基线：架构 A（与现有 SSH/RDP ws-bridge/ticket/sshForwarder 同构、协议无关、网络面最小）；连接档加 mysql(3306)/redis(6379)、redis 放宽 username 必填（参照 vnc）。
- 验证：本阶段为设计文档整理，无代码改动，未运行 typecheck / build。

## 2026-05-17 · 阶段 13a：连接档支持 mysql/redis（纯增量后端）

- 按 spec 13a（独立、零风险、不依赖架构分叉）落地：`internal/cmdb/repository.go` `UpsertAssetConnectionProfile` 协议白名单加 `mysql`/`redis`；默认端口 mysql 3306 / redis 6379；redis 与 vnc 一样放宽 username 必填（无用户概念）；mysql/redis 同 postgres/rdp/vnc/telnet 仅 password 鉴权。与阶段 12 加 vnc/telnet 完全同构、纯增量。
- 严格停在 13a：未碰会话通路。**13b（服务端 ws DB 代理新子系统，安全敏感）未开工**——它取决于 spec §1 的唯一架构分叉（A ws 桥+本地 helper / B 复用 ssh -L / C 跳板监听）与 §6 的 TTL/redis 语义等决策，需 review 拍板后才写码，不凭假设盲建。
- 验证：`go build ./...` 通过；`go test ./internal/cmdb/` 通过。本环境无 DB，未做运行期手测。

## 2026-05-17 · 阶段 13b：服务端数据库会话代理 dbproxy（架构 A，后端）

- 用户拍板架构 A（ws 桥 + 本地 helper）。其余清单项按 spec 推荐默认且契合 ADR 0011（不引非必要逻辑）：复用既有 60s 票据 + grant 窗口、不引独立 TTL 策略；代理裸字节不解析协议，redis DB index 由用户 redis-cli `-n` 决定；L1 边界=仅桥接+审计，无录制/SQL 过滤/Web 台。
- `internal/bastionprobe/service.go`：新增 `ResolveAssetDB`，镜像 `ResolveAssetRDP`（同样的 target + VPC proxy 解析、复用 `RDPResolution` 载体），仅协议门改为 mysql/postgres/redis + 默认端口 3306/5432/6379。刻意不重构 `ResolveAssetRDP`（安全路径，ADR 0011 不过度抽象，~20 行重复可接受）。
- 新增 `internal/dbproxy`：
  - `service.go`：`Service.Open` 解析后经资产 VPC proxy SSH client `Dial("tcp",addr)` 或直连拿到裸 TCP；`Conn` 关闭时连带关 proxy；用 `closer` 接口持有 proxy 避免 import x/crypto/ssh。**不解析 DB 协议**。
  - `handler.go`：`IssueTicket`（复用 `connectivity.TicketService`，与 SSH/RDP 同款）+ `ServeWS`（ticket consume + asset 匹配 → `svc.Open` → ws 升级 → `sessions.Start` → `bridge` → `sessions.End`）+ `bridge`（ws Binary 帧 ↔ 裸 TCP 双向泵，字节计数入审计，**载荷不检视**；首个出错方结束、关 db 解阻塞对端，字节为 best-effort 与 guacproxy bridge 契约一致）。无 recorder（L1 不录）。
- `internal/httpserver/server.go`：构造 `dbproxySvc/dbproxyHandler`（复用 `bastionService` 作 resolver、`ticketService`、`cmdbRepo` 作 meta、`sessionsRepo`）；新增 `POST /api/v1/cmdb/assets/{assetID}/db/ticket`（与 terminal/rdp **完全同一鉴权链**：`cmdb.asset:read` + `RequireSessionAuthorization(...,"connect",...)`）与 `GET /ws/v1/cmdb/assets/{assetID}/db`（ticket 鉴权）。
- 安全姿态：新通路鉴权链与已 review 的 RDP 路径**逐字相同**（connect 能力 + 单用票据 + asset 匹配），字节对代理透明（同 RDP/guac），未引入新攻击面（"被授权用户够到其被授权的资产"即本特性意图）。
- 严格停在 13b：**13c（本地 helper 打包：自带二进制 vs 文档化 websocat 一行）与 13d（前端 DB 访问卡）未开工**——13c 有打包决策（#2，不擅自建跨平台二进制分发）、13d 触及 ConnectPage/SessionsPage（其它会话正在改，有冲突风险），需先定再做。
- 验证：`go build ./...`、`go vet ./internal/dbproxy/ ./internal/bastionprobe/ ./internal/httpserver/`、`go test ./internal/...` 通过。本环境无 DB/ws 客户端，未运行期手测；建议 review 时：① 配 mysql/postgres/redis 连接档；② 取 `/db/ticket` 后用 ws 客户端连 `/ws/v1/.../db` 验证经/不经 VPC proxy 的字节双通 + 审计行（has_recording 恒 false）；③ 无 `bastion.session:connect`/grant 时取票 403（与 RDP 路径回归一致）。

## 2026-05-17 · 阶段 13c：本地接入文档化（决策 a，纯文档）

- 用户选 (a)：不打包自带二进制（ADR 0011：不擅自引入分发/构建产物），文档化通用 `websocat --binary` 一行隧道 + mysql/psql/redis-cli 命令模板，写入 `db-session-broker-spec.md §3a`，供 13d 前端"DB 访问"卡直接渲染。要点：`--binary` 必须、ticket 单用短 TTL、本地端口用户自选、裸 TCP 透传不在隧道内做 TLS 终结。
- 并发核实：主工作树当前对 ConnectPage/SessionsPage 无未提交改动；早前并行改动已落 `28f46e4`；4 个旁路会话工作树对相关文件均无未提交改动——13d 交织冲突顾虑解除（仅余常规"将来分支合并"风险）。
- 严格停在 13c：纯文档；13d 前端未开工，待确认后做。

## 2026-05-17 · 阶段 13d：前端"DB 访问"卡（架构 A，纯前端）

- `web/src/api/sessions.ts`：新增 `buildAssetDbTicketPath` + `issueDbTicket`（POST `/cmdb/assets/{id}/db/ticket`，与 issueRdpTicket 同款）。
- `web/src/features/sessions/SessionsPage.tsx`：option A 的 `launchTerminal` 改为返回 `LaunchOutcome` 联合——连接档 protocol ∈ {mysql,postgres,redis} 时不开 live pane，而是 `issueDbTicket` 并 `setDbAccess(...)`；其余协议走原 live 流（ssh→terminal、rdp/vnc/telnet→guac）不变。新增 `dbAccess` 状态 + 渲染 `<DbAccessCard>`。`isDbProtocol` 复用 `DbAccessCard` 导出的类型，单一来源。
- 新增 `web/src/features/sessions/DbAccessCard.tsx`：复用既有 `sessions-launch-modal` 壳；展示 §3a 的 `websocat --binary` 隧道命令 + 按协议的 mysql/psql/redis-cli 命令（占位用连接档 username/database 填充，密码不入命令），本地端口可改（默认 13306/15432/16379），票据倒计时（过期提示重连），一键复制、Done 关闭。Connect 页经 `/sessions?launch=` 进来对 DB 资产同样落到此卡（无需改 ConnectPage）。Audit 行由后端写（has_recording 恒 false），前端无需改。
- `web/src/styles/app.css`：新增 `.db-access-*` 小样式（复用既有 token/modal 壳）。
- 严格停在 13d：未做 SQL 捕获/Web 台/录制（L1 边界）；未改 ConnectPage（其 Open 按钮在 option A 下的冗余仍为 phase 12 记录的诚实遗留，与本阶段无关）。
- 验证：`cd web && npm run typecheck`、`npm run build` 通过（既有 bundle 警告）。本环境无 DB/ws，未手测；建议 review 时：① 配 mysql/postgres/redis 连接档，rail 点击→出"DB 访问"卡而非 live pane；② 按卡片命令 `websocat` 起隧道 + 客户端连通；③ 票据 60s 倒计时与过期文案；④ ssh/rdp/vnc/telnet 回归不受影响；⑤ Connect 对 DB 资产跳 Sessions 后出卡。
