import React, { useState as useLocalState } from 'react';
import { AppMode, ArenaStepEntry, ArenaCurrentStep, ArenaTimelineBlock, DIALOG_IMAGE_GEARS } from '../types';
import { dialogGenerateImage, generateArenaPrompts, optimizeLoserPrompt, generateNewChallenger, getEditPrompt, normalizeApiErrorMessage, DEFAULT_PROMPTS } from '../services/geminiService';
import { loadSnippets, addSnippet, removeSnippet } from '../services/snippetStore';
import { addChoice } from '../services/abChoiceStore';

const ARENA_STEP_PREVIEW_LEN = 400;
function stepId() {
  return `arena_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
function blockId() {
  return `block_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
function parseSummaryFromRaw(raw: string): { summary?: string; error?: string } {
  try {
    const cleaned = (raw || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const obj = JSON.parse(cleaned);
    const parts: string[] = [];
    if (typeof obj.reasoning === 'string' && obj.reasoning.trim()) parts.push(`reasoning(${obj.reasoning.trim().length}字)`);
    if (typeof obj.promptA === 'string') parts.push('promptA');
    if (typeof obj.promptB === 'string') parts.push('promptB');
    if (typeof obj.promptC === 'string') parts.push('promptC');
    if (typeof obj.promptD === 'string') parts.push('promptD');
    if (typeof obj.prompt === 'string') parts.push('prompt');
    if (parts.length === 0) return { error: '未解析到已知字段' };
    return { summary: '已解析：' + parts.join('、') };
  } catch (e) {
    return { error: 'JSON 解析失败：' + String(e) };
  }
}

const ARENA_MAX_ROUNDS = 8;

export type PromptArenaSectionProps = {
  arenaUserDescription: string;
  setArenaUserDescription: (v: string) => void;
  arenaImage: string;
  setArenaImage: (v: string) => void;
  arenaRound: number;
  setArenaRound: React.Dispatch<React.SetStateAction<number>>;
  arenaInitialCount: 2 | 3 | 4;
  setArenaInitialCount: (v: 2 | 3 | 4) => void;
  arenaReasoning: string;
  setArenaReasoning: (v: string) => void;
  arenaOptimizeReasoning: string;
  setArenaOptimizeReasoning: (v: string) => void;
  arenaPromptA: string;
  setArenaPromptA: (v: string) => void;
  arenaImageA: string | null;
  setArenaImageA: (v: string | null) => void;
  arenaPromptB: string;
  setArenaPromptB: (v: string) => void;
  arenaImageB: string | null;
  setArenaImageB: (v: string | null) => void;
  arenaPromptC: string;
  setArenaPromptC: (v: string) => void;
  arenaImageC: string | null;
  setArenaImageC: (v: string | null) => void;
  arenaPromptD: string;
  setArenaPromptD: (v: string) => void;
  arenaImageD: string | null;
  setArenaImageD: (v: string | null) => void;
  arenaChampionPrompt: string | null;
  setArenaChampionPrompt: (v: string | null) => void;
  arenaChampionImage: string | null;
  setArenaChampionImage: (v: string | null) => void;
  arenaChallengerPrompt: string | null;
  setArenaChallengerPrompt: (v: string | null) => void;
  arenaChallengerImage: string | null;
  setArenaChallengerImage: (v: string | null) => void;
  arenaChallenger2Prompt: string | null;
  setArenaChallenger2Prompt: (v: string | null) => void;
  arenaChallenger2Image: string | null;
  setArenaChallenger2Image: (v: string | null) => void;
  arenaIsGenerating: boolean;
  setArenaIsGenerating: (v: boolean) => void;
  arenaIsOptimizing: boolean;
  setArenaIsOptimizing: (v: boolean) => void;
  arenaCompareModalOpen: boolean;
  setArenaCompareModalOpen: (v: boolean) => void;
  arenaReportedGaps: string[];
  setArenaReportedGaps: (v: string[] | ((prev: string[]) => string[])) => void;
  arenaWinnerStrength: string;
  setArenaWinnerStrength: (v: string) => void;
  arenaLoserRemark: string;
  setArenaLoserRemark: (v: string) => void;
  arenaCurrentStep: ArenaCurrentStep;
  setArenaCurrentStep: (v: ArenaCurrentStep) => void;
  arenaStepLog: ArenaStepEntry[];
  setArenaStepLog: React.Dispatch<React.SetStateAction<ArenaStepEntry[]>>;
  arenaTimeline: ArenaTimelineBlock[];
  setArenaTimeline: React.Dispatch<React.SetStateAction<ArenaTimelineBlock[]>>;
  arenaSaveSnippetConfirm: boolean;
  setArenaSaveSnippetConfirm: (v: boolean) => void;
  arenaSnippets: Array<{ id: string; text: string; timestamp: number; source?: string }>;
  setArenaSnippets: (v: Array<{ id: string; text: string; timestamp: number; source?: string }>) => void;
  arenaFirstVisit: boolean;
  setArenaFirstVisit: (v: boolean) => void;
  setMode: (m: AppMode) => void;
  addTask: (type: string, label: string) => string;
  updateTask: (id: string, patch: { status?: string; progress?: number; error?: string }) => void;
  addGlobalLog: (module: string, level: 'info' | 'warn' | 'error', message: string, detail?: string) => void;
  onFileUpload: (e: React.ChangeEvent<HTMLInputElement>, callback: (base64: string) => void) => void;
  modelText: string;
  promptEdit: string;
  dialogModel: string;
  arenaImageModel: string;
  setArenaImageModel: (v: string) => void;
};

const PromptArenaSection: React.FC<PromptArenaSectionProps> = (props) => {
  const {
    arenaUserDescription,
    setArenaUserDescription,
    arenaImage,
    setArenaImage,
    arenaRound,
    setArenaRound,
    arenaInitialCount,
    setArenaInitialCount,
    arenaReasoning,
    setArenaReasoning,
    arenaOptimizeReasoning,
    setArenaOptimizeReasoning,
    arenaPromptA,
    setArenaPromptA,
    arenaImageA,
    setArenaImageA,
    arenaPromptB,
    setArenaPromptB,
    arenaImageB,
    setArenaImageB,
    arenaPromptC,
    setArenaPromptC,
    arenaImageC,
    setArenaImageC,
    arenaPromptD,
    setArenaPromptD,
    arenaImageD,
    setArenaImageD,
    arenaChampionPrompt,
    setArenaChampionPrompt,
    arenaChampionImage,
    setArenaChampionImage,
    arenaChallengerPrompt,
    setArenaChallengerPrompt,
    arenaChallengerImage,
    setArenaChallengerImage,
    arenaChallenger2Prompt,
    setArenaChallenger2Prompt,
    arenaChallenger2Image,
    setArenaChallenger2Image,
    arenaIsGenerating,
    setArenaIsGenerating,
    arenaIsOptimizing,
    setArenaIsOptimizing,
    arenaCompareModalOpen,
    setArenaCompareModalOpen,
    arenaReportedGaps,
    setArenaReportedGaps,
    arenaWinnerStrength,
    setArenaWinnerStrength,
    arenaLoserRemark,
    setArenaLoserRemark,
    arenaCurrentStep,
    setArenaCurrentStep,
    arenaStepLog,
    setArenaStepLog,
    arenaTimeline,
    setArenaTimeline,
    arenaSaveSnippetConfirm,
    setArenaSaveSnippetConfirm,
    arenaSnippets,
    setArenaSnippets,
    arenaFirstVisit,
    setArenaFirstVisit,
    setMode,
    addTask,
    updateTask,
    addGlobalLog,
    onFileUpload,
    modelText,
    promptEdit,
    dialogModel,
    arenaImageModel,
    setArenaImageModel,
  } = props;

  const [processExpanded, setProcessExpanded] = useLocalState(true);
  const [expandedBlocks, setExpandedBlocks] = useLocalState<Set<string>>(new Set());
  const toggleBlock = (key: string) => setExpandedBlocks((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const copyToClipboard = (text: string) => { try { navigator.clipboard.writeText(text); addGlobalLog('提示词擂台', 'info', '已复制到剪贴板', undefined); } catch { addGlobalLog('提示词擂台', 'warn', '复制失败', undefined); } };
  const STAGES: { step: ArenaCurrentStep; label: string }[] = [
    { step: 'idle', label: '未开始' },
    { step: 'generating_prompts', label: '生成提示词' },
    { step: 'generating_images', label: '生图' },
    { step: 'awaiting_pick', label: '等待选择' },
    { step: 'optimizing_loser', label: '优化败者' },
    { step: 'generating_challenger_image', label: '挑战者生图' },
    { step: 'adding_challenger', label: '增加挑战者' }
  ];

  const startArena = async () => {
    if (!arenaImage) {
      addGlobalLog('提示词擂台', 'warn', '请先上传底图', undefined);
      return;
    }
    const desc = (arenaUserDescription || '').trim();
    if (!desc) {
      addGlobalLog('提示词擂台', 'warn', '请用自然语言描述想要的效果', undefined);
      return;
    }
    setArenaIsGenerating(true);
    setArenaReasoning('');
    setArenaOptimizeReasoning('');
    setArenaChallenger2Prompt(null);
    setArenaChallenger2Image(null);
    setArenaStepLog([]);
    setArenaTimeline([]);
    setArenaCurrentStep('generating_prompts');
    const count = arenaInitialCount;
    const taskId = addTask('DIALOG_GEN', `擂台 ${count} 选 ${count}`);
    const sysPrompt = count === 2 ? DEFAULT_PROMPTS.arena_ab : DEFAULT_PROMPTS.arena_ab_n;
    const userMsg =
      count === 2
        ? `User description: ${desc.slice(0, 500)}\n\nImportant: These prompts will be sent to the image model together with the user's uploaded image. Ensure each prompt is an instruction to modify or transform that image (not a standalone description of a new scene).`
        : `User description: ${desc.slice(0, 500)}\n\nN = ${count}. Output exactly ${count} prompts (promptA, promptB${count >= 3 ? ', promptC' : ''}${count >= 4 ? ', promptD' : ''}). Important: These prompts will be sent to the image model together with the user's uploaded image; ensure each prompt is an instruction to modify or transform that image (not a standalone description of a new scene).`;
    const stepPromptsId = stepId();
    setArenaStepLog((prev) => [
      ...prev,
      { id: stepPromptsId, step: 'generating_prompts', label: '首轮生成提示词', status: 'running', inputFull: sysPrompt + '\n\n' + userMsg, ts: Date.now() }
    ]);
    setArenaTimeline([{ id: blockId(), type: 'step_group', label: '首轮生成提示词', stepLogIds: [stepPromptsId], ts: Date.now() }]);
    try {
      updateTask(taskId, { status: 'RUNNING', progress: 10 });
      const { reasoning, prompts, rawResponse } = await generateArenaPrompts(desc, count, modelText);
      const parsed = rawResponse ? parseSummaryFromRaw(rawResponse) : {};
      setArenaStepLog((prev) =>
        prev.map((s) =>
          s.id === stepPromptsId
            ? { ...s, status: 'done', outputRaw: rawResponse, outputParsed: parsed.summary, parseError: parsed.error, ts: Date.now() }
            : s
        )
      );
      if (reasoning) setArenaReasoning(reasoning);
      updateTask(taskId, { progress: 40 });
      setArenaPromptA(prompts[0] ?? '');
      setArenaPromptB(prompts[1] ?? '');
      setArenaPromptC(count >= 3 ? (prompts[2] ?? '') : '');
      setArenaPromptD(count >= 4 ? (prompts[3] ?? '') : '');
      setArenaImageA(null);
      setArenaImageB(null);
      setArenaImageC(count >= 3 ? null : null);
      setArenaImageD(count >= 4 ? null : null);
      setArenaCurrentStep('generating_images');
      const labels = ['A', 'B', 'C', 'D'];
      const imageStepIds: string[] = [];
      for (let i = 0; i < prompts.length; i++) {
        const stepImgId = stepId();
        imageStepIds.push(stepImgId);
        const promptSlice = (prompts[i] ?? '').slice(0, 200);
        setArenaStepLog((prev) => [
          ...prev,
          { id: stepImgId, step: `generating_image_${i}`, label: `生图 ${labels[i]}`, status: 'running', inputFull: `提示词（${labels[i]}）：${promptSlice}${(prompts[i]?.length ?? 0) > 200 ? '…' : ''}`, ts: Date.now() }
        ]);
        try {
          const img = await dialogGenerateImage(arenaImage, prompts[i]!, arenaImageModel, undefined, promptEdit);
          setArenaStepLog((prev) =>
            prev.map((s) => (s.id === stepImgId ? { ...s, status: 'done', outputRaw: '成功', ts: Date.now() } : s))
          );
          if (i === 0) setArenaImageA(img);
          else if (i === 1) setArenaImageB(img);
          else if (i === 2) setArenaImageC(img);
          else setArenaImageD(img);
        } catch (imgErr: unknown) {
          const errMsg = normalizeApiErrorMessage(imgErr);
          setArenaStepLog((prev) =>
            prev.map((s) => (s.id === stepImgId ? { ...s, status: 'error', outputRaw: errMsg, ts: Date.now() } : s))
          );
        }
      }
      setArenaRound(0);
      setArenaCurrentStep('awaiting_pick');
      setArenaTimeline((prev) => [
        ...prev,
        { id: blockId(), type: 'step_group', label: '首轮生图', stepLogIds: imageStepIds, ts: Date.now() },
        { id: blockId(), type: 'comparison', label: '首轮选择', round: 0, ts: Date.now() }
      ]);
      updateTask(taskId, { status: 'SUCCESS', progress: 100 });
      addGlobalLog('提示词擂台', 'info', `${count} 条提示词已生成，请选择`, undefined);
    } catch (err: unknown) {
      const msg = normalizeApiErrorMessage(err);
      setArenaStepLog((prev) =>
        prev.map((s) => (s.id === stepPromptsId ? { ...s, status: 'error', outputRaw: msg, parseError: msg, ts: Date.now() } : s))
      );
      addGlobalLog('提示词擂台', 'error', '生成失败', msg);
      updateTask(taskId, { status: 'FAILED', error: msg });
      setArenaCurrentStep('idle');
    } finally {
      setArenaIsGenerating(false);
    }
  };

  /** 当前对比项：round 0 为 A/B/C/D，round>0 为 [擂主, 挑战者, 挑战者2?] */
  const currentOptions = (() => {
    if (arenaRound === 0) {
      const count = arenaInitialCount;
      const prompts = [arenaPromptA, arenaPromptB, arenaPromptC, arenaPromptD].slice(0, count);
      const images = [arenaImageA, arenaImageB, arenaImageC, arenaImageD].slice(0, count);
      return prompts.map((prompt, i) => ({ label: ['A', 'B', 'C', 'D'][i], prompt, image: images[i] }));
    }
    const opts: { label: string; prompt: string; image: string | null }[] = [
      { label: '擂主', prompt: arenaChampionPrompt!, image: arenaChampionImage },
      { label: '挑战者', prompt: arenaChallengerPrompt!, image: arenaChallengerImage }
    ];
    if (arenaChallenger2Prompt) opts.push({ label: '挑战者2', prompt: arenaChallenger2Prompt, image: arenaChallenger2Image });
    return opts;
  })();

  const handleArenaPick = async (winnerIndex: number, skipOptimize = false) => {
    if (winnerIndex < 0) {
      setArenaReportedGaps([]);
      setArenaWinnerStrength('');
      setArenaLoserRemark('');
      setArenaTimeline((prev) => {
        const last = prev[prev.length - 1];
        if (last?.type === 'comparison' && !last.comparisonSnapshot) return prev.map((b, i) => (i === prev.length - 1 ? { ...b, comparisonSnapshot: { options: currentOptions } } : b));
        return prev;
      });
      setArenaTimeline((prev) => [...prev, { id: blockId(), type: 'user_choice', label: '平局', ts: Date.now() }]);
      setArenaCurrentStep('idle');
      return;
    }
    const opts = currentOptions;
    if (winnerIndex >= opts.length) return;
    const newChampPrompt = opts[winnerIndex].prompt;
    const newChampImage = opts[winnerIndex].image;
    const winnerLabel = opts[winnerIndex].label;
    const losers = opts.filter((_, i) => i !== winnerIndex);
    setArenaTimeline((prev) => {
      const last = prev[prev.length - 1];
      if (last?.type === 'comparison' && !last.comparisonSnapshot)
        return prev.map((b, i) => (i === prev.length - 1 ? { ...b, comparisonSnapshot: { options: opts } } : b));
      return prev;
    });
    setArenaTimeline((prev) => [...prev, { id: blockId(), type: 'user_choice', label: `已选 ${winnerLabel}`, ts: Date.now() }]);
    if (opts.length >= 2) {
      addChoice({
        timestamp: Date.now(),
        snippetA: opts[0].prompt,
        snippetB: opts[1].prompt,
        winner: winnerIndex === 0 ? 'A' : winnerIndex === 1 ? 'B' : 'tie',
        fullPromptA: getEditPrompt(opts[0].prompt, promptEdit),
        fullPromptB: getEditPrompt(opts[1].prompt, promptEdit)
      });
    }
    setArenaChampionPrompt(newChampPrompt);
    setArenaChampionImage(newChampImage);
    setArenaRound(r => r + 1);
    setArenaChallenger2Prompt(null);
    setArenaChallenger2Image(null);
    if (arenaRound + 1 > ARENA_MAX_ROUNDS) {
      setArenaSaveSnippetConfirm(true);
      return;
    }
    const loserToOptimize = losers[0]?.prompt ?? newChampPrompt;
    const allPrevious = [newChampPrompt, ...losers.map(l => l.prompt)].filter(Boolean);
    if (skipOptimize) {
      setArenaChallengerPrompt(loserToOptimize);
      setArenaCurrentStep('generating_challenger_image');
      const stepImgId = stepId();
      setArenaStepLog((prev) => [
        ...prev,
        { id: stepImgId, step: 'generating_challenger_image', label: '挑战者生图（不优化）', status: 'running', inputFull: `提示词：${loserToOptimize.slice(0, 300)}${loserToOptimize.length > 300 ? '…' : ''}`, ts: Date.now() }
      ]);
      setArenaTimeline((prev) => [...prev, { id: blockId(), type: 'step_group', label: '挑战者生图（不优化）', stepLogIds: [stepImgId], ts: Date.now() }]);
      setArenaIsGenerating(true);
      try {
        const img = await dialogGenerateImage(arenaImage, loserToOptimize, arenaImageModel, undefined, promptEdit);
        setArenaStepLog((prev) => prev.map((s) => (s.id === stepImgId ? { ...s, status: 'done', outputRaw: '成功', ts: Date.now() } : s)));
        setArenaChallengerImage(img);
        setArenaCurrentStep('awaiting_pick');
        setArenaTimeline((prev) => [...prev, { id: blockId(), type: 'comparison', label: `第 ${arenaRound + 1} 轮`, round: arenaRound + 1, ts: Date.now() }]);
      } catch (imgErr: unknown) {
        const errMsg = normalizeApiErrorMessage(imgErr);
        setArenaStepLog((prev) => prev.map((s) => (s.id === stepImgId ? { ...s, status: 'error', outputRaw: errMsg, ts: Date.now() } : s)));
      } finally {
        setArenaIsGenerating(false);
      }
      return;
    }
    setArenaIsOptimizing(true);
    setArenaCurrentStep('optimizing_loser');
    const userText = [
      `Winner prompt (user preferred): ${newChampPrompt}`,
      `Loser prompt (to improve): ${loserToOptimize}`,
      arenaUserDescription.trim() ? `Original user intent: ${arenaUserDescription.trim()}` : '',
      allPrevious.length > 0 ? `Other prompts already in this arena (avoid repeating, use for context):\n${allPrevious.map((p, i) => `[${i + 1}] ${p}`).join('\n')}` : '',
      arenaReportedGaps.length > 0 ? `User-reported gaps in the loser (address or avoid these when improving): ${arenaReportedGaps.join(', ')}` : '',
      arenaWinnerStrength.trim() ? `User-reported strength of the winner (preserve or learn from): ${arenaWinnerStrength.trim()}` : '',
      arenaLoserRemark.trim() ? `User-reported remark about the loser (one sentence, address when improving): ${arenaLoserRemark.trim()}` : ''
    ].filter(Boolean).join('\n\n');
    const inputOptimize = DEFAULT_PROMPTS.arena_optimize_loser + '\n\n' + userText;
    const stepOptId = stepId();
    setArenaStepLog((prev) => [
      ...prev,
      { id: stepOptId, step: 'optimizing_loser', label: '优化败者', status: 'running', inputFull: inputOptimize, ts: Date.now() }
    ]);
    setArenaTimeline((prev) => [...prev, { id: blockId(), type: 'step_group', label: '优化败者', stepLogIds: [stepOptId], ts: Date.now() }]);
    try {
      const { reasoning, prompt: newChallengerPrompt, rawResponse } = await optimizeLoserPrompt(
        newChampPrompt,
        loserToOptimize,
        arenaUserDescription.trim() || undefined,
        modelText,
        allPrevious,
        arenaReportedGaps.length > 0 ? arenaReportedGaps : undefined,
        arenaWinnerStrength.trim() || undefined,
        arenaLoserRemark.trim() || undefined
      );
      const parsed = rawResponse ? parseSummaryFromRaw(rawResponse) : {};
      setArenaStepLog((prev) =>
        prev.map((s) =>
          s.id === stepOptId ? { ...s, status: 'done', outputRaw: rawResponse, outputParsed: parsed.summary, parseError: parsed.error, ts: Date.now() } : s
        )
      );
      if (reasoning) setArenaOptimizeReasoning(reasoning);
      setArenaReportedGaps([]);
      setArenaWinnerStrength('');
      setArenaLoserRemark('');
      setArenaChallengerPrompt(newChallengerPrompt);
      setArenaCurrentStep('generating_challenger_image');
      const stepImgId = stepId();
      setArenaStepLog((prev) => [
        ...prev,
        { id: stepImgId, step: 'generating_challenger_image', label: '挑战者生图', status: 'running', inputFull: `提示词：${newChallengerPrompt.slice(0, 300)}${newChallengerPrompt.length > 300 ? '…' : ''}`, ts: Date.now() }
      ]);
      setArenaTimeline((prev) => [...prev, { id: blockId(), type: 'step_group', label: '挑战者生图', stepLogIds: [stepImgId], ts: Date.now() }]);
      setArenaIsGenerating(true);
      try {
        const newChallengerImage = await dialogGenerateImage(arenaImage, newChallengerPrompt, arenaImageModel, undefined, promptEdit);
        setArenaStepLog((prev) => prev.map((s) => (s.id === stepImgId ? { ...s, status: 'done', outputRaw: '成功', ts: Date.now() } : s)));
        setArenaChallengerImage(newChallengerImage);
      } catch (imgErr: unknown) {
        const errMsg = normalizeApiErrorMessage(imgErr);
        setArenaStepLog((prev) => prev.map((s) => (s.id === stepImgId ? { ...s, status: 'error', outputRaw: errMsg, ts: Date.now() } : s)));
        throw imgErr;
      }
      setArenaCurrentStep('awaiting_pick');
      setArenaTimeline((prev) => [...prev, { id: blockId(), type: 'comparison', label: `第 ${arenaRound + 1} 轮`, round: arenaRound + 1, ts: Date.now() }]);
    } catch (err: unknown) {
      addGlobalLog('提示词擂台', 'error', '败者优化失败', normalizeApiErrorMessage(err));
      setArenaCurrentStep('idle');
    } finally {
      setArenaIsOptimizing(false);
      setArenaIsGenerating(false);
    }
  };

  const addChallenger = async () => {
    if (!arenaChampionPrompt || !arenaUserDescription.trim()) return;
    const allPrevious = [arenaChampionPrompt, arenaChallengerPrompt, arenaChallenger2Prompt].filter(Boolean) as string[];
    setArenaIsGenerating(true);
    setArenaCurrentStep('adding_challenger');
    const userText = [
      `Original user intent: ${arenaUserDescription.trim()}`,
      `Current champion (winner) prompt: ${arenaChampionPrompt}`,
      allPrevious.length > 0 ? `All other prompts already in this arena (be distinct from these):\n${allPrevious.map((p, i) => `[${i + 1}] ${p}`).join('\n')}` : ''
    ].filter(Boolean).join('\n\n');
    const inputNewCh = DEFAULT_PROMPTS.arena_new_challenger + '\n\n' + userText;
    const stepNewId = stepId();
    setArenaStepLog((prev) => [
      ...prev,
      { id: stepNewId, step: 'adding_challenger', label: '增加挑战者（生成提示词）', status: 'running', inputFull: inputNewCh, ts: Date.now() }
    ]);
    try {
      const { reasoning, prompt, rawResponse } = await generateNewChallenger(
        arenaUserDescription.trim(),
        arenaChampionPrompt,
        allPrevious,
        modelText
      );
      const parsed = rawResponse ? parseSummaryFromRaw(rawResponse) : {};
      setArenaStepLog((prev) =>
        prev.map((s) =>
          s.id === stepNewId ? { ...s, status: 'done', outputRaw: rawResponse, outputParsed: parsed.summary, parseError: parsed.error, ts: Date.now() } : s
        )
      );
      if (reasoning) setArenaOptimizeReasoning(reasoning);
      setArenaChallenger2Prompt(prompt);
      const stepImgId = stepId();
      setArenaStepLog((prev) => [
        ...prev,
        { id: stepImgId, step: 'generating_challenger2_image', label: '挑战者2 生图', status: 'running', inputFull: `提示词：${prompt.slice(0, 300)}${prompt.length > 300 ? '…' : ''}`, ts: Date.now() }
      ]);
      try {
        const img = await dialogGenerateImage(arenaImage, prompt, arenaImageModel, undefined, promptEdit);
        setArenaStepLog((prev) => prev.map((s) => (s.id === stepImgId ? { ...s, status: 'done', outputRaw: '成功', ts: Date.now() } : s)));
        setArenaChallenger2Image(img);
      } catch (imgErr: unknown) {
        const errMsg = normalizeApiErrorMessage(imgErr);
        setArenaStepLog((prev) => prev.map((s) => (s.id === stepImgId ? { ...s, status: 'error', outputRaw: errMsg, ts: Date.now() } : s)));
        throw imgErr;
      }
      setArenaCurrentStep('awaiting_pick');
      addGlobalLog('提示词擂台', 'info', '已增加一名挑战者', undefined);
    } catch (err: unknown) {
      addGlobalLog('提示词擂台', 'error', '增加挑战者失败', normalizeApiErrorMessage(err));
      setArenaCurrentStep('awaiting_pick');
    } finally {
      setArenaIsGenerating(false);
    }
  };

  const confirmSave = (save: boolean) => {
    if (save && arenaChampionPrompt) {
      addSnippet({ text: arenaChampionPrompt, timestamp: Date.now(), source: 'arena_champion' });
      setArenaSnippets(loadSnippets());
    }
    setArenaSaveSnippetConfirm(false);
    setArenaChampionPrompt(null);
    setArenaChampionImage(null);
    setArenaChallengerPrompt(null);
    setArenaChallengerImage(null);
    setArenaChallenger2Prompt(null);
    setArenaChallenger2Image(null);
    setArenaRound(0);
    setArenaPromptA('');
    setArenaImageA(null);
    setArenaPromptB('');
    setArenaImageB(null);
    setArenaPromptC('');
    setArenaImageC(null);
    setArenaPromptD('');
    setArenaImageD(null);
    setArenaStepLog([]);
    setArenaTimeline([]);
    setArenaCurrentStep('idle');
  };

  const busy = arenaIsGenerating || arenaIsOptimizing;
  const timelineScrollRef = React.useRef<HTMLDivElement>(null);
  const scrollToBlock = (blockId: string) => {
    document.getElementById(blockId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const getStepLogById = (id: string) => arenaStepLog.find((s) => s.id === id);
  const isLiveComparisonBlock = (block: ArenaTimelineBlock, index: number) =>
    block.type === 'comparison' && index === arenaTimeline.length - 1;

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <div className="flex-1 flex flex-col gap-4 min-w-0">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <button onClick={() => setMode(AppMode.ADMIN)} className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-[9px] font-black uppercase hover:bg-white/10 transition-all">看效果分析</button>
          {arenaFirstVisit && (
            <div className="flex-1 flex items-center justify-between gap-2 px-4 py-2 rounded-xl bg-blue-600/10 border border-blue-500/30 text-[10px] text-blue-300">
              <span>用自然语言描述想要的效果，过程在时间轴中展开，可回顾每步输入输出与结果；右侧为进度地图可跳转。</span>
              <button onClick={() => { setArenaFirstVisit(false); localStorage.setItem('ac_arena_visited', '1'); }} className="text-blue-400 hover:text-white">收起</button>
            </div>
          )}
        </div>

        <section className="glass p-4 rounded-2xl border border-white/5 shrink-0">
          <div className="text-[9px] font-black text-gray-500 uppercase mb-2">底图</div>
          {!arenaImage ? (
            <label className="block w-full h-32 cursor-pointer border-2 border-dashed border-white/10 rounded-xl hover:bg-white/5 flex items-center justify-center text-[9px] text-gray-500">
              上传底图
              <input type="file" className="hidden" accept="image/*" onChange={e => onFileUpload(e, setArenaImage)} />
            </label>
          ) : (
            <div className="relative inline-block">
              <img src={arenaImage} alt="底图" className="max-h-32 rounded-xl border border-white/10" />
              <button type="button" onClick={() => setArenaImage('')} className="absolute top-1 right-1 w-6 h-6 rounded bg-red-500/80 text-white text-xs">×</button>
            </div>
          )}
        </section>

        <section className="glass p-4 rounded-2xl border border-white/5 shrink-0">
          <div className="text-[9px] font-black text-gray-500 uppercase mb-2">自然语言描述（想要什么图）</div>
          <textarea
            value={arenaUserDescription}
            onChange={e => setArenaUserDescription(e.target.value)}
            placeholder="例如：科技公司用的现代感 logo，简洁一点"
            className="w-full min-h-[80px] bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-[11px] outline-none focus:border-blue-500 resize-y"
          />
          <div className="mt-2 flex items-center gap-3 flex-wrap">
            <span className="text-[9px] text-gray-500">参赛人数：</span>
            {([2, 3, 4] as const).map((n) => (
              <button key={n} type="button" onClick={() => setArenaInitialCount(n)} className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase border ${arenaInitialCount === n ? 'bg-blue-600/20 border-blue-500/50 text-blue-300' : 'bg-white/5 border-white/10 text-gray-500 hover:bg-white/10'}`}>{n}</button>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-3 flex-wrap">
            <span className="text-[9px] text-gray-500">生图模型：</span>
            {DIALOG_IMAGE_GEARS.map((g) => (
              <button key={g.id} type="button" onClick={() => setArenaImageModel(g.modelId)} className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase border ${arenaImageModel === g.modelId ? 'bg-blue-600/20 border-blue-500/50 text-blue-300' : 'bg-white/5 border-white/10 text-gray-500 hover:bg-white/10'}`} title={g.modelId}>{g.label}</button>
            ))}
          </div>
          <button type="button" onClick={startArena} disabled={arenaIsGenerating || !arenaUserDescription.trim() || !arenaImage} className="mt-3 px-4 py-2 rounded-xl bg-blue-600 text-[9px] font-black uppercase text-white hover:bg-blue-500 disabled:opacity-50">开始擂台</button>
        </section>

        {arenaTimeline.length > 0 && (
          <div ref={timelineScrollRef} className="flex-1 overflow-y-auto space-y-4 min-h-0 rounded-2xl border border-white/10 bg-black/20 p-4">
            {arenaTimeline.map((block, idx) => (
              <div key={block.id} id={block.id} className="rounded-xl border border-white/10 bg-black/30 overflow-hidden">
                <div className="px-3 py-2 border-b border-white/10 text-[9px] font-black text-blue-400 uppercase">{block.label}</div>
                {block.type === 'step_group' && block.stepLogIds && (
                  <div className="p-3 space-y-2">
                    {block.stepLogIds.map((sid) => {
                      const entry = getStepLogById(sid);
                      if (!entry) return null;
                      const inputKey = `${entry.id}_input`;
                      const outputKey = `${entry.id}_output`;
                      const inputShowFull = expandedBlocks.has(inputKey);
                      const outputShowFull = expandedBlocks.has(outputKey);
                      const inputText = entry.inputFull ?? '';
                      const outputText = entry.outputRaw ?? '';
                      const inputPreview = inputText.length <= ARENA_STEP_PREVIEW_LEN ? inputText : inputText.slice(0, ARENA_STEP_PREVIEW_LEN) + '…';
                      const outputPreview = outputText.length <= ARENA_STEP_PREVIEW_LEN ? outputText : outputText.slice(0, ARENA_STEP_PREVIEW_LEN) + '…';
                      return (
                        <div key={entry.id} className="rounded-lg border border-white/10 bg-black/20 p-2">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[9px] font-black text-gray-400">{entry.label}</span>
                            <span className={`px-1.5 py-0.5 rounded text-[8px] ${entry.status === 'running' ? 'bg-amber-600/30 text-amber-300' : entry.status === 'error' ? 'bg-red-600/30 text-red-300' : 'bg-green-600/20 text-green-300'}`}>{entry.status === 'running' ? '进行中' : entry.status === 'error' ? '失败' : '完成'}</span>
                          </div>
                          {inputText && (
                            <div className="mb-2">
                              <div className="flex items-center justify-between gap-2 mb-0.5">
                                <span className="text-[8px] font-black text-gray-500 uppercase">输入</span>
                                <div className="flex gap-1">
                                  <button type="button" onClick={() => toggleBlock(inputKey)} className="text-[8px] text-blue-400 hover:underline">{inputShowFull ? '收起' : '展开全部'}</button>
                                  <button type="button" onClick={() => copyToClipboard(inputText)} className="text-[8px] text-blue-400 hover:underline">复制</button>
                                </div>
                              </div>
                              <pre className="whitespace-pre-wrap break-words text-[10px] bg-black/30 rounded p-2 max-h-40 overflow-y-auto">{(inputShowFull ? inputText : inputPreview)}</pre>
                            </div>
                          )}
                          {(outputText || entry.outputParsed || entry.parseError) && (
                            <div>
                              <div className="flex items-center justify-between gap-2 mb-0.5">
                                <span className="text-[8px] font-black text-gray-500 uppercase">输出</span>
                                {outputText && (
                                  <div className="flex gap-1">
                                    <button type="button" onClick={() => toggleBlock(outputKey)} className="text-[8px] text-blue-400 hover:underline">{outputShowFull ? '收起' : '展开全部'}</button>
                                    <button type="button" onClick={() => copyToClipboard(outputText)} className="text-[8px] text-blue-400 hover:underline">复制</button>
                                  </div>
                                )}
                              </div>
                              {entry.outputParsed && <p className="text-[9px] text-green-300/90 mb-1">{entry.outputParsed}</p>}
                              {entry.parseError && <p className="text-[9px] text-red-300/90 mb-1">{entry.parseError}</p>}
                              {outputText && <pre className="whitespace-pre-wrap break-words text-[10px] bg-black/30 rounded p-2 max-h-40 overflow-y-auto">{(outputShowFull ? outputText : outputPreview)}</pre>}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                {block.type === 'user_choice' && <div className="p-3 text-[10px] text-amber-300">你选择了：{block.label.replace(/^已选\s*/, '')}</div>}
                {block.type === 'comparison' && (
                  <div className="p-3">
                    {(() => {
                      const options = isLiveComparisonBlock(block, idx) ? currentOptions : (block.comparisonSnapshot?.options ?? []);
                      const isLive = isLiveComparisonBlock(block, idx);
                      return (
                        <>
                          <div className={`grid gap-4 mb-3 ${options.length <= 2 ? 'grid-cols-2' : options.length === 3 ? 'grid-cols-3' : 'grid-cols-4'}`}>
                            {options.map((opt, i) => (
                              <div key={i}>
                                <div className="text-[9px] font-black text-gray-500 uppercase mb-1">{opt.label}</div>
                                <div className="text-[9px] text-gray-400 mb-2 truncate" title={opt.prompt}>{opt.prompt}</div>
                                {opt.image ? <img src={opt.image} alt={opt.label} className="w-full rounded-xl border border-white/10" /> : <div className="aspect-square rounded-xl bg-white/5 flex items-center justify-center text-[9px] text-gray-500">生成中…</div>}
                              </div>
                            ))}
                          </div>
                          {isLive && (
                            <>
                              <div className="mb-3 space-y-2">
                                <div>
                                  <label className="text-[9px] font-black text-gray-500 uppercase block mb-1">败者差在哪？（一句话说明，可选）</label>
                                  <input type="text" value={arenaLoserRemark} onChange={(e) => setArenaLoserRemark(e.target.value)} placeholder="一句话说明败者不足" className="w-full max-w-md px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-[10px] text-gray-300 placeholder-gray-500" />
                                </div>
                                <div>
                                  <label className="text-[9px] font-black text-gray-500 uppercase block mb-1">胜者为何被选？（一句话说明，可选）</label>
                                  <input type="text" value={arenaWinnerStrength} onChange={(e) => setArenaWinnerStrength(e.target.value)} placeholder="一句话说明胜者优点" className="w-full max-w-md px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-[10px] text-gray-300 placeholder-gray-500" />
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-3">
                                {currentOptions.map((_, i) => (
                                  <button key={i} type="button" onClick={() => handleArenaPick(i)} disabled={busy} className="px-4 py-2 rounded-xl bg-amber-600/80 text-[10px] font-black uppercase text-white hover:bg-amber-500 disabled:opacity-50">选择 {currentOptions[i].label}</button>
                                ))}
                                <button type="button" onClick={() => handleArenaPick(-1)} disabled={busy} className="px-4 py-2 rounded-xl bg-white/10 text-[10px] font-black uppercase hover:bg-white/20 disabled:opacity-50">平局</button>
                                {arenaRound > 0 && currentOptions.length === 2 && <button type="button" onClick={() => handleArenaPick(1, true)} disabled={busy} className="px-4 py-2 rounded-xl border border-white/20 text-[10px] font-black uppercase disabled:opacity-50" title="选挑战者且不优化">选择挑战者（不优化）</button>}
                                {arenaRound > 0 && !arenaChallenger2Prompt && <button type="button" onClick={addChallenger} disabled={busy} className="px-4 py-2 rounded-xl border border-amber-500/50 text-amber-400 text-[10px] font-black uppercase disabled:opacity-50">增加挑战者</button>}
                                {arenaChampionPrompt && <button type="button" onClick={() => setArenaSaveSnippetConfirm(true)} className="px-4 py-2 rounded-xl bg-green-600/20 border border-green-500/30 text-[10px] font-black uppercase text-green-400">满意，保存</button>}
                                <button type="button" onClick={() => { setArenaReportedGaps([]); setArenaWinnerStrength(''); setArenaLoserRemark(''); setArenaCurrentStep('idle'); }} className="px-4 py-2 rounded-xl border border-white/20 text-[10px] font-black uppercase">收起</button>
                              </div>
                            </>
                          )}
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {arenaTimeline.length === 0 && (arenaStepLog.length > 0 || arenaReasoning || arenaOptimizeReasoning) && (
            <div className="mt-3 rounded-xl border border-white/10 bg-black/30 overflow-hidden">
              <button type="button" onClick={() => setProcessExpanded(!processExpanded)} className="w-full px-3 py-2 text-left text-[9px] font-black text-blue-400 uppercase flex items-center justify-between">
                {processExpanded ? '收起过程' : '展开过程'}
                <span className="text-gray-500">{processExpanded ? '▼' : '▶'}</span>
              </button>
              {processExpanded && (
                <div className="px-3 pb-3 space-y-3 text-[10px] text-gray-300">
                  {arenaStepLog.length > 0 && (
                    <>
                      <div className="text-[8px] font-black text-gray-500 uppercase mb-1">当前步骤</div>
                      <div className="flex flex-wrap gap-1">
                        {STAGES.map(({ step, label }) => (
                          <span
                            key={step}
                            className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase ${arenaCurrentStep === step ? 'bg-blue-600/40 text-blue-200' : 'bg-white/5 text-gray-500'}`}
                          >
                            {label}
                          </span>
                        ))}
                      </div>
                      <div className="text-[8px] font-black text-gray-500 uppercase mb-1 mt-2">每步 AI 输入 / 输出（可核对）</div>
                      <div className="space-y-3 max-h-[50vh] overflow-y-auto no-scrollbar">
                        {arenaStepLog.map((entry) => {
                          const inputKey = `${entry.id}_input`;
                          const outputKey = `${entry.id}_output`;
                          const inputShowFull = expandedBlocks.has(inputKey);
                          const outputShowFull = expandedBlocks.has(outputKey);
                          const inputText = entry.inputFull ?? '';
                          const outputText = entry.outputRaw ?? '';
                          const inputPreview = inputText.length <= ARENA_STEP_PREVIEW_LEN ? inputText : inputText.slice(0, ARENA_STEP_PREVIEW_LEN) + '…';
                          const outputPreview = outputText.length <= ARENA_STEP_PREVIEW_LEN ? outputText : outputText.slice(0, ARENA_STEP_PREVIEW_LEN) + '…';
                          return (
                            <div key={entry.id} className="rounded-lg border border-white/10 bg-black/20 p-2">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-[9px] font-black text-gray-400">{entry.label}</span>
                                <span className={`px-1.5 py-0.5 rounded text-[8px] ${entry.status === 'running' ? 'bg-amber-600/30 text-amber-300' : entry.status === 'error' ? 'bg-red-600/30 text-red-300' : 'bg-green-600/20 text-green-300'}`}>
                                  {entry.status === 'running' ? '进行中' : entry.status === 'error' ? '失败' : '完成'}
                                </span>
                              </div>
                              {inputText && (
                                <div className="mb-2">
                                  <div className="flex items-center justify-between gap-2 mb-0.5">
                                    <span className="text-[8px] font-black text-gray-500 uppercase">输入（发给模型）</span>
                                    <div className="flex gap-1">
                                      <button type="button" onClick={() => toggleBlock(inputKey)} className="text-[8px] text-blue-400 hover:underline">
                                        {inputShowFull ? '收起' : '展开全部'}
                                      </button>
                                      <button type="button" onClick={() => copyToClipboard(inputText)} className="text-[8px] text-blue-400 hover:underline">复制全文</button>
                                    </div>
                                  </div>
                                  <pre className="whitespace-pre-wrap break-words text-[10px] bg-black/30 rounded p-2 max-h-40 overflow-y-auto">{(inputShowFull ? inputText : inputPreview)}</pre>
                                </div>
                              )}
                              {(outputText || entry.outputParsed || entry.parseError) && (
                                <div>
                                  <div className="flex items-center justify-between gap-2 mb-0.5">
                                    <span className="text-[8px] font-black text-gray-500 uppercase">输出（模型返回）</span>
                                    <div className="flex gap-1">
                                      {outputText && (
                                        <>
                                          <button type="button" onClick={() => toggleBlock(outputKey)} className="text-[8px] text-blue-400 hover:underline">
                                            {outputShowFull ? '收起' : '展开全部'}
                                          </button>
                                          <button type="button" onClick={() => copyToClipboard(outputText)} className="text-[8px] text-blue-400 hover:underline">复制全文</button>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                  {entry.outputParsed && <p className="text-[9px] text-green-300/90 mb-1">{entry.outputParsed}</p>}
                                  {entry.parseError && <p className="text-[9px] text-red-300/90 mb-1">{entry.parseError}</p>}
                                  {outputText && <pre className="whitespace-pre-wrap break-words text-[10px] bg-black/30 rounded p-2 max-h-40 overflow-y-auto">{(outputShowFull ? outputText : outputPreview)}</pre>}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                  {arenaStepLog.length === 0 && arenaReasoning && (
                    <div>
                      <div className="text-[8px] font-black text-gray-500 uppercase mb-1">生成提示词时的思路</div>
                      <p className="whitespace-pre-wrap">{arenaReasoning}</p>
                    </div>
                  )}
                  {arenaStepLog.length === 0 && arenaOptimizeReasoning && (
                    <div>
                      <div className="text-[8px] font-black text-gray-500 uppercase mb-1">优化败者 / 新挑战者时的思路</div>
                      <p className="whitespace-pre-wrap">{arenaOptimizeReasoning}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

        {arenaChampionPrompt && arenaTimeline.length > 0 && (
          <section className="glass p-4 rounded-2xl border border-white/5 shrink-0">
            <div className="text-[9px] font-black text-blue-400 uppercase mb-2">当前擂主</div>
            <p className="text-[10px] text-gray-300 break-words mb-2">{arenaChampionPrompt}</p>
            <button type="button" onClick={() => setArenaSaveSnippetConfirm(true)} className="px-3 py-1.5 rounded-lg bg-amber-600/20 border border-amber-500/30 text-[9px] font-black uppercase text-amber-400">满意，保存</button>
          </section>
        )}
      </div>

      <div className="w-full lg:w-64 shrink-0 flex flex-col gap-4 max-h-[85vh] overflow-hidden">
        {arenaTimeline.length > 0 && (
          <div className="glass p-3 rounded-2xl border border-white/5 flex flex-col min-h-0">
            <div className="text-[8px] font-black text-blue-400 uppercase mb-2">进度地图</div>
            <div className="flex-1 overflow-y-auto space-y-1 no-scrollbar">
              {arenaTimeline.map((b, i) => (
                <button key={b.id} type="button" onClick={() => scrollToBlock(b.id)} className="w-full text-left px-2 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-[9px] text-gray-300 truncate border border-transparent hover:border-white/20">
                  {i + 1}. {b.label}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="glass p-4 rounded-2xl border border-white/5 flex flex-col min-h-0 flex-1">
          <div className="text-[9px] font-black text-blue-400 uppercase mb-3">获胜片段库</div>
        <p className="text-[8px] text-gray-500 mb-2">点击复制到剪贴板</p>
        <div className="flex-1 overflow-y-auto space-y-1 no-scrollbar">
          {arenaSnippets.length === 0 ? (
            <div className="text-[9px] text-gray-500 py-4">保存的擂主提示词会出现在这里</div>
          ) : (
            arenaSnippets.map(s => (
              <div key={s.id} className="flex items-center gap-2 group">
                <button type="button" onClick={() => navigator.clipboard.writeText(s.text)} className="flex-1 text-left px-2 py-1.5 rounded-lg bg-white/5 border border-white/5 hover:bg-white/10 text-[10px] text-gray-300 truncate" title={s.text}>{s.text}</button>
                <button type="button" onClick={() => { removeSnippet(s.id); setArenaSnippets(loadSnippets()); }} className="opacity-0 group-hover:opacity-100 w-6 h-6 rounded text-red-400 hover:bg-red-500/20 text-[10px]">×</button>
              </div>
            ))
          )}
        </div>
        </div>
      </div>

      {arenaSaveSnippetConfirm && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/90 p-4" onClick={() => !busy && setArenaSaveSnippetConfirm(false)}>
          <div className="relative rounded-2xl border border-white/10 bg-black/80 p-6 max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <p className="text-[11px] text-gray-300 mb-4">将当前擂主提示词保存至片段库？</p>
            <div className="flex gap-3">
              <button type="button" onClick={() => confirmSave(true)} className="px-4 py-2 rounded-xl bg-blue-600 text-[10px] font-black uppercase text-white hover:bg-blue-500">保存</button>
              <button type="button" onClick={() => confirmSave(false)} className="px-4 py-2 rounded-xl bg-white/10 text-[10px] font-black uppercase hover:bg-white/20">不保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PromptArenaSection;
