# Refactor Plan · Phase 0 Code Map

> 范围：只记录当前实现，为后续按方案 A（Operate / Inventory / Govern）分阶段迁移做准备；本阶段不改业务代码，也不提前实现新 IA。

## 参考基线

- 设计背景：`docs/design/claude-design-handoff.md`
- 设计评审：`docs/design/Ops Platform Design Review.html`
- 当前实现读取范围：
  - `web/src/app/router.tsx`
  - `web/src/app/layout/AppShell.tsx`
  - `web/src/features/sessions/SessionsPage.tsx`
  - `web/src/features/cmdb/AssetsPage.tsx`
  - `web/src/features/iam/IamPage.tsx`
  - `web/src/api/iam.ts`

## 1. 当前 `router.tsx` 的路由清单

`createBrowserRouter` 以 `appBasename(...)` 作为 basename，因此下面的内部路由在浏览器中对应 `/portal/*`。`/` 以下页面都挂在 `ProtectedRoute + AppShell` 下面，`/login` 独立于壳层之外。

| 内部路由 | 浏览器路径 | 页面组件 | 备注 |
| --- | --- | --- | --- |
| `/login` | `/portal/login` | `LoginPage` | 登录入口 |
| `/`（index） | `/portal/` | `OverviewPage` | 受保护默认首页 |
| `/cmdb` | `/portal/cmdb` | `AssetsPage` | 当前资产库存页 |
| `/sessions` | `/portal/sessions` | `SessionsPage` | 当前同时承载 Live / Audit |
| `/access` | `/portal/access` | `AccessPage` | 访问申请与审批 |
| `/connectivity` | `/portal/connectivity` | `ConnectivityPage` | 连接配置 |
| `/aws` | `/portal/aws` | `AwsPage` | AWS 配置 |
| `/iam` | `/portal/iam` | `IamPage` | IAM 管理 |
| `/oidc` | `/portal/oidc` | `OidcPage` | OIDC 配置 |
| `/profile` | `/portal/profile` | `ProfilePage` | 个人账户页 |

补充：

- 当前还没有独立的 `Connect` 路由。
- 当前也没有独立的 `Audit` 路由；审计仍是 `/sessions?mode=audit` 下的一个模式。

## 2. 当前 `AppShell.tsx` 的侧栏结构

侧栏由两个 `NavItem[]` 数组和一个通用 `NavGroup` 组件渲染：

```text
Workspace
├── Overview        /
├── CMDB            /cmdb
├── Sessions        /sessions
├── Access          /access
└── Connectivity    /connectivity

Platform
├── AWS             /aws
├── IAM             /iam
├── OIDC            /oidc
└── Profile         /profile
```

实现锚点：

- `workspaceNav`：定义 `Overview / CMDB / Sessions / Access / Connectivity`
- `platformNav`：定义 `AWS / IAM / OIDC / Profile`
- `NavGroup`：统一渲染分组标题与 `NavLink`

## 3. 当前路由到未来三分区的归属

依据方案 A，现有路由可以先这样映射：

| 未来分组 | 当前路由 | 说明 |
| --- | --- | --- |
| Operate | `/`、`/sessions`、`/access` | `Overview` 属于日常工作入口；`/sessions` 未来只保留 Live 语义；`Access` 仍是申请 / 审批 |
| Inventory | `/cmdb`、`/connectivity` | `CMDB` 继续承载库存管理；`Connectivity` 继续承载连接配置 |
| Govern | `/iam`、`/aws`、`/oidc` | 都属于治理 / 配置类页面 |

仍需单独看待的入口：

- `/login`：认证入口，不属于三分区。
- `/profile`：更接近独立账户区，而不是 Operate / Inventory / Govern 之一。

与方案 A 直接相关、但当前尚不存在的目标面：

- `Connect`：未来 Operate 下的新入口；当前没有独立路由。
- `Audit`：未来 Govern 下的新入口；当前内容来源仍是 `/sessions?mode=audit`。

补充现状：

- `AssetsPage` 仍是 table-first inventory surface。
- `AssetsPage.connectAsset(...)` 会把 CMDB 表格里的 SSH / RDP 操作跳转到 `/sessions?...`，说明当前“找资产并连接”的流程仍借由 CMDB + Sessions 拼接完成，而不是由独立的 Connect 页面承担。

## 4. `Sessions` 当前如何实现 Live / Audit 切换

### 状态来源

`SessionsPage` 没有用单独的 `useState` 保存模式，而是把模式编码进 URL query：

```ts
const [searchParams, setSearchParams] = useSearchParams();
const sessionsMode: "live" | "audit" =
  searchParams.get("mode") === "audit" ? "audit" : "live";
```

- 默认态：`/sessions` → `sessionsMode === "live"`
- 审计态：`/sessions?mode=audit` → `sessionsMode === "audit"`
- `setSessionsMode(next)` 通过 `setSearchParams(...)` 改写 URL：
  - 切回 `live` 时删除 `mode`
  - 切到 `audit` 时写入 `mode=audit`

### Tab 组件

Live / Audit 的切换直接内联在页面头部，不是抽象出来的独立组件：

```tsx
<div className="sessions-mode-tabs" role="tablist" aria-label="Sessions mode">
  <button className="sessions-mode-tab">Live</button>
  <button className="sessions-mode-tab">Audit</button>
</div>
```

对应事实：

- 容器类名：`sessions-mode-tabs`
- 单个 tab 类名：`sessions-mode-tab`
- tab 点击后调用：`setSessionsMode("live" | "audit")`

### 两种模式下的内容分流

- `sessionsMode === "live"`
  - 给 `body` 添加 `workspace-mode`
  - 渲染 `sessions-workspace`
  - 左侧是资产 rail，右侧是实时终端 / RDP 工作区
  - 工作区内部另有一套 `live-session-tabs`，用于多个实时会话之间切换
- `sessionsMode === "audit"`
  - 渲染审计指标、筛选表单、会话记录表、录屏预览

结论：当前 Live / Audit 在产品语义上已经明显分化，但实现上仍共享一个 `/sessions` 路由，只靠 query state 和条件渲染拆分。

## 5. `IAM` 页面的数据来源 hook / API 接口

### 页面侧 hook

`IamPage` 主要由 `@tanstack/react-query` 驱动，并辅以 `useAuth()` 读取当前身份与权限：

| Hook 变量 | 类型 | 调用函数 | 用途 |
| --- | --- | --- | --- |
| `users` | `useQuery` | `listIamUsers({ query: userSearch })` | 加载用户列表 |
| `roles` | `useQuery` | `listIamRoles({ includePermissions: true })` | 加载角色列表，并内联权限 |
| `selectedIdentity` | `useQuery` | `getIamUserIdentity(selectedUserID)` | 加载选中用户的身份、角色、权限 |
| `selectedRolePermissions` | `useQuery` | `getIamRolePermissions(selectedRoleName)` | 加载选中角色的权限 |
| `bindRole` | `useMutation` | `bindRoleToUser(selectedUserID, roleName)` | 给用户绑定角色 |
| `unbindRole` | `useMutation` | `unbindRoleFromUser(selectedUserID, roleName)` | 给用户解绑角色 |

另外：

- `useAuth()` 提供 `auth.identity` 与 `auth.can(...)`
- 当前登录用户自身的 IAM 权限摘要来自 `auth.identity?.permissions`

### 对应 API 接口

这些 hook 最终落到 `web/src/api/iam.ts` 中的接口：

| 动作 | API 函数 | HTTP 接口 |
| --- | --- | --- |
| 查询用户列表 | `listIamUsers` | `GET /api/v1/iam/users?q=...` |
| 查询单个用户身份 | `getIamUserIdentity` | `GET /api/v1/iam/users/{userID}` |
| 查询角色列表 | `listIamRoles` | `GET /api/v1/iam/roles?include_permissions=true` |
| 查询角色权限 | `getIamRolePermissions` | `GET /api/v1/iam/roles/{roleName}/permissions` |
| 绑定角色 | `bindRoleToUser` | `POST /api/v1/iam/users/{userID}/roles` |
| 解绑角色 | `unbindRoleFromUser` | `DELETE /api/v1/iam/users/{userID}/roles/{roleName}` |

## 阶段 0 小结

当前 IA 的“真实形状”可以压缩成三句话：

1. 代码里仍是 `Workspace / Platform` 两组导航，不是未来的三分区。
2. `Sessions` 已经同时承载两个性质不同的 surface，但它们仍共用一个路由。
3. `IAM` 现在是“用户 → 角色 → 权限”的管理页，数据链路已经清晰，适合在后续阶段独立演进。
