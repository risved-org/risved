import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ── Hoisted mocks (initialized before vi.mock factories run) ─────── */

const { mockDb, mockMonitor } = vi.hoisted(() => {
  const mockMonitor = {
    getAll: vi.fn(),
    get: vi.fn()
  }
  const mockDb = {
    select: vi.fn()
  }
  return { mockDb, mockMonitor }
})

/* ── vi.mock declarations ─────────────────────────────────────────── */

vi.mock('$lib/server/api-utils', () => ({
  requireAuth: vi.fn().mockResolvedValue({ id: 'u1' })
}))

vi.mock('$lib/server/health', () => ({
  getHealthMonitor: vi.fn()
}))

vi.mock('$lib/server/db', () => ({ db: mockDb }))

vi.mock('$lib/server/db/schema', () => ({
  healthEvents: { projectId: 'project_id', createdAt: 'created_at' }
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col, val) => ({ col, val })),
  desc: vi.fn((col) => ({ col, direction: 'desc' }))
}))

import { getHealthMonitor } from '$lib/server/health'
import { GET, POST } from './+server'

/* ── Helpers ──────────────────────────────────────────────────────── */

function makeEvent(body?: unknown) {
  return {
    locals: {},
    request: new Request('http://localhost/api/health', {
      method: body !== undefined ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined
    })
  } as Parameters<typeof GET>[0]
}

/**
 * Set up the db select chain to handle both query shapes:
 *   GET:  select().from().orderBy().limit()
 *   POST: select().from().where().orderBy().limit()
 */
function setupSelectChain(rows: unknown[]) {
  const limitFn = vi.fn().mockResolvedValue(rows)
  const orderByFn = vi.fn().mockReturnValue({ limit: limitFn })
  const whereFn = vi.fn().mockReturnValue({ orderBy: orderByFn })
  const fromFn = vi.fn().mockReturnValue({ orderBy: orderByFn, where: whereFn })
  mockDb.select.mockReturnValue({ from: fromFn })
  return { fromFn, whereFn, orderByFn, limitFn }
}

/* ── GET /api/health ──────────────────────────────────────────────── */

describe('GET /api/health', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getHealthMonitor).mockReturnValue(
      mockMonitor as ReturnType<typeof getHealthMonitor>
    )
  })

  it('returns 200 with statuses and events', async () => {
    mockMonitor.getAll.mockReturnValue([])
    setupSelectChain([])
    const res = await GET(makeEvent())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('statuses')
    expect(body).toHaveProperty('events')
  })

  it('returns statuses from monitor.getAll()', async () => {
    const statuses = [
      { projectId: 'p-1', projectSlug: 'my-app', port: 3001, healthy: true, consecutiveFailures: 0, lastCheckAt: null, lastRestartAt: null, totalRestarts: 0 },
      { projectId: 'p-2', projectSlug: 'other-app', port: 3002, healthy: false, consecutiveFailures: 2, lastCheckAt: null, lastRestartAt: null, totalRestarts: 1 }
    ]
    mockMonitor.getAll.mockReturnValue(statuses)
    setupSelectChain([])
    const res = await GET(makeEvent())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.statuses).toEqual(statuses)
  })
})

/* ── POST /api/health ─────────────────────────────────────────────── */

describe('POST /api/health', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getHealthMonitor).mockReturnValue(
      mockMonitor as ReturnType<typeof getHealthMonitor>
    )
  })

  it('returns 400 when body is missing (null parse)', async () => {
    const event = {
      locals: {},
      request: new Request('http://localhost/api/health', {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: 'not-json'
      })
    } as Parameters<typeof POST>[0]
    const res = await POST(event)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/projectId/)
  })

  it('returns 400 when body has no projectId', async () => {
    const res = await POST(makeEvent({ name: 'test' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/projectId/)
  })

  it('returns 200 with status and events for valid projectId', async () => {
    const status = { projectId: 'p-1', projectSlug: 'my-app', port: 3001, healthy: true, consecutiveFailures: 0, lastCheckAt: null, lastRestartAt: null, totalRestarts: 0 }
    const events = [
      { id: 'e-1', projectId: 'p-1', event: 'recovered', message: 'Container recovered', createdAt: '2024-01-01T00:00:00.000Z' }
    ]
    mockMonitor.get.mockReturnValue(status)
    setupSelectChain(events)
    const res = await POST(makeEvent({ projectId: 'p-1' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toEqual(status)
    expect(body.events).toEqual(events)
  })

  it('returns null status when monitor.get returns undefined', async () => {
    mockMonitor.get.mockReturnValue(undefined)
    setupSelectChain([])
    const res = await POST(makeEvent({ projectId: 'unknown' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBeNull()
  })
})
