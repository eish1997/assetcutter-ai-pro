import type { ParamSchemaV1, ParamFieldV1 } from './types/scriptHub';

export const DEFAULT_PARAM_SCHEMA: ParamSchemaV1 = {
  schemaVersion: 1,
  fields: [
    {
      key: 'message',
      type: 'string',
      label: '输出消息',
      description: '将在 Maya 脚本编辑器中打印',
      default: 'Script Hub',
      required: false,
    } satisfies ParamFieldV1,
  ],
};

export const DEFAULT_MAYA_SCRIPT = `def run(params):
    msg = str(params.get("message") or "Script Hub")
    print("[Script Hub smoke] OK — message=" + repr(msg))
`;
