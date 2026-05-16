# Refactor Progress

## 2026-05-16 · 阶段 0：准备

- 新增 `docs/design/refactor-plan.md`，先完成一次只读代码地图，作为后续按方案 A（Operate / Inventory / Govern）迁移的基线。
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
