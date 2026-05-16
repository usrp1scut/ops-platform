# IAM 能力矩阵 · 设计规格（阶段 4）

> 范围：仅设计文档，不含实现。对照设计评审 `Ops Platform Design Review.html` 第 11 页（IAM redesign，11/14）、当前 `web/src/features/iam/IamPage.tsx` 与数据层 `web/src/api/iam.ts` / `web/src/lib/iam.ts`。
>
> 目标：把 IAM 从“用户拥有哪些角色”改造成“谁能在什么资源上做什么”（capability matrix），并明确这套视图需要数据层提供什么、当前缺什么。

---

## 0. 当前实现基线（事实，不是建议）

- 数据模型 `RolePermission`（`api/iam.ts:14-18`）只有三个字段：`resource`、`action`、`permission`（`permission` 形如 `resource:action`，例如 `bastion.session:ssh`）。**没有 scope / 环境 / 来源 / 有效期字段。**
- 现有接口（`api/iam.ts`）：
  - `GET /api/v1/iam/users?q=` → 用户列表
  - `GET /api/v1/iam/users/{userID}` → 单用户身份（`user` / `roles[]` / `permissions[]`）
  - `GET /api/v1/iam/roles?include_permissions=true` → 角色列表，内联权限
  - `GET /api/v1/iam/roles/{roleName}/permissions` → 角色权限
  - `POST` / `DELETE /api/v1/iam/users/{userID}/roles[/{roleName}]` → 绑 / 解绑角色
- 现有页面（`IamPage.tsx`）是三块拼起来的：用户表 + 选中用户的角色绑定 + 角色权限表 + 折叠的“有效权限”。要回答“Alice 能不能 SSH 到 prod-eks-node-…008”，管理员必须在脑子里手动 join 三张表——这正是设计评审第 11 页要解决的问题。

**结论先行**：能力矩阵的“行 / 列 / 是否拥有”可以用现有数据推导；但“partial scope（按环境/来源限定）”、“principals 计数”、“来源是 base role 还是 ad-hoc grant”、“有效期 / 是否 unscoped 待审”这些设计稿要素，**当前数据层完全没有对应字段**，必须新增后端能力。这是阶段 4 最重要的判断，决定了后续是 UI 先还是后端先。

---

## 1. 矩阵的行：capability 列表从哪里来

- **行 = capability**，定义为“资源类上的一个动词”，即 `permission` 字符串（`resource:action`）。设计稿第 11 页的行示例：`bastion.session:ssh`、`bastion.session:rdp`、`bastion.session:read`、`access.request:create`、`access.request:approve`、`cmdb.asset:read`、`cmdb.asset:write`、`iam.role:write`、`system:admin`。
- **可用现有数据推导的来源（短期）**：`listIamRoles({ includePermissions: true })` 把所有角色的 `permissions[].permission` 求并集、去重、按 `resource` 分组（复用 `lib/iam.ts` 的 `groupRolePermissions`，其分组/排序逻辑可直接搬过来）。
- **该来源的缺陷（需要后端补齐）**：从角色反推只能看到“至少被某个角色引用过的能力”。一个产品里存在、但当前没有任何角色拥有的能力（应显示为整行 none）不会出现。要让矩阵成为“审计时可信的全集”，需要一份**权威 capability 目录**（见 §4 接口 1）。
- **行的分组**：按 `resource` 分组展示（`bastion.session.*`、`access.request.*`、`cmdb.asset.*`、`iam.*`、`system.*`），与设计稿的视觉分块一致。

## 2. 矩阵的列：role 列表

- **列 = role**，来源 `listIamRoles()` → `IamRole.name`（设计稿示例列：`admin` / `ops` / `viewer`）。
- 列顺序建议按权限广度从宽到窄（admin → ops → viewer），可由前端按 `role.permissions.length` 粗排，后端目录接口若返回 `rank` 字段则以后端为准。
- 设计稿在矩阵右侧还有一列 **“Principals · today”**（如 `2 users · 1 group` / `all signed-in`）。这不是 role 列，而是“当前实际持有该能力的主体计数”，**当前无任何接口可得**，需后端聚合（见 §4 接口 3）。
- 列上的“+ New role”“view · users / roles”是既有角色/用户管理的入口，保留现有 `IamPage` 的绑定/解绑能力作为“编辑矩阵的方式”，矩阵本身为只读主视图。

## 3. 单元格三态与数据层字段映射

设计稿单元格三态：`all`（绿，文案 “all”）/ `partial`（黄，文案如 `env=default,dev`、`source=aws`、`env≠prod`）/ `none`（灰，`—`）。

| 单元格状态 | 含义 | 当前数据层能否表达 | 目标映射字段 |
| --- | --- | --- | --- |
| `none` | 该 role 没有这条 capability | ✅ 能（`role.permissions` 中**不存在**该 `permission`） | 无需新字段 |
| `all` | 该 role 拥有该 capability 且**无 scope 限制** | ⚠️ 只能表达“拥有”，无法区分 all vs partial（现模型没有 scope） | 需 `cell.state="all"` + `cell.scope=null` |
| `partial` | 拥有但被限定到部分资源（环境 / 来源 / 集合） | ❌ **完全无对应字段** | 需新增 scope 表达：`cell.state="partial"` + `cell.scope`（结构化，见下） |

**关键缺口**：`RolePermission` 没有 scope。要支撑 `partial`，数据层须引入 scope 概念，建议结构（仅描述，不实现）：

```
Scope := {
  dimension: "env" | "source" | "tag" | ...,   // 限定维度
  op:        "in" | "not_in" | "eq",            // env=default,dev → in; env≠prod → not_in
  values:    string[]                            // ["default","dev"] / ["aws"] / ["prod"]
}
```

单元格完整数据形状（矩阵接口每格返回）：

```
Cell := {
  state:   "all" | "partial" | "none",
  scope:   Scope[] | null,        // partial 时非空，渲染成 "env=default,dev"
  sources: Source[]               // 该格由哪些来源产生（base role / ad-hoc grant）
}
Source := {
  kind:   "role" | "grant",
  ref:    string,                 // role:ops / request #114 / grant:ops-bot
  scope:  Scope[] | null,
  since:  string,                 // ISO 时间
  expires_at: string | null,      // grant 才有；role 为 null
  flagged: boolean                // 例如 "unscoped grant · review"
}
```

`sources` 支撑设计稿的 **Selected cell** 检查面板（“2 of 3 grants restrict scope… base vs ad-hoc，unscoped 高亮 review”），以及顶部 `3 unscoped grants` 警示 pill（= 全表 `sources` 中 `kind=grant && scope=null` 的计数）。

## 4. 需要新增的后端接口建议（仅签名，不含实现）

> 设计原则：能力矩阵是只读派生视图，写操作仍走现有 role bind/unbind。新增接口都为读 + 一个解析器。

**接口 1 · 权威能力目录（矩阵行的真源）**
```
GET /api/v1/iam/capabilities
→ { items: Array<{
      permission: string,        // "bastion.session:ssh"
      resource:   string,        // "bastion.session"
      action:     string,        // "ssh"
      group:      string,        // 分组展示用
      description?: string
    }> }
```

**接口 2 · 能力矩阵（一次取全表，避免前端 N×M join）**
```
GET /api/v1/iam/matrix?resource_scope=&source=
→ {
    roles:        Array<{ name: string, rank?: number }>,
    capabilities: Array<{ permission: string, group: string }>,
    cells:        Record<string /*permission*/,
                         Record<string /*roleName*/, Cell>>,   // Cell 见 §3
    warnings:     { unscoped_grants: number }
  }
```
`resource_scope` / `source` 对应设计稿顶部 “Resource scope · all / Source · all” 两个过滤 pill。

**接口 3 · 单能力的主体与来源（Selected cell 面板 + “Principals · today” 列）**
```
GET /api/v1/iam/capabilities/{permission}/principals?role=
→ {
    summary: { users: number, groups: number, label: string }, // "2 users · 1 group" / "all signed-in"
    sources: Source[]                                            // Source 见 §3
  }
```

**接口 4 · 能力解析器**（见 §5，单列出来强调它是这套设计的“回答问题”核心）。

> 说明：接口 1/2/3 都可在后端先用“现有 role/permission + 未来 scope/grant 表”组装；scope 与 grant 的持久化是后端工作量大头，前端只依赖上面的响应形状。

## 5. 能力解析器接口设计（Can user X do Y on Z）

设计稿第 11 页右下 “Answer my question” 卡片 + 第 11/12/13 页多处“从用户/资产/录屏跳进 IAM 问同一个问题”。这是当前 IAM 页**根本答不出**的问题，是矩阵之外第二个一等公民。

```
POST /api/v1/iam/resolve
body → {
  user_id:      string,
  capability:   string,        // "bastion.session:ssh"
  resource_ref: string | null  // 资产标识，如 "prod-eks-node-…008"；null = 不限定具体资源
}
→ {
  allowed:    boolean,
  effect:     "allow" | "deny",
  expires_at: string | null,                 // 来自 grant 时有；"yes · for 12h"
  path: Array<{                              // 产生该结论的链路，按贡献排序
    source:  "role" | "grant" | "profile",
    ref:     string,                          // "role:ops" / "grant #114 · approved by admin"
    capability: string,                       // 这一步贡献的能力
    scope:   Scope[] | null,
    note?:   string                           // "from connection profile" / "recording · enforced"
  }>,
  denied_reason?: string                       // allowed=false 时给出可读原因
}
```

要点：
- 返回 **yes/no + 产生它的路径**，不是单纯布尔——这是设计稿强调的“path that produces it”。
- 同一个 endpoint 服务三个入口：IAM 矩阵卡片、用户详情、资产/录屏详情的“what grant let this happen?”。前端各处复用同一 hook。
- `resource_ref=null` 时回答“在任意资源上能否”，用于矩阵单元格点开；带 `resource_ref` 时回答设计稿那种具体问题（li.wei → prod-eks-node-…008）。

## 6. 增量实施计划：UI 先 / 后端先 / 并行

**结论：分两段，先 UI-only 降级版（不阻塞后端），scope/grant 落地后再升级——不要等后端齐了才动 UI。**

理由：行（capability）、列（role）、`none` 三态可由现有 `listIamRoles({includePermissions:true})` 完全推导，能立刻交付一个“诚实受限”的矩阵；而 `partial scope` / principals 计数 / 解析器依赖后端新表，是关键路径，应尽早并行启动后端。

### 阶段 4a · UI-only 矩阵（不需要任何新接口，可立即做）
- 复用 `listIamRoles({ includePermissions: true })`：行=权限并集（搬 `lib/iam.ts:groupRolePermissions` 的分组/排序），列=角色名。
- 单元格只渲染 `none` / **`granted`（暂不区分 all vs partial，统一显示“granted”）**。
- 明确的“诚实受限”标注：页面顶部注明“scope 与按资源解析尚未接入，本视图只显示是否被角色授予”。不显示 principals 列、不显示 unscoped 警示、解析器卡片显示“需要后端 `/iam/resolve`（待接入）”占位。
- 风险低，纯前端，可与后端并行启动。

### 阶段 4b · 后端能力（与 4a 并行启动，关键路径）
顺序建议：
1. 接口 1 `GET /iam/capabilities`（权威目录）——最简单，先让行变成全集。
2. scope 数据模型 + 接口 2 `GET /iam/matrix`（带 `Cell.state/scope/sources`）——工作量大头，决定 `partial` 能否显示。
3. 接口 3 principals 聚合。
4. 接口 4 `POST /iam/resolve` 解析器——可与 2/3 并行，因为它逻辑独立。

### 阶段 4c · UI 升级（依赖 4b 各接口，逐个接入、可分批上线）
- 接口 2 到位 → 矩阵切到三态 + scope 文案 + 顶部过滤 pill + unscoped 警示。
- 接口 3 到位 → 加 “Principals · today” 列 + Selected cell 来源面板。
- 接口 4 到位 → “Answer my question” 卡片可用，并把同一 hook 接到用户详情 / 资产详情 / 录屏详情的跳转。

### 不在阶段 4 范围
- 不实现任何代码（阶段 4 仅本规格文档）。
- 不改既有 role bind/unbind 写流程。
- 不做跨页深链（Sessions/Audit/IAM 互跳）的实现——属后续阶段。

---

## 附：与设计稿的对应核对

| 设计稿第 11 页要素 | 本规格对应章节 |
| --- | --- |
| 行=capability（verb on resource class） | §1 |
| 列=role（admin/ops/viewer） | §2 |
| 单元格 all / partial / none | §3 |
| “env=default,dev / source=aws / env≠prod” scope 文案 | §3 Scope 结构 |
| “Principals · today” 列（2 users · 1 group） | §2 + §4 接口 3 |
| 顶部 “3 unscoped grants” 警示 | §3 sources + §4 接口 2 `warnings` |
| Selected cell：base vs ad-hoc grant、unscoped 高亮 review | §3 Source + §4 接口 3 |
| “Can li.wei SSH into prod-eks-node-…008?” + path | §5 解析器 |
| roles & users still editable, but secondary | §2（保留现有绑定能力，矩阵只读为主） |
