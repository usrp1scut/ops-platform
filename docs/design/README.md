# Design Docs

`docs/design/` 只保留当前仍会指导实现的设计资料；已完成使命但仍有追溯价值的材料放入 `archive/`。

## 当前有效

- `ops-platform-v0.3.md`：产品与领域基线，供 README / ADR 引用。
- `refactor-progress.md`：方案 A（Operate / Inventory / Govern）当前实施记录。
- `iam-matrix-spec.md`：IAM capability matrix 与 scope / resolver 设计依据。
- `rdp-recording-spec.md`：RDP 录制 / 回放设计，仍保留尚未实施的 10d 取舍。

## 历史归档

- `../archive/design/frontend-refactor-v2.md`：已完成的 React/Vite 迁移计划。
- `../archive/design/frontend-migration-inventory.md`：迁移前的 legacy portal 基线盘点。
- `../archive/design/claude-design-review/`：2026-05-16 方案 A 设计评审输入、14 页评审稿与截图证据。

读取顺序建议：

1. 先读 `ops-platform-v0.3.md` 理解产品本意。
2. 再读 `refactor-progress.md` 了解当前已经落地到哪里。
3. 需要理解专题决策时，再进入 IAM / RDP 专题规格。
4. 只有在追溯历史方案或 review 过程时，才进入 `../archive/design/`。
