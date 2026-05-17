# Claude Code 后续改进任务（5 项）

> 基于 `docs/design/Ops Platform Design Review.html` 的设计评审。
> 第一阶段实施已完成（侧栏分组、Audit 拆分、Connect、IAM 能力矩阵），
> 这份是收尾的 5 个细节修正。**按 P1 → P5 顺序执行，每完成一项停下让人 review。**

---

## 通用规则

每次开会话先粘贴：

```
请先阅读：
- docs/design/Ops Platform Design Review.html（设计评审，14 页）
- docs/design/claude-code-followups.md（这份后续任务）

本次只做【任务 P<N>】，不要顺手优化别的代码。
完成后用 git diff 概括改了哪些文件、改了多少行，然后停下等我 review。
```

每完成一项后，让它把改动追加到 `docs/design/refactor-progress.md`（如不存在就新建）。

---

## P1 · Connect 补回 "Connection profile" 详情卡 ⭐ 最重要

**背景**：当前 `ConnectPage` 的 connection 卡片只展示了 grant 倒计时 / Open SSH 按钮。
设计评审第 10 页那张卡片本来还要展示：bastion 地址、登录身份、跳数、
TCP probe 状态、是否强制录像、idle 上限。这是让运维觉得 Connect 比 CMDB
表格"值得用"的核心说服力。

**任务**：

1. 在 `web/src/features/connect/ConnectPage.tsx` 里：
   - 选中资产时，额外发起 `getAssetConnectionProfile(selectedAssetID)` 查询
     （已有 API，见 `web/src/api/cmdb.ts`），用 react-query。
   - 在 `connect-conn-panel` 内部、`form-actions` 之前，加一个折叠区
     `<details class="connect-profile-details">`，默认 **打开**。
   - 折叠区里用 `<dl class="detail-grid">` 列出以下字段（来自 profile + asset）：
     - **Bastion** · `profile.bastion_host:port` 或 "direct"
     - **Login as** · `profile.username`（+ "key: <key_name>" 如果有）
     - **Protocol** · `profile.protocol.toUpperCase()`
     - **Recording** · `profile.record_session ? "enforced" : "off"` （pill 样式）
     - **Idle limit** · `profile.idle_timeout_seconds` 格式化为 "15m"
     - **Credentials** · 三选一显示："password set" / "private key set" / "ec2 key: <name>" / "none"
   - 字段缺失时显示 `<span class="muted">—</span>`，不要隐藏整行。

2. 样式加到 `web/src/styles/app.css` 里（找 `.connect-conn-panel` 附近）：
   - `.detail-grid` 已存在；如果显示效果不密集，可微调
     `grid-template-columns: 140px 1fr` 复用 IAM detail-list 的风格。
   - `details > summary` 加一个 hover 颜色用 `--color-fg-muted`。

3. 错误处理：profile 查询返回 404 时（资产没有 connection profile）展示
   一行提示 "No connection profile. Configure in CMDB →" 并附跳转链接，
   **不要**把整个 connection 卡片变成错误状态。

**范围之外**：不要动 ConnectPage 的其他卡片、不要改 AssetRail、
不要碰 SessionsPage。

**验收**：
- 选中一个有完整 profile 的资产 → 折叠区显示全部字段
- 选中一个没 profile 的资产 → 折叠区显示一行提示 + CMDB 链接
- npm run build 通过

---

## P2 · IAM 视图切换进 URL

**背景**：IAM 页有 "Capabilities" / "Users & roles" 两个视图切换，但
点完刷新会回到默认 capabilities。`/iam?user=<id>` 的 deep link 已经处理了，
现在让 `/iam?view=directory` 也能用。

**任务**：

1. 修改 `web/src/features/iam/IamPage.tsx`：
   - 用 `useSearchParams` 替代单纯的 `useState<IamView>`。
   - `view` 从 search param 读：`searchParams.get("view") === "directory" ? "directory" : "capabilities"`。
   - 切换 view 时调 `setSearchParams`，**保留**已有的 `user` 参数。
   - `?user=<id>` 仍然强制 directory 视图（现有行为不动）。

2. 测试三种 URL：
   - `/iam` → capabilities
   - `/iam?view=directory` → directory
   - `/iam?user=abc123` → directory，选中 abc123（保持现有逻辑）

**范围之外**：不动 CapabilityMatrix 内部。

---

## P3 · 加回 "Old portal" 过渡链接

**背景**：设计评审第 14 页"不要改"清单里建议保留旧门户回退链接 30 天，
当前实现没有。运维老用户有肌肉记忆，一个低调的回退是便宜的保险。

**任务**：

1. 在 `web/src/app/layout/AppShell.tsx` 的 topbar 里，在 `ThemeToggle`
   **之前** 加一个文本链接：
   ```tsx
   <a className="topbar-legacy-link" href="/portal/legacy/" title="Open the previous portal">
     Old portal
   </a>
   ```
   （路径如果 `/portal/legacy/` 在你的部署里不对，请用 grep 找一下当前
   旧门户的实际 base，可能是 `/portal-old/` 或类似。）

2. 样式加到 `app.css`：
   ```css
   .topbar-legacy-link {
     font-size: 12px;
     color: var(--color-fg-subtle);
     text-decoration: none;
     padding: 4px 8px;
     border-radius: var(--radius-sm);
   }
   .topbar-legacy-link:hover {
     color: var(--color-fg-muted);
     background: var(--color-bg-subtle);
   }
   ```

3. 加一行注释：`{/* TODO(2026-06-17): remove after 30 days of new IA */}`

**范围之外**：不要改其他 topbar 元素的顺序或样式。

---

## P4 · 抽 `useBodyClass` hook

**背景**：当前 `ConnectPage` / `SessionsPage` / `IamPage` / `OverviewPage`
都在 effect 里手动 `document.body.classList.add(...)`，散在四个文件里。
功能正确，但重复。

**任务**：

1. 新建 `web/src/hooks/useBodyClass.ts`：
   ```ts
   import { useEffect } from "react";

   /**
    * Toggle a class on document.body for the lifetime of the calling
    * component. Used to opt page-level surfaces into shell-wide layout
    * modes (e.g. "fullwidth-mode" drops the centred .page-section cap;
    * "workspace-mode" drops the page-frame padding entirely).
    *
    * Multiple components can request the same class — cleanup removes
    * the class only when the last user unmounts.
    */
   const refCounts = new Map<string, number>();

   export function useBodyClass(className: string) {
     useEffect(() => {
       const next = (refCounts.get(className) || 0) + 1;
       refCounts.set(className, next);
       document.body.classList.add(className);
       return () => {
         const remaining = (refCounts.get(className) || 1) - 1;
         if (remaining <= 0) {
           refCounts.set(className, 0);
           document.body.classList.remove(className);
         } else {
           refCounts.set(className, remaining);
         }
       };
     }, [className]);
   }
   ```

2. 替换四个页面里的 useEffect 块：
   - `ConnectPage`: `useBodyClass("fullwidth-mode")`
   - `IamPage`: `useBodyClass("fullwidth-mode")`
   - `OverviewPage`: `useBodyClass("fullwidth-mode")`
   - `SessionsPage`: `useBodyClass("workspace-mode")`

**范围之外**：不要顺手重构其他 useEffect。

**验收**：
- 四个页面行为不变（视觉上完全一样）
- 在两个页面之间快速来回切换不会留下 stale class
- npm run build 通过

---

## P5 · `CapabilityMatrix` resolve 改用 useMutation

**背景**：项目里 `bindRole` / `inspectRecording` / `launchTerminal` 都用了
`useMutation`，唯独 `CapabilityMatrix` 的 resolve 用了手写
`useState(resolving) + try/catch/finally`。统一一下风格。

**任务**：

修改 `web/src/features/iam/CapabilityMatrix.tsx`：

1. 把 `resolving` / `resolveResult` / `resolveError` 三个 useState 替换成
   一个 `useMutation`：
   ```ts
   const resolve = useMutation({
     mutationFn: (args: { userID: string; capability: string; resourceRef?: string }) =>
       resolveCapability({
         user_id: args.userID,
         capability: args.capability,
         resource_ref: args.resourceRef,
       }),
   });
   ```

2. `submitResolve` 简化为校验后 `resolve.mutate({ userID: resolveUserID, capability: resolveCap, resourceRef: resolveRef.trim() || undefined })`。

3. 渲染时用 `resolve.isPending` / `resolve.data` / `resolve.error` 替代
   现有三个 state。

4. 校验失败（缺 user 或 capability）的情况：仍然要展示错误。可以
   保留一个 `formError` useState 专门给"前端校验"用，跟 mutation error
   分开渲染。

**范围之外**：不要动矩阵单元格的 onClick 逻辑、不要动 `principals` query。

**验收**：
- 提交 resolver 表单的行为完全不变
- 输入不全时仍然显示 "Select a user and a capability."
- 后端报错时仍然展示错误信息
- npm run build 通过

---

## 验收完成的标记

每项做完后，让 Claude Code 在 `docs/design/refactor-progress.md` 里追加：

```
## P<N> · <任务名>
- 日期：YYYY-MM-DD
- 改动文件：<列表>
- 测试结果：build 通过 / 手动验证通过
- 备注：<如果有偏离 prompt 的决策>
```

5 项全部完成后，整个设计评审就算 100% 兑现了。
