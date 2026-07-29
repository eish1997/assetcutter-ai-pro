'use strict';

/** @type {import('./agent-types.d.ts').AgentToolSchema[]} */
const P0_TOOL_SCHEMAS = [
  {
    name: 'ac.shell.navigate',
    description: '切换桌面壳中间内容页：home、workbench、scripts、tools、settings',
    risk: 'safe',
    surfaces: ['shell'],
    inputSchema: {
      type: 'object',
      properties: {
        view: {
          type: 'string',
          enum: ['home', 'workbench', 'scripts', 'tools', 'settings'],
        },
      },
      required: ['view'],
      additionalProperties: false,
    },
  },
  {
    name: 'ac.shell.get_state',
    description: '读取当前壳视图、伴侣连接摘要、配对与大脑探测状态',
    risk: 'safe',
    surfaces: ['shell'],
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'ac.shell.login',
    description: 'Sign in the local shell first-party web session so Workbench, Script Hub, and Copilot share one team account partition.',
    risk: 'safe',
    surfaces: ['shell'],
    inputSchema: {
      type: 'object',
      properties: {
        identifier: { type: 'string', description: 'Team account username or email.' },
        password: { type: 'string', description: 'Team account password. Never store or echo this value.' },
      },
      required: ['identifier', 'password'],
      additionalProperties: false,
    },
  },
  {
    name: 'ac.companion.runtime_status',
    description: 'GET /v1/runtime-status 本机引擎与伴侣运行摘要',
    risk: 'safe',
    surfaces: ['companion'],
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

/** @type {import('./agent-types.d.ts').AgentToolSchema[]} */
const P1_TOOL_SCHEMAS = [
  {
    name: 'ac.workbench.ensure_ready',
    description: '切到工作台并检查登录态、当前项目与可直接运行能力；可选创建承载项目',
    risk: 'safe',
    surfaces: ['workbench'],
    inputSchema: {
      type: 'object',
      properties: {
        requireProject: {
          type: 'boolean',
          description: '是否要求返回时已有 activeProjectId；默认 false',
        },
        createIfMissing: {
          type: 'boolean',
          description: 'requireProject=true 且没有项目时，是否创建一个新项目；默认 false',
        },
        projectName: {
          type: 'string',
          description: 'createIfMissing=true 时使用的项目名称',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'ac.workbench.get_context',
    description: '读取工作台登录态、当前项目、能力预设摘要（需已登录主站）',
    risk: 'safe',
    surfaces: ['workbench'],
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'ac.workbench.open_project',
    description: '打开工作区项目并切换到工作台视图',
    risk: 'safe',
    surfaces: ['workbench'],
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: '工作区项目 id' },
      },
      required: ['projectId'],
      additionalProperties: false,
    },
  },
  {
    name: 'ac.workbench.create_project',
    description: '创建一个新的工作区项目并切换到工作台视图',
    risk: 'safe',
    surfaces: ['workbench'],
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '项目名称；不传则使用默认 Agent 项目名' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'ac.workbench.list_assets',
    description: '列出当前或指定工作区项目的轻量资产摘要（不返回大图 data URL）',
    risk: 'safe',
    surfaces: ['workbench'],
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: '可选工作区项目 id；不传则使用当前打开项目' },
        limit: { type: 'number', description: '最多返回多少个最近资产，默认 50，最大 200' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'ac.workbench.get_asset',
    description: '读取单个工作区资产的结构化详情和文本结果（不返回图片/视频 data URL）',
    risk: 'safe',
    surfaces: ['workbench'],
    inputSchema: {
      type: 'object',
      properties: {
        assetId: { type: 'string', description: '工作区资产 id' },
        projectId: { type: 'string', description: '可选工作区项目 id；不传则使用当前打开项目' },
      },
      required: ['assetId'],
      additionalProperties: false,
    },
  },
  {
    name: 'ac.workbench.run_capability',
    description: '在当前工作区项目执行能力预设（gen_text 等轻量能力）',
    risk: 'confirm',
    surfaces: ['workbench'],
    inputSchema: {
      type: 'object',
      properties: {
        presetId: { type: 'string' },
        projectId: { type: 'string' },
        inputText: { type: 'string' },
        imageDataUrl: {
          type: 'string',
          description: '可选图片输入 data URL；图生图、图生文、图像处理能力需要传入',
        },
        inputAssetId: {
          type: 'string',
          description: '可选工作台资产 id；不想直接传 data URL 时，可从已有资产读取当前版本作为输入',
        },
        inputAssetDisplayKey: {
          type: 'string',
          description: '可选资产版本 key；默认使用该资产当前 displayKey',
        },
      },
      required: ['presetId'],
      additionalProperties: false,
    },
  },
  {
    name: 'ac.workbench.create_text_asset',
    description:
      '在当前工作台项目（或指定 projectId）新建一条文本资产，写入工作区资产列表（不是 Agent CLI aga_* 库）。',
    risk: 'confirm',
    surfaces: ['workbench'],
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '文本内容（必填）' },
        name: { type: 'string', description: '可选标题；默认取正文前若干字' },
        projectId: { type: 'string', description: '可选；默认当前打开的工作台项目' },
      },
      required: ['text'],
      additionalProperties: false,
    },
  },
  {
    name: 'ac.workbench.create_image_asset',
    description:
      '把一张图片写入当前工作台项目资产列表（人手导入形态）。优先传本机绝对路径 localPath（伴侣读盘入库）；不要把大图 base64 塞进 imageDataUrl。imageDataUrl 仅适合极小图调试。',
    risk: 'confirm',
    surfaces: ['workbench'],
    inputSchema: {
      type: 'object',
      properties: {
        localPath: {
          type: 'string',
          description: '本机图片绝对路径（推荐）。例如 C:\\\\Users\\\\me\\\\Downloads\\\\a.png',
        },
        imageDataUrl: {
          type: 'string',
          description: '可选；仅小图调试用 data:image/...;base64,...。真实导入请用 localPath。',
        },
        name: { type: 'string', description: '可选显示名；默认取文件名或「导入图片」' },
        projectId: { type: 'string', description: '可选；默认当前打开的工作台项目' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'ac.script_hub.list_scripts',
    description: '列出 ScriptHub Tool Bridge 平台工具（GET /tool-bridge/tools）',
    risk: 'safe',
    surfaces: ['script_hub'],
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'ac.script_hub.run_script',
    description: '调用 ScriptHub Tool Bridge 执行平台工具（POST /tool-bridge/calls）',
    risk: 'confirm',
    surfaces: ['script_hub'],
    inputSchema: {
      type: 'object',
      properties: {
        toolName: { type: 'string' },
        input: { type: 'object' },
        conversationId: { type: 'string' },
        traceId: { type: 'string' },
        idempotencyKey: { type: 'string' },
        scriptId: { type: 'string' },
        revisionId: { type: 'string' },
        targetType: { type: 'string' },
        params: { type: 'object' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'ac.script_hub.get_run',
    description: '查询 ScriptHub ToolCall 状态（GET /tool-bridge/calls/:id）',
    risk: 'safe',
    surfaces: ['script_hub'],
    inputSchema: {
      type: 'object',
      properties: {
        toolCallId: { type: 'string' },
        runId: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'ac.script_hub.export_maya_selection',
    description:
      'Maya 当前选择导出 FBX 全链路（Tool Bridge scriptHub.maya.export_selection_fbx + Connector）',
    risk: 'confirm',
    surfaces: ['script_hub'],
    inputSchema: {
      type: 'object',
      properties: {
        outputPath: { type: 'string' },
        output_path: { type: 'string' },
        overwrite: { type: 'boolean' },
        conversationId: { type: 'string' },
        traceId: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'ac.companion.compute',
    description: 'POST /v1/compute/jobs 提交本机 compute 任务',
    risk: 'confirm',
    surfaces: ['companion'],
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string' },
        projectId: { type: 'string' },
        inputs: { type: 'object' },
        params: { type: 'object' },
      },
      required: ['type'],
      additionalProperties: false,
    },
  },
  {
    name: 'ac.shell_tool.run',
    description: '打开壳内小工具窗口（shell_tool_bundle）',
    risk: 'confirm',
    surfaces: ['shell'],
    inputSchema: {
      type: 'object',
      properties: {
        toolId: { type: 'string' },
      },
      required: ['toolId'],
      additionalProperties: false,
    },
  },
  {
    name: 'ac.shell.bootstrap',
    description: '触发本机引擎一键安装（sam_local / rembg / paddleocr）',
    risk: 'confirm',
    surfaces: ['shell', 'companion'],
    inputSchema: {
      type: 'object',
      properties: {
        engine: { type: 'string', enum: ['sam_local', 'rembg', 'paddleocr'] },
        useGpu: { type: 'boolean' },
      },
      required: ['engine'],
      additionalProperties: false,
    },
  },
];

/** @type {import('./agent-types.d.ts').AgentToolSchema[]} */
const P2_TOOL_SCHEMAS = [
  {
    name: 'ac.skills.list',
    description: '列出 agent-store/skills 可复用剧本',
    risk: 'safe',
    surfaces: ['shell'],
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'ac.skills.get',
    description: '读取指定 skill 详情（含 prompt）',
    risk: 'safe',
    surfaces: ['shell'],
    inputSchema: {
      type: 'object',
      properties: { skillId: { type: 'string' } },
      required: ['skillId'],
      additionalProperties: false,
    },
  },
  {
    name: 'ac.skills.save',
    description: '保存或更新一个可复用 agent skill/workflow（写入 agent-store/skills）',
    risk: 'confirm',
    surfaces: ['shell'],
    inputSchema: {
      type: 'object',
      properties: {
        skillId: { type: 'string', description: '稳定 skill id；未提供时从 name 派生' },
        name: { type: 'string' },
        description: { type: 'string' },
        prompt: { type: 'string' },
        toolHints: { type: 'array', items: { type: 'string' } },
        workbenchPreset: {
          type: 'object',
          description:
            'Optional Workbench preset route schema for later ac.workflow.promote_workbench_preset preflight validation.',
          additionalProperties: true,
        },
        scriptManifest: {
          type: 'object',
          description:
            'Optional Script Hub tool.json-style manifest for later ac.workflow.promote_script_hub_tool preflight validation.',
          additionalProperties: true,
        },
      },
      required: ['name', 'prompt'],
      additionalProperties: false,
    },
  },
  {
    name: 'ac.skills.revisions',
    description: '列出指定 skill/workflow 的当前版本与历史归档摘要',
    risk: 'safe',
    surfaces: ['shell'],
    inputSchema: {
      type: 'object',
      properties: {
        skillId: { type: 'string', description: '要查看历史版本的稳定 skill id' },
      },
      required: ['skillId'],
      additionalProperties: false,
    },
  },
  {
    name: 'ac.skills.revision_get',
    description: '读取指定 skill/workflow 的某一个历史版本内容',
    risk: 'safe',
    surfaces: ['shell'],
    inputSchema: {
      type: 'object',
      properties: {
        skillId: { type: 'string', description: '要读取历史版本的稳定 skill id' },
        revision: { type: 'number', description: '版本号，从 1 开始' },
      },
      required: ['skillId', 'revision'],
      additionalProperties: false,
    },
  },
  {
    name: 'ac.skills.delete',
    description: '删除一个可复用 agent skill/workflow（从 agent-store/skills 下线）',
    risk: 'confirm',
    surfaces: ['shell'],
    inputSchema: {
      type: 'object',
      properties: {
        skillId: { type: 'string', description: '要下线的稳定 skill id' },
      },
      required: ['skillId'],
      additionalProperties: false,
    },
  },
  {
    name: 'ac.workflow.promote_workbench_preset',
    description: 'Governed preflight entrance for promoting an agent skill/workflow draft into a Workbench preset. The current implementation only reports missing gates and does not publish.',
    risk: 'confirm',
    surfaces: ['workbench', 'shell'],
    inputSchema: {
      type: 'object',
      properties: {
        skillId: { type: 'string', description: 'Skill/workflow id to promote' },
        presetName: { type: 'string', description: 'Target Workbench preset name' },
      },
      required: ['skillId'],
      additionalProperties: false,
    },
  },
  {
    name: 'ac.workflow.promote_script_hub_tool',
    description: 'Governed preflight entrance for promoting an agent skill/workflow draft into a Script Hub tool. The current implementation only reports missing gates and does not publish.',
    risk: 'confirm',
    surfaces: ['script_hub', 'shell'],
    inputSchema: {
      type: 'object',
      properties: {
        skillId: { type: 'string', description: 'Skill/workflow id to promote' },
        toolName: { type: 'string', description: 'Target Script Hub tool name' },
      },
      required: ['skillId'],
      additionalProperties: false,
    },
  },
  {
    name: 'ac.usage.upload_cloud_draft',
    description:
      'Confirm-risk governance tool for uploading sanitized local Copilot usage events through the shell first-party session. Cookies and tokens never leave the shell.',
    risk: 'confirm',
    surfaces: ['shell', 'companion'],
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Local usage window to upload; defaults to 1 day.' },
        limit: { type: 'number', description: 'Maximum local audit rows to summarize; defaults to 5000.' },
        dryRun: { type: 'boolean', description: 'Build and validate the upload payload without posting it.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'ac.usage.probe_quota_policy',
    description:
      'Read-only governance probe for the team Copilot usage quota policy through the shell first-party session. Cookies and tokens never leave the shell.',
    risk: 'safe',
    surfaces: ['shell', 'companion'],
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'ac.memory.list',
    description: '列出持久化用户记忆条目',
    risk: 'safe',
    surfaces: ['shell'],
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number' },
        projectId: { type: 'string' },
        kind: { type: 'string', enum: ['decision', 'workflow', 'parameter', 'recovery', 'project_note'] },
        includeDisabled: { type: 'boolean' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'ac.memory.append',
    description: '追加一条用户记忆（跨脑共享）',
    risk: 'confirm',
    surfaces: ['shell'],
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        projectId: { type: 'string' },
        projectName: { type: 'string' },
        kind: { type: 'string', enum: ['decision', 'workflow', 'parameter', 'recovery', 'project_note'] },
        contextEnabled: { type: 'boolean' },
      },
      required: ['text'],
      additionalProperties: false,
    },
  },
];

const ALL_TOOL_SCHEMAS = [...P0_TOOL_SCHEMAS, ...P1_TOOL_SCHEMAS, ...P2_TOOL_SCHEMAS];

const SURFACE_LABELS = {
  shell: 'Shell',
  workbench: 'Workbench',
  script_hub: 'Script Hub',
  companion: 'Companion',
  os: 'OS',
  other: 'Other',
};

const TOOL_GUIDANCE = {
  'ac.shell.navigate': {
    title: '切换伴侣页面',
    whenToUse: '用户要打开工作台、脚本、工具、设置或回到首页时使用。',
    exampleArguments: { view: 'workbench' },
    successSignals: ['返回 view，桌面壳中间区域切到对应页面。'],
  },
  'ac.shell.get_state': {
    title: '读取当前状态',
    whenToUse: '开始任务、排查连接、决定下一步工具前先读取状态。',
    exampleArguments: {},
    successSignals: ['返回当前页面、配对状态、大脑状态和工作台摘要。'],
  },
  'ac.companion.runtime_status': {
    title: '检查本机运行环境',
    whenToUse: '需要确认本机引擎、伴侣服务、模型运行依赖是否正常时使用。',
    exampleArguments: {},
    successSignals: ['返回本机 runtime 状态，ok=true 表示接口可达。'],
  },
  'ac.workbench.get_context': {
    title: '读取工作台上下文',
    whenToUse: '准备操作项目、能力预设或判断用户当前工作区时使用。',
    exampleArguments: {},
    successSignals: ['返回登录态、当前项目、可用能力预设摘要。'],
  },
  'ac.workbench.ensure_ready': {
    title: '准备工作台',
    whenToUse: '外部 Agent 准备操作工作台前优先调用；它会切到工作台并返回登录、项目、可运行能力和下一步。',
    exampleArguments: { requireProject: true, createIfMissing: true, projectName: 'Agent 产物项目' },
    successSignals: ['返回 action=ensureReady、ready=true、context 和 nextStep；若 authRequired 则需要用户先登录工作台。'],
  },
  'ac.workbench.open_project': {
    title: '打开项目',
    whenToUse: '用户指定项目，或 agent 已从上下文中选定项目后使用。',
    exampleArguments: { projectId: 'project-id' },
    successSignals: ['返回 action=open_project，工作台视图打开目标项目。'],
  },
  'ac.workbench.create_project': {
    title: '创建项目',
    whenToUse: 'get_context 返回没有 activeProject 或没有可用项目，需要先建立工作区承载产物时使用。',
    exampleArguments: { name: 'Agent 产物项目' },
    successSignals: ['返回 action=create_project/createProject 和 projectId，工作台视图打开新项目。'],
  },
  'ac.workbench.list_assets': {
    title: '列出资产',
    whenToUse: '需要确认当前项目已有资产、找到刚生成的 assetId，或决定后续操作目标时使用。',
    exampleArguments: { projectId: 'project-id', limit: 20 },
    successSignals: ['返回 action=list_assets/listAssets、count 和 assets 摘要；不会返回完整 data URL。'],
  },
  'ac.workbench.get_asset': {
    title: '读取资产',
    whenToUse: '已经从 list_assets 或 run_capability 得到 assetId，需要读取文本结果、版本键或媒体元数据时使用。',
    exampleArguments: { assetId: 'asset-id', projectId: 'project-id' },
    successSignals: ['返回 action=get_asset/getAsset 和 asset 详情；文本结果可直接读取，媒体仅返回长度与对象键。'],
  },
  'ac.workbench.run_capability': {
    title: '执行工作台能力',
    whenToUse: '需要在当前项目上调用图片、文本或其它能力预设生成结果时使用。',
    exampleArguments: {
      presetId: 'preset-id',
      projectId: 'project-id',
      inputText: '生成线稿版本',
      imageDataUrl: 'data:image/png;base64,...',
      inputAssetId: 'asset-id',
      inputAssetDisplayKey: 'original',
    },
    successSignals: [
      '返回 action=run_capability，nextStep 指示是否完成或需要用户检查工作台。',
      '若返回 input_image_required，请补充 imageDataUrl，或传入可解析图片的 inputAssetId。',
    ],
  },
  'ac.workbench.create_text_asset': {
    title: '创建文本资产',
    whenToUse: '用户要求在当前工作台项目里新增一条文本/备注资产时使用（不是 Agent CLI 旁路库）。',
    exampleArguments: {
      text: '这是一条测试文本',
      name: '测试文本',
      projectId: 'project-id',
    },
    successSignals: [
      '返回 action=createTextAsset、assetId，且 list_assets 能看到新文本资产。',
      '若返回 project_required，先 create_project 或让用户打开项目。',
    ],
  },
  'ac.workbench.create_image_asset': {
    title: '导入图片资产',
    whenToUse: '用户要求把本机/下载目录图片放入当前工作台项目时使用。必须传 localPath（绝对路径），不要把图片内容转成 base64 塞进工具参数。',
    exampleArguments: {
      localPath: 'C:\\\\Users\\\\me\\\\Downloads\\\\sample.png',
      name: '下载文件夹里的样例图',
      projectId: 'project-id',
    },
    successSignals: [
      '返回 action=createImageAsset、assetId，且 list_assets 能看到新图片资产。',
      '若返回 localPath not found，检查路径是否绝对路径且文件存在。',
      '若返回 image_too_large，文件超过约 100MB，请换较小文件。',
    ],
  },
  'ac.script_hub.list_scripts': {
    title: '列出脚本工具',
    whenToUse: '用户要找平台工具、自动化脚本或专业软件桥接能力时使用。',
    exampleArguments: { limit: 20 },
    successSignals: ['返回 Tool Bridge 可调用工具列表。'],
  },
  'ac.script_hub.run_script': {
    title: '执行脚本工具',
    whenToUse: '已经选定 ScriptHub 工具并准备传入参数执行时使用。',
    exampleArguments: { toolName: 'tool.name', input: {}, idempotencyKey: 'unique-run-key' },
    successSignals: ['返回 toolCallId 或运行结果，可继续用 get_run 查询。'],
  },
  'ac.script_hub.get_run': {
    title: '查询脚本运行',
    whenToUse: '脚本工具异步执行后，需要查看当前状态或结果时使用。',
    exampleArguments: { toolCallId: 'tool-call-id' },
    successSignals: ['返回运行状态、输出或错误。'],
  },
  'ac.script_hub.export_maya_selection': {
    title: '导出 Maya 选择',
    whenToUse: '用户要把 Maya 当前选择导出为 FBX 并进入平台流程时使用。',
    exampleArguments: { outputPath: 'C:/temp/selection.fbx', overwrite: true },
    successSignals: ['返回导出路径或桥接运行结果。'],
  },
  'ac.companion.compute': {
    title: '提交本机计算任务',
    whenToUse: '需要调用本机算力执行分割、抠图、OCR 等 compute job 时使用。',
    exampleArguments: { type: 'rembg', inputs: {}, params: {} },
    successSignals: ['返回 compute job id、状态或结果摘要。'],
  },
  'ac.shell_tool.run': {
    title: '打开壳内工具',
    whenToUse: '用户要启动本地伴侣内置的小工具界面时使用。',
    exampleArguments: { toolId: 'tool-id' },
    successSignals: ['返回工具窗口打开结果。'],
  },
  'ac.shell.bootstrap': {
    title: '安装本机引擎',
    whenToUse: '检测到 sam_local、rembg、paddleocr 等本机能力缺失，需要一键安装时使用。',
    exampleArguments: { engine: 'rembg', useGpu: false },
    successSignals: ['返回安装任务状态或错误详情。'],
  },
  'ac.skills.list': {
    title: '列出工作流',
    whenToUse: '用户要查看团队/本机可复用 agent skill 或 workflow 时使用。',
    exampleArguments: {},
    successSignals: ['返回 skills 数组。'],
  },
  'ac.skills.get': {
    title: '读取工作流详情',
    whenToUse: '准备执行、复用或解释某个 skill/workflow 前使用。',
    exampleArguments: { skillId: 'skill-id' },
    successSignals: ['返回 skill 的 prompt、描述和工具提示。'],
  },
  'ac.skills.save': {
    title: '保存工作流',
    whenToUse: '管理员或工作流研发人员已经测试好一段可复用流程，需要上传到本地伴侣工作流库时使用。',
    exampleArguments: {
      skillId: 'cinematic-scene-character',
      name: '影视级场景和角色',
      description: '生成影视级场景与角色资产的团队工作流',
      prompt: '按团队规范执行影视级场景和角色生成流程。',
      toolHints: ['ac.workbench.ensure_ready', 'ac.workbench.run_capability'],
    },
    successSignals: ['返回 resourceUri 和 promptName，随后可通过 prompts/list、resources/read 或 ac.skills.get 发现。'],
  },
  'ac.skills.revisions': {
    title: '查看工作流版本',
    whenToUse: '更新或排查某个 skill/workflow 前，需要查看当前版本号和历史归档摘要时使用。',
    exampleArguments: { skillId: 'cinematic-scene-character' },
    successSignals: ['返回 revisions 数组，最后一项通常是当前版本。'],
  },
  'ac.skills.revision_get': {
    title: '读取工作流版本',
    whenToUse: '需要查看某个 workflow 历史版本的完整 prompt、描述或工具提示时使用。',
    exampleArguments: { skillId: 'cinematic-scene-character', revision: 1 },
    successSignals: ['返回指定 revision 的 skill 内容和 kind=current/archived。'],
  },
  'ac.skills.delete': {
    title: '删除工作流',
    whenToUse: '管理员或工作流研发人员要下线一个不再可用、测试失败或被替代的 skill/workflow 时使用。',
    exampleArguments: { skillId: 'cinematic-scene-character' },
    successSignals: ['返回 deleted=true 后，prompts/list、resources/list 和 ac.skills.list 不再展示该 workflow。'],
  },
  'ac.workflow.promote_workbench_preset': {
    title: 'Workbench preset promotion preflight',
    whenToUse:
      'Use after a reusable skill/workflow draft is saved and an admin wants to check whether it can become a governed Workbench preset.',
    exampleArguments: { skillId: 'cinematic-scene-character', presetName: 'Cinematic scene kit' },
    successSignals: ['Returns publishable=false plus required, passed, and missing gates until governed promotion is enabled.'],
  },
  'ac.workflow.promote_script_hub_tool': {
    title: 'Script Hub tool promotion preflight',
    whenToUse:
      'Use after a reusable skill/workflow draft is saved and an admin wants to check whether it can become a governed Script Hub tool.',
    exampleArguments: { skillId: 'cinematic-scene-character', toolName: 'Cinematic scene kit' },
    successSignals: ['Returns publishable=false plus required, passed, and missing gates until governed promotion is enabled.'],
  },
  'ac.memory.list': {
    title: '读取记忆',
    whenToUse: '需要了解用户偏好、团队约定或历史上下文时使用。',
    exampleArguments: { limit: 20 },
    successSignals: ['返回 notes 数组。'],
  },
  'ac.memory.append': {
    title: '写入记忆',
    whenToUse: '用户明确要求记住偏好、规范或长期有效事实时使用。',
    exampleArguments: { text: '用户偏好产品级深色 UI', tags: ['preference', 'ui'] },
    successSignals: ['返回写入后的 note id 或 ok=true。'],
  },
};

function summarizeInputSchema(inputSchema) {
  const schema = inputSchema && typeof inputSchema === 'object' ? inputSchema : {};
  const properties = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
  const required = Array.isArray(schema.required) ? schema.required.map(String) : [];
  return {
    type: typeof schema.type === 'string' ? schema.type : 'object',
    propertyCount: Object.keys(properties).length,
    required,
    additionalProperties: schema.additionalProperties !== false,
  };
}

function normalizeToolForCatalog(tool) {
  const surfaces = Array.isArray(tool && tool.surfaces) && tool.surfaces.length ? tool.surfaces.map(String) : ['other'];
  const name = String((tool && tool.name) || '');
  const guidance = TOOL_GUIDANCE[name] || {};
  return {
    name,
    title: String((tool && tool.title) || guidance.title || name),
    description: String((tool && tool.description) || ''),
    risk: String((tool && tool.risk) || 'safe'),
    surfaces,
    primarySurface: surfaces[0] || 'other',
    deprecated: Boolean(tool && tool.deprecated),
    whenToUse: String((tool && tool.whenToUse) || guidance.whenToUse || ''),
    exampleArguments: (tool && tool.exampleArguments) || guidance.exampleArguments || {},
    successSignals: Array.isArray(tool && tool.successSignals)
      ? tool.successSignals.map(String)
      : Array.isArray(guidance.successSignals)
        ? guidance.successSignals
        : [],
    input: summarizeInputSchema(tool && tool.inputSchema),
    inputSchema: (tool && tool.inputSchema) || { type: 'object', properties: {} },
  };
}

function buildToolCatalog(toolsRaw) {
  const tools = (Array.isArray(toolsRaw) ? toolsRaw : []).map(normalizeToolForCatalog).filter((t) => t.name);
  const riskCounts = tools.reduce(
    (acc, tool) => {
      acc[tool.risk] = (acc[tool.risk] || 0) + 1;
      return acc;
    },
    { safe: 0, confirm: 0, forbidden: 0 },
  );
  const groupMap = new Map();
  for (const tool of tools) {
    const id = tool.primarySurface || 'other';
    if (!groupMap.has(id)) {
      groupMap.set(id, {
        id,
        label: SURFACE_LABELS[id] || id,
        count: 0,
        tools: [],
      });
    }
    const group = groupMap.get(id);
    group.tools.push(tool);
    group.count += 1;
  }
  const surfaceOrder = ['shell', 'workbench', 'script_hub', 'companion', 'os', 'other'];
  const surfaces = [...groupMap.values()].sort((a, b) => {
    const ai = surfaceOrder.includes(a.id) ? surfaceOrder.indexOf(a.id) : surfaceOrder.length;
    const bi = surfaceOrder.includes(b.id) ? surfaceOrder.indexOf(b.id) : surfaceOrder.length;
    if (ai !== bi) return ai - bi;
    return a.id.localeCompare(b.id);
  });
  for (const group of surfaces) {
    group.tools.sort((a, b) => a.name.localeCompare(b.name));
  }
  return {
    version: 1,
    total: tools.length,
    riskCounts,
    surfaces,
    recommendedFlow: [
      'Call ac.shell.get_state first to understand the local companion and active workbench context.',
      'Use ac.workbench.ensure_ready before opening projects or running presets; if it reports authRequired, ask the user to log in. Use ac.workbench.list_assets to verify generated outputs and choose assetIds, then ac.workbench.get_asset for details.',
      'Use confirm-risk tools only when the user intent is clear; expect Copilot/admin policy to gate them.',
      'Read assetcutter://mcp/quickstart for the concise integration guide.',
    ],
  };
}

module.exports = {
  P0_TOOL_SCHEMAS,
  P1_TOOL_SCHEMAS,
  P2_TOOL_SCHEMAS,
  ALL_TOOL_SCHEMAS,
  buildToolCatalog,
};
