import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const name = 'assetcutter-workspace-finger'
export const inject = ['systemPrompt']

function injectDir() {
  return String(process.env.ASSETCUTTER_DSH_INJECT || '').trim()
}

function readInjectFile(dir, fileName) {
  try {
    return readFileSync(join(dir, fileName), 'utf8') || ''
  } catch {
    return ''
  }
}

export function apply(ctx) {
  ctx.systemPrompt.context({
    name: 'assetcutter-workspace-finger',
    order: 200,
    text() {
      const dir = injectDir()
      if (!dir) return ''
      return readInjectFile(dir, 'workspace-finger.txt')
    },
  })
  ctx.systemPrompt.context({
    name: 'assetcutter-workspace-handoff',
    order: 210,
    text() {
      const dir = injectDir()
      if (!dir) return ''
      const handoff = readInjectFile(dir, 'handoff.txt').trim()
      if (!handoff) return ''
      const domain = (handoff.match(/(?:^|\n)handoffDomain=([^\n]+)/) || [])[1] || ''
      const kind = (handoff.match(/(?:^|\n)kind=([^\n]+)/) || [])[1] || ''
      const replay =
        domain === 'replay' ||
        kind === 'replay_run' ||
        kind === 'replay_compile' ||
        kind.startsWith('replay_') ||
        /(?:^|\n)replayId=/.test(handoff)
      const tools = domain === 'tools' || kind.startsWith('tool')
      const room = domain === 'room' || kind === 'blank_room' || kind.startsWith('blank_room') || kind.startsWith('room_')
      const heading = replay
        ? '当前技能（handoff）：'
        : tools
          ? '当前工具货架（handoff）：'
          : room
            ? '当前空房（handoff）：'
            : '当前地图办事上下文（handoff）：'
      return [heading, handoff].join('\n')
    },
  })
  ctx.systemPrompt.context({
    name: 'assetcutter-replay-compile-skill',
    order: 220,
    text() {
      const dir = injectDir()
      if (!dir) return ''
      const skill = readInjectFile(dir, 'replay-compile-skill.txt').trim()
      if (!skill) return ''
      return skill
    },
  })
  ctx.systemPrompt.context({
    name: 'assetcutter-map-add-place-skill',
    order: 221,
    text() {
      const dir = injectDir()
      if (!dir) return ''
      const skill = readInjectFile(dir, 'map-add-place-skill.txt').trim()
      if (!skill) return ''
      return skill
    },
  })
  ctx.systemPrompt.context({
    name: 'assetcutter-tools-shelf-skill',
    order: 222,
    text() {
      const dir = injectDir()
      if (!dir) return ''
      const skill = readInjectFile(dir, 'tools-shelf-skill.txt').trim()
      if (!skill) return ''
      return skill
    },
  })
  ctx.systemPrompt.context({
    name: 'assetcutter-blank-room-skill',
    order: 223,
    text() {
      const dir = injectDir()
      if (!dir) return ''
      const skill = readInjectFile(dir, 'blank-room-skill.txt').trim()
      if (!skill) return ''
      return skill
    },
  })
}
