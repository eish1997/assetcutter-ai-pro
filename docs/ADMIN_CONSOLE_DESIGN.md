# 管理后台（Admin Console）设计与实现说明

> 本文档面向开发者，说明当前批量出图管理后台的目标、信息架构、接口依赖和后续扩展点，方便后续迭代。

## 1. 目标与定位

- **核心痛点**：之前“看不到哪里坏了”，任务是否在跑、是否卡住、失败原因都不直观。
- **管理后台目标（v1）**：
  - 提供 **可观测性**：一眼看到当前批量任务与配额状态。
  - 提供 **可诊断性**：能快速定位到具体任务、状态与错误摘要。
  - 和主界面保持统一的深色视觉风格，仅信息更工程化。
- **非目标（v1）**：
  - 不做复杂的多管理员账号体系（入口仍依赖整站密码门控）。
  - 不暴露所有后端配置，只挑高杠杆的开关在后续版本逐步上线。

## 2. 路由与整体结构

前端使用 Vite + React，无 react-router。`App.tsx` 内根据 `window.location.pathname` 进行简单路由分流：

- **主站**：路径不以 `/admin` 开头时，渲染原有 3D 工具主界面。
- **管理后台**：路径以 `/admin` 开头时，渲染 `AdminAppShell`：
  - 布局组件：`components/admin/AdminLayout.tsx`
  - 子页面：
    - `/admin`：Dashboard 概览（`AdminDashboard`）
    - `/admin/jobs`：任务列表（`AdminJobList`）
    - `/admin/jobs/:id`：任务详情（`AdminJobDetail`）

布局特性：

- 左侧固定侧边栏：标题「AssetCutter 批量出图·管理后台」，菜单「概览 / 任务列表」+「返回主界面」。
- 右侧为内容区，带顶部条 `Admin Console` 标题，整体沿用主站深色玻璃风格。

## 3. 依赖的后端接口与环境变量

管理后台完全复用现有 `server/bulk-image-api.js` 暴露的 HTTP 接口，无需新增后端代码。

### 3.1 环境变量（前后端）

- `.env.local` 示例：

```bash
# 批量出图后端地址（管理后台与前端批量门面共用）
VITE_BULK_IMAGE_API=http://localhost:9002

# 批量出图后端端口（避免与 PORT=9001 的 ai3d 代理冲突）
BULK_IMAGE_PORT=9002

# 可选：任务与 RPD 持久化目录
BULK_IMAGE_DATA_DIR=.\\.data\\bulk-image
```

注意：

- `server/bulk-image-api.js` 端口优先级：`BULK_IMAGE_PORT` > `PORT` > 默认 9002。
- 若不显式设置 `BULK_IMAGE_PORT`，会意外用到 `PORT=9001`（给 ai3d 代理用），导致端口冲突。

### 3.2 后端接口

管理后台目前使用的接口：

- `GET /healthz`
  - 响应：`{ ok, rpdToday, rpdLimit, jobsTotal, jobsPendingOrRunning, inFlight, queueLength }`
  - 用途：Dashboard 顶部 4 个指标卡。
- `GET /jobs`
  - 响应：`BulkImageJob[]`（见下）按 `createdAt` 排序。
  - 用途：Dashboard 最近任务表 / 任务列表页。
- `GET /jobs/:id`
  - 响应：单个 `BulkImageJob`。
  - 用途：任务详情页。
- `POST /jobs/:id/cancel`
  - 响应：取消后的 `BulkImageJob`。
  - 用途：在任务详情中取消 `pending / running` 的任务。

前端通过 `services/adminBulkImageApi.ts` 统一封装这些调用。

### 3.3 Job 类型（前端视角）

在 `types-admin.ts` 中定义：

```ts
export type BulkImageJobStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'partial'
  | 'cancelled';

export interface BulkImageJob {
  id: string;
  instruction: string;
  totalImages: number;
  status: BulkImageJobStatus;
  results: string[];
  createdAt: number;
  updatedAt: number;
  errorSummary?: string;
  imageBase64?: string | null;
  model?: string;
  aspectRatio?: string;
  imageSize?: string;
}

export interface BulkImageHealth {
  ok: boolean;
  rpdToday: number;
  rpdLimit: number;
  jobsTotal: number;
  jobsPendingOrRunning: number;
  inFlight: number;
  queueLength: number;
}
```

## 4. 各页面功能说明

### 4.1 Dashboard（/admin）

目标：**3 秒内看出系统有没有问题**。

- 顶部 4 个统计卡片（来自 `/healthz`）：
  - 今日 RPD：`rpdToday / rpdLimit`
  - 任务总数：`jobsTotal`
  - 进行中任务：`jobsPendingOrRunning`
  - 队列 / 并发：`queueLength / inFlight`
- 最近任务表格（`GET /jobs`，截取最新 20 条）：
  - 列：任务 ID、状态、总张数、已完成数、错误摘要（截断）、创建时间。
  - 行点击跳转 `/admin/jobs/:id`。
- 自动刷新：每 10 秒轮询一次 `/healthz` 与 `/jobs`。

### 4.2 任务列表（/admin/jobs）

目标：**快速筛出“有问题的任务”**。

- 顶部筛选：
  - 状态：全部 / pending / running / completed / failed / partial / cancelled。
  - 搜索：按任务 ID 或指令关键字模糊匹配。
- 表格列：
  - 任务 ID（mono 字体、可点击）
  - 状态（带标签）
  - 总张数
  - 已完成张数（`results.length`）
  - 错误摘要（短文本）
  - 创建时间 / 更新时间
- 自动刷新：每 10 秒轮询 `GET /jobs`。

### 4.3 任务详情（/admin/jobs/:id）

目标：**和用户一起看屏幕时，能一句话解释“哪里坏了”**。

- 头部信息卡：
  - 任务 ID（可复制）
  - 状态标签，`pending / running` 时显示“取消任务”按钮（调用 `POST /jobs/:id/cancel`）。
  - 总张数、已完成张数（`results.length`）、创建时间、最近更新时间。
  - 错误摘要（如有）。
- 参数折叠区：
  - 指令 `instruction`。
  - 模型 `model`。
  - 比例 `aspectRatio`、尺寸 `imageSize`。
- 结果图片区：
  - 提示“已生成图片（X / totalImages）”。
  - 用网格展示 `results` 中的所有图片缩略图。

## 5. 设计决策与取舍

### 5.1 为什么不用 react-router？

- 现有项目没有前端路由栈，主站完全在单个 `App.tsx` 内管理视图状态。
- 为避免大规模改造，仅在 `App` 顶层用 `window.location.pathname` 做一层轻量分流：
  - `/admin*` → 管理后台壳 `AdminAppShell`。
  - 其他路径 → 原有主界面。
- 未来如果引入路由库，可把 Admin 相关组件整体迁移到路由体系下。

### 5.2 为什么管理后台不再做二次密码？

- 全站已经有 `PasswordGate`，受 `VITE_SITE_PASSWORD` 控制。
- 当前使用场景是内部开发/小范围使用，管理员和普通使用者基本一致。
- 为避免重复输入与额外复杂度，管理后台暂时只依赖整站密码门控和“知道 `/admin` 路径”这一约定。
- 如未来开放更大范围使用，可在后端增加真正的 admin token / 角色控制。

## 6. 后续可以做的扩展（按优先级）

### 6.1 P0：提升“看哪里坏了”的效率

- 统一状态颜色映射：
  - `completed` 绿色、`running/pending` 蓝色、`partial` 橙色、`failed` 红色、`cancelled` 灰色。
- 列表与详情中增加「耗时」字段（`updatedAt - createdAt`），方便识别长时间运行的任务。
- 为错误摘要添加 tooltip / 一键复制功能。

### 6.2 P1：轻量监控与日志辅助

- 在 Dashboard 增加最近任务状态分布（例如最近 50 条成功/失败/部分完成数量）。
- 在任务详情页提供“日志搜索语”一键复制，例如：
  - `[job] failed id=<jobId>`
  - 方便在日志系统中直接搜索。

### 6.3 P2：设置页与策略开关

可在 `/admin` 增加「设置」入口，逐步接入以下配置（前端 UI + 后端 env/接口）：

- 容量与限流：
  - 批量并发上限：`BULK_IMAGE_MAX_CONCURRENT`
  - 单任务最大张数：前后端共同限制。
  - 公司级 RPD 限额：`BULK_IMAGE_RPD_DAILY_LIMIT`
  - 单用户每日请求上限：`BULK_IMAGE_PER_USER_DAILY_LIMIT`
  - 是否单用户同时只允许 1 个批量任务：`ONE_BULK_JOB_AT_A_TIME`
- 策略与安全：
  - 是否允许前端自带 Key 覆盖公司 Key。
  - 错误重试策略：是否启用对 429/503 的限次重试。
  - 高队列告警阈值：`BULK_IMAGE_QUEUE_HIGH_WATERMARK`。
  - Dashboard 自动刷新频率（前端配置）。

## 7. 开发与调试步骤（本地）

1. 安装依赖：
   - `npm install`
2. 启动批量后端（确保 `.env.local` 中包含 `BULK_IMAGE_PORT` 与 `VITE_BULK_IMAGE_API`）：
   - `npm run dev:bulk-api`
   - 看到日志：`[bulk-image-api] http://0.0.0.0:9002 (RPD limit: 900, concurrent: 2, ...)`
3. 启动前端：
   - `npm run dev`
   - 默认访问 `http://localhost:3000/`
4. 使用方式：
   - 在主站创建若干“批量出图”任务。
   - 打开 `http://localhost:3000/admin` 查看 Dashboard、任务列表与任务详情。

如需修改管理后台 UI 或功能，主要涉及文件：

- `components/admin/AdminLayout.tsx`
- `components/admin/AdminDashboard.tsx`
- `components/admin/AdminJobList.tsx`
- `components/admin/AdminJobDetail.tsx`
- `services/adminBulkImageApi.ts`
- `types-admin.ts`
- `App.tsx`（仅路由分流逻辑）

