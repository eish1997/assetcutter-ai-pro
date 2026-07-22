# Copilot 功能偏好与长期工作形态

**版本**：v0.1  
**日期**：2026-07-22  
**状态**：产品偏好稿，用于指导长期可用的 Copilot 体验  
**外部参照校准**：2026-07-22，基于 OpenAI 官方 ChatGPT / ChatGPT Work / Workspace Agents / Apps / Projects / Tasks / Skills / Canvas 文档  
**关联总纲**：[`docs/Copilot商业化产品架构.md`](./Copilot商业化产品架构.md)

## 0. 写作目的

这份文档不是架构总图，也不是开发任务拆解。

它回答一个更产品化的问题：

> **如果 Copilot 要像成熟的长期工作产品一样被团队每天使用，它应该偏好什么功能形态？**

参考 ChatGPT 的长期工作形态后，我们不要照抄功能名，而要吸收它背后的产品语法：

- 有长期工作容器，而不是只有一次性聊天。
- 有能持续数小时推进目标的 Work / Agent 形态，而不是只回答问题。
- 有项目内记忆和资料，而不是每轮重新解释。
- 有用户/团队偏好，而不是每次重复要求。
- 有连接器和工具权限，而不是孤立对话。
- 有长任务报告和可验证来源，而不是只给一句总结。
- 有计划、进度、暂停、恢复，而不是黑盒执行。
- 有定时/监控型任务，而不是只能被动响应。
- 有可复用 Skills / Workspace Agents，把团队最佳实践沉淀为共享能力。
- 有本地执行和云端任务的权限边界，而不是一把梭。

---

## 1. ChatGPT 目标功能语法对 Copilot 的启发

| ChatGPT 形态 | 产品含义 | Copilot 应吸收什么 |
| --- | --- | --- |
| ChatGPT Work | 能跨应用、文件和流程行动，长时间拆解并完成目标 | Copilot 的目标也应从“回答”升级为“把工作台目标推进到可验收产物” |
| Workspace Agents | 团队可创建、共享、治理的长期 Agent，面向重复流程 | Copilot 后续要支持把成熟工作流沉淀为团队能力，而不是让每个人重复提示 |
| Projects | 一个长期工作容器，保存相关聊天、文件和上下文 | Copilot 要围绕团队、项目、资产和工作流组织任务，而不是只围绕会话 |
| Project memory | 项目内记忆，不忘记项目里发生过什么 | Copilot 要记住项目状态、最近任务、产物、失败和已确认规则 |
| Save to project | 把有价值回答保存成可复用项目资料 | Copilot 要能把决策、流程、成功参数、工作流草稿沉淀成资产 |
| Custom instructions | 用户长期偏好，可编辑、可删除、未来生效 | Copilot 要有团队/用户/项目偏好，并且可见、可改、可撤回 |
| Apps / Plugins | 连接外部数据和动作，受安装、权限和角色控制 | Copilot 的工作台、Script Hub、MCP、外部 Agent 都要变成受控能力 |
| MCP apps / Developer mode | 企业可以把内部工具做成可测试、可发布、可 RBAC 管理的 MCP 能力 | 工作台 MCP 必须成为标准控制层，支持测试、发布、权限、审计和外部 Agent 调用 |
| Skills | 把重复做法变成可共享、可稳定复用的流程 | 管理员/工作流研发人员应能把成功流程保存为 skill / workflow draft，再发布给团队 |
| Canvas | 当工作对象需要编辑、版本、预览和导出时，聊天旁边出现专门工作面 | Copilot 不应把复杂产物塞进气泡，应把资产、报告、工作流草稿交给工作台或专门面板承载 |
| Deep research | 先计划，再执行长任务，最后交付可验证报告 | Copilot 的长任务要有计划、进度、证据、引用、产物和复用出口 |
| Scheduled tasks | 周期性提醒、简报、监控；可暂停和恢复 | Copilot 后续要支持项目监控、用量日报、失败巡检、工作流健康检查 |
| Codex Local / Cloud | 本地执行和云端委托分开受工作区权限管理 | Copilot 要区分本地 Agent 执行、云端任务、工作台动作和高风险授权 |

这张表的结论是：

> **ChatGPT 的目标功能正在从“聊天入口”走向“长期工作系统”：有工作容器、有 Agent、有工具连接、有团队共享、有权限治理、有进度和证据。**

Copilot 应该吸收这套形态，但落到我们的北极星上：

> **Copilot 是团队进入工作台的统一 Agent 入口，不是另一个网页聊天机器人。**

---

## 2. Copilot 的七个功能偏好

### 2.1 偏好“工作容器”，不偏好“裸聊天”

Copilot 的默认对象应该是：

- 团队
- 项目
- 资产
- 能力
- 工作流
- 任务
- 审计证据

聊天只是入口，不是主对象。

产品偏好：

| 应该 | 不应该 |
| --- | --- |
| 进入 Copilot 后知道当前团队、项目、资产和能力状态 | 只显示一个空聊天框 |
| 任务和产物能回到项目 | 结果只留在聊天气泡里 |
| 可把一次成功流程沉淀为预设/草稿/知识 | 每次都重新描述流程 |

### 2.2 偏好“项目内记忆”，不偏好“全局乱记”

Copilot 要记住，但不能乱记。

建议分四类：

| 记忆类型 | 范围 | 示例 | 写入规则 |
| --- | --- | --- | --- |
| Session memory | 当前任务 | 本轮做了什么、调用了哪些工具 | 自动 |
| Project memory | 当前项目 | 项目风格、资产关系、成功参数 | 轻确认 |
| Team memory | 团队规则 | 默认能力、禁用动作、发布要求 | 管理员确认 |
| Personal preference | 个人偏好 | 展示密度、语言风格、常用动作 | 用户可编辑 |

必须提供：

- 查看
- 修改
- 删除
- 禁用参与上下文
- 来源追溯

默认禁止：

- 把一次临时反馈自动升级成团队规则。
- 把一个项目里的记忆带到其它项目。
- 把凭据、Cookie、Token、完整 Prompt 明文写进记忆。

### 2.3 偏好“可保存的工作成果”，不偏好“气泡里的灵感”

Copilot 产生的有价值内容应该有保存出口。

可保存对象：

| 对象 | 保存到哪里 |
| --- | --- |
| 决策摘要 | 项目知识 / 任务记录 |
| 成功参数 | 预设 metadata |
| 可复用流程 | workflow draft |
| 工具调用证据 | audit / tool execution |
| 产物 | 工作台资产库 |
| 失败恢复经验 | 错误映射 / 运维知识 |

偏好规则：

- 成功结果优先入库，再显示摘要。
- 长任务必须生成可复用报告或任务记录。
- 工作流研发成果先存草稿，再预检发布。

### 2.4 偏好“受控连接器”，不偏好“随便调工具”

Copilot 的工具能力要像 ChatGPT Apps/Plugins 那样被发现、启用、授权和治理。

在我们这里，对应为：

| 连接对象 | Copilot 形态 |
| --- | --- |
| 工作台 | `ac.workbench.*` |
| Script Hub | `ac.script_hub.*` |
| 本地伴侣能力 | `ac.companion.*` |
| 本地壳 | `ac.shell.*` |
| 外部 Agent | Body MCP |
| 工作流草稿/发布 | `ac.skills.*`、`ac.workflow.*` |
| 用量治理 | `ac.usage.*` |

每个工具必须有：

- 名称
- 用途
- 输入 schema
- 风险等级
- 所属 surface
- 权限策略
- 审计摘要
- 失败恢复建议

普通成员不看工具目录；管理员和外部 Agent 才看。

### 2.5 偏好“长任务计划”，不偏好“黑盒等待”

凡是超过几秒的任务，都应该进入长任务形态。

长任务结构：

```text
目标
  -> 计划
  -> 数据/资产来源
  -> 执行步骤
  -> 进度
  -> 中断/调整
  -> 结果
  -> 引用/证据
  -> 可保存出口
```

用于：

- 工作台能力链路验收
- 批量资产处理
- 工作流预检
- 用量审计
- 供应商/模型健康检查
- 项目总结和交付报告

交互偏好：

- 执行前给简短计划。
- 执行中显示当前步骤。
- 用户可中断、补充、缩小范围。
- 完成后给结果卡片，而不是只给日志。
- 详情默认折叠，但可追溯。

### 2.6 偏好“主动监控”，不偏好“只等用户问”

成熟商业化 Copilot 不应该只响应输入，还应该能做低频主动工作。

第一阶段可以先不实现完整自动化，但文档和架构要预留：

| 监控任务 | 触发 |
| --- | --- |
| 工作台登录态失效 | 定期检查 |
| 用量接近配额 | 每日/每小时 |
| 工作流发布预检失败 | 草稿更新后 |
| 供应商模型不可用 | 健康检查 |
| 项目长期无产物 | 项目巡检 |
| 失败任务未恢复 | 任务队列巡检 |

偏好规则：

- 监控默认通知，不默认执行高风险动作。
- 监控任务可暂停、恢复、删除。
- 监控结果要落到任务记录，不只弹 toast。

### 2.7 偏好“本地/云端权限分离”，不偏好“一套权限管所有”

Codex 的启发是：本地执行、云端任务、远程控制、工作区权限要分开看。

Copilot 也要区分：

| 执行面 | 风险 | 权限口径 |
| --- | --- | --- |
| 本地壳 UI 动作 | 中 | 用户授权 + 壳策略 |
| 本地文件/命令 | 高 | Codex / sandbox / confirm-risk |
| 工作台 API | 中 | 团队登录 + 项目权限 |
| Script Hub 工具 | 中高 | 工具白名单 + sandbox |
| 云端用量上传 | 中 | 团队登录 + 管理策略 |
| 工作流发布 | 高 | 管理员确认 + 审计证据 |

普通成员只看到“需要授权 / 已授权 / 管理员限制”。  
- 工程和管理员才看到细分权限。

---

## 3. 长时间工作的产品结构

Copilot 应该有五个长期工作对象。

### 3.1 Project Workspace

项目工作容器。

承载：

- 项目上下文
- 资产引用
- 最近任务
- 产物
- 项目记忆
- 工作流草稿

偏好：

- 用户进项目后，Copilot 自动知道当前上下文。
- 项目内任务能恢复。
- 项目内结论可保存为 source。

### 3.2 Task Thread

任务线程。

不是普通聊天线程，而是围绕一个可完成目标组织：

```text
目标 -> 计划 -> 工具调用 -> 结果 -> 下一步 -> 审计
```

状态：

- draft
- queued
- running
- waiting_confirm
- succeeded
- failed
- cancelled
- archived

### 3.3 Memory Source

可解释记忆来源。

类型：

- 用户偏好
- 团队规则
- 项目知识
- 成功流程
- 失败恢复
- 工作流发布记录

每条都必须带：

- 来源
- 范围
- 更新时间
- 谁确认
- 是否参与上下文

### 3.4 Capability Source

能力来源。

包括：

- 工作台预设
- Script Hub 工具
- Body MCP 工具
- 外部 Agent 草稿
- 管理员发布的团队工作流

偏好：

- 能力像“可安装/可启用/可禁用/可审计”的产品资产。
- 普通用户看到任务入口，不看到工具 schema。

### 3.5 Evidence Source

证据来源。

包括：

- 工具调用审计
- 用量汇总
- 工作流预检结果
- 登录态诊断
- 失败恢复记录
- 产物 id / job id / project id

偏好：

- 管理员能查证据。
- 外部 Agent 能读机器可读状态。
- 普通用户只看可读摘要。

---

## 4. Copilot 主界面偏好

### 4.1 首屏

首屏不应是配置页。

首屏应包含：

1. 团队入口状态。
2. 当前上下文。
3. 可开始的任务。
4. 最近结果或阻塞恢复。
5. 输入框。

推荐结构：

```text
顶部：团队 / 工作台 / Agent / 治理状态
中部：当前项目和最近产物
中部：快捷任务
底部：一句话输入
详情：折叠的工具、日志、配置
```

### 4.2 空状态

空状态不是欢迎语。

应该是：

- 创建或打开项目
- 运行一个预设能力
- 查看最近资产
- 验收工作台链路
- 检查团队入口状态

### 4.3 任务消息

消息应该分四类：

| 类型 | 默认展示 |
| --- | --- |
| 用户目标 | 原话 + 引用对象 |
| Copilot 计划 | 简短步骤 |
| 执行进度 | 当前步骤 + 可取消 |
| 结果卡片 | 产物 + 下一步动作 |

默认不展示：

- 大段 JSON
- MCP 工具 schema
- 原始错误堆栈
- 模型完整思考过程

### 4.4 失败消息

失败消息必须包含：

1. 发生了什么。
2. 影响什么。
3. 推荐恢复动作。
4. 可展开详情。

示例：

```text
工作台还没有登录，所以 Copilot 暂时不能创建项目。
[打开工作台登录] [登录后验收] [查看诊断]
```

---

## 5. 设置页偏好

设置页不是产品主入口。

设置页只服务三类人：

- 管理员
- 工程/运维
- 工作流研发人员

偏好：

| 设置内容 | 默认 |
| --- | --- |
| 账号状态 | 展示 |
| Codex / Hermes 状态 | 摘要展示 |
| MCP Token / JSON | 折叠 |
| 工具目录 | 折叠 |
| Workflow 预检 | 管理员区 |
| 用量治理 | 管理员区 |
| 原始日志 | 折叠 |

设置页不应该承载普通用户完成任务。

---

## 6. 功能优先级

### P0：长期工作最小可用

- 团队入口状态
- 当前项目上下文
- 快捷任务
- 一句话跑通工作台链路
- 结果卡片
- 失败恢复动作
- 任务记录

### P1：可持续使用

- 项目内记忆
- 可保存决策/流程/参数
- 长任务计划和进度
- 用量摘要
- 审计详情
- 管理员权限模板

### P2：主动和协作

- 定时/监控任务
- 团队工作流发布
- 工作流使用反馈
- 跨项目偏好
- 外部 Agent 研发流程上传

### P3：商业化运营

- 套餐和配额
- 团队能力库
- 成本分析
- 风险报表
- 能力市场

---

## 7. 下一步落地建议

下一步不要继续扩大架构文档，而是按这份偏好实现一个首屏闭环：

> **Copilot 长期工作首屏 MVP**

包含：

1. 顶部状态：账号 / 工作台 / Agent / 治理。
2. 当前上下文：项目、资产、最近任务。
3. 快捷任务：创建项目、运行能力、看资产、验收链路。
4. 任务线程：目标、计划、进度、结果、恢复。
5. 保存出口：结果入资产库，成功流程可保存为草稿。

验收句：

> 用户连续工作一小时后，Copilot 仍知道当前项目、刚才做过什么、哪些产物可继续处理、哪些失败可恢复，而不是像一个刚打开的新聊天框。

---

## 8. 参考来源

- OpenAI：ChatGPT Work for every team  
  https://openai.com/chatgpt-work/
- OpenAI：ChatGPT is now a partner for your most ambitious work  
  https://openai.com/index/chatgpt-for-your-most-ambitious-work/
- OpenAI Academy：Workspace agents  
  https://openai.com/academy/workspace-agents/
- OpenAI Academy：Using skills  
  https://openai.com/academy/skills/
- OpenAI：Introducing canvas  
  https://openai.com/index/introducing-canvas/
- OpenAI Help Center：ChatGPT Release Notes  
  https://help.openai.com/en/articles/6825453-chatgpt-release-notes
- OpenAI Help Center：Projects in ChatGPT  
  https://help.openai.com/en/articles/10169521-projects-in-chatgpt
- OpenAI Help Center：ChatGPT Custom Instructions  
  https://help.openai.com/en/articles/8096356-chatgpt-custom-instructions
- OpenAI Help Center：Apps in ChatGPT  
  https://help.openai.com/en/articles/11487775-connectors-in-chatgpt
- OpenAI Help Center：Deep research in ChatGPT  
  https://help.openai.com/en/articles/10500283-deep-research-in-chatgpt
- OpenAI Help Center：Scheduled Tasks in ChatGPT  
  https://help.openai.com/en/articles/10291617-tasks-in-chatgpt
- OpenAI Help Center：Using Codex with your ChatGPT plan  
  https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan
