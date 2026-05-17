# 数据库会话访问代理（MySQL/PostgreSQL/Redis）· 设计规格（L1，阶段 13）

> 范围：仅设计文档，不含实现。对照 `project_positioning`（内部运维控制台、非 PAM）、ADR 0011（开发阶段硬切）、`internal/connectivity`、`internal/guacproxy`（`tunnel.go` sshForwarder、`handler.go` ws bridge）、`internal/bastion`（JIT grant + `RequireSessionAuthorization`）、`internal/sessions`（审计行）、`internal/cmdb`（连接档）。
>
> 目标：让 MySQL/PG/Redis 资产可经平台**受控访问 + 审计元数据**，用户用自带 `mysql`/`psql`/`redis-cli`。**明确不做**：查询捕获、SQL 过滤、Web 查询台、会话录制——那些是 PAM 支柱，与定位冲突（L2/L3，本期不做）。

---

## 0. 当前实现基线（事实，不是建议）

- 连接档（`internal/cmdb/repository.go`）协议白名单 = `ssh|postgres|rdp|vnc|telnet`；**`postgres` 已在**（含 `database` 字段、port 默认 5432、password-only），**`mysql`/`redis` 不在**。但 `postgres` 当前仅用于**连接档 + 主机事实探测**（`bastionprobe` probe 分支），**没有任何交互式 DB 会话通路**。
- 会话通路现状：SSH 走 `internal/terminal`（仅 ssh）；RDP/VNC/Telnet 走 `internal/guacproxy`→guacd。两者都是"浏览器 WebSocket ↔ 服务端 TCP"的 `bridge` 模式（`guacproxy/handler.go:254 bridge(ws,sess)`）。
- 可复用原语：
  - `connectivity.TicketService`：资产维度短时票据（默认 60s TTL，`IssueTicket(user,name,asset)`），SSH 与 guac 都在用。
  - `guacproxy/tunnel.go` `sshForwarder`：`net.Listen` 本地随机端口 + `sshClient.Dial("tcp", target)`——经资产 VPC proxy 的 SSH client 把 TCP 打到内网目标，正是够到内网 DB 的原语。
  - `bastion.RequireSessionAuthorization(repo,"connect",...)` + JIT grant：阶段 12 已把会话权限并为单一 `bastion.session:connect`，DB 会话**直接复用**，无需新权限。
  - `sessions.Start/End`：写审计行（谁/资产/起止/字节）。
- 结论：访问代理 + 审计所需的鉴权/隧道/票据/审计/连接档基建**基本齐备**；缺的是 DB 专有的"协议无关字节代理通路"与"用户本地客户端如何接入"。

## 1. 核心架构分叉（最难、必须 review 拍）

平台是服务端，用户的 `mysql/psql/redis-cli` 在用户机器上，且 DB 在内网（常需经资产 VPC proxy）。"用户本地客户端如何够到被代理的 DB"有三条本质不同的路：

**选项 A · WebSocket↔TCP 桥 + 极简本地 helper（推荐）**
平台新增 ticket 鉴权的 WS 端点：`wss …/db?ticket=`，服务端 `bridge(ws, sshForwarder.Dial(db))`（完全复用 guac 的 bridge 形态，只是另一端是裸 DB TCP 而非 guacd）。用户侧跑一个一行式 `ws→localhost:PORT` 转发（提供脚本/小二进制），然后 `mysql -h127.0.0.1 -P PORT`。
- 优点：与现有 guac bridge/sshForwarder/ticket 同构，服务端零新网络面；穿透企业网络（走 443/wss，与现有终端/RDP 一致）；DB 协议无关（MySQL/PG/Redis 都是裸 TCP，不解析协议）。
- 代价：需分发一个本地 helper（或文档化的 `websocat` 一行命令）——有上手摩擦，但比"自建 PAM"轻得多。

**选项 B · 复用既有 bastion SSH 做 `ssh -L`**
资产可达 bastion 时，用户本就能 `ssh -L`。平台价值=签发短时凭据/grant + 审计行 + 给出现成 `ssh -L` 命令。
- 优点：服务端几乎零新增。
- 代价：只覆盖"有 SSH bastion 且用户能直连 bastion"的资产；隧道机制甩给用户；与"平台代理访问"体验不一致；非 SSH 可达的 DB 无解。

**选项 C · 在可达跳板上开短时监听**
平台在用户可达的主机（如 bastion）开短时监听，经 VPC proxy 转发到 DB，返回 `host:port+TTL`。
- 优点：最接近 JumpServer "资产隧道"、用户零 helper。
- 代价：需要一个"用户可达又能转发进内网"的监听宿主与其生命周期管理；网络暴露面与运维面变大；最偏 PAM 基建。

→ **推荐 A**：与现有 SSH/RDP 的 ws-bridge/ticket/sshForwarder 范式同构、复用最大化、网络面最小、协议无关；本地 helper 摩擦可用文档+脚本化吸收。B 作为"无 helper 退化路径"可后续叠加，C 不做（偏 PAM、运维重）。

## 2. 复用映射（A 方案下）

| 关注点 | 复用 | 新增 |
|---|---|---|
| 鉴权 | `RequireSessionAuthorization(repo,"connect",assetID)`（阶段 12 已并）+ JIT grant | 无 |
| 票据 | `connectivity.TicketService`（资产维度短时） | 无 |
| 到内网 DB | `guacproxy/tunnel.go` sshForwarder（经 VPC proxy SSH client Dial） | 抽成与 guac 无关的共享 tcp-forward（或在 db 包内同构实现） |
| 字节代理 | guac `bridge(ws,conn)` 形态 | DB 版 bridge：ws ↔ 裸 DB TCP（无 recorder——L1 不录） |
| 审计 | `sessions.Start/End`（谁/资产/起止/字节） | 复用；recording_uri 恒空（L1 无录制，诚实） |
| 连接档 | postgres 已就绪 | 白名单加 `mysql`(3306)/`redis`(6379)；redis 常无 username（参照 vnc 放宽 username 必填） |
| 前端启动 | — | 见 §3 |

## 3. 前端 UX（关键差异：DB 会话**没有浏览器内渲染器**）

SSH→xterm、RDP/VNC/Telnet→guac 画布；**DB 会话无法在浏览器内"显示"**——用户用本地客户端。所以 Sessions 的 live pane 模型不适用。设计：

- 选中 DB 资产点连接 → 不开 live pane，而是弹一张 **"DB 访问"卡**：① 一次性 ws 端点 + ticket；② 倒计时（票据/grant TTL，复用 `formatGrantTimeRemaining`）；③ 一键复制 §3a 的 `websocat` 隧道命令 + 对应 DB 客户端命令（密码不进命令、由客户端交互式输入）；④ "我已连完/关闭"显式结束（或 TTL 到期自动失效）。
- `LaunchProtocol` 不扩到 db——DB 不是"live 协议"，单独的 `openDbAccess(asset)` 流，避免污染 ssh/guac 的 pane 分支（与阶段 12 option A 的 profile 驱动一致：连接档 protocol=mysql/postgres/redis → 走 DB 流而非 live pane）。
- Audit 表：DB 会话作为审计行出现（has_recording 恒 false，Inspect 不显示——与"RDP 未录时"一致的诚实表现）。

## 3a. 本地接入 = 文档化 `websocat` 一行（13c 决策：选项 a）

不打包自带二进制（ADR 0011：不擅自引入分发/构建产物）。用户用通用工具 `websocat`
把"鉴权 ws 隧道"落成一个本地端口，再用自带 DB 客户端连本地端口。前端"DB
访问"卡渲染下面这套（占位符由卡片用真实值填充；密码不进命令、由客户端交互式
输入或从连接档侧带提示）：

```
# 1) 起本地隧道（前台保持；Ctrl-C 结束。<TICKET> 单用、TTL 内有效）
websocat --binary tcp-listen:127.0.0.1:<LOCAL_PORT> \
  wss://<HOST>/ws/v1/cmdb/assets/<ASSET_ID>/db?ticket=<TICKET>

# 2) 另开一个终端，用自带客户端连本地端口
mysql    -h 127.0.0.1 -P <LOCAL_PORT> -u <USER> -p            # mysql
psql  "host=127.0.0.1 port=<LOCAL_PORT> user=<USER> dbname=<DB>" # postgres
redis-cli -h 127.0.0.1 -p <LOCAL_PORT> [-n <DB_INDEX>]         # redis
```

要点：`--binary` 必须（DB 协议是二进制，与 `bridge` 的 Binary 帧对应）；ticket
单用且 TTL 短，隧道断开即失效，重连需在卡片重新签发；`<LOCAL_PORT>` 由用户自
选未占用端口；postgres `sslmode` 默认按客户端，平台不在隧道内做 TLS 终结（裸 TCP
透传，DB 自身的 TLS 如启用则端到端穿过隧道）。

## 4. 严格不做（定位边界，写进文档防 scope 蔓延）

L1 **只**做"受控建链 + 审计元数据"。**不**做：SQL/命令捕获或过滤、查询结果 Web 台、会话录制/回放、改密计划、审批工作流增强。这些是 L2/L3（JumpServer 式 DB-PAM 支柱），与 `project_positioning`（内部运维控制台、非 PAM）冲突；若将来要做属**产品定位变更**，须先改定位/新 ADR 再立项，不在本规格内。

## 5. 分阶段实施（review 后执行，本阶段不写码）

- **13a · 连接档**（✅ 已实现，commit 待提交）：白名单加 `mysql`/`redis`，默认端口 3306/6379，redis 放宽 username 必填（参照 vnc），password-only。纯增量。
- **13b · 服务端 DB 代理**（✅ 已实现，commit 待提交）：`internal/dbproxy`——ticket 鉴权 ws 端点 + `bastionprobe.ResolveAssetDB`（经 VPC proxy SSH client 或直连）+ ws↔TCP Binary bridge（无 recorder）+ `sessions.Start/End` 审计；`/db/ticket` 与 `/ws/.../db` 路由按 `RequireSessionAuthorization(...,"connect",...)` 门控（与 terminal/rdp 同一鉴权链）。
- **13c · 本地接入**（✅ 决策 a，纯文档，见 §3a）：不打包二进制，文档化 `websocat --binary` 一行 + 各 DB 客户端命令模板，前端卡片渲染。
- **13d · 前端**：DB 资产连接 = "DB 访问"卡（ws 端点+ticket、倒计时、§3a 命令模板一键复制、显式结束），不入 live pane；Audit 行兼容（has_recording 恒 false）。依赖 13b（已就绪）。无活跃并行会话占用 ConnectPage/SessionsPage（已核），冲突顾虑解除。

## 6. 待 review 确认清单

1. 接入架构选 A（ws 桥+本地 helper，推荐）/ B（复用 ssh -L 退化）/ C（跳板监听，不建议）？
2. 本地 helper：自带打包小二进制，还是只文档化 `websocat`/`socat` 一行命令（更轻但依赖用户环境）？
3. 票据/会话 TTL：沿用 60s 票据 + 后续以 grant 有效期为会话窗口，还是 DB 会话引入独立更长 TTL（DB 操作常较长）？这是唯一可能需要的"新策略"，需明确。
4. redis 无库/无用户：连接档 `database` 对 redis 解释为 DB index 还是忽略？
5. 审计行的 bytes 统计是否够（无查询语义，仅字节）——确认 L1 审计粒度可接受、不被误期望为 SQL 审计。
6. 是否确认 L1 严格边界（不录制/不 SQL 过滤/不 Web 台）写入规格即为最终范围，L2/L3 需另立项 + 定位变更。
