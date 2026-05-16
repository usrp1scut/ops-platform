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
