import { EventEmitter } from 'node:events'
import Module from 'node:module'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type ModuleWithLoad = typeof Module & {
  _load: (request: string, parent: { filename?: string } | null, isMain: boolean) => unknown
}

const mockWorkers = vi.hoisted(() => ({
  instances: [] as MockWorker[],
  Worker: vi.fn(function (scriptPath: string) {
    const worker = new MockWorker(scriptPath)
    mockWorkers.instances.push(worker)
    return worker
  }),
}))

class MockWorker extends EventEmitter {
  postMessage = vi.fn()
  terminate = vi.fn(() => Promise.resolve(0))

  constructor(public scriptPath: string) {
    super()
  }
}

vi.mock('worker_threads', () => ({
  Worker: mockWorkers.Worker,
}))

const loadPool = async () => {
  const mod = await import('../electron/imageWorkerPool')
  return mod as unknown as {
    initialize: (size?: number) => void
    submit: (type: string, payload: Record<string, unknown>) => Promise<unknown>
    shutdown: () => void
  }
}

describe('imageWorkerPool', () => {
  const moduleWithLoad = Module as ModuleWithLoad
  const originalLoad = moduleWithLoad._load

  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    mockWorkers.instances.length = 0
    mockWorkers.Worker.mockReset()
    mockWorkers.Worker.mockImplementation(function (scriptPath: string) {
      const worker = new MockWorker(scriptPath)
      mockWorkers.instances.push(worker)
      return worker
    })
    moduleWithLoad._load = ((request: string, parent: { filename?: string } | null, isMain: boolean) => {
      if (request === 'worker_threads') {
        return { Worker: mockWorkers.Worker }
      }
      if (request === './logger' && parent?.filename?.endsWith('imageWorkerPool.ts')) {
        return { logger: { error: vi.fn() } }
      }
      return originalLoad(request, parent, isMain)
    }) as ModuleWithLoad['_load']
  })

  afterEach(async () => {
    const pool = await loadPool()
    pool.shutdown()
    moduleWithLoad._load = originalLoad
    vi.useRealTimers()
  })

  it('resolves an immediately dispatched task when its worker posts success', async () => {
    const pool = await loadPool()
    pool.initialize(1)

    const resultPromise = Promise.race([
      pool.submit('writeBuffer', {
        bufferB64: 'aW1hZ2U=',
        filepath: 'C:/tmp/image.png',
        expectedExt: '.png',
      }).then(value => ({ status: 'resolved', value })),
      new Promise(resolve => setTimeout(() => resolve({ status: 'timeout' }), 50)),
    ])

    expect(mockWorkers.instances).toHaveLength(1)
    const worker = mockWorkers.instances[0]!
    expect(worker.postMessage).toHaveBeenCalledWith({
      id: 0,
      type: 'writeBuffer',
      payload: {
        bufferB64: 'aW1hZ2U=',
        filepath: 'C:/tmp/image.png',
        expectedExt: '.png',
      },
    })

    worker.emit('message', { id: 0, success: true, data: { format: 'png' } })

    await vi.advanceTimersByTimeAsync(50)
    await expect(resultPromise).resolves.toEqual({
      status: 'resolved',
      value: { format: 'png' },
    })
  })

  it('retires a timed-out worker before dispatching queued work to a replacement', async () => {
    const pool = await loadPool()
    pool.initialize(1)

    const timedOutTask = pool.submit('validateImage', {
      bufferB64: 'dGFzay1h',
    }).then(
      value => ({ status: 'resolved' as const, value }),
      error => ({ status: 'rejected' as const, error }),
    )

    const retiredWorker = mockWorkers.instances[0]!
    expect(retiredWorker.postMessage).toHaveBeenCalledWith({
      id: 0,
      type: 'validateImage',
      payload: { bufferB64: 'dGFzay1h' },
    })

    await vi.advanceTimersByTimeAsync(1_000)

    const replacementTask = pool.submit('validateImage', {
      bufferB64: 'dGFzay1i',
    })

    expect(retiredWorker.postMessage).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(29_000)

    await expect(timedOutTask).resolves.toEqual({
      status: 'rejected',
      error: {
        code: 'WORKER_TERMINATED',
        message: 'Task validateImage timed out after 30000ms',
      },
    })
    expect(retiredWorker.terminate).toHaveBeenCalledTimes(1)
    expect(mockWorkers.instances).toHaveLength(2)

    const replacementWorker = mockWorkers.instances[1]!
    expect(replacementWorker.postMessage).toHaveBeenCalledTimes(1)
    expect(replacementWorker.postMessage).toHaveBeenCalledWith({
      id: 1,
      type: 'validateImage',
      payload: { bufferB64: 'dGFzay1i' },
    })

    const queuedBehindReplacement = pool.submit('validateImage', {
      bufferB64: 'dGFzay1j',
    })
    expect(replacementWorker.postMessage).toHaveBeenCalledTimes(1)

    retiredWorker.emit('message', {
      id: 0,
      success: true,
      data: { format: 'late' },
    })
    retiredWorker.emit('error', new Error('late worker failure'))
    retiredWorker.emit('exit', 1)

    expect(mockWorkers.instances).toHaveLength(2)
    expect(replacementWorker.postMessage).toHaveBeenCalledTimes(1)

    replacementWorker.emit('message', {
      id: 1,
      success: true,
      data: { format: 'png' },
    })

    await expect(replacementTask).resolves.toEqual({ format: 'png' })
    expect(replacementWorker.postMessage).toHaveBeenCalledTimes(2)
    expect(replacementWorker.postMessage).toHaveBeenLastCalledWith({
      id: 2,
      type: 'validateImage',
      payload: { bufferB64: 'dGFzay1j' },
    })

    replacementWorker.emit('message', {
      id: 2,
      success: true,
      data: { format: 'jpeg' },
    })
    await expect(queuedBehindReplacement).resolves.toEqual({ format: 'jpeg' })
  })

  it('settles a timed-out task when bounded replacement construction fails synchronously', async () => {
    const pool = await loadPool()
    pool.initialize(1)

    const rejection = vi.fn()
    const timedOutTask = pool.submit('validateImage', {
      bufferB64: 'dGltZWQtb3V0',
    })
    const timedOutOutcome = timedOutTask.then(
      value => ({ status: 'resolved' as const, value }),
      error => {
        rejection(error)
        return { status: 'rejected' as const, error }
      },
    )
    const queuedOutcome = pool.submit('validateImage', {
      bufferB64: 'cXVldWVk',
    }).then(
      value => ({ status: 'resolved' as const, value }),
      error => ({ status: 'rejected' as const, error }),
    )
    const retiredWorker = mockWorkers.instances[0]!
    mockWorkers.Worker
      .mockImplementationOnce(function () { throw new Error('replacement construction failed') })
      .mockImplementationOnce(function () { throw new Error('replacement construction failed again') })

    await vi.advanceTimersByTimeAsync(30_000)

    await expect(timedOutOutcome).resolves.toEqual({
      status: 'rejected',
      error: {
        code: 'WORKER_TERMINATED',
        message: 'Task validateImage timed out after 30000ms',
      },
    })
    expect(rejection).toHaveBeenCalledTimes(1)
    await expect(queuedOutcome).resolves.toMatchObject({
      status: 'rejected',
      error: { code: 'WORKER_TERMINATED' },
    })
    expect(retiredWorker.terminate).toHaveBeenCalledTimes(1)
    expect(retiredWorker.postMessage).toHaveBeenCalledTimes(1)
    expect(mockWorkers.instances).toHaveLength(1)
    expect(mockWorkers.Worker).toHaveBeenCalledTimes(3)

    retiredWorker.emit('message', { id: 0, success: true, data: { format: 'late' } })
    retiredWorker.emit('error', new Error('late error'))
    retiredWorker.emit('exit', 1)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(rejection).toHaveBeenCalledTimes(1)
    expect(mockWorkers.Worker).toHaveBeenCalledTimes(3)
  })

  it('recovers from a zero-worker state when a later submit can construct a worker', async () => {
    const pool = await loadPool()
    pool.initialize(1)

    const timedOutOutcome = pool.submit('validateImage', {
      bufferB64: 'dGltZWQtb3V0',
    }).then(
      value => ({ status: 'resolved' as const, value }),
      error => ({ status: 'rejected' as const, error }),
    )
    const queuedOutcome = pool.submit('validateImage', {
      bufferB64: 'cXVldWVk',
    }).then(
      value => ({ status: 'resolved' as const, value }),
      error => ({ status: 'rejected' as const, error }),
    )
    const retiredWorker = mockWorkers.instances[0]!
    mockWorkers.Worker
      .mockImplementationOnce(function () { throw new Error('replacement construction failed') })
      .mockImplementationOnce(function () { throw new Error('replacement construction failed again') })

    await vi.advanceTimersByTimeAsync(30_000)
    await expect(timedOutOutcome).resolves.toMatchObject({
      status: 'rejected',
      error: { code: 'WORKER_TERMINATED' },
    })
    await expect(queuedOutcome).resolves.toMatchObject({
      status: 'rejected',
      error: { code: 'WORKER_TERMINATED' },
    })
    expect(mockWorkers.instances).toHaveLength(1)
    expect(mockWorkers.Worker).toHaveBeenCalledTimes(3)

    const recoveredTask = pool.submit('validateImage', {
      bufferB64: 'bmV3LXRhc2s=',
    })

    expect(mockWorkers.Worker).toHaveBeenCalledTimes(4)
    expect(mockWorkers.instances).toHaveLength(2)
    expect(retiredWorker.postMessage).toHaveBeenCalledTimes(1)
    const recoveredWorker = mockWorkers.instances[1]!
    expect(recoveredWorker.postMessage).toHaveBeenCalledWith({
      id: 2,
      type: 'validateImage',
      payload: { bufferB64: 'bmV3LXRhc2s=' },
    })

    recoveredWorker.emit('message', { id: 2, success: true, data: { format: 'png' } })
    await expect(recoveredTask).resolves.toEqual({ format: 'png' })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(recoveredWorker.postMessage).toHaveBeenCalledTimes(1)
  })

  it('replenishes a missing worker slot on a later submit after partial replacement failure', async () => {
    const pool = await loadPool()
    pool.initialize(2)

    const timedOutOutcome = pool.submit('validateImage', {
      bufferB64: 'd29ya2VyLTA=',
    }).then(
      value => ({ status: 'resolved' as const, value }),
      error => ({ status: 'rejected' as const, error }),
    )
    await vi.advanceTimersByTimeAsync(1_000)
    const survivingTask = pool.submit('validateImage', {
      bufferB64: 'd29ya2VyLTE=',
    })
    const retiredWorker = mockWorkers.instances[0]!
    const survivingWorker = mockWorkers.instances[1]!
    mockWorkers.Worker
      .mockImplementationOnce(function () { throw new Error('replacement construction failed') })
      .mockImplementationOnce(function () { throw new Error('replacement construction failed again') })

    await vi.advanceTimersByTimeAsync(29_000)

    await expect(timedOutOutcome).resolves.toMatchObject({
      status: 'rejected',
      error: { code: 'WORKER_TERMINATED' },
    })
    expect(retiredWorker.terminate).toHaveBeenCalledTimes(1)
    expect(survivingWorker.terminate).not.toHaveBeenCalled()
    expect(mockWorkers.Worker).toHaveBeenCalledTimes(4)
    expect(mockWorkers.instances).toHaveLength(2)

    const recoveredTask = pool.submit('validateImage', {
      bufferB64: 'cmVjb3ZlcmVk',
    })

    expect(mockWorkers.Worker).toHaveBeenCalledTimes(5)
    expect(mockWorkers.instances).toHaveLength(3)
    expect(retiredWorker.postMessage).toHaveBeenCalledTimes(1)
    expect(survivingWorker.postMessage).toHaveBeenCalledTimes(1)
    const recoveredWorker = mockWorkers.instances[2]!
    expect(recoveredWorker.postMessage).toHaveBeenCalledWith({
      id: 2,
      type: 'validateImage',
      payload: { bufferB64: 'cmVjb3ZlcmVk' },
    })

    recoveredWorker.emit('message', { id: 2, success: true, data: { format: 'png' } })
    survivingWorker.emit('message', { id: 1, success: true, data: { format: 'jpeg' } })
    await expect(recoveredTask).resolves.toEqual({ format: 'png' })
    await expect(survivingTask).resolves.toEqual({ format: 'jpeg' })
    expect(mockWorkers.Worker).toHaveBeenCalledTimes(5)
    expect(mockWorkers.instances).toHaveLength(3)
  })

  it('offers a new bounded replenishment opportunity after partial recovery keeps failing', async () => {
    const pool = await loadPool()
    pool.initialize(2)

    const timedOutOutcome = pool.submit('validateImage', {
      bufferB64: 'd29ya2VyLTA=',
    }).then(
      value => ({ status: 'resolved' as const, value }),
      error => ({ status: 'rejected' as const, error }),
    )
    await vi.advanceTimersByTimeAsync(1_000)
    const survivingTask = pool.submit('validateImage', {
      bufferB64: 'd29ya2VyLTE=',
    })
    const retiredWorker = mockWorkers.instances[0]!
    const survivingWorker = mockWorkers.instances[1]!
    mockWorkers.Worker
      .mockImplementationOnce(function () { throw new Error('initial replacement failed') })
      .mockImplementationOnce(function () { throw new Error('initial replacement failed again') })

    await vi.advanceTimersByTimeAsync(29_000)
    await expect(timedOutOutcome).resolves.toMatchObject({
      status: 'rejected',
      error: { code: 'WORKER_TERMINATED' },
    })
    expect(retiredWorker.terminate).toHaveBeenCalledTimes(1)
    expect(survivingWorker.terminate).not.toHaveBeenCalled()
    expect(mockWorkers.Worker).toHaveBeenCalledTimes(4)

    mockWorkers.Worker
      .mockImplementationOnce(function () { throw new Error('replenishment failed') })
      .mockImplementationOnce(function () { throw new Error('replenishment failed again') })
    const queuedTask = pool.submit('validateImage', {
      bufferB64: 'cXVldWVk',
    })

    expect(mockWorkers.Worker).toHaveBeenCalledTimes(6)
    expect(mockWorkers.instances).toHaveLength(2)
    expect(survivingWorker.postMessage).toHaveBeenCalledTimes(1)

    survivingWorker.emit('message', { id: 1, success: true, data: { format: 'jpeg' } })
    await expect(survivingTask).resolves.toEqual({ format: 'jpeg' })
    expect(survivingWorker.postMessage).toHaveBeenLastCalledWith({
      id: 2,
      type: 'validateImage',
      payload: { bufferB64: 'cXVldWVk' },
    })

    const recoveredTask = pool.submit('validateImage', {
      bufferB64: 'cmVjb3ZlcmVk',
    })

    expect(mockWorkers.Worker).toHaveBeenCalledTimes(7)
    expect(mockWorkers.instances).toHaveLength(3)
    const recoveredWorker = mockWorkers.instances[2]!
    expect(recoveredWorker.postMessage).toHaveBeenCalledWith({
      id: 3,
      type: 'validateImage',
      payload: { bufferB64: 'cmVjb3ZlcmVk' },
    })

    survivingWorker.emit('message', { id: 2, success: true, data: { format: 'png' } })
    recoveredWorker.emit('message', { id: 3, success: true, data: { format: 'webp' } })
    await expect(queuedTask).resolves.toEqual({ format: 'png' })
    await expect(recoveredTask).resolves.toEqual({ format: 'webp' })

    const capacityCheck = pool.submit('validateImage', {
      bufferB64: 'Y2FwYWNpdHk=',
    })
    expect(mockWorkers.Worker).toHaveBeenCalledTimes(7)
    expect(mockWorkers.instances).toHaveLength(3)
    survivingWorker.emit('message', { id: 4, success: true, data: { format: 'gif' } })
    await expect(capacityCheck).resolves.toEqual({ format: 'gif' })
  })

  it('fails a later submit immediately when bounded zero-worker recovery fails', async () => {
    const pool = await loadPool()
    pool.initialize(1)

    const timedOutOutcome = pool.submit('validateImage', {
      bufferB64: 'dGltZWQtb3V0',
    }).then(
      value => ({ status: 'resolved' as const, value }),
      error => ({ status: 'rejected' as const, error }),
    )
    const queuedOutcome = pool.submit('validateImage', {
      bufferB64: 'cXVldWVk',
    }).then(
      value => ({ status: 'resolved' as const, value }),
      error => ({ status: 'rejected' as const, error }),
    )
    mockWorkers.Worker
      .mockImplementationOnce(function () { throw new Error('replacement construction failed') })
      .mockImplementationOnce(function () { throw new Error('replacement construction failed again') })

    await vi.advanceTimersByTimeAsync(30_000)
    await expect(timedOutOutcome).resolves.toMatchObject({ status: 'rejected' })
    await expect(queuedOutcome).resolves.toMatchObject({
      status: 'rejected',
      error: { code: 'WORKER_TERMINATED' },
    })

    mockWorkers.Worker
      .mockImplementationOnce(function () { throw new Error('recovery construction failed') })
      .mockImplementationOnce(function () { throw new Error('recovery construction failed again') })
    const rejection = vi.fn()
    const recoveredOutcome = pool.submit('validateImage', {
      bufferB64: 'bmV3LXRhc2s=',
    }).then(
      value => ({ status: 'resolved' as const, value }),
      error => {
        rejection(error)
        return { status: 'rejected' as const, error }
      },
    )

    await Promise.resolve()
    expect(rejection).toHaveBeenCalledTimes(1)
    await expect(recoveredOutcome).resolves.toMatchObject({
      status: 'rejected',
      error: { code: 'WORKER_TERMINATED' },
    })
    expect(mockWorkers.Worker).toHaveBeenCalledTimes(5)
    expect(mockWorkers.instances).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(30_000)
    expect(rejection).toHaveBeenCalledTimes(1)
    expect(mockWorkers.Worker).toHaveBeenCalledTimes(5)
    expect(mockWorkers.instances).toHaveLength(1)
  })

  it('replaces a failed replacement worker once and clears its task timer', async () => {
    const pool = await loadPool()
    pool.initialize(1)

    const timedOutOutcome = pool.submit('validateImage', {
      bufferB64: 'Zmlyc3Q=',
    }).then(
      value => ({ status: 'resolved' as const, value }),
      error => ({ status: 'rejected' as const, error }),
    )
    await vi.advanceTimersByTimeAsync(1_000)
    const replacementRejection = vi.fn()
    const replacementOutcome = pool.submit('validateImage', {
      bufferB64: 'c2Vjb25k',
    }).then(
      value => ({ status: 'resolved' as const, value }),
      error => {
        replacementRejection(error)
        return { status: 'rejected' as const, error }
      },
    )

    await vi.advanceTimersByTimeAsync(29_000)
    await expect(timedOutOutcome).resolves.toMatchObject({
      status: 'rejected',
      error: { code: 'WORKER_TERMINATED' },
    })
    expect(mockWorkers.instances).toHaveLength(2)

    const replacementWorker = mockWorkers.instances[1]!
    replacementWorker.emit('error', new Error('replacement worker failed'))
    replacementWorker.emit('exit', 1)

    await expect(replacementOutcome).resolves.toEqual({
      status: 'rejected',
      error: { code: 'WORKER_TERMINATED', message: 'replacement worker failed' },
    })
    expect(replacementRejection).toHaveBeenCalledTimes(1)
    expect(mockWorkers.instances).toHaveLength(3)

    await vi.advanceTimersByTimeAsync(1_000)
    expect(replacementRejection).toHaveBeenCalledTimes(1)
    expect(mockWorkers.instances).toHaveLength(3)
  })

  it('times out an undispatched task without retiring an unrelated busy worker', async () => {
    const pool = await loadPool()
    pool.initialize(1)

    const busyOutcome = pool.submit('validateImage', {
      bufferB64: 'Zmlyc3Q=',
    }).then(
      value => ({ status: 'resolved' as const, value }),
      error => ({ status: 'rejected' as const, error }),
    )
    const busyWorker = mockWorkers.instances[0]!
    const fakeSetTimeout = globalThis.setTimeout
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementationOnce((function (handler: TimerHandler) {
      return fakeSetTimeout(handler, 1)
    }) as typeof setTimeout)

    const undispatchedOutcome = pool.submit('validateImage', {
      bufferB64: 'dW5kaXNwYXRjaGVk',
    }).then(
      value => ({ status: 'resolved' as const, value }),
      error => ({ status: 'rejected' as const, error }),
    )
    timeoutSpy.mockRestore()
    await vi.advanceTimersByTimeAsync(1)

    await expect(undispatchedOutcome).resolves.toMatchObject({
      status: 'rejected',
      error: { code: 'WORKER_TERMINATED' },
    })
    expect(busyWorker.terminate).not.toHaveBeenCalled()
    expect(busyWorker.postMessage).toHaveBeenCalledTimes(1)
    expect(mockWorkers.instances).toHaveLength(1)

    busyWorker.emit('message', { id: 0, success: true, data: { format: 'png' } })
    await expect(busyOutcome).resolves.toEqual({
      status: 'resolved',
      value: { format: 'png' },
    })
  })
})
