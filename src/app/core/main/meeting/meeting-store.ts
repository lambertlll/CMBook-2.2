import { create } from 'zustand'
import {
  getMeetingList,
  getMeeting,
  insertMeeting,
  updateMeetingRecord,
  deleteMeetingRecord,
  type MeetingRecord,
  type MeetingListRecord,
} from '@/db/meetings'
import { removeMeetingAudio } from './meeting-save-audio'
import { deleteVisitTodosByMeeting } from '@/db/visit-todos'
import { clearVisitMeetingLink } from '@/db/visits'
import { destroyRecorder, getRecorder } from './meeting-recorder-manager'
import { clearLiveTranscript, pauseLiveTranscript, resumeLiveTranscript } from './meeting-live-transcript'

export type MeetingStatus =
  | 'idle'
  | 'recording'
  | 'paused'
  | 'transcribing'
  | 'generating'
  | 'completed'

export interface Meeting {
  id: string
  title: string
  status: MeetingStatus
  duration: number
  manualNotes: string // HTML 格式
  transcript: string // 纯文本
  summary: string // Markdown 格式
  selectedTemplate: string
  selectedModel: string // 模型 ID
  audioPath: string // 第一段音频文件保存路径
  audioSegments: string[] // 全部音频段路径（按录制顺序，续录会产生多段）
  error?: string // 失败信息（持久化，重试/新流程开始时清除）
  customerId: string // 关联客户 ID（2.0 新增，空串表示未关联）
  visitId: string // 关联拜访 ID（2.0 新增，空串表示未关联）
  exportedFilePath: string // 纪要导出到客户知识库的文件相对路径（空串表示未导出）
  hasSummary: number // 是否已有纪要（列表查询的轻量标记 0/1，不读 summary 大字段；不持久化）
  createdAt: number // timestamp
  transcribeProgress: number // 仅运行时使用，不持久化
  diarizing: boolean // 正在自动补充说话人标注（fun-asr 重转写中），仅运行时使用，不持久化
  recordingStartedAt: number | null // 录音开始时间戳（运行时）
  pausedDuration: number // 累计暂停时长（毫秒，运行时）
}

// 新建会议的可选参数（拜访场景：预设标题/模板并关联客户与拜访）
export interface CreateMeetingOptions {
  title?: string
  selectedTemplate?: string
  customerId?: string
  visitId?: string
}

interface MeetingStoreState {
  meetings: Meeting[]
  activeMeetingId: string | null // 当前查看的会议
  recordingMeetingId: string | null // 当前正在录音的会议
  initialized: boolean
  /** 列表加载失败时的错误信息（未失败为 null），用于 UI 区分"加载失败"与"确实无数据" */
  loadError: string | null

  // 批量选择
  selectedMeetingIds: string[]
  toggleMeetingSelection: (id: string) => void
  clearSelectedMeetingIds: () => void

  // Actions
  loadMeetings: () => Promise<void>
  createMeeting: (options?: CreateMeetingOptions) => string // 返回新会议 ID
  setActiveMeeting: (id: string | null) => void
  updateMeeting: (id: string, updates: Partial<Meeting>) => void
  deleteMeeting: (id: string) => void
  deleteMeetings: (ids: string[]) => void // 批量删除
  setMeetingError: (id: string, message: string) => void // 记录失败并回退到可重试状态
  getActiveMeeting: () => Meeting | undefined
  getRecordingMeeting: () => Meeting | undefined

  // 录音控制
  startRecording: (id: string) => void
  pauseRecording: (id: string) => void
  resumeRecording: (id: string) => void
  stopRecording: (id: string) => void
  // 续录：已完成的会议回到录音状态，在同一会议下录制新的一段
  continueRecording: (id: string) => void
}

// 需要持久化的字段
const PERSIST_FIELDS: (keyof Meeting)[] = [
  'title',
  'status',
  'manualNotes',
  'transcript',
  'summary',
  'selectedTemplate',
  'selectedModel',
  'duration',
  'pausedDuration',
  'audioPath',
  'audioSegments',
  'error',
  'customerId',
  'visitId',
  'exportedFilePath',
]

/**
 * 解析数据库中的 audioSegments JSON 数组，非法数据回退为空数组
 */
function parseAudioSegments(json: string | undefined): string[] {
  if (!json) return []
  try {
    const arr = JSON.parse(json)
    return Array.isArray(arr)
      ? arr.filter((p): p is string => typeof p === 'string' && p !== '')
      : []
  } catch {
    return []
  }
}

/**
 * 获取会议全部音频段路径（按录制顺序）。
 * 老数据没有 audioSegments 时回退为单段 audioPath，保证重转写/删除兼容。
 */
export function getMeetingAudioPaths(
  meeting: Pick<Meeting, 'audioPath' | 'audioSegments'>
): string[] {
  if (meeting.audioSegments.length > 0) return meeting.audioSegments
  return meeting.audioPath ? [meeting.audioPath] : []
}

/**
 * 将数据库记录转为内存 Meeting 对象（含大字段）
 */
function recordToMeeting(record: MeetingRecord): Meeting {
  return {
    id: record.id,
    title: record.title,
    status: record.status as MeetingStatus,
    duration: record.duration,
    manualNotes: record.manualNotes,
    transcript: record.transcript,
    summary: record.summary,
    selectedTemplate: record.selectedTemplate,
    selectedModel: record.selectedModel || '',
    audioPath: record.audioPath || '',
    audioSegments: parseAudioSegments(record.audioSegments),
    error: record.error || undefined,
    customerId: record.customerId || '',
    visitId: record.visitId || '',
    exportedFilePath: record.exportedFilePath || '',
    hasSummary: record.summary && record.summary.trim() ? 1 : 0,
    createdAt: record.createdAt,
    transcribeProgress: 0,
    diarizing: false,
    recordingStartedAt: null,
    pausedDuration: 0,
  }
}

/**
 * 将列表元数据记录转为内存 Meeting 对象（大字段留空，按需加载）
 */
function listRecordToMeeting(record: MeetingListRecord): Meeting {
  return {
    id: record.id,
    title: record.title,
    status: record.status as MeetingStatus,
    duration: record.duration,
    manualNotes: '',
    transcript: '',
    summary: '',
    selectedTemplate: record.selectedTemplate,
    selectedModel: record.selectedModel || '',
    audioPath: record.audioPath || '',
    audioSegments: parseAudioSegments(record.audioSegments),
    error: record.error || undefined,
    customerId: record.customerId || '',
    visitId: record.visitId || '',
    exportedFilePath: record.exportedFilePath || '',
    hasSummary: record.hasSummary ?? 0,
    createdAt: record.createdAt,
    transcribeProgress: 0,
    diarizing: false,
    recordingStartedAt: null,
    pausedDuration: 0,
  }
}

// 已加载完整数据（含大字段）的会议 ID
const loadedDetails = new Set<string>()

/**
 * 防抖保存到数据库（避免编辑时频繁写入）
 */
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()
// 防抖窗口内待保存的字段（按会议 ID 合并，避免连续更新丢字段）
const pendingFields = new Map<string, Partial<Meeting>>()
// 未完成的新建插入 Promise（保存路径需等待插入完成，避免 UPDATE 先于 INSERT）
const insertPromises = new Map<string, Promise<void>>()

/**
 * 过滤出允许持久化的字段并写入数据库
 */
function flushSave(id: string, fields: Partial<Meeting>) {
  const dbFields: Record<string, unknown> = {}
  for (const key of PERSIST_FIELDS) {
    if (key in fields) {
      const value = fields[key]
      // error 传 undefined 表示清除错误，落库为空串；数组字段（audioSegments）序列化为 JSON
      if (key === 'error' && value === undefined) {
        dbFields[key] = ''
      } else if (Array.isArray(value)) {
        dbFields[key] = JSON.stringify(value)
      } else {
        dbFields[key] = value
      }
    }
  }
  if (Object.keys(dbFields).length === 0) return

  // 等待该会议的新建插入完成后再更新，避免竞态丢数据
  const ready = insertPromises.get(id) || Promise.resolve()
  ready
    .then(() => updateMeetingRecord(id, dbFields))
    .catch((err) => {
      console.error('[MeetingStore] 保存失败:', err)
      // D6：写失败时保留待保存字段，5 秒后重试一次，避免静默丢数据（内存比 DB 新）
      setTimeout(() => {
        if (!pendingFields.has(id)) {
          pendingFields.set(id, fields)
          flushSave(id, fields)
        }
      }, 5000)
    })
}

function debouncedSave(id: string, fields: Partial<Meeting>) {
  // 合并进 pending，防抖窗口内的连续更新不会丢字段
  const pending = pendingFields.get(id) || {}
  pendingFields.set(id, { ...pending, ...fields })

  const existing = saveTimers.get(id)
  if (existing) clearTimeout(existing)

  const timer = setTimeout(() => {
    saveTimers.delete(id)
    const merged = pendingFields.get(id)
    pendingFields.delete(id)
    if (merged) {
      flushSave(id, merged)
    }
  }, 500)

  saveTimers.set(id, timer)
}

/**
 * 立即保存（状态变更等关键操作）
 */
function immediateSave(id: string, fields: Partial<Meeting>) {
  const existing = saveTimers.get(id)
  if (existing) clearTimeout(existing)
  saveTimers.delete(id)

  // 把挂起的防抖字段合并进本次保存，避免被清除的定时器丢字段
  const pending = pendingFields.get(id)
  pendingFields.delete(id)

  flushSave(id, { ...pending, ...fields })
}

export const useMeetingStore = create<MeetingStoreState>((set, get) => ({
  meetings: [],
  activeMeetingId: null,
  recordingMeetingId: null,
  initialized: false,
  loadError: null,

  selectedMeetingIds: [],
  toggleMeetingSelection: (id) => {
    set((state) => {
      const exists = state.selectedMeetingIds.includes(id)
      return {
        selectedMeetingIds: exists
          ? state.selectedMeetingIds.filter((mid) => mid !== id)
          : [...state.selectedMeetingIds, id]
      }
    })
  },
  clearSelectedMeetingIds: () => set({ selectedMeetingIds: [] }),

  loadMeetings: async () => {
    try {
      // 列表只加载元数据，大字段在查看会议时按需加载
      const records = await getMeetingList()
      const meetings = records.map(listRecordToMeeting)
      // 恢复时，进行中的状态重置为 completed（录音/转写/生成状态无法恢复）
      const restored = meetings.map((m) => {
        if (
          m.status === 'recording' ||
          m.status === 'paused' ||
          m.status === 'transcribing' ||
          m.status === 'generating'
        ) {
          // 同时回写数据库，避免状态残留只在内存中修复
          updateMeetingRecord(m.id, { status: 'completed' }).catch((err) => {
            console.error('[MeetingStore] 状态重置回写失败:', err)
          })
          return { ...m, status: 'completed' as MeetingStatus }
        }
        return m
      })
      set({ meetings: restored, initialized: true, loadError: null })
    } catch (err) {
      console.error('[MeetingStore] 加载会议数据失败:', err)
      set({
        initialized: true,
        loadError: err instanceof Error ? err.message : '加载会议列表失败',
      })
    }
  },

  createMeeting: (options) => {
    const id = crypto.randomUUID()
    const now = Date.now()
    const newMeeting: Meeting = {
      id,
      title: options?.title || '',
      status: 'recording',
      duration: 0,
      manualNotes: '',
      transcript: '',
      summary: '',
      selectedTemplate: options?.selectedTemplate || 'default',
      selectedModel: '',
      audioPath: '',
      audioSegments: [],
      error: undefined,
      customerId: options?.customerId || '',
      visitId: options?.visitId || '',
      exportedFilePath: '',
      hasSummary: 0,
      createdAt: now,
      transcribeProgress: 0,
      diarizing: false,
      recordingStartedAt: now,
      pausedDuration: 0,
    }
    set((state) => ({
      meetings: [newMeeting, ...state.meetings],
      activeMeetingId: id,
      recordingMeetingId: id,
    }))
    loadedDetails.add(id)

    // 写入数据库，保存 Promise 供后续保存路径等待，避免 UPDATE 先于 INSERT
    const insertPromise = insertMeeting({
      id,
      title: newMeeting.title,
      status: 'recording',
      manualNotes: '',
      transcript: '',
      summary: '',
      selectedTemplate: newMeeting.selectedTemplate,
      selectedModel: '',
      duration: 0,
      audioPath: '',
      audioSegments: '',
      error: '',
      customerId: newMeeting.customerId,
      visitId: newMeeting.visitId,
      exportedFilePath: '',
      createdAt: now,
      updatedAt: now,
    }).catch((err) => {
      console.error('[MeetingStore] 创建会议写入失败:', err)
    })
    insertPromises.set(id, insertPromise)
    void insertPromise.finally(() => {
      if (insertPromises.get(id) === insertPromise) {
        insertPromises.delete(id)
      }
    })

    return id
  },

  setActiveMeeting: (id) => {
    set({ activeMeetingId: id })
    // 查看会议时按需加载完整数据（转写/纪要/笔记等大字段）
    if (id) {
      void ensureMeetingLoaded(id)
    }
  },

  updateMeeting: (id, updates) => {
    set((state) => ({
      meetings: state.meetings.map((m) =>
        m.id === id ? { ...m, ...updates } : m
      ),
    }))

    // 状态变更立即保存，内容编辑防抖保存
    if ('status' in updates) {
      immediateSave(id, updates)
    } else {
      debouncedSave(id, updates)
    }
  },

  deleteMeeting: (id) => {
    const meeting = get().meetings.find((m) => m.id === id)

    set((state) => {
      const newMeetings = state.meetings.filter((m) => m.id !== id)
      const newActive =
        state.activeMeetingId === id ? null : state.activeMeetingId
      const newRecording =
        state.recordingMeetingId === id ? null : state.recordingMeetingId
      return {
        meetings: newMeetings,
        activeMeetingId: newActive,
        recordingMeetingId: newRecording,
      }
    })

    // D2：等待新建插入完成后再执行删除——创建后立即删除时，
    // deleteMeetingRecord 若先于 insertMeeting 执行，行会被 INSERT 重建（幽灵行复活）
    const insertPromise = insertPromises.get(id)
    const cleanup = () => {
      // 删除正在录音的会议：销毁录音器，停止麦克风采集与 .part 分片落盘
      // （record 状态或暂停状态都属于活跃录音）
      const wasRecording = meeting?.status === 'recording' || meeting?.status === 'paused'
      if (wasRecording) {
        destroyRecorder()
      }

      // 清理实时转写采集与会话（AudioContext/WebSocket/重连定时器），
      // 避免残留会话反复重建、segments 串到新会议（M4）
      clearLiveTranscript()

      // 清理挂起的保存任务与缓存条目
      const timer = saveTimers.get(id)
      if (timer) clearTimeout(timer)
      saveTimers.delete(id)
      pendingFields.delete(id)
      insertPromises.delete(id)
      loadedDetails.delete(id)

      // 级联删除该会议产生的待办（避免待办面板残留"幽灵待办"）
      deleteVisitTodosByMeeting(id).catch((err) => {
        console.error('[MeetingStore] 删除会议待办失败:', err)
      })
      // 清空拜访记录中对该会议的悬空引用
      clearVisitMeetingLink(id).catch((err) => {
        console.error('[MeetingStore] 清理拜访会议关联失败:', err)
      })

      // 删除本地音频文件（含续录的多段，兼容多种扩展名及旧版 .wav）
      removeMeetingAudio(id, meeting?.audioPath || undefined, meeting?.audioSegments).catch((err) => {
        console.error('[MeetingStore] 删除音频文件失败:', err)
      })

      // 级联删除客户知识库的导出文件及其向量索引
      // （动态引入避免与 meeting-customer-export 形成静态循环依赖）
      if (meeting?.exportedFilePath) {
        const exportedPath = meeting.exportedFilePath
        import('./meeting-customer-export')
          .then((m) => m.removeMeetingCustomerExport(exportedPath))
          .catch((err) => {
            console.error('[MeetingStore] 删除导出文件失败:', err)
          })
      }

      deleteMeetingRecord(id).catch((err) => {
        console.error('[MeetingStore] 删除会议失败:', err)
      })
    }

    // 等待新建插入完成后执行清理（防幽灵行复活）；无挂起插入则立即执行
    if (insertPromise) {
      void insertPromise.finally(() => cleanup())
    } else {
      cleanup()
    }
  },

  deleteMeetings: (ids) => {
    const idSet = new Set(ids)
    const meetingsToDelete = get().meetings.filter((m) => idSet.has(m.id))

    // 更新内存状态
    set((state) => ({
      meetings: state.meetings.filter((m) => !idSet.has(m.id)),
      activeMeetingId: idSet.has(state.activeMeetingId || '') ? null : state.activeMeetingId,
      recordingMeetingId: idSet.has(state.recordingMeetingId || '') ? null : state.recordingMeetingId,
      selectedMeetingIds: [],
    }))

    // 若批量删除包含正在录音的会议，销毁录音器
    if (meetingsToDelete.some((m) => m.status === 'recording' || m.status === 'paused')) {
      destroyRecorder()
    }

    // 逐个清理：挂起保存、音频文件、导出文件、待办、拜访关联、数据库记录
    for (const meeting of meetingsToDelete) {
      const id = meeting.id
      const timer = saveTimers.get(id)
      if (timer) clearTimeout(timer)
      saveTimers.delete(id)
      pendingFields.delete(id)
      insertPromises.delete(id)
      loadedDetails.delete(id)

      // 级联删除该会议产生的待办与拜访关联
      deleteVisitTodosByMeeting(id).catch((err) => {
        console.error('[MeetingStore] 批量删除-待办失败:', err)
      })
      clearVisitMeetingLink(id).catch((err) => {
        console.error('[MeetingStore] 批量删除-拜访关联失败:', err)
      })

      removeMeetingAudio(id, meeting.audioPath || undefined, meeting.audioSegments).catch((err) => {
        console.error('[MeetingStore] 批量删除-音频文件失败:', err)
      })

      if (meeting.exportedFilePath) {
        const exportedPath = meeting.exportedFilePath
        import('./meeting-customer-export')
          .then((m) => m.removeMeetingCustomerExport(exportedPath))
          .catch((err) => {
            console.error('[MeetingStore] 批量删除-导出文件失败:', err)
          })
      }

      deleteMeetingRecord(id).catch((err) => {
        console.error('[MeetingStore] 批量删除-数据库失败:', err)
      })
    }
  },

  setMeetingError: (id, message) => {
    // 失败时记录错误信息，状态回退到 completed（可重试的稳定状态）
    set((state) => ({
      meetings: state.meetings.map((m) =>
        m.id === id
          ? { ...m, error: message, status: 'completed' as MeetingStatus }
          : m
      ),
    }))
    immediateSave(id, { error: message, status: 'completed' })
  },

  getActiveMeeting: () => {
    const { meetings, activeMeetingId } = get()
    return meetings.find((m) => m.id === activeMeetingId)
  },

  getRecordingMeeting: () => {
    const { meetings, recordingMeetingId } = get()
    return meetings.find((m) => m.id === recordingMeetingId)
  },

  startRecording: (id) => {
    set((state) => ({
      recordingMeetingId: id,
      meetings: state.meetings.map((m) =>
        m.id === id
          ? { ...m, status: 'recording' as MeetingStatus, error: undefined }
          : m
      ),
    }))
    // 新流程开始，清除之前的错误信息
    immediateSave(id, { status: 'recording', error: '' })
  },

  pauseRecording: (id) => {
    const now = Date.now()
    set((state) => ({
      meetings: state.meetings.map((m) => {
        if (m.id !== id) return m
        // 计算已录制时长并累加到 pausedDuration
        const elapsed = m.recordingStartedAt ? now - m.recordingStartedAt : 0
        return {
          ...m,
          status: 'paused' as MeetingStatus,
          pausedDuration: m.pausedDuration + elapsed,
          recordingStartedAt: null,
        }
      }),
    }))
    // 同步驱动录音器与实时转写暂停（M5：不依赖 UI effect 时序，快速 暂停→恢复 不丢帧）
    const recorder = getRecorder()
    if (recorder && recorder.getState() === 'recording') {
      recorder.pause()
    }
    pauseLiveTranscript()
    immediateSave(id, { status: 'paused' })
  },

  resumeRecording: (id) => {
    const now = Date.now()
    set((state) => ({
      meetings: state.meetings.map((m) =>
        m.id === id
          ? { ...m, status: 'recording' as MeetingStatus, recordingStartedAt: now }
          : m
      ),
    }))
    // 同步驱动恢复
    const recorder = getRecorder()
    if (recorder && recorder.getState() === 'paused') {
      recorder.resume()
    }
    resumeLiveTranscript()
    immediateSave(id, { status: 'recording' })
  },

  stopRecording: (id) => {
    const now = Date.now()
    let finalDuration = 0
    set((state) => ({
      recordingMeetingId:
        state.recordingMeetingId === id ? null : state.recordingMeetingId,
      meetings: state.meetings.map((m) => {
        if (m.id !== id) return m
        const elapsed = m.recordingStartedAt ? now - m.recordingStartedAt : 0
        const totalMs = m.pausedDuration + elapsed
        finalDuration = Math.round(totalMs / 1000)
        return {
          ...m,
          status: 'transcribing' as MeetingStatus,
          duration: finalDuration,
          recordingStartedAt: null,
          error: undefined,
        }
      }),
    }))
    // 进入转写流程，清除之前的错误信息
    immediateSave(id, { status: 'transcribing', duration: finalDuration, error: '' })
  },

  continueRecording: (id) => {
    const now = Date.now()
    set((state) => ({
      activeMeetingId: id,
      recordingMeetingId: id,
      meetings: state.meetings.map((m) =>
        m.id === id
          ? {
              ...m,
              status: 'recording' as MeetingStatus,
              error: undefined,
              // 计时语义为累计时长：把已录总时长并入 pausedDuration，
              // 现有计时逻辑（pausedDuration + 本段进行中时长）自然显示累计值
              pausedDuration: m.duration * 1000,
              recordingStartedAt: now,
            }
          : m
      ),
    }))
    // 回到录音状态，清除之前的错误信息
    immediateSave(id, { status: 'recording', error: '' })
  },
}))

/**
 * 按需加载会议完整数据（列表只含元数据，查看时才加载大字段）
 */
async function ensureMeetingLoaded(id: string) {
  if (loadedDetails.has(id)) return
  // 先标记，避免并发重复加载
  loadedDetails.add(id)

  try {
    const record = await getMeeting(id)
    if (!record) return
    useMeetingStore.setState((state) => ({
      meetings: state.meetings.map((m) => {
        if (m.id !== id) return m
        const fromDb = recordToMeeting(record)
        // 防抖窗口内有挂起编辑的字段：保留内存值（更新），避免 DB 旧值覆盖新输入（D1）
        const pending = pendingFields.get(id)
        if (!pending) return fromDb
        return {
          ...fromDb,
          ...Object.fromEntries(
            Object.entries(pending).filter(([k, v]) => {
              // 只保护用户可编辑的大字段；error/status 等状态字段以 DB 为准
              return (
                (k === 'manualNotes' || k === 'summary') &&
                v !== undefined &&
                v !== null
              )
            })
          ),
        }
      }),
    }))
  } catch (err) {
    loadedDetails.delete(id)
    console.error('[MeetingStore] 加载会议详情失败:', err)
  }
}
