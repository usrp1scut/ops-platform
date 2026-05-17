# Testing Guide

这份文档用于帮助开发者判断什么时候写什么测试，以及如何把测试当作理解系统的工具。

## 测试分层

单元测试：

- 放在代码旁边，文件名为 `*_test.go`。
- 适合验证纯逻辑、service 分支、错误处理和边界条件。
- 默认用 `go test ./...` 覆盖。

集成测试：

- 位于 `test/integration/`。
- 适合验证 route、middleware、auth、database、serialization 的完整链路。
- 使用 `integration` build tag，由 `scripts/test-integration.sh` 运行。

架构检查：

- 使用 `scripts/check-deps.sh`。
- 适合防止包依赖方向被破坏。
- 新增严格边界规则时，应同步更新文档和检查脚本。

## 什么时候必须补测试

- 修复一个已经复现的 bug。
- 修改权限、认证、审计或路由挂载。
- 修改数据库 schema、查询条件或事务边界。
- 修改跨模块接口或 DTO。
- 修改 worker 的重试、清理、超时或外部资源释放逻辑。

## 推荐验证顺序

从最小反馈开始：

```bash
go test ./...
go build ./...
bash scripts/check-deps.sh
```

需要数据库完整链路时再运行：

```bash
bash scripts/test-integration.sh
```

## 写测试的思考顺序

1. 这个行为的输入是什么。
2. 期望输出或副作用是什么。
3. 失败时应该返回什么错误。
4. 哪些边界值最容易被忽略。
5. 这个测试未来能防止哪类回归。

## 命名建议

测试名应该描述行为，而不是实现细节：

```go
func TestServiceRejectsProxyRequiredTargetWithoutProxy(t *testing.T) {}
func TestCreateAssetReturnsConflictForDuplicateCloudIdentity(t *testing.T) {}
```

## 学习练习

- 找一个没有测试的错误分支，为它补一个单元测试。
- 找一个已有集成测试，画出它经过的 route、middleware、handler、repository。
- 修复 bug 前先写一个失败测试，再实现修复。

