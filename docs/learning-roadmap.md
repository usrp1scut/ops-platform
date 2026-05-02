# Learning Roadmap

这份路线图用于把 `ops-platform` 当作真实工程项目来学习。学习目标不是记住某段代码，而是逐步理解一个运维平台从接口、数据、权限、同步任务到可维护架构的完整链路。

## Stage 1: 跑起来并理解入口

- 阅读 `README.md`，用 Docker Compose 或本地方式启动项目。
- 找到 API、worker、migration 的入口：`cmd/`。
- 理解配置来自环境变量，特别是数据库、OIDC、AWS sync、probe worker。
- 用浏览器或 API 工具访问 `GET /healthz` 和 portal。

练习：

- 画出从启动 `ops-api` 到注册 HTTP route 的调用路径。
- 找到一个环境变量从读取到使用的完整链路。

## Stage 2: 理解分层和边界

- 阅读 `docs/architecture/maintenance.md`。
- 阅读 `docs/architecture/dependency-graph.md`。
- 对照 `internal/iam`、`internal/cmdb`、`internal/aws`、`internal/awssync` 的职责边界。
- 理解 handler、service、repository 各自应该承担什么。

练习：

- 选一个已有 API，写出请求从 route 到数据库的流程。
- 找一个架构边界规则，解释它防止了什么问题。

## Stage 3: 学会改一个小功能

- 从一个只读 API 或简单字段开始。
- 先定位 model、repository、handler、route、migration 是否都需要改。
- 写最小改动，再运行单元测试。
- 把修改过程写入个人开发日志。

练习：

- 给一个列表接口增加一个非破坏性的查询条件。
- 给一个 response 增加只读字段，并确认旧调用不受影响。

## Stage 4: 学会排错

- 使用 `docs/debugging-playbook.md` 的步骤复现和缩小范围。
- 区分编译错误、运行时错误、数据错误、权限错误和架构边界错误。
- 学会从日志、HTTP status、数据库状态和测试失败信息中建立假设。

练习：

- 人为制造一个权限缺失问题，并追踪它在哪里被拒绝。
- 人为制造一个数据库约束错误，并解释错误如何返回给调用方。

## Stage 5: 学会测试和验证

- 阅读 `docs/testing-guide.md`。
- 默认先补单元测试；跨 route、auth、数据库时考虑集成测试。
- 理解哪些验证可以靠 `go test ./...`，哪些需要 `scripts/test-integration.sh`。

练习：

- 为一个 service 分支补一个单元测试。
- 为一个涉及权限的 API 补一个集成测试。

## Stage 6: 学会写架构决策

- 阅读 `docs/adr/README.md`。
- 使用 `docs/adr/0000-template.md` 记录重要选择。
- 练习描述背景、决策、替代方案和影响。

练习：

- 为一次非平凡重构写一篇 ADR 草稿。
- 找一篇已有 ADR，说明它今天仍然保护了哪些代码边界。

