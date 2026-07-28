// 拜访纪要待办解析：从「客户拜访纪要」模板生成的纪要 markdown 中提取待办表格。
// 模板约定：待办章节（如「## 七、待办事项与后续跟进」）内含固定四列表格
// `| 序号 | 跟进事项 | 负责人 | 完成时限 |`，无待办时写「本次拜访未产生待办事项」。
// 纯函数，不依赖 Tauri API（node --test 可直接跑 .spec.mjs 规格）。

export interface ParsedVisitTodo {
  content: string // 跟进事项
  owner: string // 负责人（无对应列或留空时为 ''）
  dueText: string // 完成时限原文（由 parseDueDate 转时间戳，无法解析时记 0）
}

// Markdown 标题行（允许行首最多 3 个空格，# 后必须有空格）
const HEADING_RE = /^\s{0,3}#{1,6}\s+/
// 待办章节标题：兼容「待办事项与后续跟进」「后续待跟进事项」等写法
const TODO_HEADING_RE = /待办|待跟进/
// 表格分隔行：|------|---------| 之类
const SEPARATOR_RE = /^\s*\|?[\s:|-]+\|?\s*$/

/**
 * 从纪要 markdown 中解析待办表格，返回 {content, owner, dueText} 数组。
 * 定位不到待办章节、章节内无表格、或明确写「未产生待办事项」时返回空数组。
 * 兼容表头列序差异（按表头名映射列）与标题/表格之间的空行、说明文字。
 */
export function parseVisitTodosFromSummary(summaryMd: string): ParsedVisitTodo[] {
  if (!summaryMd || !summaryMd.trim()) return []
  const lines = summaryMd.split(/\r?\n/)

  // 1. 定位待办章节：标题含「待办」或「待跟进」；找不到时回退为整篇文档扫描
  let sectionStart = -1
  for (let i = 0; i < lines.length; i++) {
    if (HEADING_RE.test(lines[i]) && TODO_HEADING_RE.test(lines[i])) {
      sectionStart = i
      break
    }
  }
  let region: string[]
  if (sectionStart >= 0) {
    let sectionEnd = lines.length
    for (let i = sectionStart + 1; i < lines.length; i++) {
      if (HEADING_RE.test(lines[i])) {
        sectionEnd = i
        break
      }
    }
    region = lines.slice(sectionStart + 1, sectionEnd)
  } else {
    region = lines
  }

  // 2. 在章节内找第一个符合「跟进事项/负责人/完成时限」结构的表格
  for (let i = 0; i < region.length; i++) {
    const line = region[i]
    if (!/^\s*\|/.test(line)) continue
    const headerCells = splitRow(line)
    const mapping = mapHeader(headerCells)
    if (!mapping) continue // 不是待办表头，继续向下找

    // 表头下一非空行必须是分隔行，否则说明这不是表格（继续向后扫描）
    let j = i + 1
    while (j < region.length && !region[j].trim()) j++
    if (j >= region.length || !SEPARATOR_RE.test(region[j]) || !region[j].includes('-')) {
      continue
    }

    // 3. 逐行解析数据行，直到表格结束（首个非 | 开头的行）
    const todos: ParsedVisitTodo[] = []
    for (let k = j + 1; k < region.length; k++) {
      const rowLine = region[k]
      if (!/^\s*\|/.test(rowLine)) break
      const cells = splitRow(rowLine)
      const content = cleanCell(cells[mapping.contentIdx] ?? '')
      // 跳过模板占位行（| 1 | {具体事项} | ...）与「未产生待办」说明行
      if (!content || /^\{.*\}$/.test(content)) continue
      if (/未产生待办|^无$|^暂无$/.test(content)) continue
      todos.push({
        content,
        owner: mapping.ownerIdx >= 0 ? cleanCell(cells[mapping.ownerIdx] ?? '') : '',
        dueText: mapping.dueIdx >= 0 ? cleanCell(cells[mapping.dueIdx] ?? '') : '',
      })
    }
    return todos
  }

  return []
}

/**
 * 把「完成时限」原文解析为本地当天 0 点时间戳；无法解析/明确无时限时返回 0。
 * 支持：YYYY-MM-DD、YYYY/M/D、YYYY.M.D、M月D日（默认当年，日期已过则取明年）、
 * 今天/明天/后天（相对 now），「待定/无/-」等返回 0。
 * @param dueText 时限原文
 * @param now 相对时刻（默认当前时间，测试可注入固定值）
 */
export function parseDueDate(dueText: string, now: number = Date.now()): number {
  const text = dueText.trim()
  if (!text) return 0
  // 明确「无时限」语义
  if (/^(待定|无|暂无|未定|--?|—|\/|tbd)$/i.test(text)) return 0

  const DAY_MS = 24 * 60 * 60 * 1000
  const nowDate = new Date(now)
  const today = new Date(
    nowDate.getFullYear(),
    nowDate.getMonth(),
    nowDate.getDate()
  ).getTime()

  // 今天/明天/后天（允许「明天上午」这类后缀；「大后天」含「后天」，需先匹配）
  if (text.includes('今天') || text.includes('今日')) return today
  if (text.includes('明天') || text.includes('明日')) return today + DAY_MS
  if (text.includes('大后天')) return today + 3 * DAY_MS
  if (text.includes('后天')) return today + 2 * DAY_MS

  // 完整日期：YYYY-MM-DD / YYYY/M/D / YYYY.M.D / YYYY年M月D日
  const full = text.match(/(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?/)
  if (full) {
    return makeDate(+full[1], +full[2], +full[3]) ?? 0
  }

  // 月日：M月D日（兼容「8月5日前/之前」），或 M-D / M/D（当年，已过则明年）
  const cnMd = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/)
  const numMd = cnMd ? null : text.match(/(\d{1,2})\s*[-/.]\s*(\d{1,2})/)
  const md = cnMd ?? numMd
  if (md) {
    const month = +md[1]
    const day = +md[2]
    const year = nowDate.getFullYear()
    let ts = makeDate(year, month, day)
    if (ts !== null && ts < today) {
      ts = makeDate(year + 1, month, day)
    }
    return ts ?? 0
  }

  return 0
}

/** 拆分表格行为单元格数组（去掉首尾的 | 后按 | 切分） */
function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

/** 清理单元格：去掉首尾空白与包裹的强调符（星号、下划线） */
function cleanCell(cell: string): string {
  return cell.trim().replace(/^(\*\*|__)+|(\*\*|__)+$/g, '').trim()
}

/**
 * 按表头名映射列序：跟进事项列必须存在（含「事项」），
 * 负责人列（负责人/责任人）、时限列（时限/期限/日期）可缺省（返回 -1）。
 */
function mapHeader(cells: string[]): {
  contentIdx: number
  ownerIdx: number
  dueIdx: number
} | null {
  const contentIdx = cells.findIndex((c) => c.includes('事项'))
  if (contentIdx < 0) return null
  const ownerIdx = cells.findIndex((c) => c.includes('负责人') || c.includes('责任人'))
  const dueIdx = cells.findIndex(
    (c) => c.includes('时限') || c.includes('期限') || c.includes('日期')
  )
  return { contentIdx, ownerIdx, dueIdx }
}

/** 构造本地日期 0 点时间戳；月份/日期越界时返回 null */
function makeDate(year: number, month: number, day: number): number | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const d = new Date(year, month - 1, day)
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
    return null
  }
  return d.getTime()
}
