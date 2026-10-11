// Pure-logic unit tests (synthetic: no Claude Code session involved).
import { expect, test } from 'claude-code/testing'
import {
  addPair, freshContextBlocks, MAX_PAIRS, normaliseMode, normaliseTimeoutSeconds, originFor, parsePrompt,
  pickTarget, projectDirName, withholdAttachment, withholdSection,
} from '../hooks/core.js'

test('parsePrompt strips one pair of wrapping quotes and keeps inner text', async () => {
  expect(parsePrompt('"review the parser"')).toBe('review the parser')
  expect(parsePrompt("'single'")).toBe('single')
  expect(parsePrompt('  no quotes here  ')).toBe('no quotes here')
  expect(parsePrompt('"say "hi" twice"')).toBe('say "hi" twice')
  expect(parsePrompt('')).toBe('')
  expect(parsePrompt(undefined)).toBe('')
})

test('modes and timeouts fall back to safe defaults', async () => {
  expect(normaliseMode(undefined)).toBe('ask')
  expect(normaliseMode('yolo')).toBe('ask')
  expect(normaliseMode('toggle')).toBe('toggle')
  expect(normaliseMode('off')).toBe('off')
  expect(normaliseTimeoutSeconds(undefined)).toBe(60)
  expect(normaliseTimeoutSeconds(1)).toBe(5)
  expect(normaliseTimeoutSeconds(99999)).toBe(600)
})

test('projectDirName matches the verified transcript folder naming', async () => {
  expect(projectDirName('/tmp/claude-0/-home-claude/x/scratchpad/spike/repo'))
    .toBe('-tmp-claude-0--home-claude-x-scratchpad-spike-repo')
})

test('pickTarget never guesses', async () => {
  const pairs = {
    f1: { originId: 'o1', originRoot: '/r', createdAt: 1 },
    f2: { originId: 'o1', originRoot: '/r', createdAt: 2 },
  }
  expect(pickTarget(pairs, 'f1')).toEqual({ direction: 'return', targetId: 'o1', root: '/r' })
  expect(pickTarget(pairs, 'o1')).toEqual({ direction: 'enter', targetId: 'f2', root: '/r' })
  expect(pickTarget(pairs, 'unrelated')).toBe(null)
  expect(pickTarget(pairs, null)).toBe(null)
  expect(pickTarget({}, 'o1')).toBe(null)
})

test('a FreshEye opened from a FreshEye links to the true original', async () => {
  const pairs = { f1: { originId: 'o1', createdAt: 1 } }
  expect(originFor(pairs, 'f1')).toBe('o1')
  expect(originFor(pairs, 'o1')).toBe('o1')
})

test('pairs table is bounded and keeps the newest', async () => {
  let pairs = {}
  for (let i = 0; i < MAX_PAIRS + 5; i++) pairs = addPair(pairs, `f${i}`, { originId: 'o', createdAt: i })
  expect(Object.keys(pairs).length).toBe(MAX_PAIRS)
  expect(pairs[`f${MAX_PAIRS + 4}`]).toBeDefined()
  expect(pairs.f0).toBeUndefined()
})

test('withholding rules: hook context and memory/instruction attachments only', async () => {
  expect(withholdAttachment('hook_additional_context', { kind: 'hook', event: 'SessionStart' })).toBe(true)
  expect(withholdAttachment('hook_additional_context', { kind: 'hook', event: 'UserPromptSubmit' })).toBe(true)
  expect(withholdAttachment('hook_blocking_error', { kind: 'hook', event: 'PreToolUse' })).toBe(false) // safety note stays
  expect(withholdAttachment('instructions', { kind: 'engine' })).toBe(true)
  expect(withholdAttachment('nested_memory', { kind: 'engine' })).toBe(true)
  expect(withholdAttachment('todo_reminder', { kind: 'engine' })).toBe(false)
  expect(withholdAttachment('anything', { kind: 'plugin', event: 'prompt.submit' })).toBe(false)
  expect(withholdSection('memory')).toBe(true)
  expect(withholdSection('tools')).toBe(false)
  expect(freshContextBlocks([{ name: 'claudeMd', text: 'x' }, { name: 'currentDate', text: 'd' }]))
    .toEqual([{ name: 'currentDate', text: 'd' }])
})
