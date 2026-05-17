# Documentation Map

`docs/` 按四层组织。先沿任务找入口，再进入专题细节；这样读者不会先掉进历史材料里。

## 1. 入门

适合第一次接触项目，或想把项目当作学习样本来读的人。

- `learning/learning-roadmap.md`：建议阅读顺序与练习路线。
- `learning/debugging-playbook.md`：排错方法。
- `learning/testing-guide.md`：测试分层与验证顺序。
- `learning/dev-journal-template.md`：复盘模板。

## 2. 架构维护

适合准备改代码、加模块、守边界的人。

- `architecture/overview.md`：整体结构速览。
- `architecture/maintenance.md`：新增功能时该放哪里、怎么扩展。
- `architecture/dependency-graph.md`：当前依赖关系与严格边界。

## 3. 决策记录

适合理解“为什么这样设计”。

- `adr/`：不可轻易改写的架构决策记录。
- `design/`：仍在指导当前实现的产品 / 专题设计资料。
  - 入口见 `design/README.md`。

## 4. 历史归档

适合追溯已经完成使命、但仍有证据价值的材料。

- `archive/design/`：旧迁移计划、迁移基线、设计评审输入与截图证据。

## 推荐路径

- 想快速读懂项目：`README.md` → `learning/learning-roadmap.md` → `architecture/overview.md`
- 准备开始改代码：`architecture/maintenance.md` → `architecture/dependency-graph.md`
- 需要理解边界由来：`adr/README.md`
- 需要理解当前产品方向：`design/README.md`
