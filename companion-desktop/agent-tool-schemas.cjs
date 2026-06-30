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
      },
      required: ['presetId'],
      additionalProperties: false,
    },
  },
  {
    name: 'ac.script_hub.list_scripts',
    description: '列出 Script Hub 脚本库（需 scripts 域已登录）',
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
    description: '创建 Script Hub Run 并在本机伴侣排队执行（如 Maya）',
    risk: 'confirm',
    surfaces: ['script_hub'],
    inputSchema: {
      type: 'object',
      properties: {
        scriptId: { type: 'string' },
        revisionId: { type: 'string' },
        targetType: { type: 'string', enum: ['maya', 'unreal'] },
        params: { type: 'object' },
      },
      required: ['scriptId', 'revisionId', 'targetType'],
      additionalProperties: false,
    },
  },
  {
    name: 'ac.script_hub.get_run',
    description: '查询 Script Hub Run 状态',
    risk: 'safe',
    surfaces: ['script_hub'],
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string' },
      },
      required: ['runId'],
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
    name: 'ac.memory.list',
    description: '列出持久化用户记忆条目',
    risk: 'safe',
    surfaces: ['shell'],
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number' } },
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
      },
      required: ['text'],
      additionalProperties: false,
    },
  },
];

const ALL_TOOL_SCHEMAS = [...P0_TOOL_SCHEMAS, ...P1_TOOL_SCHEMAS, ...P2_TOOL_SCHEMAS];

module.exports = { P0_TOOL_SCHEMAS, P1_TOOL_SCHEMAS, P2_TOOL_SCHEMAS, ALL_TOOL_SCHEMAS };
