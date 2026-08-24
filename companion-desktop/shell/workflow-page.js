/**
 * Workflow page: local WorkflowSkill list and runner.
 */
(function () {
  'use strict';

  function $(id) {
    return document.getElementById(id);
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function compact(value, fallback) {
    const text = String(value == null ? '' : value).trim();
    return text || fallback || '';
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(String(value || ''));
    return String(value || '').replace(/["\\]/g, '\\$&');
  }

  function ensureStyles() {
    if (document.getElementById('workflow-page-style')) return;
    const style = document.createElement('style');
    style.id = 'workflow-page-style';
    style.textContent = `
      .workflow-shell {
        min-height: 100%;
        padding: 16px;
        background: #111113;
      }
      .workflow-page-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 12px;
      }
      .workflow-page-header h1 {
        margin: 0;
        color: rgba(244, 244, 245, 0.96);
        font-size: 16px;
        line-height: 1.25;
      }
      .workflow-icon-btn {
        width: 30px;
        height: 30px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 7px;
        background: rgba(255, 255, 255, 0.045);
        color: rgba(244, 244, 245, 0.9);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
      }
      .workflow-icon-btn:hover {
        border-color: rgba(59, 130, 246, 0.48);
        background: rgba(59, 130, 246, 0.12);
      }
      .workflow-icon-btn:disabled {
        opacity: 0.52;
        cursor: wait;
      }
      .workflow-icon-btn svg {
        width: 16px;
        height: 16px;
      }
      .workflow-toolbar {
        display: grid;
        grid-template-columns: minmax(160px, 1fr) auto;
        align-items: center;
        gap: 10px;
        margin-bottom: 12px;
      }
      .workflow-search {
        min-width: 0;
        height: 34px;
        border: 1px solid rgba(148, 163, 184, 0.16);
        border-radius: 7px;
        background: rgba(0, 0, 0, 0.22);
        color: rgba(244, 244, 245, 0.94);
        padding: 0 10px;
        font-size: 12px;
        outline: none;
      }
      .workflow-search:focus {
        border-color: rgba(59, 130, 246, 0.55);
      }
      .workflow-summary {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        justify-content: flex-end;
      }
      .workflow-summary-pill {
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 999px;
        color: rgba(212, 212, 216, 0.86);
        background: rgba(255, 255, 255, 0.04);
        padding: 4px 8px;
        font-size: 10px;
        font-weight: 700;
      }
      .workflow-summary-pill.good {
        border-color: rgba(34, 197, 94, 0.32);
        color: #bbf7d0;
        background: rgba(22, 101, 52, 0.16);
      }
      .workflow-inline-status {
        min-height: 18px;
        margin-bottom: 10px;
        color: rgba(161, 161, 170, 0.9);
        font-size: 11px;
      }
      .workflow-list {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
        gap: 12px;
        max-width: 1100px;
        margin-bottom: 12px;
      }
      .workflow-card {
        min-width: 0;
        border: 1px solid rgba(148, 163, 184, 0.18);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.035);
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .workflow-card-head {
        display: flex;
        justify-content: space-between;
        gap: 10px;
      }
      .workflow-card-title {
        min-width: 0;
        font-size: 14px;
        font-weight: 800;
        color: rgba(244, 244, 245, 0.96);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .workflow-card-status {
        flex: none;
        border: 1px solid rgba(34, 197, 94, 0.36);
        border-radius: 999px;
        color: #bbf7d0;
        background: rgba(22, 101, 52, 0.18);
        padding: 3px 7px;
        font-size: 10px;
        font-weight: 800;
      }
      .workflow-card-desc {
        color: var(--muted);
        font-size: 12px;
        line-height: 1.45;
      }
      .workflow-card-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
      }
      .workflow-card-tag {
        padding: 3px 7px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        color: rgba(212, 212, 216, 0.84);
        background: rgba(255, 255, 255, 0.04);
        font-size: 10px;
        font-weight: 700;
      }
      .workflow-connectors {
        display: grid;
        gap: 5px;
        border: 1px solid rgba(148, 163, 184, 0.12);
        border-radius: 7px;
        background: rgba(0, 0, 0, 0.1);
        padding: 7px;
      }
      .workflow-connector-row {
        min-width: 0;
        display: grid;
        grid-template-columns: minmax(90px, 1fr) auto;
        align-items: center;
        gap: 8px;
        color: rgba(212, 212, 216, 0.84);
        font-size: 11px;
      }
      .workflow-connector-title {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .workflow-connector-state {
        border: 1px solid rgba(148, 163, 184, 0.18);
        border-radius: 999px;
        color: rgba(228, 228, 231, 0.88);
        background: rgba(255, 255, 255, 0.04);
        padding: 2px 6px;
        font-size: 10px;
        font-weight: 850;
      }
      .workflow-connector-state.ok {
        border-color: rgba(34, 197, 94, 0.32);
        color: #bbf7d0;
        background: rgba(22, 101, 52, 0.16);
      }
      .workflow-connector-state.warning {
        border-color: rgba(245, 158, 11, 0.36);
        color: #fde68a;
        background: rgba(146, 64, 14, 0.16);
      }
      .workflow-connector-state.blocked {
        border-color: rgba(239, 68, 68, 0.32);
        color: #fecaca;
        background: rgba(127, 29, 29, 0.16);
      }
      .workflow-run-form {
        display: grid;
        grid-template-columns: minmax(120px, 1fr) minmax(96px, 0.72fr) auto;
        gap: 8px;
        align-items: center;
      }
      .workflow-run-input {
        min-width: 0;
        height: 32px;
        border: 1px solid rgba(148, 163, 184, 0.16);
        border-radius: 7px;
        background: rgba(0, 0, 0, 0.18);
        color: rgba(244, 244, 245, 0.94);
        padding: 0 9px;
        font-size: 11px;
        outline: none;
      }
      .workflow-run-check {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: rgba(212, 212, 216, 0.85);
        font-size: 11px;
        font-weight: 700;
      }
      .workflow-card-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 7px;
      }
      .workflow-card-action {
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 7px;
        background: rgba(255, 255, 255, 0.045);
        color: rgba(244, 244, 245, 0.92);
        padding: 6px 9px;
        font-size: 11px;
        font-weight: 800;
        cursor: pointer;
      }
      .workflow-card-action.primary {
        border-color: rgba(59, 130, 246, 0.48);
        color: #dbeafe;
        background: rgba(37, 99, 235, 0.18);
      }
      .workflow-card-action:hover {
        border-color: rgba(59, 130, 246, 0.48);
        background: rgba(59, 130, 246, 0.12);
      }
      .workflow-card-action:disabled {
        opacity: 0.5;
        cursor: wait;
      }
      .workflow-detail {
        display: grid;
        gap: 8px;
        border: 1px solid rgba(148, 163, 184, 0.14);
        border-radius: 7px;
        background: rgba(0, 0, 0, 0.12);
        padding: 9px;
      }
      .workflow-detail-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 7px;
      }
      .workflow-detail-row {
        min-width: 0;
        display: grid;
        gap: 2px;
      }
      .workflow-detail-label {
        color: rgba(161, 161, 170, 0.9);
        font-size: 10px;
        font-weight: 820;
      }
      .workflow-detail-value {
        min-width: 0;
        color: rgba(244, 244, 245, 0.92);
        font-size: 11px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .workflow-detail-section {
        display: grid;
        gap: 5px;
      }
      .workflow-detail-section-title {
        color: rgba(228, 228, 231, 0.9);
        font-size: 11px;
        font-weight: 850;
      }
      .workflow-detail-chip-row {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
      }
      .workflow-detail-chip {
        border: 1px solid rgba(148, 163, 184, 0.16);
        border-radius: 999px;
        color: rgba(228, 228, 231, 0.88);
        background: rgba(255, 255, 255, 0.04);
        padding: 3px 7px;
        font-size: 10px;
        font-weight: 820;
      }
      .workflow-detail-chip.good {
        border-color: rgba(34, 197, 94, 0.32);
        color: #bbf7d0;
        background: rgba(22, 101, 52, 0.16);
      }
      .workflow-detail-chip.blocked {
        border-color: rgba(239, 68, 68, 0.32);
        color: #fecaca;
        background: rgba(127, 29, 29, 0.16);
      }
      .workflow-run-result {
        display: grid;
        gap: 5px;
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 7px;
        padding: 8px;
        background: rgba(0, 0, 0, 0.13);
        color: rgba(212, 212, 216, 0.84);
        font-size: 11px;
        line-height: 1.35;
      }
      .workflow-run-result.good {
        border-color: rgba(34, 197, 94, 0.2);
      }
      .workflow-run-result.bad {
        border-color: rgba(239, 68, 68, 0.24);
      }
      .workflow-preflight {
        display: grid;
        gap: 5px;
        border: 1px solid rgba(148, 163, 184, 0.14);
        border-radius: 7px;
        padding: 8px;
        background: rgba(0, 0, 0, 0.12);
      }
      .workflow-preflight-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        color: rgba(244, 244, 245, 0.92);
        font-size: 11px;
        font-weight: 850;
      }
      .workflow-preflight-status {
        border: 1px solid rgba(148, 163, 184, 0.16);
        border-radius: 999px;
        color: rgba(228, 228, 231, 0.9);
        background: rgba(255, 255, 255, 0.04);
        padding: 2px 6px;
        font-size: 10px;
      }
      .workflow-preflight-status.passed {
        border-color: rgba(34, 197, 94, 0.3);
        color: #bbf7d0;
        background: rgba(22, 101, 52, 0.15);
      }
      .workflow-preflight-status.warning {
        border-color: rgba(245, 158, 11, 0.36);
        color: #fde68a;
        background: rgba(146, 64, 14, 0.16);
      }
      .workflow-preflight-status.failed {
        border-color: rgba(239, 68, 68, 0.32);
        color: #fecaca;
        background: rgba(127, 29, 29, 0.16);
      }
      .workflow-preflight-list {
        display: grid;
        gap: 4px;
      }
      .workflow-preflight-item {
        min-width: 0;
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        align-items: start;
        gap: 6px;
        color: rgba(212, 212, 216, 0.84);
        font-size: 11px;
        line-height: 1.35;
      }
      .workflow-preflight-dot {
        width: 8px;
        height: 8px;
        border-radius: 999px;
        margin-top: 4px;
        background: rgba(148, 163, 184, 0.75);
      }
      .workflow-preflight-dot.passed {
        background: #22c55e;
      }
      .workflow-preflight-dot.warning {
        background: #f59e0b;
      }
      .workflow-preflight-dot.failed {
        background: #ef4444;
      }
      .workflow-preflight-message {
        min-width: 0;
      }
      .workflow-preflight-repair {
        margin-top: 2px;
        color: rgba(251, 191, 36, 0.9);
        font-size: 10px;
        font-weight: 750;
      }
      .workflow-preflight-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 6px;
      }
      .workflow-repair-action {
        border: 1px solid rgba(251, 191, 36, 0.26);
        border-radius: 7px;
        background: rgba(146, 64, 14, 0.13);
        color: #fde68a;
        padding: 5px 8px;
        font-size: 10px;
        font-weight: 850;
        cursor: pointer;
      }
      .workflow-repair-action:hover {
        border-color: rgba(251, 191, 36, 0.42);
        background: rgba(146, 64, 14, 0.2);
      }
      .workflow-repair-text {
        color: rgba(212, 212, 216, 0.78);
        font-size: 10px;
        line-height: 1.35;
      }
      .workflow-run-result-row {
        min-width: 0;
        display: flex;
        gap: 6px;
      }
      .workflow-run-result-label {
        flex: 0 0 auto;
        color: rgba(161, 161, 170, 0.9);
        font-weight: 800;
      }
      .workflow-run-result-value {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .workflow-artifact {
        display: grid;
        gap: 7px;
        border: 1px solid rgba(34, 197, 94, 0.18);
        border-radius: 7px;
        padding: 8px;
        background: rgba(22, 101, 52, 0.08);
      }
      .workflow-artifact.missing,
      .workflow-artifact.rejected {
        border-color: rgba(239, 68, 68, 0.24);
        background: rgba(127, 29, 29, 0.1);
      }
      .workflow-artifact-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .workflow-artifact-title {
        color: rgba(244, 244, 245, 0.94);
        font-size: 11px;
        font-weight: 850;
      }
      .workflow-artifact-state {
        border: 1px solid rgba(34, 197, 94, 0.3);
        border-radius: 999px;
        color: #bbf7d0;
        background: rgba(22, 101, 52, 0.16);
        padding: 2px 6px;
        font-size: 10px;
        font-weight: 850;
      }
      .workflow-artifact-state.missing,
      .workflow-artifact-state.rejected {
        border-color: rgba(239, 68, 68, 0.32);
        color: #fecaca;
        background: rgba(127, 29, 29, 0.16);
      }
      .workflow-artifact-grid {
        display: grid;
        gap: 4px;
      }
      .workflow-artifact-row {
        min-width: 0;
        display: flex;
        gap: 6px;
        color: rgba(212, 212, 216, 0.84);
        font-size: 11px;
        line-height: 1.35;
      }
      .workflow-artifact-label {
        flex: 0 0 auto;
        color: rgba(161, 161, 170, 0.9);
        font-weight: 850;
      }
      .workflow-artifact-value {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .workflow-artifact-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .workflow-artifact-action {
        border: 1px solid rgba(34, 197, 94, 0.25);
        border-radius: 7px;
        background: rgba(22, 101, 52, 0.12);
        color: #bbf7d0;
        padding: 5px 8px;
        font-size: 10px;
        font-weight: 850;
        cursor: pointer;
      }
      .workflow-artifact-action:hover {
        border-color: rgba(34, 197, 94, 0.42);
        background: rgba(22, 101, 52, 0.2);
      }
      .workflow-artifact-action:disabled {
        opacity: 0.48;
        cursor: default;
      }
      .workflow-history {
        max-width: 1100px;
        border: 1px solid rgba(148, 163, 184, 0.14);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.026);
        padding: 12px;
      }
      .workflow-history-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 8px;
      }
      .workflow-history-title {
        color: rgba(244, 244, 245, 0.95);
        font-size: 13px;
        font-weight: 850;
      }
      .workflow-history-meta {
        color: rgba(161, 161, 170, 0.88);
        font-size: 10px;
        font-weight: 750;
      }
      .workflow-history-list {
        display: grid;
        gap: 7px;
      }
      .workflow-history-row {
        min-width: 0;
        display: grid;
        grid-template-columns: minmax(130px, 1.1fr) auto minmax(120px, 0.85fr) minmax(150px, 1.1fr) auto;
        align-items: center;
        gap: 8px;
        border: 1px solid rgba(255, 255, 255, 0.065);
        border-radius: 7px;
        background: rgba(0, 0, 0, 0.12);
        padding: 8px;
      }
      .workflow-history-row.succeeded {
        border-color: rgba(34, 197, 94, 0.2);
      }
      .workflow-history-row.failed,
      .workflow-history-row.preflight_failed {
        border-color: rgba(239, 68, 68, 0.22);
      }
      .workflow-history-main,
      .workflow-history-detail {
        min-width: 0;
      }
      .workflow-history-name,
      .workflow-history-detail {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .workflow-history-name {
        color: rgba(244, 244, 245, 0.94);
        font-size: 12px;
        font-weight: 820;
      }
      .workflow-history-time {
        color: rgba(161, 161, 170, 0.86);
        font-size: 10px;
        margin-top: 2px;
      }
      .workflow-history-status {
        justify-self: start;
        border: 1px solid rgba(148, 163, 184, 0.18);
        border-radius: 999px;
        color: rgba(228, 228, 231, 0.9);
        background: rgba(255, 255, 255, 0.045);
        padding: 3px 7px;
        font-size: 10px;
        font-weight: 850;
      }
      .workflow-history-status.succeeded {
        border-color: rgba(34, 197, 94, 0.32);
        color: #bbf7d0;
        background: rgba(22, 101, 52, 0.16);
      }
      .workflow-history-status.failed,
      .workflow-history-status.preflight_failed {
        border-color: rgba(239, 68, 68, 0.32);
        color: #fecaca;
        background: rgba(127, 29, 29, 0.16);
      }
      .workflow-history-detail {
        color: rgba(212, 212, 216, 0.84);
        font-size: 11px;
      }
      .workflow-history-action {
        border: 1px solid rgba(59, 130, 246, 0.28);
        border-radius: 7px;
        background: rgba(37, 99, 235, 0.12);
        color: #dbeafe;
        padding: 5px 8px;
        font-size: 10px;
        font-weight: 850;
        cursor: pointer;
      }
      .workflow-history-action:hover {
        border-color: rgba(59, 130, 246, 0.46);
        background: rgba(37, 99, 235, 0.18);
      }
      .workflow-history-empty {
        border: 1px dashed rgba(148, 163, 184, 0.2);
        border-radius: 7px;
        color: rgba(161, 161, 170, 0.9);
        background: rgba(255, 255, 255, 0.02);
        padding: 10px;
        font-size: 11px;
      }
      .workflow-empty {
        max-width: 640px;
        border: 1px dashed rgba(148, 163, 184, 0.28);
        border-radius: 8px;
        padding: 18px;
        color: rgba(212, 212, 216, 0.82);
        background: rgba(255, 255, 255, 0.025);
      }
      .workflow-empty-title {
        color: rgba(244, 244, 245, 0.95);
        font-size: 14px;
        font-weight: 800;
        margin-bottom: 4px;
      }
      .workflow-empty-sub {
        color: var(--muted);
        font-size: 12px;
        line-height: 1.45;
      }
      .workflow-error {
        max-width: 720px;
        border: 1px solid rgba(239, 68, 68, 0.35);
        border-radius: 8px;
        padding: 10px 12px;
        color: #fecaca;
        background: rgba(239, 68, 68, 0.08);
        font-size: 12px;
      }
      @media (max-width: 720px) {
        .workflow-toolbar,
        .workflow-run-form,
        .workflow-detail-grid,
        .workflow-history-row {
          grid-template-columns: 1fr;
        }
        .workflow-summary {
          justify-content: flex-start;
        }
      }
    `;
    document.head.appendChild(style);
  }

  window.ShellWorkflowPage = {
    _shell: null,
    workflows: [],
    drafts: [],
    pins: [],
    historyRuns: [],
    runsByWorkflowId: new Map(),
    preflightByWorkflowId: new Map(),
    draftParamsByWorkflowId: new Map(),
    reuseSourceByWorkflowId: new Map(),
    busyId: '',
    listError: '',
    searchQuery: '',
    inlineStatus: '',
    selectedWorkflowId: '',
    _reloadGen: 0,

    async fetchSkills(shell) {
      const r = await shell.api('GET', '/v1/workflows/skills', null);
      if (!r || !r.ok || !r.json || !Array.isArray(r.json.workflows)) {
        throw new Error((r && r.json && (r.json.message || r.json.error)) || (r && r.text) || '读取 Workflow 失败');
      }
      return r.json.workflows;
    },

    async fetchRuns(shell) {
      const r = await shell.api('GET', '/v1/workflows/runs', null);
      if (!r || !r.ok || !r.json || !Array.isArray(r.json.runs)) {
        throw new Error((r && r.json && (r.json.message || r.json.error)) || (r && r.text) || '读取 Workflow 运行历史失败');
      }
      return r.json.runs;
    },

    async fetchDrafts(shell) {
      const r = await shell.api('GET', '/v1/workflows/drafts', null);
      if (!r || !r.ok || !r.json || !Array.isArray(r.json.drafts)) {
        throw new Error((r && r.json && (r.json.message || r.json.error)) || (r && r.text) || '读取 Workflow 草稿失败');
      }
      return r.json.drafts;
    },

    async fetchPins(shell) {
      const r = await shell.api('GET', '/v1/workflows/pins', null);
      if (!r || !r.ok || !r.json || !Array.isArray(r.json.pins)) {
        throw new Error((r && r.json && (r.json.message || r.json.error)) || (r && r.text) || '读取 Workflow 固定项失败');
      }
      return r.json.pins;
    },

    rebuildLatestRuns() {
      const next = new Map();
      for (const run of asArray(this.historyRuns)) {
        if (!run || !run.workflow_id || next.has(run.workflow_id)) continue;
        next.set(run.workflow_id, run);
      }
      this.runsByWorkflowId = next;
    },

    matchesSearch(workflow) {
      const q = String(this.searchQuery || '').trim().toLowerCase();
      if (!q) return true;
      const contract = workflow && workflow.aiContract && typeof workflow.aiContract === 'object' ? workflow.aiContract : {};
      const summary = workflow && workflow.userSummary && typeof workflow.userSummary === 'object' ? workflow.userSummary : {};
      const haystack = [
        workflow && workflow.id,
        workflow && workflow.name,
        workflow && workflow.version,
        workflow && workflow.status,
        summary.title,
        summary.inputSummary,
        summary.outputSummary,
        contract.whenToUse,
        ...asArray(workflow && workflow.connectorSummaries).flatMap((connector) => [
          connector && connector.title,
          connector && connector.label,
          connector && connector.status,
        ]),
        ...asArray(workflow && workflow.systemContract && workflow.systemContract.requiredCapabilities),
      ]
        .map((item) => String(item || '').toLowerCase())
        .join('\n');
      return haystack.includes(q);
    },

    renderSummary(items) {
      const summary = $('workflowSummary');
      const status = $('workflowInlineStatus');
      if (summary) {
        const available = items.filter((item) => item && item.status === 'available').length;
        const validated = items.filter((item) => {
          const validation =
            item && item.systemContract && item.systemContract.validation && typeof item.systemContract.validation === 'object'
              ? item.systemContract.validation
              : {};
          return validation.status === 'validated';
        }).length;
        const succeeded = asArray(this.historyRuns).filter((run) => run && run.status === 'succeeded').length;
        const activeDrafts = asArray(this.drafts).filter((draft) => draft && draft.status !== 'archived').length;
        const pinned = asArray(this.pins).length;
        summary.innerHTML =
          '<span class="workflow-summary-pill">全部 ' +
          items.length +
          '</span>' +
          '<span class="workflow-summary-pill good">可用 ' +
          available +
          '</span>' +
          '<span class="workflow-summary-pill">已验证 ' +
          validated +
          '</span>' +
          '<span class="workflow-summary-pill">历史成功 ' +
          succeeded +
          '</span>' +
          '<span class="workflow-summary-pill">草稿 ' +
          activeDrafts +
          '</span>' +
          '<span class="workflow-summary-pill">固定 ' +
          pinned +
          '</span>';
      }
      if (status) status.textContent = this.inlineStatus;
    },

    draftsForWorkflow(workflow) {
      return asArray(this.drafts).filter((draft) => {
        if (!draft || draft.status === 'archived') return false;
        const source = draft.source && typeof draft.source === 'object' ? draft.source : {};
        const definition = draft.definition && typeof draft.definition === 'object' ? draft.definition : {};
        const executor = definition.executor_ref && typeof definition.executor_ref === 'object' ? definition.executor_ref : {};
        return source.workflow_id === workflow.id || executor.id === workflow.id;
      });
    },

    pinsForWorkflow(workflow) {
      return asArray(this.pins).filter((pin) => pin && pin.workflow_id === workflow.id);
    },

    pinForScope(workflow, scopeKind, scopeId) {
      return this.pinsForWorkflow(workflow).find((pin) => {
        const scope = pin.scope && typeof pin.scope === 'object' ? pin.scope : {};
        if (scope.kind !== scopeKind) return false;
        if (!scopeId) return true;
        return scope.connection_id === scopeId || scope.project_id === scopeId || scope.object_id === scopeId || scope.workspace_id === scopeId;
      }) || null;
    },

    pinScopeLabel(pin) {
      const scope = pin && pin.scope && typeof pin.scope === 'object' ? pin.scope : {};
      if (scope.kind === 'home') return '首页';
      if (scope.kind === 'connection') return '连接:' + compact(scope.connection_id, 'unknown');
      if (scope.kind === 'project') return '项目:' + compact(scope.project_id, 'unknown');
      if (scope.kind === 'object') return '对象:' + compact(scope.object_id, 'unknown');
      if (scope.kind === 'workspace') return '工作区:' + compact(scope.workspace_id, 'unknown');
      return '固定';
    },

    pinVersionPolicyLabel(pin) {
      const policy = pin && pin.version_policy && typeof pin.version_policy === 'object' ? pin.version_policy : {};
      if (policy.kind === 'locked') return 'locked ' + compact(policy.version_id, '');
      return 'follow default';
    },

    pinsHtml(workflow) {
      const pins = this.pinsForWorkflow(workflow);
      if (!pins.length) return '';
      const run = this.runsByWorkflowId.get(workflow.id);
      const runStatus = run ? this.statusLabel(run.status) : '未运行';
      const connector = asArray(workflow.connectorSummaries)[0] || null;
      const connectorStatus = connector ? this.connectorStatusLabel(connector.status) : '未知';
      return (
        '<div class="workflow-detail-chip-row">' +
        pins.map((pin) =>
          '<span class="workflow-detail-chip good">固定: ' +
          esc(this.pinScopeLabel(pin)) +
          ' · ' +
          esc(this.pinVersionPolicyLabel(pin)) +
          ' · 最近 ' +
          esc(runStatus) +
          ' · 连接 ' +
          esc(connectorStatus) +
          '</span>',
        ).join('') +
        '</div>'
      );
    },

    detailStatusChip(label, value) {
      const state = value === 'validated' || value === 'available' || value === 'succeeded'
        ? ' good'
        : value === 'blocked' || value === 'failed' || value === 'preflight_failed'
          ? ' blocked'
          : '';
      return '<span class="workflow-detail-chip' + state + '">' + esc(label + ': ' + (value || '未知')) + '</span>';
    },

    detailHtml(workflow) {
      if (!workflow || this.selectedWorkflowId !== workflow.id) return '';
      const system = workflow.systemContract && typeof workflow.systemContract === 'object' ? workflow.systemContract : {};
      const validation = system.validation && typeof system.validation === 'object' ? system.validation : {};
      const lastRun = this.runsByWorkflowId.get(workflow.id);
      const drafts = this.draftsForWorkflow(workflow);
      const connectors = asArray(workflow.connectorSummaries);
      const connectorText = connectors.length
        ? connectors.map((item) => compact(item.title || item.id, '连接') + ' · ' + compact(item.label || this.connectorStatusLabel(item.status), '')).join(' / ')
        : '无连接摘要';
      const draftChips = drafts.length
        ? drafts.map((draft) => this.detailStatusChip(draft.name || draft.id, draft.status)).join('')
        : '<span class="workflow-detail-chip">草稿: none</span>';
      return (
        '<div class="workflow-detail">' +
        '<div class="workflow-detail-grid">' +
        this.detailRow('状态', workflow.status || 'unknown') +
        this.detailRow('验证', validation.status || 'unvalidated') +
        this.detailRow('当前版本', workflow.version || '') +
        this.detailRow('最近运行', lastRun ? this.statusLabel(lastRun.status) + ' / ' + lastRun.id : 'none') +
        this.detailRow('连接摘要', connectorText) +
        this.detailRow('参数', this.inputSummary(workflow)) +
        '</div>' +
        '<div class="workflow-detail-section">' +
        '<div class="workflow-detail-section-title">草稿与状态</div>' +
        '<div class="workflow-detail-chip-row">' +
        this.detailStatusChip('稳定', validation.status === 'validated' ? 'validated' : workflow.status) +
        draftChips +
        '</div>' +
        '</div>' +
        '</div>'
      );
    },

    detailRow(label, value) {
      return (
        '<div class="workflow-detail-row">' +
        '<div class="workflow-detail-label">' +
        esc(label) +
        '</div>' +
        '<div class="workflow-detail-value" title="' +
        esc(value) +
        '">' +
        esc(value) +
        '</div>' +
        '</div>'
      );
    },

    inputSummary(workflow) {
      const schema = workflow && workflow.aiContract && workflow.aiContract.inputSchema && typeof workflow.aiContract.inputSchema === 'object'
        ? workflow.aiContract.inputSchema
        : {};
      const properties = schema.properties && typeof schema.properties === 'object' ? Object.keys(schema.properties) : [];
      return properties.length ? properties.join(', ') : '未声明';
    },

    tagsFor(workflow) {
      const system = workflow && workflow.systemContract && typeof workflow.systemContract === 'object' ? workflow.systemContract : {};
      const validation = system.validation && typeof system.validation === 'object' ? system.validation : {};
      return [
        workflow && workflow.status,
        workflow && workflow.version ? 'v' + workflow.version : '',
        system.riskLevel,
        validation.status,
        ...asArray(system.requiredCapabilities),
      ].filter(Boolean);
    },

    resultHtml(run) {
      if (!run) return '';
      const failedRepair = asArray(run.repair_actions)[0] || null;
      const artifact = asArray(run.artifacts)[0] || null;
      const rows = [
        ['状态', run.status],
        ['产物', artifact ? artifact.uri || artifact.local_path || artifact.id : ''],
        ['修复', failedRepair ? failedRepair.title || failedRepair.id : ''],
        ['复现', run.replay_snapshot_id || ''],
        ['Trace', run.trace_id || ''],
      ].filter((row) => compact(row[1], ''));
      return (
        '<div class="workflow-run-result ' +
        (run.status === 'succeeded' ? 'good' : 'bad') +
        '">' +
        rows
          .map(
            (row) =>
              '<div class="workflow-run-result-row"><span class="workflow-run-result-label">' +
              esc(row[0]) +
              '</span><span class="workflow-run-result-value" title="' +
              esc(row[1]) +
              '">' +
              esc(row[1]) +
              '</span></div>',
          )
          .join('') +
        (run.status === 'failed' || run.status === 'preflight_failed'
          ? '<div class="workflow-artifact-actions"><button type="button" class="workflow-artifact-action" data-run-action="repair-session">修复会话</button></div>'
          : '') +
        '</div>'
      );
    },

    connectorStatusLabel(status) {
      switch (status) {
        case 'ok':
          return '已连接';
        case 'warning':
          return '待处理';
        case 'blocked':
          return '受阻';
        case 'unknown':
          return '未知';
        default:
          return status || '未知';
      }
    },

    connectorsHtml(workflow) {
      const connectors = asArray(workflow && workflow.connectorSummaries);
      if (!connectors.length) return '';
      return (
        '<div class="workflow-connectors">' +
        connectors
          .map(
            (connector) =>
              '<div class="workflow-connector-row">' +
              '<span class="workflow-connector-title" title="' +
              esc(connector.title || connector.id || '') +
              '">' +
              esc(connector.title || connector.id || '') +
              ' · ' +
              esc(connector.label || '') +
              '</span>' +
              '<span class="workflow-connector-state ' +
              esc(connector.status || '') +
              '">' +
              esc(this.connectorStatusLabel(connector.status)) +
              '</span>' +
              '</div>',
          )
          .join('') +
        '</div>'
      );
    },

    artifactStatusLabel(status) {
      switch (status) {
        case 'created':
          return '可用';
        case 'missing':
          return '文件失效';
        case 'rejected':
          return '已拒绝';
        default:
          return status || '未知';
      }
    },

    formatBytes(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '';
      if (value < 1024) return value + ' bytes';
      if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KB';
      return (value / 1024 / 1024).toFixed(1) + ' MB';
    },

    artifactPath(artifact) {
      return compact(artifact && (artifact.local_path || artifact.uri || artifact.id), '');
    },

    canOpenArtifact(artifact) {
      const path = this.artifactPath(artifact);
      return Boolean(artifact && artifact.local_path && path && artifact.status !== 'missing' && artifact.status !== 'rejected');
    },

    artifactHtml(run) {
      const artifact = asArray(run && run.artifacts)[0] || null;
      if (!artifact || run.status !== 'succeeded') return '';
      const metadata = artifact.metadata && typeof artifact.metadata === 'object' ? artifact.metadata : {};
      const rows = [
        ['路径', this.artifactPath(artifact)],
        ['大小', this.formatBytes(metadata.bytes)],
        ['生成', this.formatRunTime(run)],
      ].filter((row) => compact(row[1], ''));
      return (
        '<div class="workflow-artifact ' +
        esc(artifact.status || '') +
        '">' +
        '<div class="workflow-artifact-head">' +
        '<span class="workflow-artifact-title">产物</span>' +
        '<span class="workflow-artifact-state ' +
        esc(artifact.status || '') +
        '">' +
        esc(this.artifactStatusLabel(artifact.status)) +
        '</span>' +
        '</div>' +
        '<div class="workflow-artifact-grid">' +
        rows
          .map(
            (row) =>
              '<div class="workflow-artifact-row"><span class="workflow-artifact-label">' +
              esc(row[0]) +
              '</span><span class="workflow-artifact-value" title="' +
              esc(row[1]) +
              '">' +
              esc(row[1]) +
              '</span></div>',
          )
          .join('') +
        '</div>' +
        '<div class="workflow-artifact-actions">' +
        '<button type="button" class="workflow-artifact-action" data-artifact-action="open" ' +
        (this.canOpenArtifact(artifact) ? '' : 'disabled') +
        '>打开位置</button>' +
        '<button type="button" class="workflow-artifact-action" data-artifact-action="copy">复制路径</button>' +
        (run.saved_as_draft_id
          ? '<button type="button" class="workflow-artifact-action" disabled>已保存草稿</button>'
          : '<button type="button" class="workflow-artifact-action" data-artifact-action="save-draft">保存为工作流</button>') +
        '<button type="button" class="workflow-artifact-action" data-artifact-action="reuse">复用参数</button>' +
        '<button type="button" class="workflow-artifact-action" data-artifact-action="rerun">再次运行</button>' +
        '</div>' +
        '</div>'
      );
    },

    workflowTitle(workflowId) {
      const workflow = this.workflows.find((item) => item && item.id === workflowId);
      const summary = workflow && workflow.userSummary && typeof workflow.userSummary === 'object' ? workflow.userSummary : {};
      return summary.title || (workflow && workflow.name) || workflowId || 'Workflow';
    },

    formatRunTime(run) {
      const value = run && (run.finished_at || run.started_at || run.created_at);
      if (!value) return '';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return String(value);
      return date.toLocaleString('zh-CN', {
        hour12: false,
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    },

    statusLabel(status) {
      switch (status) {
        case 'succeeded':
          return '成功';
        case 'preflight_failed':
          return '检查未通过';
        case 'failed':
          return '失败';
        case 'running':
          return '运行中';
        case 'ready':
          return '待执行';
        case 'canceled':
          return '已取消';
        default:
          return status || '未知';
      }
    },

    preflightStatusLabel(status) {
      switch (status) {
        case 'passed':
          return '通过';
        case 'warning':
          return '提醒';
        case 'failed':
          return '未通过';
        default:
          return status || '未知';
      }
    },

    artifactSummary(run) {
      const artifact = asArray(run && run.artifacts)[0] || null;
      if (!artifact) return '';
      const bytes = artifact.metadata && typeof artifact.metadata === 'object' ? artifact.metadata.bytes : undefined;
      const bytesText = typeof bytes === 'number' && Number.isFinite(bytes) ? ' · ' + bytes + ' bytes' : '';
      return compact(artifact.uri || artifact.local_path || artifact.id, '产物已记录') + bytesText;
    },

    failureSummary(run) {
      if (run && run.error && run.error.message) return run.error.message;
      const failedPreflight = asArray(run && run.preflight_results).find((item) => item && item.status === 'failed');
      if (failedPreflight && failedPreflight.message) return failedPreflight.message;
      const repair = asArray(run && run.repair_actions)[0] || null;
      if (repair && repair.title) return repair.title;
      return '';
    },

    runFailureMessage(body, run, fallback) {
      return this.failureSummary(run) || (body && (body.message || body.error)) || fallback || '';
    },

    versionSummary(run) {
      return compact(run && (run.workflow_version_id || run.workflow_version), '');
    },

    historyDetail(run) {
      if (!run) return '';
      const version = this.versionSummary(run);
      const suffix = version ? ' · ' + version : '';
      if (run.status === 'succeeded') return (this.artifactSummary(run) || '成功完成') + suffix;
      return (this.failureSummary(run) || '未完成') + suffix;
    },

    preflightHtml(preflight) {
      if (!preflight) return '';
      const results = asArray(preflight.results);
      const repairs = new Map(asArray(preflight.repair_actions).map((action) => [action && action.id, action]));
      const status = preflight.status || (results.some((item) => item && item.status === 'failed') ? 'failed' : 'passed');
      return (
        '<div class="workflow-preflight">' +
        '<div class="workflow-preflight-head">' +
        '<span>运行前检查</span>' +
        '<span class="workflow-preflight-status ' +
        esc(status) +
        '">' +
        esc(this.preflightStatusLabel(status)) +
        '</span>' +
        '</div>' +
        '<div class="workflow-preflight-list">' +
        results
          .map((result) => {
            const repair = result && result.repair_action_id ? repairs.get(result.repair_action_id) : null;
            return (
              '<div class="workflow-preflight-item">' +
              '<span class="workflow-preflight-dot ' +
              esc(result && result.status) +
              '"></span>' +
              '<div class="workflow-preflight-message">' +
              '<strong>' +
              esc(this.preflightStatusLabel(result && result.status)) +
              '</strong> · ' +
              esc((result && result.message) || (result && result.check_id) || '') +
              (repair
                ? '<div class="workflow-preflight-repair">' + esc(repair.title || repair.id || result.repair_action_id) + '</div>'
                : '') +
              '</div>' +
              '</div>'
            );
          })
          .join('') +
        '</div>' +
        this.repairActionsHtml(preflight) +
        '</div>'
      );
    },

    isSupportedRepairAction(action) {
      return ['confirm', 'reconnect', 'retry', 'revise_input', 'manual_repair'].includes(String(action && action.actionType));
    },

    repairActionLabel(action) {
      if (!action) return '处理';
      if (action.actionType === 'reconnect') return '打开连接';
      if (action.actionType === 'retry') return '重新检测';
      if (action.actionType === 'confirm') return action.title || '确认';
      if (action.actionType === 'revise_input') return action.title || '修改输入';
      if (action.actionType === 'manual_repair') {
        if (action.id === 'repair_maya_export_capability') return '打开连接';
        return '重新检测';
      }
      return action.title || '处理';
    },

    repairActionsHtml(preflight) {
      const actions = asArray(preflight && preflight.repair_actions);
      if (!actions.length) return '';
      return (
        '<div class="workflow-preflight-actions">' +
        actions
          .map((action, index) => {
            if (!this.isSupportedRepairAction(action)) {
              return '<span class="workflow-repair-text">' + esc(action && (action.title || action.id || action.actionType)) + '</span>';
            }
            return (
              '<button type="button" class="workflow-repair-action" data-repair-action="' +
              esc(index) +
              '">' +
              esc(this.repairActionLabel(action)) +
              '</button>'
            );
          })
          .join('') +
        '</div>'
      );
    },

    renderHistory() {
      const list = $('workflowHistoryList');
      const empty = $('workflowHistoryEmpty');
      const meta = $('workflowHistoryMeta');
      if (!list || !empty) return;
      const runs = asArray(this.historyRuns).slice(0, 8);
      list.innerHTML = '';
      if (meta) meta.textContent = runs.length ? '显示最近 ' + runs.length + ' 条' : '';
      if (!runs.length) {
        empty.classList.remove('hidden');
        return;
      }
      empty.classList.add('hidden');
      for (const run of runs) {
        const row = document.createElement('div');
        row.className = 'workflow-history-row ' + (run.status || '');
        row.innerHTML =
          '<div class="workflow-history-main">' +
          '<div class="workflow-history-name" title="' +
          esc(this.workflowTitle(run.workflow_id)) +
          '">' +
          esc(this.workflowTitle(run.workflow_id)) +
          '</div>' +
          '<div class="workflow-history-time">' +
          esc(this.formatRunTime(run)) +
          '</div>' +
          '</div>' +
          '<span class="workflow-history-status ' +
          esc(run.status || '') +
          '">' +
          esc(this.statusLabel(run.status)) +
          '</span>' +
          '<div class="workflow-history-detail" title="' +
          esc(run.id || '') +
          '">' +
          esc(run.id || '') +
          '</div>' +
          '<div class="workflow-history-detail" title="' +
          esc(this.historyDetail(run)) +
          '">' +
          esc(this.historyDetail(run)) +
          '</div>' +
          '<button type="button" class="workflow-history-action" data-history-action="reuse">复用</button>';
        row.querySelector('[data-history-action="reuse"]')?.addEventListener('click', () => {
          void this.reuseRun(run);
        });
        list.appendChild(row);
      }
    },

    workflowContext(workflow) {
      const summary = workflow && workflow.userSummary && typeof workflow.userSummary === 'object' ? workflow.userSummary : {};
      const system = workflow && workflow.systemContract && typeof workflow.systemContract === 'object' ? workflow.systemContract : {};
      const lastRun = this.runsByWorkflowId.get(workflow.id);
      return [
        '当前对话绑定到一个 WorkflowSkill。',
        'Workflow ID: ' + (workflow.id || ''),
        '名称: ' + (workflow.name || workflow.id || ''),
        '版本: ' + (workflow.version || ''),
        '状态: ' + (workflow.status || ''),
        '用途: ' + (summary.title || ''),
        '输入: ' + (summary.inputSummary || ''),
        '输出: ' + (summary.outputSummary || ''),
        '风险: ' + (system.riskLevel || ''),
        '最近运行: ' + (lastRun ? `${lastRun.status} / ${lastRun.id}` : 'none'),
        '请围绕这个 WorkflowSkill 继续预检、运行、分析 RepairAction、复现或派生新版本。',
      ]
        .filter((line) => String(line || '').trim())
        .join('\n');
    },

    openWorkflowConversation(workflow) {
      if (typeof window.__acOpenCopilotObjectSession === 'function') {
        void window.__acOpenCopilotObjectSession({
          type: 'workflow',
          id: workflow.id,
          sessionId: 'workflow:' + workflow.id,
          label: workflow.name || workflow.id,
          contextPrompt: this.workflowContext(workflow),
        });
        return;
      }
      if (typeof window.__acOpenCopilotPanel === 'function') window.__acOpenCopilotPanel();
    },

    renderCard(workflow) {
      const summary = workflow && workflow.userSummary && typeof workflow.userSummary === 'object' ? workflow.userSummary : {};
      const run = this.runsByWorkflowId.get(workflow.id);
      const preflight = this.preflightByWorkflowId.get(workflow.id);
      const draft = this.draftParamsByWorkflowId.get(workflow.id) || {};
      const reuseSource = this.reuseSourceByWorkflowId.get(workflow.id);
      const busy = this.busyId === workflow.id;
      const tags = this.tagsFor(workflow);
      const card = document.createElement('article');
      card.className = 'workflow-card';
      card.dataset.workflowId = workflow.id;
      card.innerHTML =
        '<div class="workflow-card-head">' +
        '<div class="workflow-card-title">' +
        esc(summary.title || workflow.name || workflow.id) +
        '</div>' +
        '<span class="workflow-card-status">' +
        esc(workflow.status || 'workflow') +
        '</span>' +
        '</div>' +
        '<div class="workflow-card-desc">' +
        esc(summary.outputSummary || summary.inputSummary || workflow.id) +
        '</div>' +
        '<div class="workflow-card-tags">' +
        tags.map((tag) => '<span class="workflow-card-tag">' + esc(tag) + '</span>').join('') +
        '</div>' +
        this.pinsHtml(workflow) +
        this.connectorsHtml(workflow) +
        '<div class="workflow-run-form">' +
        '<input class="workflow-run-input" data-field="output_dir" placeholder="project://exports" value="' +
        esc(draft.output_dir || 'project://exports') +
        '" autocomplete="off" />' +
        '<input class="workflow-run-input" data-field="file_name" placeholder="selected_asset" value="' +
        esc(draft.file_name || 'selected_asset') +
        '" autocomplete="off" />' +
        '<label class="workflow-run-check"><input type="checkbox" data-field="overwrite" ' +
        (draft.overwrite ? 'checked' : '') +
        ' /> 覆盖</label>' +
        '</div>' +
        (reuseSource
          ? '<div class="workflow-run-result"><div class="workflow-run-result-row"><span class="workflow-run-result-label">复用</span><span class="workflow-run-result-value">' +
            esc(reuseSource.id || '') +
            '</span></div></div>'
          : '') +
        '<div class="workflow-card-actions">' +
        '<button type="button" class="workflow-card-action" data-action="preflight"' +
        (busy ? ' disabled' : '') +
        '>检查</button>' +
        '<button type="button" class="workflow-card-action primary" data-action="run"' +
        (busy ? ' disabled' : '') +
        '>运行</button>' +
        '<button type="button" class="workflow-card-action" data-action="conversation">对话</button>' +
        '<button type="button" class="workflow-card-action" data-action="detail">' +
        (this.selectedWorkflowId === workflow.id ? '收起详情' : '详情') +
        '</button>' +
        '<button type="button" class="workflow-card-action" data-action="pin-home">' +
        (this.pinForScope(workflow, 'home') ? '取消首页固定' : '固定到首页') +
        '</button>' +
        '<button type="button" class="workflow-card-action" data-action="pin-connection">' +
        (this.pinForScope(workflow, 'connection', this.connectorTargetForWorkflow(workflow)) ? '取消连接固定' : '固定到连接') +
        '</button>' +
        (this.pinsForWorkflow(workflow).length
          ? '<button type="button" class="workflow-card-action primary" data-action="run-pinned">运行固定项</button>'
          : '') +
        '</div>' +
        this.detailHtml(workflow) +
        this.preflightHtml(preflight) +
        this.artifactHtml(run) +
        this.resultHtml(run);
      card.querySelector('[data-action="preflight"]')?.addEventListener('click', () => {
        void this.preflightWorkflow(workflow, card);
      });
      card.querySelectorAll('[data-repair-action]').forEach((button) => {
        button.addEventListener('click', () => {
          const preflight = this.preflightByWorkflowId.get(workflow.id);
          const action = asArray(preflight && preflight.repair_actions)[Number(button.getAttribute('data-repair-action'))];
          void this.handleRepairAction(workflow, card, action);
        });
      });
      card.querySelector('[data-action="run"]')?.addEventListener('click', () => {
        void this.runWorkflow(workflow, card);
      });
      card.querySelectorAll('[data-artifact-action]').forEach((button) => {
        button.addEventListener('click', () => {
          const latestRun = this.runsByWorkflowId.get(workflow.id);
          const artifact = asArray(latestRun && latestRun.artifacts)[0] || null;
          void this.handleArtifactAction(workflow, card, artifact, button.getAttribute('data-artifact-action'));
        });
      });
      card.querySelector('[data-action="conversation"]')?.addEventListener('click', () => {
        this.openWorkflowConversation(workflow);
      });
      card.querySelector('[data-action="detail"]')?.addEventListener('click', () => {
        this.selectedWorkflowId = this.selectedWorkflowId === workflow.id ? '' : workflow.id;
        this.render();
      });
      card.querySelector('[data-run-action="repair-session"]')?.addEventListener('click', () => {
        const latestRun = this.runsByWorkflowId.get(workflow.id);
        void this.createRepairSession(workflow, latestRun);
      });
      card.querySelector('[data-action="pin-home"]')?.addEventListener('click', () => {
        void this.togglePin(workflow, { kind: 'home' });
      });
      card.querySelector('[data-action="pin-connection"]')?.addEventListener('click', () => {
        const connectionId = this.connectorTargetForWorkflow(workflow);
        void this.togglePin(workflow, { kind: 'connection', connection_id: connectionId || 'unknown' });
      });
      card.querySelector('[data-action="run-pinned"]')?.addEventListener('click', () => {
        void this.runWorkflow(workflow, card);
      });
      return card;
    },

    render() {
      ensureStyles();
      const list = $('workflowList');
      const empty = $('workflowEmpty');
      if (!list || !empty) return;
      list.innerHTML = '';
      this.rebuildLatestRuns();
      this.renderSummary(this.workflows);
      this.renderHistory();
      if (this.listError) {
        empty.classList.add('hidden');
        list.className = 'workflow-list';
        const error = document.createElement('div');
        error.className = 'workflow-error';
        error.textContent = this.listError;
        list.appendChild(error);
        return;
      }
      const visible = this.workflows.filter((workflow) => this.matchesSearch(workflow));
      if (!this.workflows.length) {
        empty.classList.remove('hidden');
        list.className = 'hidden';
        return;
      }
      empty.classList.add('hidden');
      list.className = 'workflow-list';
      if (!visible.length) {
        const error = document.createElement('div');
        error.className = 'workflow-error';
        error.textContent = '没有匹配的 Workflow。';
        list.appendChild(error);
        return;
      }
      for (const workflow of visible) list.appendChild(this.renderCard(workflow));
    },

    async reload(shell) {
      const activeShell = shell || this._shell;
      const gen = ++this._reloadGen;
      const btn = $('btnWorkflowRefresh');
      if (btn) btn.disabled = true;
      try {
        const [workflows, runs, drafts, pins] = await Promise.all([
          this.fetchSkills(activeShell),
          this.fetchRuns(activeShell),
          this.fetchDrafts(activeShell),
          this.fetchPins(activeShell),
        ]);
        this.workflows = workflows;
        this.historyRuns = runs;
        this.drafts = drafts;
        this.pins = pins;
        this.listError = '';
      } catch (e) {
        if (gen !== this._reloadGen) return;
        this.workflows = [];
        this.historyRuns = [];
        this.drafts = [];
        this.pins = [];
        this.listError = e instanceof Error ? e.message : String(e);
      } finally {
        if (btn) btn.disabled = false;
      }
      if (gen === this._reloadGen) this.render();
    },

    runPayloadFromCard(card) {
      const outputDir = compact(card.querySelector('[data-field="output_dir"]')?.value, 'project://exports');
      const fileName = compact(card.querySelector('[data-field="file_name"]')?.value, 'selected_asset');
      const overwrite = Boolean(card.querySelector('[data-field="overwrite"]')?.checked);
      const payload = {
        params: {
          output_dir: outputDir,
          file_name: fileName,
          overwrite,
        },
      };
      return payload;
    },

    async runWorkflow(workflow, card) {
      const shell = this._shell;
      if (!shell || typeof shell.api !== 'function' || !workflow || !workflow.id) return;
      this.busyId = workflow.id;
      this.inlineStatus = '正在检查 ' + (workflow.name || workflow.id);
      this.render();
      const liveCard = document.querySelector('[data-workflow-id="' + cssEscape(workflow.id) + '"]') || card;
      const payload = this.runPayloadFromCard(liveCard);
      const reuseSource = this.reuseSourceByWorkflowId.get(workflow.id);
      if (reuseSource && reuseSource.id) payload.reusedFromRunId = reuseSource.id;
      try {
        const preflight = await this.preflightWorkflow(workflow, liveCard, payload, { keepBusy: true });
        if (!preflight || preflight.status === 'failed') {
          this.inlineStatus = '运行前检查未通过：' + (workflow.name || workflow.id);
          this.render();
          return;
        }
        this.inlineStatus = '正在运行 ' + (workflow.name || workflow.id);
        this.render();
        const r = await shell.api(
          'POST',
          '/v1/workflows/' + encodeURIComponent(workflow.id) + '/run',
          payload,
          { timeoutMs: 120000 },
        );
        const body = (r && r.json) || {};
        const run = body.result || null;
        if (run && run.workflow_id) {
          this.historyRuns = [
            run,
            ...asArray(this.historyRuns).filter((item) => item && item.id !== run.id),
          ].slice(0, 20);
        }
        this.inlineStatus =
          r && r.ok
            ? '运行完成：' + (run && run.output && run.output.fbx_path ? run.output.fbx_path : workflow.id)
            : '运行未完成：' + this.runFailureMessage(body, run, (r && r.text) || workflow.id);
        this.render();
        if (!r || !r.ok) this.openWorkflowConversation(workflow);
      } catch (e) {
        this.inlineStatus = '运行失败：' + (e instanceof Error ? e.message : String(e));
        this.render();
        this.openWorkflowConversation(workflow);
      } finally {
        this.busyId = '';
        this.render();
      }
    },

    async preflightWorkflow(workflow, card, payload, opts) {
      const shell = this._shell;
      if (!shell || typeof shell.api !== 'function' || !workflow || !workflow.id) return null;
      const keepBusy = Boolean(opts && opts.keepBusy);
      const liveCardBeforeRender = document.querySelector('[data-workflow-id="' + cssEscape(workflow.id) + '"]') || card;
      const effectivePayload = payload || this.runPayloadFromCard(liveCardBeforeRender);
      if (!keepBusy) {
        this.busyId = workflow.id;
        this.inlineStatus = '正在检查 ' + (workflow.name || workflow.id);
        this.render();
      }
      try {
        const liveCard = document.querySelector('[data-workflow-id="' + cssEscape(workflow.id) + '"]') || card;
        const r = await shell.api(
          'POST',
          '/v1/workflows/' + encodeURIComponent(workflow.id) + '/preflight',
          effectivePayload,
          { timeoutMs: 60000 },
        );
        const body = (r && r.json) || {};
        const preflight = body.preflight || null;
        if (preflight) this.preflightByWorkflowId.set(workflow.id, preflight);
        this.inlineStatus =
          r && r.ok
            ? '检查完成：' + this.preflightStatusLabel(preflight && preflight.status)
            : '检查失败：' + (body.message || body.error || (r && r.text) || workflow.id);
        this.render();
        return preflight;
      } catch (e) {
        this.inlineStatus = '检查失败：' + (e instanceof Error ? e.message : String(e));
        this.render();
        return null;
      } finally {
        if (!keepBusy) {
          this.busyId = '';
          this.render();
        }
      }
    },

    connectorTargetForWorkflow(workflow) {
      const summaries = asArray(workflow && workflow.connectorSummaries);
      const firstSummary = summaries.find((item) => item && item.capabilityPackageId);
      if (firstSummary) return firstSummary.capabilityPackageId;
      const connectors = asArray(workflow && workflow.systemContract && workflow.systemContract.requiredConnectors);
      const firstConnector = connectors.find((item) => item && item.capabilityPackageId);
      return firstConnector ? firstConnector.capabilityPackageId : '';
    },

    async openConnectionPage(action, workflow) {
      const shell = this._shell;
      if (shell && typeof shell.setShellView === 'function') {
        await shell.setShellView('connections');
        if (window.ShellConnectionPage && typeof window.ShellConnectionPage.focusConnection === 'function') {
          window.ShellConnectionPage.focusConnection(this.connectorTargetForWorkflow(workflow));
        }
        return true;
      }
      const link = document.querySelector('[data-view="connections"]');
      if (link && typeof link.click === 'function') {
        link.click();
        if (window.ShellConnectionPage && typeof window.ShellConnectionPage.focusConnection === 'function') {
          window.ShellConnectionPage.focusConnection(this.connectorTargetForWorkflow(workflow));
        }
        return true;
      }
      this.inlineStatus = '请打开连接页面处理：' + ((action && (action.title || action.id)) || '连接修复');
      this.render();
      return false;
    },

    applyRepairPatch(card, action) {
      const patch = action && action.suggestedInputPatch && typeof action.suggestedInputPatch === 'object'
        ? action.suggestedInputPatch
        : {};
      if (Object.prototype.hasOwnProperty.call(patch, 'overwrite')) {
        const overwrite = card.querySelector('[data-field="overwrite"]');
        if (overwrite) overwrite.checked = Boolean(patch.overwrite);
      }
      if (typeof patch.output_dir === 'string') {
        const outputDir = card.querySelector('[data-field="output_dir"]');
        if (outputDir) outputDir.value = patch.output_dir;
      }
      if (typeof patch.file_name === 'string') {
        const fileName = card.querySelector('[data-field="file_name"]');
        if (fileName) fileName.value = patch.file_name;
      }
    },

    async handleRepairAction(workflow, card, action) {
      if (!action || !this.isSupportedRepairAction(action)) {
        this.inlineStatus = '暂不支持该修复动作：' + ((action && (action.title || action.id || action.actionType)) || 'unknown');
        this.render();
        return;
      }
      const liveCard = document.querySelector('[data-workflow-id="' + cssEscape(workflow.id) + '"]') || card;
      if (action.actionType === 'reconnect' || action.id === 'repair_maya_export_capability') {
        await this.openConnectionPage(action, workflow);
        return;
      }
      if (action.actionType === 'confirm' || action.actionType === 'revise_input') {
        this.applyRepairPatch(liveCard, action);
        const payload = this.runPayloadFromCard(liveCard);
        this.inlineStatus = '已应用修复建议：' + (action.title || action.id);
        await this.preflightWorkflow(workflow, liveCard, payload);
        return;
      }
      await this.preflightWorkflow(workflow, liveCard);
    },

    async handleArtifactAction(workflow, card, artifact, action) {
      if (!artifact) return;
      if (action === 'open') {
        const shell = this._shell;
        if (!this.canOpenArtifact(artifact)) {
          this.inlineStatus = '无法打开：产物文件不可用';
          this.render();
          return;
        }
        if (shell && typeof shell.openFolderPath === 'function') {
          const r = await shell.openFolderPath(artifact.local_path);
          this.inlineStatus = r && r.ok ? '已打开产物位置' : '打开失败：' + ((r && (r.error || r.message)) || artifact.local_path);
          this.render();
          return;
        }
        this.inlineStatus = '当前环境不支持打开位置';
        this.render();
        return;
      }
      if (action === 'copy') {
        const text = this.artifactPath(artifact);
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(text);
          this.inlineStatus = '已复制产物路径';
        } else {
          this.inlineStatus = '产物路径：' + text;
        }
        this.render();
        return;
      }
      if (action === 'save-draft') {
        const shell = this._shell;
        const run = this.runsByWorkflowId.get(workflow.id);
        if (!shell || typeof shell.api !== 'function' || !run || run.status !== 'succeeded') return;
        const r = await shell.api(
          'POST',
          '/v1/workflows/runs/' + encodeURIComponent(run.id) + '/save-draft',
          { name: (workflow.name || workflow.id || 'Workflow') + ' 草稿' },
          { timeoutMs: 30000 },
        );
        const body = (r && r.json) || {};
        if (r && r.ok && body.run && body.run.id) {
          this.historyRuns = asArray(this.historyRuns).map((item) => item && item.id === body.run.id ? body.run : item);
          this.inlineStatus = '已保存为工作流草稿：' + ((body.draft && (body.draft.name || body.draft.id)) || body.run.saved_as_draft_id || run.id);
        } else {
          this.inlineStatus = '保存草稿失败：' + (body.message || body.error || (r && r.text) || run.id);
        }
        this.render();
        return;
      }
      if (action === 'rerun') {
        await this.runWorkflow(workflow, card);
        return;
      }
      if (action === 'reuse') {
        const run = this.runsByWorkflowId.get(workflow.id);
        await this.reuseRun(run);
      }
    },

    async createRepairSession(workflow, run) {
      const shell = this._shell;
      if (!shell || typeof shell.api !== 'function' || !run || !run.id) return;
      const r = await shell.api(
        'POST',
        '/v1/workflows/runs/' + encodeURIComponent(run.id) + '/repair-session',
        {},
        { timeoutMs: 30000 },
      );
      const body = (r && r.json) || {};
      if (r && r.ok && body.repairSession) {
        this.inlineStatus = '已创建修复会话：' + (body.repairSession.id || run.id);
        this.openWorkflowConversation(workflow);
      } else {
        this.inlineStatus = '创建修复会话失败：' + (body.message || body.error || (r && r.text) || run.id);
      }
      this.render();
    },

    async togglePin(workflow, scope) {
      const shell = this._shell;
      if (!shell || typeof shell.api !== 'function' || !workflow || !workflow.id || !scope || !scope.kind) return;
      const existing = this.pinForScope(workflow, scope.kind, scope.connection_id || scope.project_id || scope.object_id || scope.workspace_id);
      if (existing) {
        const r = await shell.api('DELETE', '/v1/workflows/pins/' + encodeURIComponent(existing.id), null, { timeoutMs: 30000 });
        if (r && r.ok) {
          this.pins = asArray(this.pins).filter((pin) => pin && pin.id !== existing.id);
          this.inlineStatus = '已取消固定：' + this.pinScopeLabel(existing);
        } else {
          const body = (r && r.json) || {};
          this.inlineStatus = '取消固定失败：' + (body.message || body.error || (r && r.text) || existing.id);
        }
        this.render();
        return;
      }
      const r = await shell.api(
        'POST',
        '/v1/workflows/pins',
        {
          scope,
          versionPolicy: { kind: 'follow_default' },
          workflowId: workflow.id,
        },
        { timeoutMs: 30000 },
      );
      const body = (r && r.json) || {};
      if (r && r.ok && body.pin) {
        this.pins = [body.pin, ...asArray(this.pins).filter((pin) => pin && pin.id !== body.pin.id)];
        this.inlineStatus = '已固定：' + this.pinScopeLabel(body.pin);
      } else {
        this.inlineStatus = '固定失败：' + (body.message || body.error || (r && r.text) || workflow.id);
      }
      this.render();
    },

    replayParamsFromRun(run) {
      const normalized = run && run.replay_snapshot && run.replay_snapshot.normalized_input
        ? run.replay_snapshot.normalized_input
        : run && run.normalized_input
          ? run.normalized_input
          : null;
      if (!normalized) return null;
      return {
        file_name: normalized.file_name || '',
        output_dir: normalized.output_dir || '',
        overwrite: Boolean(normalized.overwrite),
      };
    },

    async reuseRun(run) {
      if (!run || !run.workflow_id) return;
      const workflow = this.workflows.find((item) => item && item.id === run.workflow_id);
      if (!workflow) return;
      const params = this.replayParamsFromRun(run);
      if (!params) {
        this.inlineStatus = '无法复用：缺少 ReplaySnapshot';
        this.render();
        return;
      }
      this.draftParamsByWorkflowId.set(workflow.id, params);
      this.reuseSourceByWorkflowId.set(workflow.id, run);
      this.inlineStatus = '已载入历史参数，正在重新检查：' + (run.id || workflow.id);
      this.render();
      const card = document.querySelector('[data-workflow-id="' + cssEscape(workflow.id) + '"]');
      await this.preflightWorkflow(workflow, card, { params });
    },

    bind(shell) {
      this._shell = shell;
      $('btnWorkflowRefresh')?.addEventListener('click', () => void this.reload(shell));
      $('workflowSearch')?.addEventListener('input', (ev) => {
        this.searchQuery = String((ev && ev.target && ev.target.value) || '');
        this.render();
      });
    },

    async onViewShown(shell) {
      this._shell = shell;
      await this.reload(shell);
    },
  };
})();
