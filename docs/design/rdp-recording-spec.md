# RDP 会话录制与回放 · 设计规格（阶段 10）

> 范围：仅设计文档，不含实现。对照调研清单 "Audit RDP 录屏回放（L，最大盲区）"、当前 `internal/guacproxy/*`、`internal/terminal/*`（SSH 录屏作对照基线）、`internal/sessions/*`、`internal/storage/*`、`web/src/features/audit/AuditPage.tsx` 与 `web/src/lib/guacamole.ts`。
>
> 目标：让 RDP 会话像 SSH 一样可审计回放，补上"堡垒机有 RDP 会话却无任何录像"这个真盲区。

---

## 0. 当前实现基线（事实，不是建议）

- **SSH 已录屏**：`internal/terminal/recorder.go` 写 asciinema cast v2（**仅输出帧 `o`，不录输入**，避免录入密码）。`terminal/handler.go`：
  - `openRecorder` 在 `storage != nil && IsEnabled()` 时建 `os.TempDir()/ops-cast-<sid>.cast`；否则 nil = 录制关闭（由 `OPS_RECORDING_ENDPOINT` 是否配置决定）。
  - `finalizeRecording`：会话结束后关闭 cast → `storage.PutObject(key, ..., "application/x-asciicast")`，key 约定 `terminal/YYYY/MM/DD/<sid>.cast` → `sessions.SetRecording(sid, key, size)`。上传走独立 60s deadline，失败只记日志不毁审计行。
- **RDP 完全不录屏**：`internal/guacproxy/handler.go` 的 `bridge(conn, session)` 在浏览器 websocket（`conn`）与 guacd（`session`，经 `tunnel.go` 的 ssh forwarder 转发）之间双向中转 Guacamole 协议指令流。**guacproxy 全包无任何 record/storage/SetRecording 代码**。RDP 仅经 `sessions.Start/End` 写审计行（进 Audit 表，有 bytes in/out），`recording_uri` 永远为空 → `has_recording=false` → Audit 的 Inspect 按钮对 RDP **从不显示**。
- **分发链路**：`/recording` 路由 → `sessions` handler（owner 校验：非 `bastion.session:read`/admin 跨用户访问返回 404 不泄露存在性）→ `httpserver/recording_adapter.go` 的 `recordingFetcher` → `storage.Client.GetObject`。
- **前端**：`web/src/lib/guacamole.ts` + `RdpSessionPane.tsx` 已有 Guacamole 客户端用于**实时** RDP；Audit 的 `getSessionRecording` 取文本 + `parseAsciicast` 仅支持 asciicast v2（对非 cast 硬抛——今天对 RDP 不触发，因为 RDP 不显示 Inspect）。
- **结论**：本项不是"录了播不了"，是"**RDP 根本没录**"。需新建整条管线：采集 → 存储 → 分发 → 回放。

## 1. 关键设计抉择

### 1.1 采集（recording capture）

**选项 A · 代理侧 tee（推荐）**
guacproxy 本就在 Guacamole 指令流中间。在 `bridge` 处把 **guacd→浏览器方向**（server-to-client 指令流，即用户看到的画面流）tee 到一个本地录制文件，会话结束后上传 MinIO、`sessions.SetRecording`——与 SSH 的 recorder/finalizeRecording **完全对称**。
- 优点：自包含；复用现有 storage/sessions 管线与权限/分发；无 guacd 配置、无 guacd↔ops-api 共享卷耦合；与 SSH "仅录输出" 的隐私取舍一致（client-to-server 含键盘/剪贴板，**不录**）。
- 代价：需在 guacproxy 落地一个 `Guacamole.SessionRecording` 兼容的写出器（Guacamole 录制格式 = 带时间戳前缀的 server→client 指令流，格式简单、可控）。

**选项 B · guacd 侧 recording-path**
握手参数传 `recording-path`/`recording-name`/`create-recording-path` 让 guacd 自己写录制文件。
- 优点：guacd 原生、最"标准"。
- 代价：需 guacd↔ops-api 共享卷把文件取回再传 MinIO；guacd 镜像/部署需支持；与现有 SSH 自包含管线不对称；运维面更大。

→ **推荐 A**：对称、自包含、贴合"内部运维控制台"定位与现有 MinIO 存储，无新增基建耦合。

### 1.2 回放（playback）

**选项 A · 浏览器内 `Guacamole.SessionRecording`（推荐）**
前端已有 guac 库用于实时 RDP。回放即把录下的指令流喂给 `Guacamole.SessionRecording`（guacamole-common-js 提供的录制播放器：play/pause/seek、时间轴）。
- 优点：无服务端转码、无新基建；与 SSH cast 客户端预览同思路；录制文件即"可重放协议流"，体积小。
- 代价：需确认/补齐前端 guac 库的 `SessionRecording`（`web/src/lib/guacamole.ts` 当前可能只含实时 client，需 review 时核实是否需引入 guacamole-common-js 的录制播放器模块）。

**选项 B · 服务端 `guacenc` 转 mp4**
guacd 自带 `guacenc` 把录制转 .m4v。
- 优点：产出标准视频，可像 `.cast` 一样直接下载/外部播放。
- 代价：需部署 guacenc 二进制/sidecar + 异步转码任务 + 转码产物的存储与生命周期；重。

→ **推荐 A**：复用既有前端能力、零新基建；可选在后续阶段加 B 的"导出 mp4"作为增值，而非回放主路径。

### 1.3 录制开关与隐私

- 复用 SSH 的同一总开关语义：`storage` 未启用（`OPS_RECORDING_ENDPOINT` 未配）时 RDP 同样**不录**（nil-safe no-op），不改变现有部署默认。
- 隐私取舍与 SSH 对齐：**只录 server→client（用户所见画面）**，不录 client→server（键盘/剪贴板/拖拽），避免录入凭据。文档需在 review 明确这条。

## 2. 数据 / 存储 / 权限 / 容量

- **数据模型**：复用 `terminal_session.recording_uri/recording_bytes` 与 `sessions.SetRecording`。**无需迁移**。需要区分录制类型时，新增可空列 `recording_kind`（`asciicast`|`guac`，默认按 content-type/key 前缀推断，向后兼容）——是否加列待 review 决定，最小方案靠 storage key 前缀（`rdp/…` vs `terminal/…`）+ content-type 区分即可。
- **存储 key 约定**：`rdp/YYYY/MM/DD/<sessionID>.guac`，content-type 用自定义如 `application/vnd.glyptodon.guacamole.recording`（或 `application/octet-stream`）。
- **分发**：完全复用现有 `/recording` 路由与 owner/`bastion.session:read` 权限语义——RDP 录像与 SSH cast 同一鉴权边界，无新端点、无新权限。
- **容量**：Guacamole 指令流录制比视频小得多，但 RDP 图形会话仍可能远大于 SSH cast。需 review 明确：① 是否设单会话录制大小上限（超限截断并标记）；② 保留期/清理策略（当前 SSH cast 似无清理，RDP 体量更需正视——可作为独立后续项，不阻塞本期）。

## 3. 分阶段实施计划（review 后执行，不在本阶段写码）

- **阶段 10a · 采集（后端）**：guacproxy 在 `bridge` 接入 server→client tee 写出器；会话结束按 SSH `finalizeRecording` 同构上传 MinIO + `SetRecording`。开关复用 storage 启用判定。验证：跑一次 RDP 会话后 Audit 行 `has_recording=true`、MinIO 有对象。
- **阶段 10b · 分发 + 类型标识**：确认 `/recording` 对 `.guac` 字节透传正确；前端 `getSessionRecording`/Audit 按类型分流（cast→现有预览，guac→录像播放器），不再对非 cast 硬抛（修掉那个潜在健壮性问题）。
- **阶段 10c · 回放（前端）**：核实/引入 `Guacamole.SessionRecording`，Audit Inspect 对 RDP 渲染录像播放器（play/pause/seek）；SSH 路径不变。
- **阶段 10d（可选，增值）**：服务端 `guacenc` 导出 mp4 下载，与 `.cast` 下载对齐。非回放主路径，独立可裁剪。

## 4. 严格边界（本阶段）

- 本阶段**仅设计文档**，不写任何代码，不改 guacproxy/sessions/前端。
- 推荐基线 = 采集 A（代理侧 tee）+ 回放 A（浏览器内 SessionRecording），但**最终采集/回放选型、是否加 `recording_kind` 列、容量/保留策略**均需 review 拍板后方可进入 10a。
- 与已暂停的 IAM 工作、其它模块改进互不依赖。

## 5. 待 review 确认清单

1. 采集选 A（代理侧 tee）还是 B（guacd recording-path）？
2. 回放选 A（浏览器 SessionRecording）还是 B（guacenc→mp4）作为主路径？
3. 录制方向是否锁定"仅 server→client"（隐私取舍，建议是）？
4. 录制类型区分用新列 `recording_kind` 还是 key 前缀+content-type 推断（建议后者，免迁移）？
5. 是否本期就定单会话大小上限与保留期，还是拆为独立后续项？
6. 前端 `web/src/lib/guacamole.ts` 是否已含录制播放器，还是需引入 guacamole-common-js 对应模块（影响 10c 工作量）？
