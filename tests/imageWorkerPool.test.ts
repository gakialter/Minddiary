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
  terminate = vi.fn()

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
    mockWorkers.Worker.mockClear()
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
})
