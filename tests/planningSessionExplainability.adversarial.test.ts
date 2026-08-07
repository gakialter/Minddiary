import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StudyTask } from '../src/types'
import type { IdempotentAIStudyTaskCreateRequest, IdempotentAIStudyTaskCreateResponse } from '../src/types/api'
import {
  executeIdempotentAIStudyTaskCreateRequest,
  type StudyTaskActionExecutionResult,
} from '../src/utils/agentStudyTaskActions'
import { mapStudyTaskActionExecutionResult } from '../src/utils/planningSessionExplainability'
import * as pendingStudyTaskOperations from '../src/utils/pendingStudyTaskOperations'

const OPERATION_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_OPERATION_ID = '22222222-2222-4222-8222-222222222222'

const RAW_SECRET_OPERATION_ID = 'RAW_SECRET_OPERATION_ID'
const RAW_SECRET_TASK_ID = 'RAW_SECRET_TASK_ID'
const RAW_SECRET_ERROR = 'RAW_SECRET_ERROR'
const RAW_SECRET_STACK = 'RAW_SECRET_STACK'
const RAW_SECRET_PATH = 'RAW_SECRET_PATH'
const RAW_SECRETS = [
  RAW_SECRET_OPERATION_ID,
  RAW_SECRET_TASK_ID,
  RAW_SECRET_ERROR,
  RAW_SECRET_STACK,
  RAW_SECRET_PATH,
] as const

const FIXED_UNCERTAIN_OUTCOME = {
  kind: 'uncertain',
  operationId: OPERATION_ID,
  message: '结果尚无法确认，需要用户手动检查',
} as const

const FIXED_NULL_OPERATION_UNCERTAIN_OUTCOME = {
  kind: 'uncertain',
  operationId: null,
  message: '结果尚无法确认，需要用户手动检查',
} as const

const TASK_KEYS = [
  'id',
  'title',
  'description',
  'type',
  'subject_id',
  'related_mistake_id',
  'related_entry_id',
  'related_chapter_id',
  'planned_date',
  'estimate_minutes',
  'status',
  'source',
  'created_at',
  'updated_at',
] as const satisfies readonly (keyof StudyTask)[]

const BASE_TASK: StudyTask = {
  id: 42,
  title: '复习函数极限',
  description: '今天到期，适合先处理。',
  type: 'review',
  subject_id: 1,
  related_mistake_id: 12,
  related_entry_id: null,
  related_chapter_id: null,
  planned_date: '2026-06-12',
  estimate_minutes: 25,
  status: 'todo',
  source: 'ai',
  created_at: '2026-06-12T00:00:00.000Z',
  updated_at: '2026-06-12T00:00:00.000Z',
}

type SucceededResult = Extract<StudyTaskActionExecutionResult, { status: 'succeeded' }>
type FailedResult = Extract<StudyTaskActionExecutionResult, { status: 'failed' }>
type UncertainResult = Extract<StudyTaskActionExecutionResult, { status: 'uncertain' }>
type UnknownFactory = () => unknown
type TaskMutationCase = readonly [name: string, key: keyof StudyTask, value: unknown]

function buildTask(overrides: Partial<StudyTask> = {}): StudyTask {
  return { ...BASE_TASK, ...overrides }
}

function buildSucceeded(overrides: Partial<SucceededResult> = {}): SucceededResult {
  return {
    operationId: OPERATION_ID,
    status: 'succeeded',
    task: buildTask(),
    replayed: false,
    ...overrides,
  }
}

function buildFailed(overrides: Partial<FailedResult> = {}): FailedResult {
  return {
    operationId: OPERATION_ID,
    status: 'failed',
    code: 'INTEGRITY_ERROR',
    error: 'bounded failure detail',
    ...overrides,
  }
}

function buildUncertain(overrides: Partial<UncertainResult> = {}): UncertainResult {
  return {
    operationId: OPERATION_ID,
    status: 'uncertain',
    error: 'bounded transport detail',
    ...overrides,
  }
}

function asRecord(value: object): Record<string, unknown> {
  return value as unknown as Record<string, unknown>
}

function omitOwnKey(value: object, key: string): Record<string, unknown> {
  const clone = { ...asRecord(value) }
  delete clone[key]
  return clone
}

function buildSucceededWithTask(task: unknown, replayed = false): Record<string, unknown> {
  return { ...buildSucceeded(), task, replayed }
}

function nonEnumerableDataClone(value: object): Record<string, unknown> {
  const clone: Record<string, unknown> = {}
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor === undefined || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) continue
    Object.defineProperty(clone, key, {
      configurable: true,
      enumerable: false,
      writable: true,
      value: descriptor.value,
    })
  }
  return clone
}

const SECRET_PAYLOAD = Object.freeze({
  operationId: RAW_SECRET_OPERATION_ID,
  taskId: RAW_SECRET_TASK_ID,
  error: RAW_SECRET_ERROR,
  stack: RAW_SECRET_STACK,
  path: RAW_SECRET_PATH,
})

type ExtraPropertyKind = 'string' | 'numeric' | 'nonenumerable' | 'symbol'

function addExtraProperty(value: object, kind: ExtraPropertyKind): object {
  const clone = { ...asRecord(value) } as Record<PropertyKey, unknown>
  if (kind === 'string') clone.rawSecret = SECRET_PAYLOAD
  if (kind === 'numeric') clone[0] = SECRET_PAYLOAD
  if (kind === 'nonenumerable') {
    Object.defineProperty(clone, 'rawSecret', {
      configurable: true,
      enumerable: false,
      value: SECRET_PAYLOAD,
      writable: true,
    })
  }
  if (kind === 'symbol') {
    Object.defineProperty(clone, Symbol(RAW_SECRET_PATH), {
      configurable: true,
      enumerable: false,
      value: SECRET_PAYLOAD,
      writable: true,
    })
  }
  return clone
}

function createAccessorProbe(
  value: object,
  key: string,
  kind: 'getter' | 'setter-only',
): { input: object; calls: () => number } {
  const input = { ...asRecord(value) }
  let calls = 0
  Object.defineProperty(input, key, {
    configurable: true,
    enumerable: true,
    ...(kind === 'getter'
      ? {
          get: () => {
            calls += 1
            throw new Error(`${RAW_SECRET_ERROR}:${RAW_SECRET_STACK}:${RAW_SECRET_PATH}`)
          },
        }
      : {
          set: (_next: unknown) => {
            calls += 1
          },
        }),
  })
  return { input, calls: () => calls }
}

function assertNoRawSecrets(value: unknown): void {
  const serialized = JSON.stringify(value)
  expect(serialized).toBeTypeOf('string')
  for (const secret of RAW_SECRETS) expect(serialized).not.toContain(secret)
}

function mapAndAssertSafe(result: unknown, expectedOperationId: string = OPERATION_ID) {
  const mutationAttempts: string[] = []
  const probedResult = result !== null && (typeof result === 'object' || typeof result === 'function')
    ? new Proxy(result as object, {
        defineProperty: () => {
          mutationAttempts.push('defineProperty')
          throw new Error(RAW_SECRET_STACK)
        },
        deleteProperty: () => {
          mutationAttempts.push('deleteProperty')
          throw new Error(RAW_SECRET_STACK)
        },
        preventExtensions: () => {
          mutationAttempts.push('preventExtensions')
          throw new Error(RAW_SECRET_STACK)
        },
        set: () => {
          mutationAttempts.push('set')
          throw new Error(RAW_SECRET_STACK)
        },
        setPrototypeOf: () => {
          mutationAttempts.push('setPrototypeOf')
          throw new Error(RAW_SECRET_STACK)
        },
      })
    : result
  const outcome = mapStudyTaskActionExecutionResult(probedResult, expectedOperationId)
  expect(mutationAttempts).toEqual([])
  for (const value of Object.values(outcome)) {
    expect(value === null || !['object', 'function', 'symbol'].includes(typeof value)).toBe(true)
    expect(value === result).toBe(false)
  }
  assertNoRawSecrets(outcome)
  expect(JSON.stringify(outcome).length).toBeLessThan(300)
  return outcome
}

function expectFixedUncertain(result: unknown): void {
  const outcome = mapAndAssertSafe(result)
  expect(outcome).toStrictEqual(FIXED_UNCERTAIN_OUTCOME)
  expect(Reflect.ownKeys(outcome)).toStrictEqual(['kind', 'operationId', 'message'])
}

beforeEach(() => {
  vi.spyOn(console, 'debug').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  vi.spyOn(console, 'trace').mockImplementation(() => undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  vi.spyOn(pendingStudyTaskOperations, 'savePendingStudyTaskOperation')
  vi.spyOn(pendingStudyTaskOperations, 'removePendingStudyTaskOperation')
})

afterEach(() => {
  try {
    expect(console.debug).not.toHaveBeenCalled()
    expect(console.error).not.toHaveBeenCalled()
    expect(console.info).not.toHaveBeenCalled()
    expect(console.log).not.toHaveBeenCalled()
    expect(console.trace).not.toHaveBeenCalled()
    expect(console.warn).not.toHaveBeenCalled()
    expect(pendingStudyTaskOperations.savePendingStudyTaskOperation).not.toHaveBeenCalled()
    expect(pendingStudyTaskOperations.removePendingStudyTaskOperation).not.toHaveBeenCalled()
  } finally {
    vi.restoreAllMocks()
  }
})

const RESULT_VARIANTS = [
  {
    name: 'succeeded',
    keys: ['operationId', 'status', 'task', 'replayed'] as const,
    build: () => buildSucceeded(),
  },
  {
    name: 'failed',
    keys: ['operationId', 'status', 'code', 'error'] as const,
    build: () => buildFailed(),
  },
  {
    name: 'uncertain',
    keys: ['operationId', 'status', 'error'] as const,
    build: () => buildUncertain(),
  },
] as const

const TOP_LEVEL_PRIMITIVE_CASES: ReadonlyArray<readonly [string, unknown]> = [
  ['null', null],
  ['undefined', undefined],
  ['false', false],
  ['true', true],
  ['zero', 0],
  ['one', 1],
  ['NaN', Number.NaN],
  ['Infinity', Number.POSITIVE_INFINITY],
  ['bigint', 1n],
  ['empty string', ''],
  ['string', `${RAW_SECRET_ERROR}:${RAW_SECRET_STACK}`],
  ['symbol', Symbol(RAW_SECRET_PATH)],
  ['function', () => SECRET_PAYLOAD],
]

const TOP_LEVEL_NONPLAIN_CASES: ReadonlyArray<readonly [string, UnknownFactory]> = [
  ['array', () => Object.assign([], buildSucceeded())],
  ['null-prototype object', () => Object.assign(Object.create(null) as object, buildSucceeded())],
  ['custom-prototype object', () => Object.assign(Object.create({ marker: true }) as object, buildSucceeded())],
  ['class instance', () => Object.assign(new (class Result {})(), buildSucceeded())],
  ['Date instance', () => Object.assign(new Date(0), buildSucceeded())],
  ['Map instance', () => Object.assign(new Map(), buildSucceeded())],
  ['Set instance', () => Object.assign(new Set(), buildSucceeded())],
  ['boxed string', () => Object.assign(new String('result'), buildSucceeded())],
]

const TOP_LEVEL_MISSING_CASES: ReadonlyArray<readonly [string, UnknownFactory]> = RESULT_VARIANTS.flatMap(
  variant => variant.keys.map(key => [
    `${variant.name} missing ${key}`,
    () => omitOwnKey(variant.build(), key),
  ] as const),
)

const EXTRA_PROPERTY_KINDS = ['string', 'numeric', 'nonenumerable', 'symbol'] as const
const TOP_LEVEL_EXTRA_CASES: ReadonlyArray<readonly [string, UnknownFactory]> = RESULT_VARIANTS.flatMap(
  variant => EXTRA_PROPERTY_KINDS.map(kind => [
    `${variant.name} extra ${kind} key`,
    () => addExtraProperty(variant.build(), kind),
  ] as const),
)

const TOP_LEVEL_ACCESSOR_CASES: ReadonlyArray<readonly [string, () => ReturnType<typeof createAccessorProbe>]> =
  RESULT_VARIANTS.flatMap(variant => variant.keys.flatMap(key => ([
    [
      `${variant.name} getter ${key}`,
      () => createAccessorProbe(variant.build(), key, 'getter'),
    ] as const,
    [
      `${variant.name} setter-only ${key}`,
      () => createAccessorProbe(variant.build(), key, 'setter-only'),
    ] as const,
  ])))

const TASK_MISSING_CASES: ReadonlyArray<readonly [string, UnknownFactory]> = TASK_KEYS.map(key => [
  `task missing ${key}`,
  () => buildSucceededWithTask(omitOwnKey(buildTask(), key)),
] as const)

const TASK_EXTRA_CASES: ReadonlyArray<readonly [string, UnknownFactory]> = EXTRA_PROPERTY_KINDS.map(kind => [
  `task extra ${kind} key`,
  () => buildSucceededWithTask(addExtraProperty(buildTask(), kind)),
] as const)

const TASK_ACCESSOR_CASES: ReadonlyArray<readonly [string, () => ReturnType<typeof createAccessorProbe>]> =
  TASK_KEYS.flatMap(key => ([
    [
      `task getter ${key}`,
      () => {
        const probe = createAccessorProbe(buildTask(), key, 'getter')
        return { input: buildSucceededWithTask(probe.input), calls: probe.calls }
      },
    ] as const,
    [
      `task setter-only ${key}`,
      () => {
        const probe = createAccessorProbe(buildTask(), key, 'setter-only')
        return { input: buildSucceededWithTask(probe.input), calls: probe.calls }
      },
    ] as const,
  ]))

const NULLABLE_RELATION_FIELDS = [
  'subject_id',
  'related_mistake_id',
  'related_entry_id',
  'related_chapter_id',
] as const satisfies readonly (keyof StudyTask)[]

const NULLABLE_RELATION_MUTATIONS: ReadonlyArray<TaskMutationCase> = NULLABLE_RELATION_FIELDS.flatMap(
  (field): TaskMutationCase[] => [
    [`${field} undefined`, field, undefined],
    [`${field} zero`, field, 0],
    [`${field} negative`, field, -1],
    [`${field} fractional`, field, 1.5],
    [`${field} unsafe integer`, field, Number.MAX_SAFE_INTEGER + 1],
    [`${field} string`, field, RAW_SECRET_PATH],
  ],
)

const TASK_DOMAIN_MUTATIONS: ReadonlyArray<TaskMutationCase> = [
  ['id zero', 'id', 0],
  ['id negative', 'id', -1],
  ['id fractional', 'id', 1.5],
  ['id NaN', 'id', Number.NaN],
  ['id Infinity', 'id', Number.POSITIVE_INFINITY],
  ['id unsafe integer', 'id', Number.MAX_SAFE_INTEGER + 1],
  ['id string', 'id', RAW_SECRET_TASK_ID],
  ['id null', 'id', null],
  ['empty title', 'title', ''],
  ['non-string title', 'title', 42],
  ['null description', 'description', null],
  ['object description', 'description', SECRET_PAYLOAD],
  ['unknown type', 'type', 'unknown'],
  ['uppercase type', 'type', 'REVIEW'],
  ['null type', 'type', null],
  ...NULLABLE_RELATION_MUTATIONS,
  ['empty planned date', 'planned_date', ''],
  ['impossible planned date', 'planned_date', '2026-02-30'],
  ['unbounded planned date format', 'planned_date', '2026-2-2'],
  ['timestamp planned date', 'planned_date', '2026-06-12T00:00:00.000Z'],
  ['non-string planned date', 'planned_date', 20260612],
  ['zero estimate', 'estimate_minutes', 0],
  ['negative estimate', 'estimate_minutes', -5],
  ['fractional estimate', 'estimate_minutes', 5.5],
  ['NaN estimate', 'estimate_minutes', Number.NaN],
  ['Infinity estimate', 'estimate_minutes', Number.POSITIVE_INFINITY],
  ['unsafe estimate', 'estimate_minutes', Number.MAX_SAFE_INTEGER + 1],
  ['string estimate', 'estimate_minutes', '25'],
  ['unknown status', 'status', 'complete'],
  ['non-string status', 'status', 0],
  ['unknown source', 'source', 'provider'],
  ['non-string source', 'source', null],
  ['empty created_at', 'created_at', ''],
  ['non-string created_at', 'created_at', 0],
  ['empty updated_at', 'updated_at', ''],
  ['non-string updated_at', 'updated_at', SECRET_PAYLOAD],
]

const TASK_NONPLAIN_AND_PRIMITIVE_CASES: ReadonlyArray<readonly [string, UnknownFactory]> = [
  ['null task', () => buildSucceededWithTask(null)],
  ['undefined task', () => buildSucceededWithTask(undefined)],
  ['string task', () => buildSucceededWithTask(RAW_SECRET_TASK_ID)],
  ['number task', () => buildSucceededWithTask(42)],
  ['array task', () => buildSucceededWithTask(Object.assign([], buildTask()))],
  ['null-prototype task', () => buildSucceededWithTask(Object.assign(Object.create(null) as object, buildTask()))],
  ['custom-prototype task', () => buildSucceededWithTask(Object.assign(Object.create({ marker: true }) as object, buildTask()))],
  ['class-instance task', () => buildSucceededWithTask(Object.assign(new (class Task {})(), buildTask()))],
  ['Date task', () => buildSucceededWithTask(Object.assign(new Date(0), buildTask()))],
]

const RESULT_DOMAIN_MUTATIONS: ReadonlyArray<readonly [string, UnknownFactory]> = [
  ['succeeded replayed string', () => ({ ...buildSucceeded(), replayed: 'false' })],
  ['succeeded replayed number', () => ({ ...buildSucceeded(), replayed: 0 })],
  ['succeeded replayed null', () => ({ ...buildSucceeded(), replayed: null })],
  ['failed unknown code', () => ({ ...buildFailed(), code: 'UNKNOWN_CODE' })],
  ['failed numeric code', () => ({ ...buildFailed(), code: 1 })],
  ['failed null code', () => ({ ...buildFailed(), code: null })],
  ['failed empty error', () => ({ ...buildFailed(), error: '' })],
  ['failed oversized error', () => ({ ...buildFailed(), error: `${RAW_SECRET_ERROR}${'x'.repeat(501)}` })],
  ['failed object error', () => ({ ...buildFailed(), error: SECRET_PAYLOAD })],
  ['failed null error', () => ({ ...buildFailed(), error: null })],
  ['failed numeric error', () => ({ ...buildFailed(), error: 404 })],
  ['failed extra task', () => ({ ...buildFailed(), task: buildTask() })],
  ['failed extra replayed', () => ({ ...buildFailed(), replayed: false })],
  ['uncertain empty error', () => ({ ...buildUncertain(), error: '' })],
  ['uncertain oversized error', () => ({ ...buildUncertain(), error: `${RAW_SECRET_ERROR}${'x'.repeat(501)}` })],
  ['uncertain object error', () => ({ ...buildUncertain(), error: SECRET_PAYLOAD })],
  ['uncertain null error', () => ({ ...buildUncertain(), error: null })],
  ['uncertain numeric error', () => ({ ...buildUncertain(), error: 500 })],
  ['uncertain extra code', () => ({ ...buildUncertain(), code: 'INTEGRITY_ERROR' })],
  ['uncertain extra task', () => ({ ...buildUncertain(), task: buildTask() })],
  ['uncertain extra replayed', () => ({ ...buildUncertain(), replayed: false })],
  ['unknown string status', () => ({ ...buildUncertain(), status: 'completed' })],
  ['null status', () => ({ ...buildFailed(), status: null })],
  ['object status', () => ({ ...buildSucceeded(), status: SECRET_PAYLOAD })],
  ['non-string operation ID', () => ({ ...buildFailed(), operationId: 42 })],
  ['secret operation ID', () => ({ ...buildUncertain(), operationId: RAW_SECRET_OPERATION_ID })],
]

const FAILURE_OUTCOME_CASES = [
  ['IDEMPOTENCY_CONFLICT', 'conflict', '该操作 ID 已对应另一份确认内容，本次未新建任务'],
  ['RESULT_DELETED', 'deleted', '原操作曾成功关联任务，但该任务后来已删除；本次检查没有新建任务。'],
  ['INTEGRITY_ERROR', 'integrity_error', '完整性检查未通过，本次操作已安全终止'],
  ['DATE_MISMATCH', 'date_mismatch', '确认日期已失效，本次未创建任务'],
  ['INVALID_REQUEST', 'validation_error', '确认内容未通过校验，本次未创建任务'],
] as const satisfies ReadonlyArray<readonly [FailedResult['code'], string, string]>

function throwingProxyTrap(message: string): never {
  throw new Error(message)
}

const PROXY_FAILURE_CASES: ReadonlyArray<readonly [string, UnknownFactory]> = [
  ['top-level getPrototypeOf trap throws', () => new Proxy(buildSucceeded(), {
    getPrototypeOf: () => throwingProxyTrap(`${RAW_SECRET_STACK}:${RAW_SECRET_PATH}`),
  })],
  ['top-level ownKeys trap throws', () => new Proxy(buildSucceeded(), {
    ownKeys: () => throwingProxyTrap(`${RAW_SECRET_ERROR}:${RAW_SECRET_STACK}`),
  })],
  ['top-level descriptor trap throws', () => new Proxy(buildSucceeded(), {
    getOwnPropertyDescriptor: () => throwingProxyTrap(`${RAW_SECRET_ERROR}:${RAW_SECRET_PATH}`),
  })],
  ['top-level duplicate own keys', () => new Proxy({}, {
    ownKeys: () => ['operationId', 'operationId'],
  })],
  ['top-level nonextensible target with inconsistent keys', () => {
    const target = Object.preventExtensions(buildSucceeded())
    return new Proxy(target, { ownKeys: () => ['operationId', 'status', 'task'] })
  }],
  ['revoked top-level proxy', () => {
    const revocable = Proxy.revocable(buildSucceeded(), {})
    revocable.revoke()
    return revocable.proxy
  }],
  ['task getPrototypeOf trap throws', () => buildSucceededWithTask(new Proxy(buildTask(), {
    getPrototypeOf: () => throwingProxyTrap(`${RAW_SECRET_STACK}:${RAW_SECRET_PATH}`),
  }))],
  ['task ownKeys trap throws', () => buildSucceededWithTask(new Proxy(buildTask(), {
    ownKeys: () => throwingProxyTrap(`${RAW_SECRET_ERROR}:${RAW_SECRET_STACK}`),
  }))],
  ['task descriptor trap throws', () => buildSucceededWithTask(new Proxy(buildTask(), {
    getOwnPropertyDescriptor: () => throwingProxyTrap(`${RAW_SECRET_ERROR}:${RAW_SECRET_PATH}`),
  }))],
  ['task nonextensible target with inconsistent keys', () => {
    const target = Object.preventExtensions(buildTask())
    const proxy = new Proxy(target, { ownKeys: () => TASK_KEYS.slice(0, -1) })
    return buildSucceededWithTask(proxy)
  }],
  ['revoked task proxy', () => {
    const revocable = Proxy.revocable(buildTask(), {})
    revocable.revoke()
    return buildSucceededWithTask(revocable.proxy)
  }],
]

function createShapeShiftingDataProxy<T extends object>(
  target: T,
  laterValues: Readonly<Record<string, unknown>>,
) {
  const descriptorCalls = new Map<PropertyKey, number>()
  let directGetCalls = 0
  const proxy = new Proxy(target, {
    get: () => {
      directGetCalls += 1
      throw new Error(`${RAW_SECRET_ERROR}:${RAW_SECRET_STACK}:${RAW_SECRET_PATH}`)
    },
    getOwnPropertyDescriptor: (current, key) => {
      const nextCall = (descriptorCalls.get(key) ?? 0) + 1
      descriptorCalls.set(key, nextCall)
      const descriptor = Reflect.getOwnPropertyDescriptor(current, key)
      if (
        descriptor !== undefined
        && Object.prototype.hasOwnProperty.call(descriptor, 'value')
        && nextCall > 1
        && typeof key === 'string'
        && Object.prototype.hasOwnProperty.call(laterValues, key)
      ) {
        return { ...descriptor, value: laterValues[key] }
      }
      return descriptor
    },
  })
  return {
    proxy,
    callsFor: (key: PropertyKey) => descriptorCalls.get(key) ?? 0,
    directGetCalls: () => directGetCalls,
  }
}

function createValidationThenMalformedResponse(operationId: string) {
  const validTask = buildTask()
  const malformedTask = { ...buildTask(), id: RAW_SECRET_TASK_ID }
  const target = {
    ok: true,
    operationId,
    task: validTask,
    replayed: false,
  }
  let taskReads = 0
  const response = new Proxy(target, {
    get: (current, key, receiver) => {
      if (key === 'task') {
        taskReads += 1
        return taskReads === 1 ? validTask : malformedTask
      }
      return Reflect.get(current, key, receiver)
    },
  })
  return { response, target, validTask, malformedTask, taskReads: () => taskReads }
}

describe('mapStudyTaskActionExecutionResult adversarial descriptor snapshots', () => {
  describe('real execution-result unions and valid data-property representations', () => {
    it('uses a complete exact 14-key StudyTask fixture', () => {
      expect(Reflect.ownKeys(buildTask())).toStrictEqual(TASK_KEYS)
      expect(TASK_KEYS).toHaveLength(14)
    })

    it.each([
      ['ordinary succeeded', () => buildSucceeded(), {
        kind: 'created', operationId: OPERATION_ID, message: '已创建任务', taskId: 42,
      }],
      ['ordinary failed', () => buildFailed(), {
        kind: 'integrity_error', operationId: OPERATION_ID, message: '完整性检查未通过，本次操作已安全终止',
      }],
      ['ordinary uncertain', () => buildUncertain(), FIXED_UNCERTAIN_OUTCOME],
      ['frozen succeeded and task', () => Object.freeze({
        ...buildSucceeded(),
        task: Object.freeze(buildTask()),
      }), {
        kind: 'created', operationId: OPERATION_ID, message: '已创建任务', taskId: 42,
      }],
      ['sealed replay and task', () => Object.seal({
        ...buildSucceeded(),
        task: Object.seal(buildTask()),
        replayed: true,
      }), {
        kind: 'replayed', operationId: OPERATION_ID, message: '原操作此前已完成，本次未重复创建', taskId: 42,
      }],
      ['nonenumerable succeeded and task data keys', () => nonEnumerableDataClone({
        ...buildSucceeded(),
        task: nonEnumerableDataClone(buildTask()),
      }), {
        kind: 'created', operationId: OPERATION_ID, message: '已创建任务', taskId: 42,
      }],
      ['nonenumerable failed data keys', () => nonEnumerableDataClone(buildFailed()), {
        kind: 'integrity_error', operationId: OPERATION_ID, message: '完整性检查未通过，本次操作已安全终止',
      }],
      ['nonenumerable uncertain data keys', () => nonEnumerableDataClone(buildUncertain()), FIXED_UNCERTAIN_OUTCOME],
    ] as const)('accepts %s', (_name, createInput, expected) => {
      expect(mapAndAssertSafe(createInput())).toStrictEqual(expected)
    })

    it('keeps replay compatibility for a previously persisted 240-minute task', () => {
      const outcome = mapAndAssertSafe(buildSucceeded({
        replayed: true,
        task: buildTask({ estimate_minutes: 240 }),
      }))

      expect(outcome).toStrictEqual({
        kind: 'replayed',
        operationId: OPERATION_ID,
        message: '原操作此前已完成，本次未重复创建',
        taskId: 42,
      })
    })

    it.each([
      ['all nullable relations null', {
        subject_id: null,
        related_mistake_id: null,
        related_entry_id: null,
        related_chapter_id: null,
      }],
      ['all nullable relations positive', {
        subject_id: 1,
        related_mistake_id: 2,
        related_entry_id: 3,
        related_chapter_id: 4,
      }],
      ['empty description remains valid', { description: '' }],
    ] as const)('accepts %s', (_name, taskOverrides) => {
      expect(mapAndAssertSafe(buildSucceeded({ task: buildTask(taskOverrides) }))).toStrictEqual({
        kind: 'created',
        operationId: OPERATION_ID,
        message: '已创建任务',
        taskId: 42,
      })
    })

    it('never exposes valid but irrelevant task strings', () => {
      const task = buildTask({
        title: RAW_SECRET_PATH,
        description: `${RAW_SECRET_ERROR}:${RAW_SECRET_STACK}`,
        created_at: RAW_SECRET_OPERATION_ID,
        updated_at: RAW_SECRET_TASK_ID,
      })

      expect(mapAndAssertSafe(buildSucceeded({ task }))).toStrictEqual({
        kind: 'created',
        operationId: OPERATION_ID,
        message: '已创建任务',
        taskId: 42,
      })
    })

    it.each(FAILURE_OUTCOME_CASES)('maps valid failed code %s without leaking error detail', (code, kind, message) => {
      const error = RAW_SECRETS.join(':')
      expect(mapAndAssertSafe(buildFailed({ code, error }))).toStrictEqual({ kind, operationId: OPERATION_ID, message })
    })

    it.each([
      ['one-character failed error', 'x'],
      ['500-character failed error', 'x'.repeat(500)],
    ] as const)('accepts %s', (_name, error) => {
      expect(mapAndAssertSafe(buildFailed({ error }))).toStrictEqual({
        kind: 'integrity_error',
        operationId: OPERATION_ID,
        message: '完整性检查未通过，本次操作已安全终止',
      })
    })

    it.each([
      ['one-character uncertain error', 'x'],
      ['500-character uncertain error', 'x'.repeat(500)],
      ['secret uncertain error', RAW_SECRETS.join(':')],
    ] as const)('bounds %s to the exact fixed outcome', (_name, error) => {
      expect(mapAndAssertSafe(buildUncertain({ error }))).toStrictEqual(FIXED_UNCERTAIN_OUTCOME)
    })
  })

  describe('top-level fail-closed shape and value matrix', () => {
    it.each(TOP_LEVEL_PRIMITIVE_CASES)('fails closed for primitive/top-level %s', (_name, input) => {
      expectFixedUncertain(input)
    })

    it.each(TOP_LEVEL_NONPLAIN_CASES)('rejects nonplain top-level %s', (_name, createInput) => {
      expectFixedUncertain(createInput())
    })

    it.each(TOP_LEVEL_MISSING_CASES)('rejects exact-key mutation: %s', (_name, createInput) => {
      expectFixedUncertain(createInput())
    })

    it.each(TOP_LEVEL_EXTRA_CASES)('rejects exact-key mutation: %s', (_name, createInput) => {
      expectFixedUncertain(createInput())
    })

    it.each(TOP_LEVEL_ACCESSOR_CASES)('rejects %s without invoking it', (_name, createProbe) => {
      const probe = createProbe()
      expectFixedUncertain(probe.input)
      expect(probe.calls()).toBe(0)
    })

    it('rejects a getter that would throw on its second access without invoking it', () => {
      const input = buildFailed()
      let calls = 0
      Object.defineProperty(input, 'error', {
        configurable: true,
        enumerable: true,
        get: () => {
          calls += 1
          if (calls > 1) throw new Error(`${RAW_SECRET_ERROR}:${RAW_SECRET_STACK}`)
          return 'safe first value'
        },
      })

      expectFixedUncertain(input)
      expect(calls).toBe(0)
    })

    it.each([
      ['getter returns expected operation ID once then attacker ID', 'operationId', [OPERATION_ID, RAW_SECRET_OPERATION_ID]],
      ['getter returns invalid status once then valid status', 'status', ['completed', 'failed']],
      ['getter returns a valid task once then raw secret', 'task', [buildTask(), SECRET_PAYLOAD]],
      ['getter returns a boolean once then raw secret', 'replayed', [false, RAW_SECRET_ERROR]],
      ['getter returns a known code once then unknown code', 'code', ['INTEGRITY_ERROR', RAW_SECRET_PATH]],
      ['getter returns a safe error once then raw secret', 'error', ['safe', RAW_SECRET_ERROR]],
    ] as const)('rejects shape-shifting accessor: %s without invoking it', (_name, key, values) => {
      const base = key === 'code' ? buildFailed() : key === 'error' ? buildUncertain() : buildSucceeded()
      let calls = 0
      Object.defineProperty(base, key, {
        configurable: true,
        enumerable: true,
        get: () => values[Math.min(calls++, values.length - 1)],
      })

      expectFixedUncertain(base)
      expect(calls).toBe(0)
    })

    it.each(RESULT_DOMAIN_MUTATIONS)('rejects result mutation: %s', (_name, createInput) => {
      expectFixedUncertain(createInput())
    })

    it('uses the trusted expected operation ID for an operation mismatch and never inspects the task', () => {
      let nestedInspectionCalls = 0
      const hostileTask = new Proxy(buildTask(), {
        getPrototypeOf: () => {
          nestedInspectionCalls += 1
          return throwingProxyTrap(`${RAW_SECRET_STACK}:${RAW_SECRET_PATH}`)
        },
      })
      const input = {
        ...buildSucceeded({ operationId: OTHER_OPERATION_ID }),
        task: hostileTask,
      }

      expectFixedUncertain(input)
      expect(nestedInspectionCalls).toBe(0)
    })

    it.each([
      ['empty', ''],
      ['uppercase UUID', 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'],
      ['wrong UUID version', '11111111-1111-5111-8111-111111111111'],
      ['secret string', RAW_SECRET_OPERATION_ID],
      ['null', null],
      ['number', 42],
    ] as const)('returns a fixed null-operation outcome for invalid expected ID: %s', (_name, invalidExpected) => {
      let inspectionCalls = 0
      const hostileInput = new Proxy({}, {
        getPrototypeOf: () => {
          inspectionCalls += 1
          return throwingProxyTrap(`${RAW_SECRET_ERROR}:${RAW_SECRET_STACK}:${RAW_SECRET_PATH}`)
        },
      })

      const outcome = mapAndAssertSafe(hostileInput, invalidExpected as string)
      expect(outcome).toStrictEqual(FIXED_NULL_OPERATION_UNCERTAIN_OUTCOME)
      expect(Reflect.ownKeys(outcome)).toStrictEqual(['kind', 'operationId', 'message'])
      expect(inspectionCalls).toBe(0)
    })
  })

  describe('succeeded nested StudyTask fail-closed matrix', () => {
    it.each(TASK_MISSING_CASES)('rejects %s', (_name, createInput) => {
      expectFixedUncertain(createInput())
    })

    it.each(TASK_EXTRA_CASES)('rejects %s', (_name, createInput) => {
      expectFixedUncertain(createInput())
    })

    it.each(TASK_ACCESSOR_CASES)('rejects %s without invoking it', (_name, createProbe) => {
      const probe = createProbe()
      expectFixedUncertain(probe.input)
      expect(probe.calls()).toBe(0)
    })

    it.each(TASK_NONPLAIN_AND_PRIMITIVE_CASES)('rejects %s', (_name, createInput) => {
      expectFixedUncertain(createInput())
    })

    it.each(TASK_DOMAIN_MUTATIONS)('rejects task domain mutation: %s', (_name, key, value) => {
      const task = { ...buildTask(), [key]: value }
      expectFixedUncertain(buildSucceededWithTask(task))
    })
  })

  describe('Proxy traps and one-sample descriptor behavior', () => {
    it.each(PROXY_FAILURE_CASES)('fails closed for %s', (_name, createInput) => {
      expectFixedUncertain(createInput())
    })

    it('rejects a Proxy-reported symbol key without reading business fields', () => {
      const symbol = Symbol(RAW_SECRET_PATH)
      const target = buildSucceeded() as SucceededResult & { [symbol]?: unknown }
      Object.defineProperty(target, symbol, {
        configurable: true,
        enumerable: false,
        value: SECRET_PAYLOAD,
      })
      let directGetCalls = 0
      const proxy = new Proxy(target, {
        get: () => {
          directGetCalls += 1
          return SECRET_PAYLOAD
        },
      })

      expectFixedUncertain(proxy)
      expect(directGetCalls).toBe(0)
    })

    it('samples a shape-shifting ownKeys trap once', () => {
      let ownKeysCalls = 0
      const target = buildFailed()
      const proxy = new Proxy(target, {
        ownKeys: current => {
          ownKeysCalls += 1
          return ownKeysCalls === 1
            ? Reflect.ownKeys(current)
            : [...Reflect.ownKeys(current), 'rawSecret']
        },
      })

      expect(mapAndAssertSafe(proxy)).toStrictEqual({
        kind: 'integrity_error',
        operationId: OPERATION_ID,
        message: '完整性检查未通过，本次操作已安全终止',
      })
      expect(ownKeysCalls).toBe(1)
    })

    it('uses the first data descriptor and never observes a later accessor descriptor', () => {
      const target = buildFailed()
      let errorDescriptorCalls = 0
      const proxy = new Proxy(target, {
        getOwnPropertyDescriptor: (current, key) => {
          const descriptor = Reflect.getOwnPropertyDescriptor(current, key)
          if (key !== 'error' || descriptor === undefined) return descriptor
          errorDescriptorCalls += 1
          return errorDescriptorCalls === 1
            ? descriptor
            : {
                configurable: true,
                enumerable: true,
                get: () => RAW_SECRET_ERROR,
              }
        },
      })

      expect(mapAndAssertSafe(proxy)).toStrictEqual({
        kind: 'integrity_error',
        operationId: OPERATION_ID,
        message: '完整性检查未通过，本次操作已安全终止',
      })
      expect(errorDescriptorCalls).toBe(1)
    })

    it('uses the first data descriptor and never reaches a second descriptor trap that throws', () => {
      const target = buildFailed()
      let descriptorCalls = 0
      const proxy = new Proxy(target, {
        getOwnPropertyDescriptor: (current, key) => {
          if (key === 'error') {
            descriptorCalls += 1
            if (descriptorCalls > 1) throw new Error(`${RAW_SECRET_ERROR}:${RAW_SECRET_STACK}`)
          }
          return Reflect.getOwnPropertyDescriptor(current, key)
        },
      })

      expect(mapAndAssertSafe(proxy)).toStrictEqual({
        kind: 'integrity_error',
        operationId: OPERATION_ID,
        message: '完整性检查未通过，本次操作已安全终止',
      })
      expect(descriptorCalls).toBe(1)
    })

    it('accepts safe first-sample succeeded Proxy descriptors exactly once with controlled output', () => {
      const taskProbe = createShapeShiftingDataProxy(buildTask(), {
        id: RAW_SECRET_TASK_ID,
        title: RAW_SECRET_PATH,
        description: RAW_SECRET_STACK,
        related_entry_id: RAW_SECRET_ERROR,
      })
      const resultProbe = createShapeShiftingDataProxy(buildSucceeded({ task: taskProbe.proxy }), {
        operationId: RAW_SECRET_OPERATION_ID,
        task: SECRET_PAYLOAD,
        replayed: RAW_SECRET_ERROR,
      })

      expect(mapAndAssertSafe(resultProbe.proxy)).toStrictEqual({
        kind: 'created',
        operationId: OPERATION_ID,
        message: '已创建任务',
        taskId: 42,
      })
      for (const key of ['operationId', 'status', 'task', 'replayed']) {
        expect(resultProbe.callsFor(key)).toBe(1)
      }
      for (const key of TASK_KEYS) expect(taskProbe.callsFor(key)).toBe(1)
      expect(resultProbe.directGetCalls()).toBe(0)
      expect(taskProbe.directGetCalls()).toBe(0)
    })

    it('accepts safe first-sample failed Proxy descriptors once and never rereads later secrets', () => {
      const resultProbe = createShapeShiftingDataProxy(buildFailed(), {
        operationId: RAW_SECRET_OPERATION_ID,
        status: RAW_SECRET_STACK,
        code: RAW_SECRET_PATH,
        error: RAW_SECRET_ERROR,
      })

      expect(mapAndAssertSafe(resultProbe.proxy)).toStrictEqual({
        kind: 'integrity_error',
        operationId: OPERATION_ID,
        message: '完整性检查未通过，本次操作已安全终止',
      })
      for (const key of ['operationId', 'status', 'code', 'error']) {
        expect(resultProbe.callsFor(key)).toBe(1)
      }
      expect(resultProbe.directGetCalls()).toBe(0)
    })
  })

  it('fails closed after the real executor validates one task and later constructs a malformed result', async () => {
    const fixture = createValidationThenMalformedResponse(OPERATION_ID)
    const descriptorsBefore = {
      target: Object.getOwnPropertyDescriptors(fixture.target),
      validTask: Object.getOwnPropertyDescriptors(fixture.validTask),
      malformedTask: Object.getOwnPropertyDescriptors(fixture.malformedTask),
    }
    const request: IdempotentAIStudyTaskCreateRequest = {
      operationId: OPERATION_ID,
      operationKind: 'today_action',
      actionContractVersion: 'confirmed-study-task-action.v1',
      expectedCurrentDate: '2026-06-12',
      payload: {
        title: BASE_TASK.title,
        description: BASE_TASK.description,
        type: BASE_TASK.type,
        subject_id: BASE_TASK.subject_id,
        related_mistake_id: BASE_TASK.related_mistake_id,
        related_entry_id: BASE_TASK.related_entry_id,
        related_chapter_id: BASE_TASK.related_chapter_id,
        planned_date: BASE_TASK.planned_date,
        estimate_minutes: BASE_TASK.estimate_minutes,
        status: 'todo',
        source: 'ai',
      },
    }
    const route = vi.fn(async () => fixture.response as unknown as IdempotentAIStudyTaskCreateResponse)

    const result = await executeIdempotentAIStudyTaskCreateRequest(request, {
      createIdempotentAIStudyTaskForCurrentDate: route,
    })

    expect(result).toMatchObject({ status: 'succeeded', operationId: OPERATION_ID })
    expect(fixture.taskReads()).toBe(2)
    expect(route).toHaveBeenCalledTimes(1)
    expectFixedUncertain(result)
    expect(Object.getOwnPropertyDescriptors(fixture.target)).toEqual(descriptorsBefore.target)
    expect(Object.getOwnPropertyDescriptors(fixture.validTask)).toEqual(descriptorsBefore.validTask)
    expect(Object.getOwnPropertyDescriptors(fixture.malformedTask)).toEqual(descriptorsBefore.malformedTask)
  })

  it('keeps the generated adversarial matrix sizes deterministic', () => {
    expect(TOP_LEVEL_PRIMITIVE_CASES).toHaveLength(13)
    expect(TOP_LEVEL_NONPLAIN_CASES).toHaveLength(8)
    expect(TOP_LEVEL_MISSING_CASES).toHaveLength(11)
    expect(TOP_LEVEL_EXTRA_CASES).toHaveLength(12)
    expect(TOP_LEVEL_ACCESSOR_CASES).toHaveLength(22)
    expect(TASK_MISSING_CASES).toHaveLength(14)
    expect(TASK_EXTRA_CASES).toHaveLength(4)
    expect(TASK_ACCESSOR_CASES).toHaveLength(28)
    expect(TASK_DOMAIN_MUTATIONS).toHaveLength(59)
    expect(PROXY_FAILURE_CASES).toHaveLength(11)
  })
})
