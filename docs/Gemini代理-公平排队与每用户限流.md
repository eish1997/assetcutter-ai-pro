# Gemini / Vertex 代理：公平排队与每用户限流（开发规格）

本文档描述在 **单 GCP 项目、单 Vertex 凭证** 前提下，为 `server/ai-worker-proxy-api.js` 及调用链增加的 **公平排队** 与 **每用户限流** 的设计目标、行为规格与落地清单。**实现前以本文为准；实现后应同步更新环境变量表与健康检查字段。**

> **2026-07-25（C12 / D9）**：工作流客户端 **不再** HTTP coalesce 调用 `POST /proxy/gemini/async-batch`；**用户生图 / 理解 / 检测主路走 AI Gateway Jobs**（`runUnifiedImageGeneration` 等）。  
> 服务端 `POST /proxy/gemini/async-batch` 默认 **410 Gone**；仅运维显式 `AI_WORKER_PROXY_ASYNC_BATCH_ENABLED=true` 时内部可用（**误开会绕过「用户图必须 Jobs」叙事，禁止当预发路径**）。  
> **现行验收以** [`AI-Gateway优化清单-D轮-验收即线上.md`](./AI-Gateway优化清单-D轮-验收即线上.md) **§5 为准**。下文 §5～§6、§12、§15 中「客户端 async-batch」段落均为 **历史规格存档**，勿照做联调。

相关文档：

- [Vertex AI 接入说明](./VERTEX_AI_INTEGRATION.md)（`aiBackend: "vertex"`、ADC、前端 `VITE_AI_WORKER_PROXY_API` / `VITE_AI_WORKER_PROXY_API_VERTEX`）
- Google：**[Standard PayGo 与用量档位（TPM）](https://cloud.google.com/vertex-ai/generative-ai/docs/dynamic-shared-quota)**、**[Throughput quota / 动态共享池](https://cloud.google.com/vertex-ai/generative-ai/docs/resources/throughput-quota)**、**[Generative AI quotas](https://cloud.google.com/vertex-ai/generative-ai/docs/quotas)**、**[Vertex AI quotas](https://cloud.google.com/vertex-ai/docs/quotas)**

### 全链路速查（实现后）

| 位置 | 职责 |
| --- | --- |
| **浏览器** | `geminiFairnessBridge` 登录头；**`throwFairnessRejected`** → **`ac:ai-worker-proxy-fairness-rejected`**；**`traceUnifiedAiCall`**（`workflow*`）对其它限流/繁忙节流派发 **`ac:unified-ai-soft-notice`**；**`GeminiFairnessFloatingNotice`** 统一顶栏展示。 |
| **ai-worker-proxy 进程** | **`server/ai-worker-proxy-fairness.js`** 准入与队列；**`server/ai-worker-proxy-api.js`** 挂接 async / generate-content（**async-batch 默认关闭**）；**`/healthz.fairness`** 可观测。 |
| **运维数值** | 默认磁盘 **`server/data/gemini-fairness-config.json`**（或 **`GEMINI_FAIRNESS_CONFIG_PATH`**）；代理约 **3s** 重读；**auth-api** **`GET` / `PUT` / `DELETE`** **`/api/admin/gemini-fairness-config`**（**DELETE** 清空为 `{}`）与站点 **`/admin/gemini-fairness`**（**PUT 与已有键合并**、**清空磁盘覆盖**按钮）。 |
| **总开关 / 密钥** | 仍以环境变量为准（**`GEMINI_FAIRNESS_ENABLED`**、HMAC、**`GEMINI_FAIRNESS_TRUST_CLIENT_KEY_HEADER`** 等）；磁盘只覆盖数值型旋钮。 |

**术语（文中简称）**

| 术语 | 含义 |
| --- | --- |
| **Fairness key** | 限流与公平排队使用的逻辑主体标识（如 `user:<id>`、`anon:<ip>`、`service:<name>`）。 |
| **全局槽** | 全站同时占用、正在执行上游 `generateContent` 的槽位数（与现有 `withAiWorkerProxySlot` / `AI_WORKER_ASYNC_PROXY_MAX_CONCURRENT` 语义一致）。 |
| **排队深度** | 某 fairness key 已入队、尚未进入 `running` 的任务数量（含 `pending` / `queued` 等未执行态）。 |

**文档维护**：规格在代码中稳定落地后，可将 **§0** 压缩为简短「背景摘要」或移至文末附录，减少长期维护中的会话口吻。

---

## 0. 会话脉络与结论摘要（给接手人）

以下为本话题多轮讨论后的**共识结论**，便于与下文规格对照阅读。

| 话题 | 结论 |
| --- | --- |
| **为何失败变多** | 全站共用 **同一 Vertex 项目**；Google 侧除档位 TPM 外还有 **动态共享池**，高峰易 **429**；**秒级尖峰**易触发限流。代理仅有 **全局并发** 时，**无法防止单用户霸占**队列与槽位。 |
| **解决思路（比喻）** | 像 **一个银行柜台（Vertex）**：要有 **全站同时办事人数上限**，还要有 **每人限拿号、限排队长度、限每分钟取号**，以及 **多条队伍轮流叫号（公平队列）**，避免一人长队堵死众人。 |
| **与 Google 配额的关系** | 应用层排队 **不增加** GCP 配额，只能 **摊平尖峰、改善公平**；仍可能需 **控制台提额 / Provisioned Throughput**。 |
| **推荐起步参数** | 全站并发 **4**；登录用户每 key：**并发 2、排队深度 5、提交 30/分钟**；匿名桶：**1 / 2 / 10**；全站排队硬顶 **500**（**唯一参数表：§14**）。 |
| **管理员界面** | 把上述「旋钮」做到 **管理员页** 属于 **运维自助调参**（容量与稳定性），合理；**密钥、HMAC、GCP 凭证** 仍宜 **环境变量 / Secret**，界面可编辑的数值须有 **服务端 clamp 与权限**。 |

---

## 1. 背景与目标

### 1.1 问题

- 全站用户共用 **同一 Vertex 项目** 时，Google 侧为 **组织级 TPM 基线 + 动态共享池**；高峰会出现 **429 / RESOURCE_EXHAUSTED**，且官方说明 **秒级尖峰** 易触发限流（即使分钟均值不高）。
- 代理侧若仅有 **全局并发上限**（如现有 `AI_WORKER_ASYNC_PROXY_MAX_CONCURRENT`），**无法防止单用户**占用过多排队资源或并发槽，导致 **多数用户饥饿**。

### 1.2 目标（可验收）

| 编号 | 目标 | 验收要点 |
| --- | --- | --- |
| G1 | **保护 Vertex**：控制同时发往 Google 的请求数，降低 429 与长尾失败 | 可调的全局并发；与现有退避重试兼容 |
| G2 | **用户间公平**：单用户无法长期独占「排队 + 运行」资源 | 每用户并发上限 + 公平调度策略 |
| G3 | **可解释**：用户侧能区分「排队中」「系统繁忙请稍后」「自身触发过频」 | 明确 HTTP 状态、错误码或 job `status` 文案 |
| G4 | **可观测**：运维能看队列深度、按用户拒绝/等待次数 | 日志字段 + `/healthz` 或监控指标 |
| G5 | **路径一致**：异步、批量异步、同步 Vertex **同一套准入规则**（或文档写明例外及风险） | 无「仅异步限流、同步绕过」的漏洞 |

### 1.3 非目标（本期可不实现）

- 替代 Google **配额申请 / Provisioned Throughput**（仍可能需商务与控制台提额）。
- 多 GCP 项目 **分片路由**（可作为后续扩展，本文仅预留「限流键」可带 `shard` 字段）。

---

## 2. 与 Google 限流的关系（设计假设）

- **应用层限流不增加 Vertex 配额**：只能减少尖峰、改善公平性；**不能**把 Google 的 TPM/RPM 上限「变大」。
- **429 仍可能出现**：实现后应保留对上游的 **指数退避重试**（现有 `isRetryable` 逻辑）；公平队列主要降低 **自激** 与 **单用户霸占**。
- **流量形态**：调度器应尽量 **把取号出队摊平到分钟内**（与官方「避免秒级尖峰」一致）。

### 2.1 Google / Vertex 侧「有几类限制」（对话归纳）

以下为 **Vertex 上在线 Gemini（Standard PayGo 等）** 常见维度，**具体数值以 GCP 控制台与官方表格为准**（会随档位、模型、区域变化）。

| 类型 | 含义（大白话） | 备注 |
| --- | --- | --- |
| **组织级 TPM 基线** | 过去 30 天消费决定档位，给 **每分钟 token 吞吐** 的「地板」预期 | [Standard PayGo](https://cloud.google.com/vertex-ai/generative-ai/docs/dynamic-shared-quota)；**Pro 与 Flash 系表不同**；常 **按模型分别计量**。 |
| **突发（burst）** | 允许短时间 **超过基线多跑一点**，平台忙时最不稳定 | 易伴随 429。 |
| **RPM / 请求类系统上限** | 除 TPM 外，还有 **每模型、每区域** 的请求频率上限量级（文档引用约 **3 万 RPM** 级） | 见 Standard PayGo 页面对 [Vertex quotas](https://cloud.google.com/vertex-ai/docs/quotas) 的引用；**以控制台为准**。 |
| **动态共享池** | 多人共用池子，瞬时挤爆会出现 **429 / RESOURCE_EXHAUSTED**，**不等于「你固定配额用完了」** | [Throughput quota](https://cloud.google.com/vertex-ai/generative-ai/docs/resources/throughput-quota) |
| **秒级形状** | **同一分钟内若集中在几秒打满**，易限流，**平均每分钟不高也可能 429** | 官方明确建议 **摊平**；与本文公平队列目标一致。 |
| **预览模型** | Standard PayGo **用量档位不适用于 preview** | 以各模型文档为准。 |
| **其它产品线** | Embedding、Agent Engine、RAG、Batch 等在 [Generative AI quotas](https://cloud.google.com/vertex-ai/generative-ai/docs/quotas) 有 **很具体的 RPM/并发表** | 与纯在线生图主路径可能无关，排查时要区分 API。 |
| **预留吞吐** | **Provisioned Throughput**：花钱买 **固定容量**，逻辑不同于共享池 | 大客/稳定 SLA 路线。 |

**与本文推荐参数的关系**：下文应用侧 **每用户 30/分钟、全站并发 4** 等，在数量级上 **通常远小于** Google 表上的 RPM/TPM；目的是 **自控尖峰与公平**，而非「贴齐 Google 每一行」。

---

## 3. 现状摘要（实现前代码事实）

| 组件 | 行为 |
| --- | --- |
| `server/ai-worker-proxy-api.js` | 异步单任务 / 批量异步在真正调用前使用 **`withAiWorkerProxySlot`**，全局并发由 **`AI_WORKER_ASYNC_PROXY_MAX_CONCURRENT`**（生产默认 2，本地/测试默认 4）控制；**同步** `POST /proxy/gemini/generate-content` 在 Vertex 路径上 **不经过** 该槽（若不做改造则存在绕过风险）。 |
| `services/geminiService.ts` | 对代理发起 `POST /proxy/gemini/async`、`async-batch`；Vertex 时 body 带 **`aiBackend: "vertex"`**。 |
| 试用额度 | **`consumeTrialGeminiSlotBeforeProxyOrThrow`**（经 **auth-api** 扣日配额）与 Vertex **正交**；Vertex 全站公平队列 **不能** 替代试用配额，二者叠加。 |

### 3.1 部署假设：单副本与多副本

内存中的 **每 key 计数器、子队列、round-robin 状态** 仅在 **单进程、单副本** 下与文档语义一致。

| 部署形态 | 行为 | 建议 |
| --- | --- | --- |
| **单实例** `ai-worker-proxy` | 本文所述公平队列与每用户限流 **可直接实现**。 | MVP / 中小流量默认。 |
| **多实例**（多 Pod / 多进程负载均衡） | 各实例内存 **不共享**，总和限流失效；公平性 **仅在单实例内** 成立。 | 必须其一：**Redis（或等价）集中计数与队列**；**API 网关统一限流**（按 key）；**Ingress 会话粘滞**（仅缓解，换实例仍漂移）；或 **明确文档化「仅单副本」** 并在编排上锁副本数为 1。 |

**实现清单**：若目标为生产多副本，将 **「集中式存储或网关限流」** 列为独立里程碑，避免先做满内存队列再推倒重来。

---

## 4. 身份与限流键（Fairness Key）

### 4.1 原则

- **限流键必须服务端可信**：禁止仅信任浏览器 body 中的「用户 ID」字符串；须由 **已鉴权服务** 签发或转发。
- **推荐**：主站或 **auth-api** 在代表用户调用代理时，注入 **`Authorization: Bearer <session>`** 或由网关添加 **`X-AC-User-Id`**（仅内网可达代理时可用固定 HMAC 头，避免伪造）。

### 4.2 键的取值策略

| 用户类型 | 限流键建议 | 说明 |
| --- | --- | --- |
| 已登录 | `user:<stableUserId>` | 稳定 ID 来自会话/JWT `sub`，与业务用户表主键一致最佳 |
| 未登录 / 仅前端匿名 | `anon:<ip>` 或 `anon:<ip>:<fingerprint>` | NAT 下同 IP 多用户会 **共桶**；可接受或要求登录后使用 Vertex |
| 内部批任务 / 系统账号 | `service:<jobName>` | 单独桶，避免与 C 端抢同一默认上限 |
| 多租户（若有 org） | `org:<orgId>` 或 `user:<uid>` 二级 | **组织级预算**：同一 org 下用户共享子桶；实现复杂度更高，可二期 |

**默认策略（建议写死为产品规则）**：

- **Vertex 路径**：若无可信 `userId`，则落入 **`anon:<ip>`** 桶，且 **anon 桶的 RPM/并发/队列深度** 显著低于登录用户（防刷）。
- **试用路径**（`aiBackend` 缺省或显式非 vertex）：继续走现有试用配额；可选是否与 Vertex 共用「代理内公平队列」——**推荐共用全局槽**、**分桶策略可不同**（试用更严）。

### 4.3 可信客户端 IP（anon 桶）

`anon:<ip>` 依赖 **真实客户端 IP**。代理在 **CDN / 七层 LB** 之后时，禁止直接使用 `socket.remoteAddress` 作为公网用户 IP。

- **推荐**：由 **BFF / 网关**（已校验会话或已做 WAF）解析 `X-Forwarded-For` 等，向代理传入 **`X-AC-Client-Ip`**（单 IPv4/v6 或规范化字符串），代理 **仅信任** 来自内网或带 HMAC 的该头。
- **若必须由代理解析 `X-Forwarded-For`**：须配置 **可信跳数**（trusted hops）或 **允许代理 IP 列表**，取 **最左或最右一跳** 的策略写死在文档与代码中，与基础设施一致。
- **IPv6**：与 IPv4 同一套桶规则；注意压缩格式规范化，避免同一用户因字符串形式不同落入多桶。

### 4.4 Fairness key 形态与安全

- **最大长度**：例如 **≤ 256 字节**（可配置），超限 **400**，防超长键占内存与日志爆炸。
- **字符集**：建议仅允许 `[a-z0-9:_-]` 及 IPv6 所需字符；`user:` 前缀后为用户表主键字符串。
- **禁止**：由浏览器直连代理且 **无签名** 时，不得接受任意客户端自拟的 `fairnessKey` 作为唯一凭据（见 §6.2）。

---

## 5. 两层控制模型

### 5.1 层 A：全站对 Vertex 的并发（已有概念，可保留并改名）

- **含义**：任意时刻 **正在执行** `proxyVertexGenerateContent`（或等价 SDK 调用）的请求数上限。
- **与现有变量对齐**：继续以 **`AI_WORKER_ASYNC_PROXY_MAX_CONCURRENT`** 为全局槽（或拆出 **`VERTEX_PROXY_MAX_CONCURRENT`** 仅作用于 `useVertex`，便于与 Gemini Key 路径分离调参）。
- **作用**：保护进程与上游连接数；**单独使用不足以公平**。

### 5.2 层 B：每用户（每 fairness key）限制

须同时启用 **三类约束**：**并发运行上限**（该 key 已占用的全局槽数）、**提交速率**（如新 job / 分钟）、**排队深度**（未开始执行的排队任务数）。

**建议数值与调参方向**：以 **§14 为唯一权威表**，本文不重复维护数字，避免与 §14 不一致。

**令牌桶**：提交速率可用 **滑动窗口** 或 **令牌桶**；**并发**与 **排队深度** 在 job 创建、进入 `running`、结束（成功/失败/取消）时须 **原子更新**，防止竞态下超卖。

### 5.3 层 C：公平调度（出队顺序）

当多个用户均有 **已排队** 任务竞争全局槽时：

- **基准算法**：**加权轮询（WRR）或简单 round-robin** 在 **各 fairness key 的队头** 之间轮流取下一任务。避免单用户 FIFO 深度过大导致他人长期得不到槽。
- **同用户内**：保持 **FIFO**（先提交先服务）。
- **可选增强**：付费档位提高 **每用户并发** 或 **权重**（产品策略，非必须）。

---

## 6. 请求形态与协议（对前后端的约定）

### 6.1 需要限流的入口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/proxy/gemini/async` | 单任务异步 |
| POST | `/proxy/gemini/async-batch` | 批量：可按 **items 条数** 计权重（见 §7） |
| POST | `/proxy/gemini/generate-content` | **须纳入**与异步相同的准入（或明确禁止对外 Vertex 同步，仅内网） |

### 6.2 透传方式（二选一，实现时定稿）

**方案甲（推荐）**：调用方在反向代理或 BFF 上校验会话后，向 ai-worker-proxy 转发请求并设置：

- `X-AC-Fairness-Key: user:<id>`（或 `anon:...`）

代理 **只信任** 以下之一：

- 请求来自 **内网**（如 `127.0.0.1` / 私有网段）且网关已剥离公网直连；或  
- `X-AC-Fairness-Signature: <HMAC>`，密钥为 **`AI_WORKER_PROXY_FAIRNESS_HMAC_SECRET`**，载荷为 `key + '\n' + timestamp`，防伪造；**时间戳允许偏差**见 §10.3。

**方案乙**：在 JSON body 增加 **`fairnessKey`** —— **仅当** 与 HMAC 或 mTLS 联用时采用；**不推荐**单独使用。

### 6.3 可选：`costHint` 与模型权重

为简化首版，可在 body 增加可选字段（由 **可信 BFF** 填写，代理校验范围）：

```json
"fairnessMeta": { "costWeight": 1 }
```

- `costWeight` 仅允许 `1 | 2 | 5` 等白名单；未传默认为 `1`。
- **批量 async-batch**：`costWeight = min(ceil(n/5), 10)` 之类，避免一次提交 20 条等同 20 次单任务冲击。

### 6.4 `async-batch` 首版语义（历史规格 · 默认已 410）

> **D9**：用户路径已不走本接口；下列策略仅供理解旧实现 / 误开时的内部行为。

当前仓库内批量路径对子项 **并行** 发起上游调用；与「公平队列 + 每用户并发」叠加时，须在文档中 **写死首版语义**，避免实现分歧：

| 策略 | 说明 | 首版推荐 |
| --- | --- | --- |
| **A. 整批为单位** | 一次 `async-batch` 仅占 **1** 个「提交速率」扣减；子项在批内 **串行** 或通过子限流并发执行。 | **默认推荐**：语义简单，与「一次 HTTP 提交」一致，最不易打爆全局槽。 |
| **B. 子项独立入队** | 每个 item 独立占公平队列位置与并发计数；公平性最好，实现与状态机最重。 | 二期，若强需求再拆。 |
| **C. 整批并行现状 + 仅整批准入** | 创建时按 `items.length` 一次性检查「排队深度 / costWeight」，运行期仍 `Promise.all` 并行；**仍可能瞬时占满全局槽**，须与 §5.1 联调。 | 仅当接受「批内突发」时采用，并 **收紧** `GEMINI_ASYNC_BATCH_MAX_ITEMS` 与全局并发。 |

**首版采用策略 A**：批整体通过准入后，子请求 **串行或受限并发（≤ 每用户并发）** 调用上游，并与 §7 `costWeight` 一致扣减令牌。

---

## 7. 生图 vs 文本（权重策略）

Vertex 官方以 **TPM** 为主计量；应用侧无精确 tokenizer 时可用 **启发式**：

| 场景 | 建议 `costWeight` |
| --- | --- |
| 文本 / JSON 小请求 | `1` |
| 含图输入或生图模型（站内 `*-image*`、`image` 在 model 字段中） | `2`～`5`（与 `AI_WORKER_ASYNC_PROXY_MAX_CONCURRENT` 联调） |
| `async-batch` 每条子项 | 每条计 `1` 图像素级权重可二期再做 |

**公平性**：权重只影响 **出队优先级或占槽个数** 二选一，首版建议 **仅影响「提交速率扣减」**（例如一次请求扣 `costWeight` 个令牌），避免「大任务永不运行」。

---

## 8. Job 状态机扩展（异步路径）

在现有 `pending` / `running` / `completed` / `failed` 基础上增加：

| 状态 | 含义 | 客户端行为 |
| --- | --- | --- |
| `queued` | 已通过准入计数，**等待全局槽或公平队列轮到** | 继续轮询；UI 可显示「排队中」 |
| `rejected` | **未进入队列**（超每用户速率或队列深度） | 创建请求即返回 **4xx** 更清晰；若仍用 job，则 `failed` 且 `errorCode` 区分 |

**建议**：**拒绝**在 **POST 创建** 时同步返回 **HTTP 429**，body：

```json
{ "error": "rate_limited", "message": "...", "retryAfterSec": 12 }
```

已进入队列的 **不** 再 429，避免客户端重复创建。

### 8.1 取消、超时与资源释放

以下事件须 **递减** 对应 key 的排队深度 / 释放全局槽（与 §5.2 原子计数一致），避免泄漏或永久占坑：

| 事件 | 计数与槽位 |
| --- | --- |
| **客户端断开**（若代理能感知）或 **长期无轮询**（可选 TTL） | 将 job 置 `failed` 或 `cancelled`，释放 **排队深度**；若已进入 `running`，释放 **全局槽** 与 **每用户并发**。 |
| **上游返回终态**（成功 / 不可重试失败） | 释放 **全局槽** 与 **每用户并发**；排队深度已在进入 `running` 时减少（若设计为「排队与运行分离计数」则两阶段分别维护，文档与代码须一致）。 |
| **客户端 `AbortSignal` 取消**（仅当创建阶段可中止） | 若尚未入队：无操作；若已入队未运行：移出队列并减排队深度；若已 `running`：无法取消上游时仅标记「用户放弃结果」，槽位仍待上游结束释放（或支持 AbortController 透传 SDK，若可行）。 |
| **GEMINI_ASYNC_JOB_TTL 到期** | 与断开类似，**必须**释放槽位与深度，防止僵尸任务。 |

**建议**：在 job 对象上显式字段 `releasedSlots: boolean`，防止 `finally` 双释放。

---

## 9. HTTP 与错误码约定

| HTTP | 场景 | `error` 建议值 |
| --- | --- | --- |
| 429 | 每用户提交过频、队列满、或全站短时过载 | `rate_limited` |
| 503 | 全站队列溢出（保护内存） | `queue_overflow` |
| 401 | 缺少 fairness 头或签名校验失败（若启用严格模式） | `fairness_auth_failed` |

响应头 **`Retry-After`**（秒）在 429 时 **尽量给出**，便于前端退避。

### 9.1 客户端退避（防重试风暴）

收到 **429** / **`rate_limited`** 时，客户端应：

- 尊重 **`Retry-After`**；若缺失，使用 **指数退避 + 抖动**，并设 **最大重试次数**（如 5 次）与 **总上限时间**，避免 tight loop 打爆代理。

---

## 10. 环境变量（建议名，实现时对齐代码）

| 变量 | 默认建议 | 说明 |
| --- | --- | --- |
| `GEMINI_FAIRNESS_ENABLED` | 生产默认 `true`，本地/测试默认 `false` | `false` 时关闭公平队列与每用户限流，仅保留现有行为；**紧急回滚**，见 §10.2。 |
| `GEMINI_FAIRNESS_CONFIG_SOURCE` | `db` 或空 | `env_only`：忽略管理员 UI 持久化，仅用 env/默认；用于排障或双源冲突时强制单源。 |
| `AI_WORKER_ASYNC_PROXY_MAX_CONCURRENT` | 生产默认 `2`，本地/测试默认 `4` | 全局 Vertex+非 Vertex 共用或拆变量见 §5.1；429 多时先降，排队明显但 429 少时再升。 |
| `VERTEX_PROXY_MAX_CONCURRENT` | 空=回退到全局 | 可选：仅 Vertex 使用独立槽 |
| `GEMINI_FAIRNESS_USER_MAX_IN_FLIGHT` | `2` | 每 fairness key 占用全局槽上限 |
| `GEMINI_FAIRNESS_USER_MAX_QUEUED` | `5` | 每 key 未开始任务数上限 |
| `GEMINI_FAIRNESS_USER_SUBMIT_RPM` | `30` | 每 key 每分钟「取号」次数 |
| `GEMINI_FAIRNESS_ANON_MAX_IN_FLIGHT` | `1` | anon 桶并发 |
| `GEMINI_FAIRNESS_ANON_MAX_QUEUED` | `2` | anon 桶排队深度 |
| `GEMINI_FAIRNESS_ANON_SUBMIT_RPM` | `10` | anon 桶提交 RPM |
| `GEMINI_FAIRNESS_GLOBAL_QUEUE_MAX` | `500` | 全站等待队列长度硬顶，防 OOM |
| `AI_WORKER_PROXY_FAIRNESS_HMAC_SECRET` | 空=不校验 | 非空则要求 `X-AC-Fairness-Signature` |
| `GEMINI_FAIRNESS_STRICT` | `false` | `true` 时无有效 key 直接 401，不回落 anon |

### 10.1 管理员界面与配置分层（运维调参）

把 §10 中的 **数值类旋钮** 做到 **管理员界面**是合理需求：属于 **「容量与限流」运维自助**，减少改 `.env` 与重发版；**不等于替代运维**（监控、告警、GCP 控制台提额仍需要）。

| 类别 | 建议放管理员 UI | 建议保留环境变量 / Secret Manager |
| --- | --- | --- |
| 全站并发、全站队列硬顶 | 是 | 可在 env 设 **硬上限（clamp max）**，防止误填极大值 |
| 登录 / 匿名 三件套（并发、排队深度、RPM） | 是 | 同上，生产 clamp |
| 公平队列开关、轮询策略（若做多档） | 可选 | — |
| **HMAC 密钥**、**GCP ADC**、**仅内网信任** | 否（或只读掩码展示） | **必须** Secret；不入库明文 |
| `GEMINI_FAIRNESS_STRICT`、是否强制签名校验 | 谨慎：可放 UI 但需 **超级管理员 + 审计日志** | 默认仍可由 env 覆盖 |

**实现注意**：代理进程需 **周期性读取**持久化配置（或订阅配置服务），并 **线程安全**地更新内存中的限流参数；**clamp 范围**写死在服务端（例如全站并发 1～32、每用户 RPM 5～120），UI 超限自动夹取或拒绝保存。

### 10.2 配置优先级与紧急回滚

同时存在 **环境变量** 与 **管理员 UI（持久化配置）** 时，须在实现中写死优先级，避免「改了 UI 不生效」或「双源打架」。

| 优先级（从高到低） | 用途 |
| --- | --- |
| **1. 环境变量「总闸」** | 例如 `GEMINI_FAIRNESS_ENABLED=false` 或 `GEMINI_FAIRNESS_CONFIG_SOURCE=env_only`：**立即关闭**公平队列逻辑，仅保留现有全局槽（或完全旁路），用于事故回滚。 |
| **2. 环境变量 clamp 上下界** | 如 `GEMINI_FAIRNESS_MAX_GLOBAL_CONCURRENT=32`：即使 DB 更大也 **夹到上限**；防止管理员误填极大值。 |
| **3. 持久化（管理员 UI）** | 在 clamp 范围内覆盖默认数值。 |
| **4. 代码内置默认** | 无 env、无 DB 时的兜底。 |

**回滚操作示例（运维）**：先设 `GEMINI_FAIRNESS_ENABLED=false` 重启代理 → 确认错误率下降 → 再查 DB/UI 配置与 GCP 配额。

### 10.3 安全补充（HMAC 与滥用面）

- **HMAC 时间戳窗口**：校验 `timestamp` 与服务器时间差在 **±60～120 秒**（可配置），超出视为 **401**，防重放。
- **`AI_WORKER_PROXY_FAIRNESS_HMAC_SECRET` 轮换**：轮换时支持 **双密钥** 短暂并存（可选），避免全站瞬时 401。
- **日志**：禁止输出完整 fairness key 中的 **PII**；已述脱敏策略见 §11.2。

---

## 11. 可观测性与运维

- **日志**：每次 **拒绝**、每次 **入队**、每次 **开始 running** 打结构化日志（字段见 §11.2）。
- **`GET /healthz`** 扩展字段建议：`fairness.globalQueued`、`fairness.globalRunning`、`fairness.rejectedLast1m`（或接入 Cloud Monitoring 后省略）。
- **告警**：`rejected` 比例持续升高、或 `globalQueued` 长期接近 `GEMINI_FAIRNESS_GLOBAL_QUEUE_MAX`。

### 11.1 排障时优先看的三类指标

区分 **自家限流** 与 **Vertex 上游 429**：

| 指标 / 现象 | 更可能原因 |
| --- | --- |
| 日志中 **`error: rate_limited`** 且 `source: fairness`（或等价标记） | **应用层**每用户 / 全站队列触发。 |
| 日志中 **`RESOURCE_EXHAUSTED` / Vertex 429** 且发生在 SDK 返回后 | **Google 侧**动态池或配额；应结合 GCP Console、Monitoring。 |
| **`fairness.globalQueued` 高**、`rejected` 低 | 全局槽偏小或上游慢；考虑调并发或摊平 batch。 |
| **`rejected` 高**、`globalQueued` 不高 | 每用户 RPM 或排队深度过严，或遭遇刷接口。 |

### 11.2 建议结构化日志字段（示例）

| 字段 | 说明 |
| --- | --- |
| `event` | `fairness_reject` \| `fairness_enqueue` \| `fairness_start_run` \| `fairness_release` |
| `reason` | 如 `user_rpm` \| `user_queue_depth` \| `global_queue_overflow` \| `anon_stricter` |
| `fairnessKeyHash` | **SHA-256 截断** 或前缀 + 脱敏后缀，**禁止**明文长 PII |
| `globalQueued` / `userQueued` | 可选快照，便于关联 |
| `upstream` | `vertex` \| `studio` 便于分渠道告警 |

---

## 12. 实现清单（供排期）

1. **公平队列模块**：每 key 子队列 + round-robin 与全局槽交互。  
2. **POST 入口**：async / async-batch / generate-content 统一 **取 fairness key → 校验 → 入队或 429**。  
3. **BFF 或 auth-api**：登录态下转发代理请求时写入 **`X-AC-Fairness-Key` + 可选 HMAC**；前端 **不** 直连暴露代理时可选省略 HMAC（由同源 BFF 代发）。  
4. **`geminiService.ts`**：若创建任务返回 429，解析 **`retryAfterSec`**，UI 提示「使用人数较多」。  
5. **轮询 UI**：识别 `queued` 状态文案。  
6. **压测**：同 key 高并发、多 key 交替、async-batch 大 items。  
7. **文档**：更新 [VERTEX_AI_INTEGRATION.md](./VERTEX_AI_INTEGRATION.md) 的「请求协议」与「环境变量」小节。
8. **管理员 UI**：持久化「容量与限流」配置、权限与 **clamp**、热加载（见 §10.1）。
9. **多副本路径**：按 §3.1 选择 Redis/网关限流或文档化单副本；与公平队列模块同里程碑或拆分。
10. **§8.1**：取消 / TTL / `releasedSlots` 防双释放。
11. **§6.4**：`async-batch` 与策略 A（批内串行或受限并发）对齐实现。

---

## 13. 与试用配额的关系

- **试用**：日配额与 **auth-api**（`consumeTrialGeminiSlotForUser`）绑定，见 `services/trialGeminiQuota.ts` 与 `server/trial-gemini-quota-store.js`。  
- **Vertex 公平队列**：在 **通过试用扣减之后** 或 **并行**于试用检查（依路由：仅 vertex 供应商走 Vertex 桶）。避免重复扣次：试用用户走 Key 路径时不应用 Vertex 并发键，或共用键但 **分离计数器命名空间** `vertex:` / `studio:`。

---

## 14. 推荐参数速查（对话建议值 · 首版调参起点）

| 参数项 | 建议首版值 | 调参方向（经验规则） |
| --- | --- | --- |
| 全站同时执行（全局槽） | 生产默认 `2`，本地/测试默认 `4`（`AI_WORKER_ASYNC_PROXY_MAX_CONCURRENT`） | 429 **少**、排队长 → 可逐步上调；429 **多** → **先降**或先查 GCP |
| 每用户占用全局槽上限（登录） | `2` | 生图慢且堆积 → 改为 **1** |
| 每用户未开始队列深度（登录） | `5` | 内存或轮询压力大 → **3** |
| 每用户提交 RPM（登录） | `30` | 误伤正常用户则略升；刷接口则略降 |
| anon 并发 / 深度 / RPM | `1` / `2` / `10` | 同 IP 攻击面大时 **更严** |
| 全站排队硬顶 | `500`（可 **200～1000**） | 防 OOM；接近满持续告警 |

---

## 15. 最小验收与测试用例（对应 §1.2 G1～G5）

| 编号 | 场景 | 预期 |
| --- | --- | --- |
| T1 | 两用户 **交替** 提交多 job，全局槽为 1～2 | 出队顺序近似 **round-robin**，无单用户连续独占（可日志断言 `fairnessKeyHash` 交替）。 |
| T2 | 单用户提交数 **超过排队深度** | **POST 即 429**，`error: rate_limited`，且 **不** 创建无意义 job 条目。 |
| T3 | 单用户 RPM **超限** | 同上；`Retry-After` 可选存在。 |
| T4 | **同步** `generate-content`（Vertex） | 与异步 **同一套准入**；若暂未实现同步路径，须在部署层 **禁止公网** 调该路径并文档声明例外。 |
| T5 | **async-batch**、`items` 大于上限或策略 A 下批内第二项在上一项未完成前 | 不突破 **每用户并发** 与 **全局槽**（或明确串行完成顺序）。 |
| T6 | Job **TTL 到期** 或客户端放弃轮询 | **§8.1** 计数与槽位释放；无泄漏（压测前后 `healthz` 中 `globalRunning` 归零趋势一致）。 |
| T7 | **多实例**（若已上 Redis/网关） | 两实例总和不超过配置的全局意图；或单副本模式下副本数锁为 1。 |

---

## 16. 修订记录

| 日期 | 说明 |
| --- | --- |
| 2026-05-14 | 初稿：公平排队、每用户限流、协议与实现清单 |
| 2026-05-14 | 增补 §0 会话结论摘要、§2.1 Google 限制归纳、§10.1 管理员界面与配置分层、§14 推荐参数速查表 |
| 2026-05-14 | 按评审优化：文首术语与 §0 维护说明；§3.1 多副本；§4.3～§4.4 IP/HMAC/key；§5.2 与 §14 去重；§6.4 async-batch 首版语义 A；§8.1 取消与释放；§9.1 客户端退避；§10.2～§10.3 配置优先级与安全；§11.1～§11.2 排障与日志；§12 清单扩展；新增 **§15 最小验收**。 |
