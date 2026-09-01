# 整理成技能

whenToUse：用户说「把刚才的这套整理成技能 / 整理成复现 / 代工单 / 按刚才那样以后点一下」。没说这句话不要创建。

步骤：

1. 先 `workspace_open_surface`，surface=`workflow`（人进技能房间后才能上架）。
2. 读 `replay_trace_list`。没有痕迹就说明缺「刚才」的原料，禁止凭空编单。
3. 判断：下次还要临场发挥 → 只当说明书记住，调用不要 `replay_compile`。步骤已熟、只要点这张卡 → `replay_compile`。
4. `replay_compile`：把手续写成 SKILL.md 存到技能房间货架。已登记执行器（现在是 Maya FBX）会跑 fixture，通过才上墙。Unreal 连接 / fog holdout 这类没有本机执行器的痕迹，上墙为技能卡，点执行交给管家按步骤办，不要调用 `replay_run`，不要假装已有 Unreal 执行器。其它对不上的痕迹仍报 `replay_no_executor`。失败把错误码原样告诉用户。
5. 用户在墙上点「执行」后：自动执行器按 handoff 里的 replayId 确认变动格再 `replay_run`；技能卡按描述办事，禁止 `replay_run`。不要改工序。
