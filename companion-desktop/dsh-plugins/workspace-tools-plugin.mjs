import { defineTool } from '../dsh-bundled/node_modules/@deepseek-ai/dsh-tools/lib/index.js'

export const name = 'assetcutter-workspace-tools'
export const inject = ['tools']

function toolsOrigin() {
  return String(process.env.ASSETCUTTER_DSH_TOOLS || 'http://127.0.0.1:3081').trim().replace(/\/$/, '')
}

async function postJson(path, body) {
  const res = await fetch(toolsOrigin() + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  })
  return await res.json()
}

function jsonOutput() {
  return {
    schema: { type: 'string' },
    render(_args, value) {
      return [{ type: 'text', text: String(value || '') }]
    },
  }
}

export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: 'workspace_read_document',
    description: 'Read the shared workbench document (cards + finger). This is the same draft the user is editing.',
    parameters: {},
    output: jsonOutput(),
    async execute() {
      const out = await fetch(`${toolsOrigin()}/workspace/document`).then((r) => r.json())
      return JSON.stringify(out)
    },
  }))
  ctx.tools.register(defineTool({
    name: 'workspace_read_finger',
    description: 'Read the current workspace finger (selection, preview, connected hosts).',
    parameters: {},
    output: jsonOutput(),
    async execute() {
      const out = await fetch(`${toolsOrigin()}/workspace/finger`).then((r) => r.json())
      return JSON.stringify(out)
    },
  }))
  ctx.tools.register(defineTool({
    name: 'workspace_dispatch',
    description: 'Mutate the shared document. Commands: set_finger, upsert_asset, remove_asset, append_text_result, ingest_image, generate_on_current, send_to_current_host, open_surface.',
    parameters: {
      type: { type: 'string', required: true, description: 'Document command type.' },
      payload: { type: 'object', additionalProperties: true },
    },
    output: jsonOutput(),
    async execute(args) {
      const out = await postJson('/workspace/dispatch', args || {})
      return JSON.stringify(out)
    },
  }))
  ctx.tools.register(defineTool({
    name: 'workspace_open_surface',
    description: 'Open a building room in the shell: canvas, workflow, tools, connections, settings, or a leased room.',
    parameters: {
      surface: { type: 'string', required: true, description: 'Room to open.' },
    },
    output: jsonOutput(),
    async execute(args) {
      const out = await postJson('/workspace/open-surface', args || {})
      return JSON.stringify(out)
    },
  }))
  ctx.tools.register(defineTool({
    name: 'connection_list',
    description: 'List software_connection capability-package drafts and connection maturity from the communications room.',
    parameters: {},
    output: jsonOutput(),
    async execute() {
      const out = await fetch(`${toolsOrigin()}/connection/drafts`).then((r) => r.json())
      return JSON.stringify(out)
    },
  }))
  ctx.tools.register(defineTool({
    name: 'connection_create',
    description: 'Add a map destination (software_connection draft) by software name. Use after connection_list shows it is missing. Do not invent executable paths.',
    parameters: {
      name: { type: 'string', required: true, description: 'Software place name, e.g. Maya.' },
      hostId: { type: 'string', description: 'Optional known host id such as maya.' },
    },
    output: jsonOutput(),
    async execute(args) {
      const out = await postJson('/connection/create', args || {})
      return JSON.stringify(out)
    },
  }))
  ctx.tools.register(defineTool({
    name: 'connection_probe',
    description: 'Probe a connection draft for a real host signal.',
    parameters: {
      draftId: { type: 'string', required: true, description: 'software_connection draft id.' },
    },
    output: jsonOutput(),
    async execute(args) {
      const out = await postJson('/connection/probe', args || {})
      return JSON.stringify(out)
    },
  }))
  ctx.tools.register(defineTool({
    name: 'connection_discover',
    description: 'Discover running local software for eligible connection drafts.',
    parameters: {},
    output: jsonOutput(),
    async execute() {
      const out = await postJson('/connection/discover', {})
      return JSON.stringify(out)
    },
  }))
  ctx.tools.register(defineTool({
    name: 'host_list_primitives',
    description: 'List map-visible host primitive routes (inner lines) for a software_connection draft.',
    parameters: {
      draftId: { type: 'string', required: true, description: 'software_connection draft id.' },
    },
    output: jsonOutput(),
    async execute(args) {
      const draftId = encodeURIComponent(String(args.draftId || '').trim())
      const out = await fetch(`${toolsOrigin()}/host/primitives/${draftId}`).then((r) => r.json())
      return JSON.stringify(out)
    },
  }))
  ctx.tools.register(defineTool({
    name: 'host_invoke_primitive',
    description: 'Invoke a host primitive such as host.import_file for a connected software draft.',
    parameters: {
      draftId: { type: 'string', required: true, description: 'software_connection draft id.' },
      primitiveId: { type: 'string', required: true, description: 'Host primitive id, usually host.import_file.' },
      params: { type: 'object', additionalProperties: true },
    },
    output: jsonOutput(),
    async execute(args) {
      const body = args && typeof args === 'object' ? args : {}
      const out = await postJson('/host/invoke', {
        draftId: body.draftId,
        primitiveId: String(body.primitiveId || 'host.import_file').trim() || 'host.import_file',
        params: body.params,
      })
      return JSON.stringify(out)
    },
  }))
  ctx.tools.register(defineTool({
    name: 'replay_trace_list',
    description: 'List recent 3081 tool traces used to compile a replay 代工单.',
    parameters: {},
    output: jsonOutput(),
    async execute() {
      const out = await fetch(`${toolsOrigin()}/replay/trace`).then((r) => r.json())
      return JSON.stringify(out)
    },
  }))
  ctx.tools.register(defineTool({
    name: 'replay_compile',
    description: 'Compile the recent tool trace into a frozen replay 代工单, run fixture tests, and list it in the replay room if it passes.',
    parameters: {},
    output: jsonOutput(),
    async execute() {
      const out = await postJson('/replay/compile', {})
      return JSON.stringify(out)
    },
  }))
  ctx.tools.register(defineTool({
    name: 'replay_run',
    description: 'Run a frozen replay 代工单 after confirming variable slots. Do not change the procedure.',
    parameters: {
      replayId: { type: 'string', required: true, description: 'Workflow / replay id, e.g. workflow.maya.export_selection_fbx.' },
      params: { type: 'object', additionalProperties: true, description: 'Confirmed input slots.' },
    },
    output: jsonOutput(),
    async execute(args) {
      const out = await postJson('/replay/run', args || {})
      return JSON.stringify(out)
    },
  }))
  ctx.tools.register(defineTool({
    name: 'replay_list',
    description: 'List replay 代工单 currently on the replay room wall.',
    parameters: {},
    output: jsonOutput(),
    async execute() {
      const out = await fetch(`${toolsOrigin()}/replay/list`).then((r) => r.json())
      return JSON.stringify(out)
    },
  }))
  ctx.tools.register(defineTool({
    name: 'shell_tool_list',
    description: 'List installed shell tools on the tools shelf.',
    parameters: {},
    output: jsonOutput(),
    async execute() {
      const out = await fetch(`${toolsOrigin()}/shell-tools`).then((r) => r.json())
      return JSON.stringify(out)
    },
  }))
  ctx.tools.register(defineTool({
    name: 'shell_tool_install',
    description: 'Install a shelf tool from the builtin example or a catalog URL. Call shell_tool_list first.',
    parameters: {
      exampleId: { type: 'string', description: 'Builtin example tool id such as image-format-converter.' },
      url: { type: 'string', description: 'Catalog install URL when not using a builtin example.' },
    },
    output: jsonOutput(),
    async execute(args) {
      const out = await postJson('/shell-tools/install', args || {})
      return JSON.stringify(out)
    },
  }))
}
