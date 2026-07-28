import test from 'node:test'
import assert from 'node:assert/strict'

import { parseVisitTodosFromSummary, parseDueDate } from './visit-todos.ts'

// 固定「今天」为本地 2026-07-23，保证时限解析断言可复现
const NOW = new Date(2026, 6, 23).getTime()
const DAY = 24 * 60 * 60 * 1000

test('parses the standard customer-visit todo table', () => {
  const md = [
    '## 一、拜访基本信息',
    '',
    '- 客户：宁德时代',
    '',
    '## 七、待办事项与后续跟进',
    '',
    '| 序号 | 跟进事项 | 负责人 | 完成时限 |',
    '|------|---------|--------|----------|',
    '| 1 | 提供近三年财务报表 | 张三 | 2026-07-30 |',
    '| 2 | 反馈授信额度方案 | 李四 | 8月5日 |',
    '',
  ].join('\n')

  assert.deepEqual(parseVisitTodosFromSummary(md), [
    { content: '提供近三年财务报表', owner: '张三', dueText: '2026-07-30' },
    { content: '反馈授信额度方案', owner: '李四', dueText: '8月5日' },
  ])
})

test('tolerates reordered header columns and blank lines/prose before the table', () => {
  const md = [
    '## 七、待办事项与后续跟进',
    '',
    '本次拜访形成以下待办：',
    '',
    '| 负责人 | 完成时限 | 跟进事项 |',
    '|--------|----------|----------|',
    '| **王五** | 明天 | 寄送产品资料 |',
  ].join('\n')

  assert.deepEqual(parseVisitTodosFromSummary(md), [
    { content: '寄送产品资料', owner: '王五', dueText: '明天' },
  ])
})

test('returns empty array when the section says no todos were produced', () => {
  const md = [
    '## 七、待办事项与后续跟进',
    '',
    '本次拜访未产生待办事项',
  ].join('\n')

  assert.deepEqual(parseVisitTodosFromSummary(md), [])
})

test('returns empty array when there is no todo section at all', () => {
  const md = ['# 会议纪要', '', '## 一、会谈内容', '', '随便聊聊。'].join('\n')
  assert.deepEqual(parseVisitTodosFromSummary(md), [])
})

test('skips template placeholder rows and stops at the next section', () => {
  const md = [
    '## 七、待办事项与后续跟进',
    '',
    '| 序号 | 跟进事项 | 负责人 | 完成时限 |',
    '|------|---------|--------|----------|',
    '| 1 | {具体事项} | {待定} | {待定} |',
    '| 2 | 确认开户资料清单 | 客户经理 | 后天 |',
    '',
    '## 八、其他',
    '',
    '| 跟进事项 | 负责人 |',
    '| 不该被解析到 | 因为已到下一章节 |',
  ].join('\n')

  assert.deepEqual(parseVisitTodosFromSummary(md), [
    { content: '确认开户资料清单', owner: '客户经理', dueText: '后天' },
  ])
})

test('also parses the default template todo table (责任人 column)', () => {
  const md = [
    '## 三、后续待跟进事项',
    '',
    '| 序号 | 跟进事项 | 责任人 | 完成时限 |',
    '|------|---------|--------|----------|',
    '| 1 | 整理报价单 | 赵六 | 2026/8/1 |',
  ].join('\n')

  assert.deepEqual(parseVisitTodosFromSummary(md), [
    { content: '整理报价单', owner: '赵六', dueText: '2026/8/1' },
  ])
})

test('parseDueDate parses ISO and slash dates', () => {
  assert.equal(parseDueDate('2026-08-01', NOW), new Date(2026, 7, 1).getTime())
  assert.equal(parseDueDate('2026/8/1', NOW), new Date(2026, 7, 1).getTime())
  assert.equal(parseDueDate('2026.08.01', NOW), new Date(2026, 7, 1).getTime())
})

test('parseDueDate parses M月D日 with this year, rolling to next year when passed', () => {
  // 相对 2026-07-23：12月31日 在今年，7月1日 已过去年
  assert.equal(parseDueDate('12月31日', NOW), new Date(2026, 11, 31).getTime())
  assert.equal(parseDueDate('7月1日', NOW), new Date(2027, 6, 1).getTime())
  // 兼容「前/号」后缀
  assert.equal(parseDueDate('8月5日前', NOW), new Date(2026, 7, 5).getTime())
  assert.equal(parseDueDate('8月5号', NOW), new Date(2026, 7, 5).getTime())
})

test('parseDueDate parses relative days', () => {
  const today = new Date(2026, 6, 23).getTime()
  assert.equal(parseDueDate('今天', NOW), today)
  assert.equal(parseDueDate('明天上午', NOW), today + DAY)
  assert.equal(parseDueDate('后天', NOW), today + 2 * DAY)
  assert.equal(parseDueDate('大后天', NOW), today + 3 * DAY)
})

test('parseDueDate returns 0 for undecided or unparseable text', () => {
  for (const text of ['', '  ', '待定', '无', '暂无', '-', '--', '—', 'TBD', '尽快', '2026-13-40']) {
    assert.equal(parseDueDate(text, NOW), 0, `expected 0 for ${JSON.stringify(text)}`)
  }
})
