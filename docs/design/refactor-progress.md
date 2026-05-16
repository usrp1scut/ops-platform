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
