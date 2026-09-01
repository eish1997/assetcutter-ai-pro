# D8 / D7 验收记录

**日期**：2026-08-26  
**自动化**：`npx vitest run tests/workshopGenerationRemap.test.ts tests/workshopFileTreeHost.test.ts tests/workshopFolderSource.test.ts`

## D8 手测清单（壳内 + 已开文件夹）

| # | 场景 | 期望 | 自动化/人工 | 结果 |
|---|------|------|-------------|------|
| 1 | 空目录 + 对话文生图 | 占位卡 → 磁盘包 + 有图 | 人工 | 待签字 |
| 2 | 散文件 loose 第一次出图 | upgradeLoose 成包 | host 测试覆盖 upgradeLoose | 自动通过 |
| 3 | 包内再出图 | manifest 新 fileId | host 测试覆盖 writeResult | 自动通过 |
| 4 | 预设拖放文生图（选中卡） | wspkg 落盘 | remap 单测 + 人工 | 人工待签字 |
| 5 | 灯箱 / 生成输入 | 读源文件 | 人工 | 待签字 |
| 6 | 多根 + 同名 rel | 不串库 | host 测试覆盖双 root | 自动通过 |
| 7 | 载入即画布 | 不进项目页 | 代码已 guard | 人工回归待签字 |
| 8 | 左树默认「浏览器资产」 | 列出项目卡；本机文件夹用「+」另加；该夹内生成不 remap 磁盘 | 单测 + 人工 | 待签字 |
| 9 | 指定库目录 | `library.json` 记下已挂根；未指库不能「+」；AppData 只留指针 | host 测试 + 人工 | 待签字 |
| 10 | 删除进库回收站 | 删卡进 `{库}/recycle/`，左树出现「回收站」与浏览器资产同级；不在素材根建 `.ac-recycle` | host 测试 + 人工 | 待签字 |

## D7 无 Node 装包

| 项 | 路径/说明 | 结果 |
|---|-----------|------|
| 安装包 | `companion-desktop/dist-out-0212/installer/AssetCutterCompanion-0.2.12-20260826-203938-x64.exe` | 已打出 |
| 验收 ZIP | `AssetCutterCompanion-0.2.12-clean-machine-acceptance.zip` | 已打出 |
| 无 Node 手测 | 包内 `README-clean-machine.txt` | **待人工** |

## D6 壳侧隔间（本轮回代码）

- 文件夹已添加时：`workspace_read_document` 不再投影作坊 `assetIds`
- dsh 注入：`workshop=folder:<root>/<rel>`
- 网页 hydrate 在壳侧短路（`skippedAssets: true`）
- 作坊 `upsert_asset` / `remove_asset` dispatch 在文件夹真源时 skip
- 工作台仅转发 `finger.changed`（文件夹真源模式）
