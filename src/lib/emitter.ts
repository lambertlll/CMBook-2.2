import mitt from 'mitt'
import type { QuickPrompt } from '@/lib/ai/placeholder'
import type { OnboardingStepId } from '@/app/core/main/editor/onboarding-state'

// 定义事件类型
interface Events {
  'searchAndScroll': string;
  'ai-completion-loading': boolean;
  'auto-completion-enabled-changed': boolean;
  'editor-input': unknown;
  'editor:ready': unknown;
  'editor-mode-changed': string;
  'external-content-update': string;
  'editor-content-from-remote': { content: string };
  'toolbar-text-number': number;
  'toolbar-reset-selected-text': unknown;
  'quickRecordText': unknown;
  'quickRecordTextHandler': { prefillText?: string } | undefined;
  'onboarding-record-prefill-changed': { prefillText?: string } | undefined;
  'onboarding-step-complete': { step: OnboardingStepId; filePath?: string };
  'openWindow': unknown;
  'startMeeting': unknown;
  'immediate-pull-needed': { type: string; path: string; hash: string; filePath: string } | { type: string; filePath: string } | { filePath: string; isRemoteFile: boolean };
  'getSettingModelList': unknown;
  'insert-quote': {
    quote: string;
    fullContent: string;
    fileName: string;
    startLine: number;
    endLine: number;
    from: number;
    to: number;
    articlePath: string;
  };
  'toolbar-shortcut-image': unknown;
  'toolbar-shortcut-file': unknown;
  'toolbar-shortcut-todo': unknown;
  'editor-ai-streaming': { isStreaming: boolean; targetFilePath?: string; terminate?: () => void };
  'latest-commit-info': {
    sha: string;
    message: string;
    author: string;
    date: Date;
    additions?: number;
    deletions?: number;
  };
  'sync-success': unknown;
  'sync-content-updated': { path: string; content: string };
  'sync-push-completed': { path: string; success: boolean; sha?: string };
  'sync-sha-mismatch': { path: string; localSha?: string; remoteSha?: string; force?: boolean };
  'revertChat': unknown;
  'fileSelected': {
    name: string;
    path: string;
    relativePath: string;
  };
  'folderSelected': {
    name: string;
    path: string;
    relativePath: string;
    fileCount: number;
    indexedCount: number;
  };
  'toolbar-mark': unknown;
  'toolbar-continue': unknown;
  'toolbar-question': unknown;
  'toolbar-translation': unknown;
  'toolbar-organize': unknown;
  'screenshot-shortcut-register': unknown;
  'text-shortcut-register': unknown;
  'window-pin-register': unknown;
  'window-pin-changed': boolean;
  'link-shortcut-register': unknown;
  'refresh-marks': unknown;
  'quick-prompt-insert': string;
  'quick-prompt-send': string;
  'ai-placeholder-generated': string;
  'ai-prompts-generated': QuickPrompt[];
  'start-ai-streaming': {
    originalText: string;
    type: string;
    position: { top: number; left: number; right: number; bottom: number };
    controller?: AbortController;
  };
  'update-ai-streaming-content': {
    suggestedText: string;
    position: { top: number; left: number; right: number; bottom: number };
  };
  'update-ai-thinking-content': {
    thinkingText: string;
    position: { top: number; left: number; right: number; bottom: number };
  };
  'ai-streaming-complete': {
    originalText: string;
    suggestedText: string;
    type: string;
    position: { top: number; left: number; right: number; bottom: number };
    generatedRange?: { from: number; to: number };
  } | undefined;
  'show-ai-suggestion': {
    originalText: string;
    suggestedText: string;
    type: string;
    position: { top: number; left: number; right: number; bottom: number };
    generatedRange?: { from: number; to: number };
  };
  'abort-ai-streaming': void;
  'accept-ai-suggestion': void;
  'reject-ai-suggestion': void;
  // 客户模块：程序化发送聊天消息（拜访产物生成）
  'send-chat-message': { content: string };
  // 客户模块：拜访产物生成完成（访前尽调/访后财报分析/审贷会材料）
  'customer-visit-doc-generated': { customerId: string; visitId: string; kind: 'previsit' | 'financial' | 'credit'; path: string };
  // 客户模块：会议纪要导出到客户知识库完成
  'customer-meeting-exported': { customerId: string; visitId?: string; path: string };
  // 笔记模块：右键"归入客户知识库/提取待办"打开客户选择框（对话框在菜单外渲染，避免随菜单关闭卸载）
  'note-customer-picker': { action: 'archive' | 'extract'; item: unknown };
  // Agent 编辑器工具事件 - 内联定义避免重复
  'editor-get-selection': { resolve: (data: { text: string; from: number; to: number; html?: string; startLine?: number; endLine?: number }) => void };
  'editor-get-content': { resolve: (data: { markdown: string; text: string; wordCount: number; charCount: number; totalLines?: number; numberedLines?: string; version: number }) => void };
  'editor-insert': { content: string; position?: number; resolve: (result: { success: boolean; insertedLength: number; newCursorPosition?: number }) => void };
  'editor-undo': void;
  'editor-redo': void;
  'editor-agent-diff-preview': {
    originalContent: string;
    modifiedContent: string;
    filePath?: string;
    from?: number;
    to?: number;
  };
  'editor-agent-diff-clear': void;
  'mobile-editor-toggle-outline': void;
  'editor-can-undo-redo': { resolve: (can: { undo: boolean; redo: boolean }) => void };
  'editor-undo-redo-changed': { undo: boolean; redo: boolean };
  'editor-replace': {
    content?: string;
    range?: { from: number; to: number };
    searchContent?: string;
    occurrence?: number;
    startLine?: number;
    endLine?: number;
    expectedVersion?: number;
    resolve: (result: { success: boolean; insertedLength: number; message?: string; error?: string; newCursorPosition?: number; versionMismatch?: boolean }) => void;
  };
  [key: string]: unknown;
  [key: symbol]: unknown;
}

const emitter = mitt<Events>()

export type { Events }
export default emitter;
