'use strict';

/** @type {import('./agent-types.d.ts').AgentToolSchema[]} */
const P0_TOOL_SCHEMAS = [
  {
    name: 'ac.shell.navigate',
    description: '切换桌面壳中间内容页：home、workbench、workflow、tools、connections、settings',
    risk: 'safe',
    surfaces: ['shell'],
    inputSchema: {
      type: 'object',
      properties: {
        view: {
          type: 'string',
          enum: ['home', 'workbench', 'workflow', 'tools', 'connections', 'settings'],
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
    description: 'Sign in the local shell first-party web session so Workbench, Workflow, and Copilot share one team account partition.',
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
    autoConfirmEligible: true,
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
    whenToUse:
      'Only for plain notes, briefs, or reusable text content that belongs in the current Workbench asset list. Do not use for creating tools, plugins, Maya scripts, script tools, or installable utilities; use ac.shell_tool.scaffold -> ac.shell_tool.authored_upsert instead.',
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
    name: 'ac.shell_tool.list',
    description: '列出已安装小工具与本机自建草稿',
    risk: 'safe',
    surfaces: ['shell'],
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'ac.shell_tool.scaffold',
    description: '创建最小可运行自建小工具壳，安装到本机工具架并打开窗口',
    risk: 'confirm',
    whenToUse:
      'Use when the user asks Copilot to create/build a local tool, plugin, Maya plugin, script tool, or installable utility. Scaffold first, then write tool.json/panel.json/scripts with ac.shell_tool.authored_upsert.',
    surfaces: ['shell'],
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'toolId，小写字母开头' },
        name: { type: 'string' },
        description: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        overwrite: { type: 'boolean' },
        open: { type: 'boolean', description: '是否打开工具窗，默认 true' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'ac.shell_tool.authored_upsert',
    description: '写入自建小工具草稿文件（tool.json / panel.json / scripts）；保存后自动热重载',
    risk: 'confirm',
    surfaces: ['shell'],
    inputSchema: {
      type: 'object',
      properties: {
        toolId: { type: 'string' },
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              content: { type: 'string' },
            },
            required: ['path', 'content'],
            additionalProperties: false,
          },
        },
      },
      required: ['toolId', 'files'],
      additionalProperties: false,
    },
  },
  {
    name: 'ac.shell_tool.export',
    description: '将自建小工具打成 ZIP（与管理员上架同形）',
    risk: 'confirm',
    surfaces: ['shell'],
    inputSchema: {
      type: 'object',
      properties: {
        toolId: { type: 'string' },
        destZipPath: { type: 'string' },
      },
      required: ['toolId'],
      additionalProperties: false,
    },
  },
  {
    name: 'ac.shell_tool.import',
    description: '从本机 ZIP 导入为自建小工具并安装',
    risk: 'confirm',
    surfaces: ['shell'],
    inputSchema: {
      type: 'object',
      properties: {
        zipPath: { type: 'string' },
        open: { type: 'boolean' },
      },
      required: ['zipPath'],
      additionalProperties: false,
    },
  },
  {
    name: 'ac.capability.draft_create',
    description: '通过统一能力包主线创建本地草稿；支持 software_connection 连接草稿、tool 工具草稿和 workflow 工作流草稿。',
    risk: 'confirm',
    whenToUse:
      'Use when the user asks Copilot to add/create/connect a local software application from the Connection page. Treat every app as unknown first, create a CapabilityPackage(type=software_connection) draft, collect connectionFacts, and let StrategyDraft/candidateStrategies drive the next step. do not restore the old 62-host default catalog, do not ask the user to choose a technical template, and do not suggest editing capabilityLifecycle.ts. Known drivers are only verified strategy shortcuts; new app support must be added through softwareBridgeRegistry by registering a bridge driver.',
    surfaces: ['companion', 'shell'],
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Optional stable lowercase package id, e.g. photoshop.' },
        type: { type: 'string', enum: ['software_connection', 'tool', 'workflow'], description: 'Capability package type.' },
        name: { type: 'string', description: 'Connection display name or target software name.' },
        appName: { type: 'string', description: 'Optional target software name if different from name.' },
        description: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        templateHint: { type: 'string', description: 'Optional inferred connector hint; user should not have to choose it.' },
        semver: { type: 'string', description: 'Optional tool semver when type=tool.' },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'ac.capability.create_draft',
    description: '通过自然语言意图创建能力包草稿；自动判断本机软件连接或工具，避免把技术模板决策交给用户。',
    risk: 'confirm',
    whenToUse:
      'Preferred unified creation entry for Copilot. Use when the user says they want to create a tool, add a software connection, create a workflow, or start a capability from conversation. It should infer tool vs software_connection vs workflow from intent/name; for software_connection, treat the target as unknown first, collect connectionFacts, and produce StrategyDraft/candidateStrategies without making the user choose a template. do not create Workbench text assets for tools. Known drivers are only verified strategy shortcuts; unsupported software must stay as a local strategy/template draft and route future implementation through softwareBridgeRegistry bridge drivers, not capabilityLifecycle.ts branches.',
    surfaces: ['companion', 'shell'],
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Optional stable id. If omitted, the shell derives a safe id from name/intent.' },
        type: { type: 'string', enum: ['software_connection', 'tool', 'workflow'], description: 'Optional inferred type override.' },
        name: { type: 'string', description: 'User-facing capability name.' },
        intent: { type: 'string', description: 'Natural language user intent, e.g. 创建随机选择工具 or 添加 Photoshop 连接.' },
        appName: { type: 'string', description: 'Optional target software name for software_connection.' },
        description: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        templateHint: { type: 'string', description: 'Optional inferred connector hint; never ask the user to choose it.' },
        semver: { type: 'string', description: 'Optional tool semver when type=tool.' },
        open: { type: 'boolean', description: 'For tool creation, whether to open the scaffolded tool window. Default true.' },
      },
      required: ['name', 'intent'],
      additionalProperties: false,
    },
  },
  {
    name: 'ac.capability.draft_list',
    description: '列出本地能力包草稿，用于连接页或对象对话确认当前已创建的连接/工具/工作流草稿。',
    risk: 'safe',
    surfaces: ['companion', 'shell'],
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'ac.capability.validate_draft',
    description: '统一校验能力包草稿，返回该连接或工具当前是否满足生命周期/发布前基础要求。',
    risk: 'safe',
    whenToUse:
      'Use before install/run/publish or while repairing a capability object. It validates the CapabilityPackage through the unified lifecycle and returns Chinese-readable issues without publishing anything.',
    surfaces: ['companion', 'shell'],
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Capability package id.' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'ac.capability.context_get',
    description: '读取单个能力包对象对话上下文，包含 manifest、安装记录、probe 状态和最近事件。',
    risk: 'safe',
    whenToUse:
      'Use at the start of a capability object conversation or after install/probe/uninstall to refresh the bound object state. It must return only the requested package context and must not mix different connections or tools.',
    surfaces: ['companion', 'shell'],
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Capability package id, e.g. photoshop.' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'ac.capability.event_append',
    description: '向单个能力包对象追加运行、探测、修复或复测事件，用于 loop engine 对象级闭环。',
    risk: 'confirm',
    whenToUse:
      'Use when a capability-specific run/probe/test fails or is fixed, so the failure log belongs to that exact package session instead of global chat. Do not use it to mark real probe success without ac.capability.probe.',
    surfaces: ['companion', 'shell'],
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Capability package id.' },
        kind: { type: 'string', description: 'Event kind, e.g. run_failed, fix_applied, retest_passed.' },
        ok: { type: 'boolean' },
        message: { type: 'string' },
        detail: { type: 'object' },
      },
      required: ['id', 'kind'],
      additionalProperties: false,
    },
  },
  {
    name: 'ac.capability.template_draft_create',
    description: '为模板待接入的软件连接生成连接模板草稿，并作为该 CapabilityPackage 的对象事件保存；会按软件类型补齐接入计划，不会写入生产 bridge definitions。',
    risk: 'confirm',
    whenToUse:
      'Legacy-compatible draft tool for older template_missing recovery. Prefer the unknown-first strategy flow: read connectionFacts and StrategyDraft/candidateStrategies, then save any proposed bridge plan on the current capability object only. Do not ask the user to choose a technical template, do not mark the host supported, do not write local-companion/src/bridges/definitions, and do not publish cloud versions.',
    surfaces: ['companion', 'shell'],
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Software connection capability package id.' },
        hostId: { type: 'string', description: 'Inferred host id, e.g. blender or spine.' },
        appName: { type: 'string', description: 'Target software name.' },
        kind: {
          type: 'string',
          enum: ['executable', 'script_dcc', 'project_plugin', 'command_port', 'heartbeat', 'unknown'],
        },
        files: { type: 'array', items: { type: 'string' }, description: 'Files that would need to be generated later. Optional; defaults are inferred from kind.' },
        requiredUserDirs: { type: 'array', items: { type: 'string' }, description: 'Directories the user may need to choose. Optional; defaults are inferred from kind.' },
        probeSignal: { type: 'string', description: 'Real signal required to call the connection connected. Optional; defaults are inferred from kind.' },
        safetyBoundaries: { type: 'array', items: { type: 'string' }, description: 'Safety constraints for this connector. Optional; defaults are inferred from kind.' },
        notes: { type: 'string' },
      },
      required: ['id', 'appName', 'kind'],
      additionalProperties: false,
    },
  },
  {
    name: 'ac.capability.lifecycle_run',
    description: '统一能力包生命周期调度入口，按 packageId + action 触发 validate/install/run/probe/uninstall/open_conversation。',
    risk: 'confirm',
    whenToUse:
      'Use as the preferred capability lifecycle entry once a CapabilityPackage exists. For software_connection probe it must still use the real probe path; for tool run it must write run_failed/run_passed events to that tool context. Workflow run belongs to ScriptHub Workflow Runtime; the local shell only validates/publishes/switches the workflow projection.',
    surfaces: ['companion', 'shell'],
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Capability package id.' },
        action: {
          type: 'string',
          enum: ['validate', 'install', 'run', 'probe', 'uninstall', 'launch', 'close', 'discover_running', 'publish', 'switch_version', 'open_conversation'],
        },
        targetDir: { type: 'string' },
        executablePath: { type: 'string', description: 'Optional executable path for action=launch; must match the target host executable.' },
        targetId: { type: 'string', description: 'Optional saved host target id for action=launch.' },
        currentStrategyId: { type: 'string', description: 'Optional verified/candidate strategy id currently being attempted.' },
        actionId: { type: 'string' },
        params: { type: 'object' },
        actorRole: { type: 'string', description: 'Optional caller role for publish gate checks, e.g. admin.' },
        isAdmin: { type: 'boolean', description: 'Optional explicit admin flag for local publish gate checks.' },
        semver: { type: 'string', description: 'Optional semver for action=publish.' },
        versionId: { type: 'string', description: 'Required when action=switch_version.' },
        versionNote: { type: 'string', description: 'Required when action=publish.' },
        publishedBy: { type: 'string', description: 'Optional publisher id/email for action=publish.' },
      },
      required: ['id', 'action'],
      additionalProperties: false,
    },
  },
  {
    name: 'ac.capability.connection_loop_run',
    description: 'Run a bounded, object-scoped software connection loop for Copilot: refresh context, optionally discover/launch/install/probe, record evidence, and return the next object state.',
    risk: 'confirm',
    whenToUse:
      'Use when the user wants Copilot to independently fix or complete a software connection. This is the PI-style path: the connection is a long-lived object, Copilot gets bounded permissions, every action goes through ac.capability.lifecycle_run/context/events, and real connection success still requires a real probe signal. If connectionState.maturity is strategy_draft, read connectionFacts and candidateStrategies, record failedStrategyId/failureClass when a strategy fails, then select the next candidate strategy through softwareBridgeRegistry strategy flow, without editing capabilityLifecycle.ts. If no candidate remains, return needs_user_action.',
    surfaces: ['companion', 'shell'],
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Software connection capability package id.' },
        goal: { type: 'string', description: 'Natural language goal for this bounded loop.' },
        permissions: {
          type: 'array',
          items: {
            type: 'string',
            enum: [
              'context.read',
              'process.discover',
              'process.launch',
              'bridge.install',
              'connection.probe',
              'event.write',
              'conversation.open',
            ],
          },
          description: 'Explicit permissions for this run. Omit risky permissions to make the loop read-only or probe-only.',
        },
        targetDir: { type: 'string', description: 'Optional install target folder for bridge.install.' },
        executablePath: { type: 'string', description: 'Optional executable path for process.launch; lifecycle validation still applies.' },
        currentStrategyId: { type: 'string', description: 'Optional current candidate strategy id being attempted.' },
        failedStrategyId: { type: 'string', description: 'Optional strategy id that just failed and should be recorded.' },
        failedStrategyIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Strategy ids already attempted and failed in this connection loop.',
        },
        failureClass: { type: 'string', description: 'Structured failure class, for example missing_path, permission_denied, probe_failed, host_not_running, or unknown.' },
        failureMessage: { type: 'string', description: 'Human-readable failure evidence for failedStrategyId.' },
        maxSteps: { type: 'number', description: 'Bounded step limit. Default 6, max 8.' },
      },
      required: ['id', 'goal', 'permissions'],
      additionalProperties: false,
    },
  },
  {
    name: 'ac.capability.publish_gate_check',
    description: 'Check whether a local CapabilityPackage draft is allowed to be submitted to governed cloud publishing without writing a cloud version.',
    risk: 'safe',
    whenToUse:
      'Use before any cloud submit button or publish action. It must require admin when governance says so, require a version note, require a real probe for software_connection packages, and keep local draft events out of cloud history.',
    surfaces: ['companion', 'shell'],
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Capability package id.' },
        actorRole: { type: 'string', description: 'Optional caller role, e.g. admin.' },
        isAdmin: { type: 'boolean', description: 'Set true only when the current signed-in user is an admin.' },
        versionNote: { type: 'string', description: 'Human version note for the governed cloud version.' },
      },
      required: ['id', 'versionNote'],
      additionalProperties: false,
    },
  },
  {
    name: 'ac.capability.publish_cloud',
    description: '统一提交能力包到云端版本库；执行管理员、版本说明和真实 probe 门禁。',
    risk: 'confirm',
    whenToUse:
      'Use only when the user explicitly wants to submit/publish a capability package to cloud. It must go through the unified lifecycle publish action, require admin permission and versionNote, require real probe for software_connection, and must not turn local draft history into cloud versions automatically.',
    surfaces: ['companion', 'shell'],
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Capability package id.' },
        actorRole: { type: 'string', description: 'Optional caller role, e.g. admin.' },
        isAdmin: { type: 'boolean', description: 'Set true only when the signed-in user is an admin.' },
        semver: { type: 'string', description: 'Semver for the cloud version.' },
        versionNote: { type: 'string', description: 'Human version note. Required.' },
        publishedBy: { type: 'string', description: 'Optional publisher id/email.' },
      },
      required: ['id', 'versionNote'],
      additionalProperties: false,
    },
  },
  {
    name: 'ac.capability.install',
    description: '按能力包生命周期安装本地软件连接；P1 样板支持 Photoshop ExtendScript heartbeat。',
    risk: 'confirm',
    whenToUse:
      'Use inside a capability object conversation when the user wants to install the current software_connection. This must call the real lifecycle path and must not count file/card existence as connection success.',
    surfaces: ['companion', 'shell'],
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Capability package id, e.g. photoshop.' },
        targetDir: { type: 'string', description: 'User-selected script/plugin/install directory.' },
        port: { type: 'number' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'ac.capability.probe',
    description: '按能力包生命周期探测本地软件连接；P1 样板读取 Photoshop 真实 heartbeat。',
    risk: 'safe',
    whenToUse:
      'Use after installing or when the user asks whether the current connection really works. It must require a real heartbeat/host signal and return failure if the software has not produced one.',
    surfaces: ['companion', 'shell'],
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Capability package id, e.g. photoshop.' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'ac.capability.uninstall',
    description: '按能力包生命周期卸载本地软件连接脚本；P1 样板支持 Photoshop。',
    risk: 'confirm',
    surfaces: ['companion', 'shell'],
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Capability package id, e.g. photoshop.' },
        targetDir: { type: 'string', description: 'Optional explicit directory to remove generated files from.' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'ac.companion.host_bridge.create_draft',
    description:
      'Legacy recovery/debug entry for creating a local host bridge draft. Normal user-facing software connection creation must use ac.capability.create_draft with type=software_connection.',
    risk: 'confirm',
    deprecated: true,
    whenToUse:
      'Legacy host bridge recovery only. If the user asks Copilot to add/create a new host application integration, prefer ac.capability.create_draft with type=software_connection and natural-language intent. Ask only for the host software name when possible; do not ask the user to choose a technical template.',
    surfaces: ['companion', 'shell'],
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Optional stable lowercase host id, e.g. spine.' },
        name: { type: 'string', description: 'Host software name, e.g. Spine.' },
        category: { type: 'string', enum: ['3d', 'engine', 'paint', 'post', 'compositing'] },
        defaultPort: { type: 'number' },
        connectorLabel: { type: 'string' },
        entryFile: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        description: { type: 'string' },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'ac.companion.host_bridge.validate_draft',
    description: 'Legacy recovery/debug entry for validating a local host bridge draft before it is recovered into the capability package mainline.',
    risk: 'safe',
    deprecated: true,
    whenToUse:
      'Legacy host bridge recovery only. For normal capability validation use ac.capability.validate_draft or ac.capability.lifecycle_run with action=validate.',
    surfaces: ['companion', 'shell'],
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'ac.companion.host_bridge.acceptance_status',
    description:
      'Legacy read-only acceptance gate for the old Host Center recovery pool: total hosts, ready/one-click counts, accepted groups, missing groups, accepted hosts, and recommended next hosts to verify.',
    risk: 'safe',
    deprecated: true,
    whenToUse:
      'Legacy host bridge recovery only. Use before answering what remains for old Host Center acceptance, release readiness, or real-software bridge acceptance. This is read-only and must not mark missing groups as passed.',
    surfaces: ['companion', 'shell'],
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: 'ac.companion.host_bridge.install',
    description: 'Legacy recovery/debug entry for installing a local draft or synced cloud host bridge into a user-provided script/plugin directory.',
    risk: 'confirm',
    deprecated: true,
    whenToUse:
      'Legacy host bridge recovery only. For normal software_connection capability install use ac.capability.install or ac.capability.lifecycle_run with action=install. This writes real bridge files through the registered template.',
    surfaces: ['companion', 'shell'],
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        targetDir: { type: 'string', description: 'User-selected script/plugin/project directory.' },
        port: { type: 'number' },
      },
      required: ['id', 'targetDir'],
      additionalProperties: false,
    },
  },
  {
    name: 'ac.companion.host_bridge.probe',
    description: 'Legacy recovery/debug entry for probing a local draft or synced cloud host bridge using its real HTTP or heartbeat probe.',
    risk: 'safe',
    deprecated: true,
    whenToUse:
      'Legacy host bridge recovery only. For normal software_connection capability probing use ac.capability.probe or ac.capability.lifecycle_run with action=probe; success must still come from a real HTTP/heartbeat/host signal.',
    surfaces: ['companion', 'shell'],
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'ac.companion.host_bridge.launch_host',
    description: 'Legacy recovery/debug entry for launching a supported host application from the old Host Center executable registry.',
    risk: 'confirm',
    deprecated: true,
    whenToUse:
      'Legacy host bridge recovery only. Use when the user asks to open/start/launch a host application such as Maya, Blender, Photoshop, Unity, Unreal, or another app and the executable is already known in the legacy registry.',
    surfaces: ['companion', 'shell'],
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Host id, e.g. blender, maya, photoshop, unity.' },
        executablePath: { type: 'string', description: 'Optional explicit exe path selected or provided by the user.' },
        versionId: { type: 'string', description: 'Optional saved Host Center version id to launch when the user names a specific software version.' },
        targetId: { type: 'string', description: 'Optional saved Host Center manual target id to launch.' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'ac.companion.host_bridge.close_host',
    description: 'Legacy recovery/debug entry for closing a supported host application by its whitelisted Host Center process name.',
    risk: 'confirm',
    deprecated: true,
    whenToUse:
      'Legacy host bridge recovery only. Use when the user asks to close/quit/stop a host application from the old Host Center registry. This does not accept arbitrary process names.',
    surfaces: ['companion', 'shell'],
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Host id, e.g. blender, maya, photoshop, unity.' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'ac.companion.host_bridge.discover_running_host',
    description:
      'Legacy recovery/debug entry for detecting a running supported host application and saving its executable folder in the old Host Center registry.',
    risk: 'confirm',
    deprecated: true,
    whenToUse:
      'Legacy host bridge recovery only. Use when the user says the host application is already open/running and wants AssetCutter to find its launch location or save it as a legacy version.',
    surfaces: ['companion', 'shell'],
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Host id, e.g. blender, maya, photoshop, unity.' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'ac.companion.host_bridge.uninstall',
    description: 'Legacy recovery/debug entry for uninstalling a local draft or synced cloud host bridge by removing only recorded generated files.',
    risk: 'confirm',
    deprecated: true,
    whenToUse:
      'Legacy host bridge recovery only. For normal software_connection capability uninstall use ac.capability.uninstall or ac.capability.lifecycle_run with action=uninstall.',
    surfaces: ['companion', 'shell'],
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'ac.companion.host_bridge.delete_draft',
    description: 'Legacy recovery/debug entry for deleting a local Copilot host bridge draft. This does not delete built-in or cloud hosts.',
    risk: 'confirm',
    deprecated: true,
    whenToUse:
      'Legacy host bridge recovery only. New user-facing connection drafts should be managed through CapabilityPackage draft APIs.',
    surfaces: ['companion', 'shell'],
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
      },
      required: ['id'],
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
            'Optional Workflow tool.json-style manifest for later ac.workflow.promote_script_hub_tool preflight validation.',
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
    description: 'Governed preflight entrance for promoting an agent skill/workflow draft into a Workflow tool. The current implementation only reports missing gates and does not publish.',
    risk: 'confirm',
    surfaces: ['script_hub', 'shell'],
    inputSchema: {
      type: 'object',
      properties: {
        skillId: { type: 'string', description: 'Skill/workflow id to promote' },
        toolName: { type: 'string', description: 'Target Workflow tool name' },
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
  script_hub: 'Workflow',
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
  'ac.capability.draft_create': {
    title: '创建能力包草稿',
    whenToUse: '用户通过“连接”页对话添加本机软件连接时使用；创建 software_connection 能力包草稿，不恢复旧 62 宿主列表。',
    exampleArguments: { type: 'software_connection', name: 'Photoshop', tags: ['图像'] },
    successSignals: ['返回 draft.type=software_connection、source=draft，并带有独立 capability conversation session。'],
  },
  'ac.capability.create_draft': {
    title: '对话创建能力包',
    whenToUse: '首选统一创建入口。用户说创建工具、添加连接、创建工作流或通过对话长出能力时使用；自动判断 tool/software_connection/workflow。',
    exampleArguments: { name: '随机选择工具', intent: '做一个可配置候选项并随机抽取的小工具' },
    successSignals: ['工具请求会创建本机工具草稿和 tool 能力包；软件请求会创建 software_connection 能力包；工作流请求会创建 workflow 能力包；且不把技术模板决策交给用户。'],
  },
  'ac.capability.draft_list': {
    title: '列出能力包草稿',
    whenToUse: '需要确认连接页应显示哪些本地草稿，或继续某个能力包对象对话前使用。',
    exampleArguments: {},
    successSignals: ['返回 drafts 数组；没有草稿时为空数组，而不是旧 62 宿主 catalog。'],
  },
  'ac.capability.validate_draft': {
    title: '校验能力包草稿',
    whenToUse: '安装、运行、发布或对象级修复前检查当前能力包是否有效。',
    exampleArguments: { id: 'photoshop' },
    successSignals: ['返回统一生命周期 validate 结果；只读，不写云端版本。'],
  },
  'ac.capability.context_get': {
    title: '读取能力包上下文',
    whenToUse: '对象对话开始、安装/探测/卸载后刷新当前能力包状态时使用。',
    exampleArguments: { id: 'photoshop' },
    successSignals: ['返回 session、contextPrompt、package、recentEvents；不同能力包 session 不串线。'],
  },
  'ac.capability.event_append': {
    title: '追加能力包事件',
    whenToUse: '工具或连接对象的运行失败、修复、复测结果需要进入该对象上下文时使用。',
    exampleArguments: { id: 'random-selector', kind: 'run_failed', ok: false, message: '空列表时报错' },
    successSignals: ['再次 context_get 时 recentEvents 包含该对象自己的事件。'],
  },
  'ac.capability.lifecycle_run': {
    title: '运行能力包生命周期',
    whenToUse: '已有能力包后优先使用的统一生命周期入口。',
    exampleArguments: { id: 'photoshop', action: 'probe' },
    successSignals: ['软件连接 probe 仍来自真实信号；工具 run 会把 run_failed/run_passed 写入该工具对象上下文。'],
  },
  'ac.capability.connection_loop_run': {
    title: 'Connection Agent loop',
    whenToUse: 'Use for PI-style connection work: Copilot can keep working on one software connection object with explicit bounded permissions. For strategy_draft, read connectionFacts/candidateStrategies and switch strategies after failure.',
    exampleArguments: {
      id: 'photoshop',
      goal: 'Install and verify the connection',
      permissions: ['context.read', 'process.discover', 'bridge.install', 'connection.probe', 'event.write'],
    },
    successSignals: ['Returns ordered steps, finalContext, and nextAction; probe success still requires a real host signal. If nextAction=run_next_connection_strategy, continue with the selected candidate. If nextAction=needs_user_action, all candidates are exhausted or external confirmation is required.'],
  },
  'ac.capability.template_draft_create': {
    title: '创建连接模板草稿',
    whenToUse: '连接成熟度为 template_missing 时使用；只把模板接入计划保存为当前连接对象事件，不写生产 bridge definition。只要判断出 kind，系统会补齐默认文件、目录、探测信号和安全边界。',
    exampleArguments: {
      id: 'spine',
      appName: 'Spine',
      kind: 'script_dcc',
      probeSignal: '由 Spine 脚本写入的新鲜 heartbeat 文件',
    },
    successSignals: ['返回 templateDraft.productionDefinition=false；对象 recentEvents 出现 connection_template_draft_created。'],
  },
  'ac.capability.publish_cloud': {
    title: '提交云端版本',
    whenToUse: '管理员明确要把能力包提交到云端版本库时使用。',
    exampleArguments: { id: 'random-selector', isAdmin: true, semver: '0.2.0', versionNote: '补充空列表提示' },
    successSignals: ['通过统一发布门禁后生成云端版本；普通用户、缺少版本说明或软件连接未真实 probe 都会被拦截。'],
  },
  'ac.capability.install': {
    title: '安装能力包连接',
    whenToUse: '连接对象对话中需要安装本机软件连接时使用；P1 样板支持 Photoshop。',
    exampleArguments: { id: 'photoshop', targetDir: 'C:\\\\Users\\\\me\\\\AppData\\\\Roaming\\\\Adobe\\\\Adobe Photoshop 2026\\\\Presets\\\\Scripts' },
    successSignals: ['返回真实安装结果和写入的脚本路径；这不等于连接成功，还需要 ac.capability.probe。'],
  },
  'ac.capability.probe': {
    title: '探测能力包连接',
    whenToUse: '安装后或排障时确认连接是否真的可用。必须依赖真实 heartbeat/host signal。',
    exampleArguments: { id: 'photoshop' },
    successSignals: ['只有收到真实 Photoshop heartbeat 时才返回 ok；未运行脚本时应失败。'],
  },
  'ac.capability.uninstall': {
    title: '卸载能力包连接',
    whenToUse: '用户要移除某个连接能力包安装过的本地脚本时使用。',
    exampleArguments: { id: 'photoshop' },
    successSignals: ['返回 removed 列表或卸载结果。'],
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
  'ac.shell_tool.list': {
    title: '列出小工具',
    whenToUse: '需要查看已安装或自建草稿小工具时使用。',
    exampleArguments: {},
    successSignals: ['返回 installed 与 authored 列表。'],
  },
  'ac.shell_tool.scaffold': {
    title: '创建自建小工具壳',
    whenToUse: '用户要用 Copilot 新建本机小工具时，先 scaffold 再迭代改包。',
    exampleArguments: { id: 'my-converter', name: '我的转换器', open: true },
    successSignals: ['返回 toolId，工具架出现「我的」工具并可开窗。'],
  },
  'ac.shell_tool.authored_upsert': {
    title: '更新自建小工具文件',
    whenToUse: '修改 tool.json、panel.json 或 scripts 后保存；保存即热重载。',
    exampleArguments: {
      toolId: 'my-converter',
      files: [{ path: 'module/panel.json', content: '{}' }],
    },
    successSignals: ['返回 written 文件列表；工具窗自动刷新。'],
  },
  'ac.shell_tool.export': {
    title: '导出小工具 ZIP',
    whenToUse: '用户要导出或准备提交审批时打包 ZIP。',
    exampleArguments: { toolId: 'my-converter' },
    successSignals: ['返回 zipPath、sha256、bytes。'],
  },
  'ac.shell_tool.import': {
    title: '导入小工具 ZIP',
    whenToUse: '用户提供本机 ZIP 路径，导入为我的工具。',
    exampleArguments: { zipPath: 'C:/temp/my-converter-0.1.0.zip', open: true },
    successSignals: ['返回 toolId 与安装结果。'],
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
    title: 'Workflow tool promotion preflight',
    whenToUse:
      'Use after a reusable skill/workflow draft is saved and an admin wants to check whether it can become a governed Workflow tool.',
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
