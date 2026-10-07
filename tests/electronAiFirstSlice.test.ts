// @vitest-environment node
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EvidenceRequest, FocusPeriodResult, RequestHandle, SessionHandle } from '../src/types/api';
import { classifyFirstSlice } from '../src/utils/aiFirstSlice';

const mocks = vi.hoisted(() => ({
    identity: vi.fn(), aggregate: vi.fn(), detail: vi.fn(), focus: vi.fn(),
    subjectsFactory: vi.fn(), chaptersFactory: vi.fn(), focusFactory: vi.fn(),
}));
vi.mock('../electron/repositories/subjectsRepository', () => ({ createSubjectsRepository: mocks.subjectsFactory }));
vi.mock('../electron/repositories/subjectChaptersRepository', () => ({ createSubjectChaptersRepository: mocks.chaptersFactory }));
vi.mock('../electron/repositories/pomodoroRepository', () => ({ createPomodoroRepository: mocks.focusFactory }));
import { createFirstSliceResolver, createFirstSliceCoordinator, readFirstSliceDurablePreferences, FIRST_SLICE_RESTRICTIONS_KEY } from '../electron/aiFirstSlice';

const periodA = { startDate: '2026-09-07', endDate: '2026-09-13' };
const periodB = { startDate: '2026-09-14', endDate: '2026-09-20' };
const progress: EvidenceRequest = { kind: 'subject_progress', subject: { by: 'id', id: 1 } };
const focus: EvidenceRequest = { kind: 'focus_comparison', subject: { by: 'id', id: 1 }, periodA, periodB };
const observedAt = '2026-09-21T04:00:00.000Z';
const ok: FocusPeriodResult = { status: 'ok', recordedMinutes: 70, observedDateCount: 7 };
const empty: FocusPeriodResult = { status: 'empty', recordedMinutes: 0, observedDateCount: 0 };
const failed: FocusPeriodResult = { status: 'failed', recordedMinutes: null, observedDateCount: null };
const unavailable: FocusPeriodResult = { status: 'unavailable', recordedMinutes: null, observedDateCount: null };

describe('I1 trusted-main validation and envelope coordination', () => {
    let db: BetterSqlite3.Database;
    let resolve: ReturnType<typeof createFirstSliceResolver>;
    let now: ReturnType<typeof vi.fn<() => Date>>;
    let fetchSpy: ReturnType<typeof vi.fn>;
    beforeEach(() => {
        vi.resetAllMocks();
        db = new BetterSqlite3(':memory:');
        now = vi.fn(() => new Date(observedAt));
        resolve = createFirstSliceResolver(db, now);
        mocks.subjectsFactory.mockReturnValue({ resolveFirstSliceSubject: mocks.identity, getFirstSliceProgressAggregate: mocks.aggregate });
        mocks.chaptersFactory.mockReturnValue({ getFirstSliceProgressRows: mocks.detail });
        mocks.focusFactory.mockReturnValue({ getFirstSliceFocusComparison: mocks.focus });
        mocks.identity.mockReturnValue([{ id: 1, name: '线代' }]);
        mocks.detail.mockReturnValue([
            { title: '第1章', sort_order: 0, completed: true },
            { title: '第2章', sort_order: 1, completed: true },
            { title: '第3章', sort_order: 2, completed: false },
        ]);
        mocks.aggregate.mockReturnValue({ total_chapters: 3, completed_chapters: 2 });
        mocks.focus.mockReturnValue({ periodA: ok, periodB: { ...ok, recordedMinutes: 140 } });
        fetchSpy = vi.fn(() => { throw new Error('Provider calls forbidden'); });
        vi.stubGlobal('fetch', fetchSpy);
    });
    afterEach(() => {
        expect(fetchSpy).not.toHaveBeenCalled();
        vi.unstubAllGlobals();
        if (db.open) db.close();
    });

    it('constructs the exact F3 detail envelope with the injected clock and no extra query', () => {
        expect(resolve(progress)).toEqual({ kind: 'resolved', envelope: {
            semantics: 'chapter_marks', sourceCategory: 'subject_progress',
            scope: { subject: { id: 1, name: '线代' }, observedAt }, status: 'ok', coverage: 'detail',
            value: { completed: 2, total: 3, nextTitle: '第3章' },
        } });
        expect(now).toHaveBeenCalledTimes(1);
        expect(mocks.identity).toHaveBeenCalledExactlyOnceWith({ by: 'id', id: 1 });
        expect(mocks.detail).toHaveBeenCalledExactlyOnceWith(1);
        expect(mocks.aggregate).not.toHaveBeenCalled();
        expect(mocks.focusFactory).not.toHaveBeenCalled();
    });

    it('constructs the exact fixed focus envelope without differences or progress reads', () => {
        expect(resolve(focus)).toEqual({ kind: 'resolved', envelope: {
            semantics: 'recorded_focus_minutes', sourceCategory: 'focus_comparison',
            scope: { subject: { id: 1, name: '线代' }, periodA, periodB, observedAt }, status: 'ok',
            value: { periodA: ok, periodB: { ...ok, recordedMinutes: 140 } },
            coverage: { realStudy: 'unknown', unassigned: 'excluded_not_measured' },
        } });
        expect(mocks.focus).toHaveBeenCalledExactlyOnceWith(1, periodA, periodB);
        expect(mocks.detail).not.toHaveBeenCalled();
        expect(mocks.aggregate).not.toHaveBeenCalled();
        expect(mocks.chaptersFactory).not.toHaveBeenCalled();
    });

    it('trims only surrounding name whitespace and preserves exact Unicode/internal text', () => {
        resolve({ kind: 'subject_progress', subject: { by: 'exact_name', name: ' \tＭath  e\u0301\n' } });
        expect(mocks.identity).toHaveBeenCalledExactlyOnceWith({ by: 'exact_name', name: 'Ｍath  e\u0301' });
    });

    const invalid = [
        null, undefined, [], 'subject_progress', {},
        { ...progress, kind: 'generic_query' }, { ...progress, fields: ['title'] },
        { ...progress, periodA }, { ...progress, history: [] }, { ...progress, subject: null },
        ...[0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1'].map(id => ({ ...progress, subject: { by: 'id', id } })),
        ...['', ' \t\n', 1, null].map(name => ({ ...progress, subject: { by: 'exact_name', name } })),
        { ...progress, subject: { by: 'id', id: 1, name: '线代' } },
        { ...progress, subject: { by: 'alias', name: '线代' } },
        { ...focus, meaning: 'efficiency' }, { ...focus, periodB: undefined },
        { ...focus, periodA: { ...periodA, timezone: 'UTC' } },
        ...['2026-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '2026-01-00',
            '2026-9-07', '2026-09-07T00:00:00Z', ' 2026-09-07', '0000-01-01', '1900-02-29'].map(startDate => ({ ...focus, periodA: { ...periodA, startDate } })),
        { ...focus, periodA: { startDate: '2026-09-13', endDate: '2026-09-07' } },
        { ...focus, periodB: { ...periodB, startDate: '2026-09-13' } },
        { ...focus, periodB: periodA },
        { ...focus, periodB: { startDate: '2026-09-08', endDate: '2026-09-09' } },
        Object.assign(Object.create({ hidden: true }), progress),
        { ...progress, [Symbol('extra')]: true },
        Object.defineProperty({ ...progress }, 'hidden', { value: true }),
        Object.defineProperty({ ...progress }, 'subject', { get: () => { throw new Error('Getter must not be used'); } }),
        { ...progress, subject: Object.assign(Object.create({}), { by: 'id', id: 1 }) },
    ];
    it.each(invalid.map((input, index) => ({ input, index })))('rejects invalid input $index before any repository/transaction access', ({ input }) => {
        const transaction = vi.spyOn(db, 'transaction');
        expect(resolve(input)).toEqual({ kind: 'stopped', reason: 'unsupported', status: 'unavailable' });
        for (const method of Object.values(mocks)) expect(method).not.toHaveBeenCalled();
        expect(now).not.toHaveBeenCalled();
        expect(transaction).not.toHaveBeenCalled();
    });

    it('accepts leap dates, unequal periods and reverse chronological non-overlapping pairs unchanged', () => {
        const a = { startDate: '2024-02-29', endDate: '2024-03-01' };
        const b = { startDate: '2024-02-01', endDate: '2024-02-01' };
        expect(resolve({ ...focus, periodA: a, periodB: b }).kind).toBe('resolved');
        expect(mocks.focus).toHaveBeenCalledExactlyOnceWith(1, a, b);
    });

    it('returns only duplicate identities and never reads either candidate evidence', () => {
        mocks.identity.mockReturnValue([{ id: 1, name: '线代', notes: 'CANARY' }, { id: 2, name: '线代', color: 'CANARY' }]);
        expect(resolve({ ...progress, subject: { by: 'exact_name', name: '线代' } })).toEqual({
            kind: 'ask_user', candidates: [{ id: 1, name: '线代' }, { id: 2, name: '线代' }],
        });
        expect(mocks.detail).not.toHaveBeenCalled();
        expect(mocks.aggregate).not.toHaveBeenCalled();
        expect(mocks.focus).not.toHaveBeenCalled();
        expect(mocks.chaptersFactory).not.toHaveBeenCalled();
        expect(mocks.focusFactory).not.toHaveBeenCalled();
    });
    it('keeps missing/deleted identity unavailable with no invented envelope', () => {
        mocks.identity.mockReturnValue([]);
        expect(resolve(progress)).toEqual({ kind: 'stopped', reason: 'insufficient', status: 'unavailable' });
        expect(mocks.detail).not.toHaveBeenCalled();
        expect(mocks.focus).not.toHaveBeenCalled();
        expect(mocks.aggregate).not.toHaveBeenCalled();
    });
    it('keeps identity SQL errors failed and hides raw error text', () => {
        mocks.identity.mockImplementation(() => { throw new Error('SECRET_PATH_CANARY'); });
        expect(resolve(progress)).toEqual({ kind: 'stopped', reason: 'read_failed', status: 'failed' });
        expect(mocks.detail).not.toHaveBeenCalled();
        expect(mocks.aggregate).not.toHaveBeenCalled();
    });
    it('reports missing and closed connections as unavailable without reads', () => {
        expect(createFirstSliceResolver(null)(progress)).toEqual({ kind: 'stopped', reason: 'insufficient', status: 'unavailable' });
        db.close();
        expect(resolve(focus)).toEqual({ kind: 'stopped', reason: 'insufficient', status: 'unavailable' });
        expect(mocks.subjectsFactory).not.toHaveBeenCalled();
    });
    it('never falls back on detail failure', () => {
        mocks.detail.mockImplementation(() => { throw new Error('Synthetic read failure'); });
        expect(resolve(progress)).toMatchObject({ kind: 'resolved', envelope: { status: 'failed', value: null, coverage: 'unknown' } });
        expect(mocks.aggregate).not.toHaveBeenCalled();
    });
    it('uses aggregate only after successful empty detail and cannot invent nextTitle', () => {
        mocks.detail.mockReturnValue([]);
        expect(resolve(progress)).toMatchObject({ kind: 'resolved', envelope: {
            status: 'ok', coverage: 'aggregate_only', value: { completed: 2, total: 3, nextTitle: null },
        } });
        expect(mocks.aggregate).toHaveBeenCalledExactlyOnceWith(1);
        expect(mocks.detail.mock.invocationCallOrder[0]).toBeLessThan(mocks.aggregate.mock.invocationCallOrder[0]!);
    });
    it('represents aggregate 0/0 as empty', () => {
        mocks.detail.mockReturnValue([]);
        mocks.aggregate.mockReturnValue({ completed_chapters: 0, total_chapters: 0 });
        expect(resolve(progress)).toMatchObject({ kind: 'resolved', envelope: { status: 'empty', value: null, coverage: 'no_chapter_records' } });
    });
    it.each(['failed', 'unavailable'])('preserves aggregate %s', status => {
        mocks.detail.mockReturnValue([]);
        if (status === 'failed') mocks.aggregate.mockImplementation(() => { throw new Error('Synthetic'); });
        else mocks.aggregate.mockReturnValue(undefined);
        expect(resolve(progress)).toMatchObject({ kind: 'resolved', envelope: { status, value: null, coverage: 'unknown' } });
    });
    it('returns nextTitle null when all detail marks are complete', () => {
        mocks.detail.mockReturnValue([{ title: '第1章', sort_order: 0, completed: true }]);
        expect(resolve(progress)).toMatchObject({ envelope: { value: { completed: 1, total: 1, nextTitle: null } } });
    });
    const combinations: Array<[FocusPeriodResult, FocusPeriodResult, string]> = [
        [ok, ok, 'ok'], [ok, empty, 'ok'], [empty, ok, 'ok'], [empty, empty, 'empty'],
        [ok, failed, 'partial'], [failed, ok, 'partial'], [empty, unavailable, 'partial'],
        [unavailable, empty, 'partial'], [ok, unavailable, 'partial'], [unavailable, ok, 'partial'],
        [empty, failed, 'partial'], [failed, empty, 'partial'], [failed, failed, 'failed'],
        [unavailable, failed, 'failed'], [failed, unavailable, 'failed'], [unavailable, unavailable, 'unavailable'],
    ];
    it.each(combinations)('aggregates %j and %j into %s without replacing values or computing differences', (a, b, status) => {
        mocks.focus.mockReturnValue({ periodA: a, periodB: b });
        expect(resolve(focus)).toEqual({ kind: 'resolved', envelope: {
            semantics: 'recorded_focus_minutes', sourceCategory: 'focus_comparison',
            scope: { subject: { id: 1, name: '线代' }, periodA, periodB, observedAt }, status,
            value: { periodA: a, periodB: b }, coverage: { realStudy: 'unknown', unassigned: 'excluded_not_measured' },
        } });
        expect(mocks.focus).toHaveBeenCalledTimes(1);
    });
    it('executes all trusted repositories synchronously inside the same connection transaction', () => {
        mocks.identity.mockImplementation(() => {
            expect(db.inTransaction).toBe(true);
            return [{ id: 1, name: '线代' }];
        });
        mocks.focus.mockImplementation(() => {
            expect(db.inTransaction).toBe(true);
            return { periodA: ok, periodB: empty };
        });
        expect(resolve(focus).kind).toBe('resolved');
        expect(mocks.subjectsFactory).toHaveBeenCalledExactlyOnceWith(db);
        expect(mocks.focusFactory).toHaveBeenCalledExactlyOnceWith(db);
        expect(db.inTransaction).toBe(false);
    });
});

describe('I2 main-owned state (test assembly, no privileged transport)', () => {
    let db: BetterSqlite3.Database;
    let state: ReturnType<typeof createFirstSliceCoordinator>;
    let owner: object;
    let session: SessionHandle;
    const destination = { normalizedEndpoint: 'https://provider.example/v1', model: 'test-model', revision: 1 };
    let fetchSpy: ReturnType<typeof vi.fn>;
    beforeEach(() => {
        vi.resetAllMocks();
        db = new BetterSqlite3(':memory:');
        state = createFirstSliceCoordinator(db, { now: () => new Date(observedAt) });
        owner = {};
        session = state.openSession(owner, destination);
        mocks.subjectsFactory.mockReturnValue({ resolveFirstSliceSubject: mocks.identity, getFirstSliceProgressAggregate: mocks.aggregate });
        mocks.chaptersFactory.mockReturnValue({ getFirstSliceProgressRows: mocks.detail });
        mocks.focusFactory.mockReturnValue({ getFirstSliceFocusComparison: mocks.focus });
        mocks.identity.mockReturnValue([{ id: 1, name: '数学' }]);
        mocks.detail.mockReturnValue([{ title: '第3章', sort_order: 0, completed: false }]);
        mocks.focus.mockReturnValue({ periodA: ok, periodB: { ...ok, recordedMinutes: 140 } });
        fetchSpy = vi.fn(() => { throw new Error('No I2 networking'); });
        vi.stubGlobal('fetch', fetchSpy);
    });
    afterEach(() => {
        expect(fetchSpy).not.toHaveBeenCalled();
        vi.unstubAllGlobals();
        db.close();
    });
    function begin(text = '请按我现在说的分析', s = session): RequestHandle {
        const id = state.beginRequest(owner, s, { userInput: text });
        expect(id).not.toBeNull();
        return id!;
    }
    function resolved(input: EvidenceRequest = focus): RequestHandle {
        const id = begin();
        expect(state.resolveEvidence(owner, session, id, input).kind).toBe('resolved');
        return id;
    }
    function restrict(text: string) {
        const id = begin(text);
        const gate = classifyFirstSlice(text);
        if (gate.kind !== 'restriction') throw new Error('Expected supported restriction');
        return state.restrict(owner, session, id, gate.intent);
    }
    function chat(text = '我今天只睡了五个小时，先按我现在说的这些分析', diary = false) {
        const id = begin(text);
        expect(state.trustedEvents.prepareChat(owner, session, id, diary ? [{ source: 'diary', text: 'PRIVATE_DIARY' }] : [])).toBe(true);
        expect(state.trustedEvents.adoptResult(owner, session, id, diary ? 'OLD_MIXED_DIARY_TASK' : 'NEW_SELF_REPORT_HELP')).toBe(true);
        return id;
    }
    function pending(input: EvidenceRequest = { ...progress, subject: { by: 'exact_name', name: '同名' } }, ids = [6, 9]) {
        mocks.identity.mockReturnValue(ids.map(id => ({ id, name: '同名' })));
        const id = begin();
        const result = state.resolveEvidence(owner, session, id, input);
        expect(result).toEqual({ kind: 'ask_user', candidates: ids.map(id => ({ id, name: '同名' })) });
        expect(state.validity(owner, session, id)).toBe('active');
        expect(mocks.detail).not.toHaveBeenCalled();
        expect(mocks.aggregate).not.toHaveBeenCalled();
        expect(mocks.focus).not.toHaveBeenCalled();
        return { id, result };
    }
    it.each([progress, focus])('resumes the same fixed %j batch, then forbids a third call', original => {
        const input: EvidenceRequest = { ...original, subject: { by: 'exact_name', name: '同名' } };
        const { id, result } = pending(input);
        // Neither exposed candidates nor the original renderer object owns pending scope.
        if (result.kind !== 'ask_user') throw new Error('Expected candidates');
        result.candidates[0]!.id = 100;
        input.subject = { by: 'id', id: 100 };
        if (input.kind === 'focus_comparison') input.periodA = { ...periodA, startDate: '2026-09-01' };
        mocks.identity.mockReturnValue([{ id: 6, name: '同名' }]);
        const resume = { ...original, subject: { by: 'id', id: 6 } };
        expect(state.resolveEvidence(owner, session, id, resume)).toMatchObject({ kind: 'resolved', envelope: { scope: { subject: { id: 6, name: '同名' } } } });
        expect(mocks.identity.mock.calls.slice(1)).toEqual([[{ by: 'id', id: 6 }], [{ by: 'id', id: 6 }]]);
        if (original.kind === 'subject_progress') expect(mocks.detail).toHaveBeenCalledExactlyOnceWith(6);
        else expect(mocks.focus).toHaveBeenCalledExactlyOnceWith(6, periodA, periodB);
        expect(state.validity(owner, session, id)).toBe('completed');
        const reads = mocks.identity.mock.calls.length;
        expect(state.resolveEvidence(owner, session, id, resume)).toMatchObject({ kind: 'stopped' });
        expect(mocks.identity).toHaveBeenCalledTimes(reads);
    });
    it.each([
        { ...progress, subject: { by: 'id', id: 100 } },
        { ...focus, subject: { by: 'id', id: 6 } },
        { ...progress, subject: { by: 'id', id: 6 }, extra: true },
        { ...progress, subject: { by: 'exact_name', name: '同名' } },
    ])('rejects non-candidate or changed progress scope before reads: %j', resume => {
        const { id } = pending();
        expect(state.resolveEvidence(owner, session, id, resume)).toMatchObject({ kind: 'stopped' });
        expect(mocks.identity).toHaveBeenCalledTimes(1);
        expect(mocks.detail).not.toHaveBeenCalled();
        expect(mocks.focus).not.toHaveBeenCalled();
    });
    it.each(['periodA', 'periodB'] as const)('rejects changed focus %s before reads', period => {
        const { id } = pending({ ...focus, subject: { by: 'exact_name', name: '同名' } });
        const resume = { ...focus, subject: { by: 'id', id: 6 }, [period]: { ...focus[period], endDate: period === 'periodA' ? '2026-09-12' : '2026-09-19' } };
        expect(state.resolveEvidence(owner, session, id, resume)).toMatchObject({ kind: 'stopped' });
        expect(mocks.identity).toHaveBeenCalledTimes(1);
        expect(mocks.focus).not.toHaveBeenCalled();
    });
    it('binds candidates to request, session and owner', () => {
        const a = pending().id;
        const b = pending(undefined, [12, 15]).id;
        const other = state.openSession(owner, destination);
        const resume = { ...progress, subject: { by: 'id', id: 6 } };
        for (const [o, s, id] of [[{}, session, a], [owner, other, a], [owner, session, b]] as const) {
            expect(state.resolveEvidence(o, s, id, resume)).toMatchObject({ kind: 'stopped' });
        }
        expect(mocks.identity).toHaveBeenCalledTimes(2);
        expect(mocks.detail).not.toHaveBeenCalled();
    });
    it.each(['deleted', 'renamed', 'failed', 'closed'] as const)('stops stale selected identity: %s', change => {
        const { id } = pending();
        if (change === 'deleted') mocks.identity.mockReturnValue([]);
        if (change === 'renamed') mocks.identity.mockReturnValue([{ id: 6, name: '新名' }]);
        if (change === 'failed') mocks.identity.mockImplementation(() => { throw new Error('read failed'); });
        if (change === 'closed') db.close();
        const resume = { ...progress, subject: { by: 'id', id: 6 } };
        expect(state.resolveEvidence(owner, session, id, resume)).toMatchObject({ kind: 'stopped' });
        expect(mocks.detail).not.toHaveBeenCalled();
        expect(mocks.focus).not.toHaveBeenCalled();
        const reads = mocks.identity.mock.calls.length;
        expect(state.resolveEvidence(owner, session, id, resume)).toMatchObject({ kind: 'stopped' });
        expect(mocks.identity).toHaveBeenCalledTimes(reads);
    });
    it.each(['source', 'destination', 'reload', 'close', 'revocation', 'cancel'] as const)('invalidates pending selection on %s', event => {
        const { id } = pending();
        if (event === 'source') state.trustedEvents.sourceChanged(owner, session);
        if (event === 'destination') state.trustedEvents.destinationChanged(owner, session, { ...destination, revision: 2 });
        if (event === 'reload') state.trustedEvents.reloadBoundary(owner, session);
        if (event === 'close') state.closeSession(owner, session);
        if (event === 'revocation') restrict('这次别发日记');
        if (event === 'cancel') state.cancel(owner, session, id);
        expect(state.resolveEvidence(owner, session, id, { ...progress, subject: { by: 'id', id: 6 } })).toMatchObject({ kind: 'stopped' });
        expect(mocks.identity).toHaveBeenCalledTimes(1);
        expect(mocks.detail).not.toHaveBeenCalled();
        expect(mocks.focus).not.toHaveBeenCalled();
    });
    it('keeps active supplied evidence away from identity and database evidence', () => {
        const first = classifyFirstSlice('最近数学效率下降');
        if (first.kind !== 'clarify') throw new Error('Expected clarification');
        const answer = classifyFirstSlice('数学\n2026-09-07..13 = 70 min\n2026-09-14..20 = 140 min\n覆盖未知', first.slots);
        if (answer.kind === 'evidence') state.resolveEvidence(owner, session, begin(), answer.request);
        expect(answer).toMatchObject({ kind: 'supplied', evidence: { source: 'user_message' } });
        expect(answer).not.toHaveProperty('request');
        expect(mocks.identity).not.toHaveBeenCalled();
        expect(mocks.focus).not.toHaveBeenCalled();
    });
    it('generates unique opaque tokens and rejects generator collision without overwriting', () => {
        const second = state.openSession(owner, destination);
        expect(second).not.toBe(session);
        expect(session).not.toContain('provider');
        const collisions = createFirstSliceCoordinator(null, { token: () => 'test-token' });
        collisions.openSession(owner, destination);
        expect(() => collisions.openSession({}, destination)).toThrow('token generator');
    });
    it('rejects random, wrong-owner, cross-session and closed references before querying', () => {
        const id = begin();
        const other = state.openSession(owner, destination);
        for (const [o, s, r] of [
            [{}, session, id], [owner, 'random' as SessionHandle, id], [owner, other, id],
            [owner, session, 'random' as RequestHandle],
        ] as Array<[object, SessionHandle, RequestHandle]>) {
            expect(state.resolveEvidence(o, s, r, focus)).toMatchObject({ kind: 'stopped' });
            expect(state.prepareDisclosure(o, s, r, { share: true, acceptLimited: true })).toBeNull();
            expect(state.cancel(o, s, r)).toBe(false);
        }
        expect(state.closeSession({}, session)).toBe(false);
        state.closeSession(owner, session);
        expect(state.beginRequest(owner, session, { userInput: 'new' })).toBeNull();
        expect(state.resolveEvidence(owner, session, id, focus)).toMatchObject({ kind: 'stopped' });
        expect(mocks.identity).not.toHaveBeenCalled();
    });
    it.each(['epoch', 'sources', 'verified', 'envelope', 'history', 'requestMessages', 'destinationRevision', 'validity'])('rejects renderer trusted-state injection %s', field => {
        expect(state.beginRequest(owner, session, { userInput: 'current', [field]: 'FORGED' })).toBeNull();
        const id = begin();
        expect(state.resolveEvidence(owner, session, id, { ...focus, [field]: 'FORGED' })).toMatchObject({ kind: 'stopped' });
        expect(mocks.identity).not.toHaveBeenCalled();
    });
    it('keeps ambiguity, supplied facts and unsupported questions out of the resolver in gate assembly', () => {
        for (const text of ['最近数学效率下降', '为什么我的数学效率下降？', '讲克拉默法则',
            '数学\n2026-09-07..13 = 70 min\n2026-09-14..20 = 140 min\n覆盖未知']) {
            const result = classifyFirstSlice(text);
            if (result.kind === 'evidence') state.resolveEvidence(owner, session, begin(text), result.request);
        }
        expect(mocks.identity).not.toHaveBeenCalled();
        expect(mocks.focus).not.toHaveBeenCalled();
    });
    it('keeps both local evidence variants out of reusable history and snapshots', () => {
        for (const input of [progress, focus]) {
            const id = resolved(input);
            expect(state.validity(owner, session, id)).toBe('completed');
            expect(state.trustedEvents.prepareChat(owner, session, id)).toBe(false);
            expect(state.trustedEvents.adoptResult(owner, session, id, 'renderer replay of local answer')).toBe(false);
            expect(state.regenerate(owner, session, id)).toBe('unavailable');
            if (input === progress) expect(state.prepareDisclosure(owner, session, id, { share: true, acceptLimited: true })).toBeNull();
            expect(state.resolveEvidence(owner, session, id, input)).toMatchObject({ kind: 'stopped' });
        }
        expect(state.reusableHistory(owner, session)).toEqual([]);
        expect(mocks.identity).toHaveBeenCalledTimes(2);
    });
    it('projects the exact trusted S2 DTO; no configured destination is consent', () => {
        const id = resolved();
        expect(state.disclosure(owner, session, id)).toBeNull();
        expect(state.prepareDisclosure(owner, session, id, { share: false, acceptLimited: true })).toBeNull();
        const summary = state.prepareDisclosure(owner, session, id, { share: true, acceptLimited: false });
        expect(summary).toEqual({ subjectDisplayName: '数学',
            periodA: { ...periodA, recordedMinutes: 70, limitation: 'recorded_only' },
            periodB: { ...periodB, recordedMinutes: 140, limitation: 'recorded_only' },
            semantics: 'recorded study time, not efficiency',
            coverageLimitations: { realStudy: 'unknown', unassigned: 'excluded_not_measured' },
        });
        const serialized = JSON.stringify(summary);
        for (const field of ['observedDateCount', 'observedAt', 'subjectId', 'session', 'request', 'epoch', 'SQL', 'error', 'sourceCategory', 'restriction', 'value']) {
            expect(serialized).not.toContain(field);
        }
        expect(serialized).not.toContain(id);
        expect(serialized).not.toContain(session);
        expect(state.regenerate(owner, session, id)).toBe('unavailable');
        expect(state.reusableHistory(owner, session)).toEqual([]);
    });
    it('rejects fabricated envelopes and protects stored evidence/decision from returned-object mutation', () => {
        const id = begin();
        const local = state.resolveEvidence(owner, session, id, focus);
        if (local.kind !== 'resolved' || local.envelope.sourceCategory !== 'focus_comparison') throw new Error('Expected focus');
        local.envelope.scope.subject.name = 'FORGED';
        local.envelope.value.periodA.recordedMinutes = 999;
        expect(state.prepareDisclosure(owner, session, id, { share: true, acceptLimited: true, envelope: local.envelope })).toBeNull();
        const summary = state.prepareDisclosure(owner, session, id, { share: true, acceptLimited: false })!;
        expect(summary.subjectDisplayName).toBe('数学');
        expect(summary.periodA.recordedMinutes).toBe(70);
        summary.periodA.recordedMinutes = 999;
        expect(state.disclosure(owner, session, id)!.periodA.recordedMinutes).toBe(70);
    });
    it.each([
        [ok, empty, false, 'no_records'], [ok, failed, true, 'read_failed'],
        [ok, unavailable, true, 'unavailable'], [failed, unavailable, false, null],
        [unavailable, unavailable, false, null], [empty, empty, false, 'no_records'],
    ] as Array<[FocusPeriodResult, FocusPeriodResult, boolean, string | null]>)('bounds projection for %j / %j', (a, b, limited, limitation) => {
        mocks.focus.mockReturnValue({ periodA: a, periodB: b });
        const id = resolved();
        if (limited) expect(state.prepareDisclosure(owner, session, id, { share: true, acceptLimited: false })).toBeNull();
        const summary = state.prepareDisclosure(owner, session, id, { share: true, acceptLimited: limited });
        if (limitation === null) expect(summary).toBeNull();
        else expect(summary!.periodB).toEqual({ ...periodB, recordedMinutes: b.recordedMinutes, limitation });
    });
    it('applies request restriction only to its turn, permanently revoking the old prefix', () => {
        const old = chat('OLD_USER', true);
        const display = state.reusableHistory(owner, session);
        const effect = restrict('这次别发给 AI');
        expect(effect).toMatchObject({ applied: true, restriction: { lifetime: { kind: 'request' } } });
        expect(effect).not.toHaveProperty('durablePreference');
        expect(state.regenerate(owner, session, old)).toBe('unavailable');
        expect(state.reusableHistory(owner, session)).toEqual([]);
        expect(display).toHaveLength(2);
        const next = chat();
        expect(state.regenerate(owner, session, next)).toBe('eligible');
        expect(JSON.stringify(state.reusableHistory(owner, session))).not.toMatch(/OLD_USER|OLD_MIXED/);
    });
    it('session restriction survives epoch changes, but does not become a global preference', () => {
        expect(restrict('接下来这段不要用日记')).not.toHaveProperty('durablePreference');
        state.trustedEvents.sourceChanged(owner, session);
        const id = begin();
        expect(state.trustedEvents.prepareChat(owner, session, id, [{ source: 'diary', text: 'PRIVATE' }])).toBe(false);
        expect(state.trustedEvents.prepareChat(owner, session, id, [{ source: 'unknown', text: 'MIXED' }])).toBe(false);
        expect(state.trustedEvents.prepareChat(owner, session, id)).toBe(true);
        const another = state.openSession(owner, destination);
        expect(state.trustedEvents.prepareChat(owner, another, begin('Independent', another), [{ source: 'diary', text: 'new' }])).toBe(true);
    });
    it('returns durable intent without persistence, retaining exact purpose and destination', () => {
        const effect = restrict('以后默认不要把日记发给这个 Provider');
        expect(effect).toMatchObject({ applied: true, durablePreference: {
            target: { category: 'diary', operation: 'disclose' },
            qualifiers: { purpose: 'aipanel_default', object: 'category', destination: { normalizedEndpoint: destination.normalizedEndpoint } },
        } });
        if (!effect.applied) throw new Error('Expected restriction');
        effect.restriction.qualifiers.destination = 'all';
        expect(state.trustedEvents.prepareChat(owner, session, begin(), [{ source: 'diary', text: 'SECRET' }])).toBe(false);
        state.trustedEvents.destinationChanged(owner, session, { ...destination, normalizedEndpoint: 'https://other.example/v1' });
        expect(state.trustedEvents.prepareChat(owner, session, begin(), [{ source: 'diary', text: 'NEW' }])).toBe(true);
    });
    it('durable all-outbound blocks future outbound preparation but permits local S2 facts', () => {
        restrict('以后在这里一直不要发给 AI');
        expect(state.trustedEvents.prepareChat(owner, session, begin())).toBe(false);
        const id = resolved();
        expect(state.prepareDisclosure(owner, session, id, { share: true, acceptLimited: true })).toBeNull();
    });
    it('rejects broadened renderer scope and conservatively invalidates old material', () => {
        const old = chat('OLD');
        const narrow = begin('这次别发日记');
        const forged = classifyFirstSlice('以后在这里一直不要发给 AI');
        if (forged.kind !== 'restriction') throw new Error('Expected restriction');
        expect(state.restrict(owner, session, narrow, forged.intent)).toEqual({ applied: false });
        expect(state.regenerate(owner, session, old)).toBe('unavailable');
        expect(state.reusableHistory(owner, session)).toEqual([]);
        chat('No durable effect');
    });
    it.each(['lifetime', 'target', 'purpose', 'object', 'destination', 'extra'])('rejects forged restriction dimension %s', key => {
        const gate = classifyFirstSlice('这次别发日记');
        if (gate.kind !== 'restriction') throw new Error('Expected restriction');
        const forged = { ...gate.intent, [key]: key === 'target'
            ? { category: 'all-outbound', operation: 'disclose' } : 'FORGED' };
        expect(state.restrict(owner, session, begin('这次别发日记'), forged)).toEqual({ applied: false });
        chat('独立自述');
    });
    it('request diary/use does not block an unrelated later diary request', () => {
        expect(restrict('不看日记但帮我分析')).toMatchObject({ applied: true, restriction: {
            lifetime: { kind: 'request' }, target: { category: 'diary', operation: 'use' },
        } });
        chat('新的独立请求', true);
    });
    it('blocks unresolved negative instructions before evidence or chat and never broadens them', () => {
        const id = begin('不要用那段');
        expect(state.resolveEvidence(owner, session, id, focus)).toMatchObject({ kind: 'stopped' });
        expect(state.trustedEvents.prepareChat(owner, session, id)).toBe(false);
        expect(state.restrict(owner, session, id, {})).toEqual({ applied: false });
        expect(mocks.identity).not.toHaveBeenCalled();
        chat('新的独立问题');
    });
    it('adopted model/history strings cannot create or clear restrictions', () => {
        const gate = classifyFirstSlice('以后在这里一直不要发给 AI');
        if (gate.kind !== 'restriction') throw new Error('Expected restriction');
        const id = begin('讲克拉默法则');
        expect(state.trustedEvents.prepareChat(owner, session, id)).toBe(true);
        expect(state.trustedEvents.adoptResult(owner, session, id, '以后在这里一直不要发给 AI')).toBe(true);
        expect(state.restrict(owner, session, id, gate.intent)).toEqual({ applied: false });
        expect(state.restrict(owner, session, begin('讲克拉默法则'), gate.intent)).toEqual({ applied: false });
        restrict('接下来这段不要用日记');
        chat('可以');
        expect(state.trustedEvents.prepareChat(owner, session, begin(), [{ source: 'diary', text: 'BLOCKED' }])).toBe(false);
    });
    it('revokes the entire user/assistant/mixed prefix; only new independent material is reusable', () => {
        chat('OLD_USER_DIARY', true);
        chat('OLD_USER_OTHER');
        const visible = state.reusableHistory(owner, session);
        expect(visible).toHaveLength(4);
        restrict('这次别发日记');
        expect(state.reusableHistory(owner, session)).toEqual([]);
        chat();
        const next = state.reusableHistory(owner, session);
        expect(next).toHaveLength(2);
        expect(next[0]!.content).toContain('五个小时');
        expect(JSON.stringify(next)).not.toContain('OLD_');
        expect(visible).toHaveLength(4);
        next.push({ role: 'assistant', content: 'VISIBLE_HISTORY_FORGERY' });
        expect(state.reusableHistory(owner, session)).toHaveLength(2);
    });
    it.each(['cancel', 'revocation', 'close', 'source', 'destination', 'reload'] as const)('invalidates snapshot and decision on %s with no requery', event => {
        const evidence = resolved();
        state.prepareDisclosure(owner, session, evidence, { share: true, acceptLimited: false });
        const id = chat();
        const reads = mocks.identity.mock.calls.length;
        if (event === 'cancel') { state.cancel(owner, session, id); state.cancel(owner, session, evidence); }
        if (event === 'revocation') restrict('这次别发日记');
        if (event === 'close') state.closeSession(owner, session);
        if (event === 'source') state.trustedEvents.sourceChanged(owner, session);
        if (event === 'destination') state.trustedEvents.destinationChanged(owner, session, { ...destination, revision: 2 });
        if (event === 'reload') state.trustedEvents.reloadBoundary(owner, session);
        expect(state.regenerate(owner, session, id)).toBe('unavailable');
        expect(state.disclosure(owner, session, evidence)).toBeNull();
        expect(state.prepareDisclosure(owner, session, evidence, { share: true, acceptLimited: true })).toBeNull();
        expect(mocks.identity).toHaveBeenCalledTimes(reads);
    });
    it.each(['cancel', 'revocation', 'source', 'destination', 'reload'] as const)('rejects active late result after %s', event => {
        const old = begin();
        state.trustedEvents.prepareChat(owner, session, old);
        if (event === 'cancel') state.cancel(owner, session, old);
        if (event === 'revocation') restrict('这次别发日记');
        if (event === 'source') state.trustedEvents.sourceChanged(owner, session);
        if (event === 'destination') state.trustedEvents.destinationChanged(owner, session, { ...destination, model: 'other' });
        if (event === 'reload') { state.trustedEvents.reloadBoundary(owner, session); session = state.openSession(owner, destination); }
        const next = chat();
        expect(state.trustedEvents.adoptResult(owner, session, old, 'LATE_OLD')).toBe(false);
        expect(state.cancel(owner, session, old)).toBe(false);
        expect(state.validity(owner, session, next)).toBe('completed');
        expect(state.regenerate(owner, session, next)).toBe('eligible');
        expect(JSON.stringify(state.reusableHistory(owner, session))).not.toContain('LATE_OLD');
    });
    it('rejects model result adoption before preparation or twice', () => {
        const id = begin();
        expect(state.trustedEvents.adoptResult(owner, session, id, 'unprepared')).toBe(false);
        state.trustedEvents.prepareChat(owner, session, id);
        expect(state.trustedEvents.adoptResult(owner, session, id, 'once')).toBe(true);
        expect(state.trustedEvents.adoptResult(owner, session, id, 'twice')).toBe(false);
    });
    it('cancelled history and dependent snapshots are unavailable, while an independent active request survives', () => {
        const independent = begin('independent');
        state.trustedEvents.prepareChat(owner, session, independent);
        const old = chat('cancel this history');
        const dependent = chat('uses old history');
        state.cancel(owner, session, old);
        expect(state.reusableHistory(owner, session)).toEqual([]);
        expect(state.regenerate(owner, session, dependent)).toBe('unavailable');
        expect(state.trustedEvents.adoptResult(owner, session, independent, 'independent result')).toBe(true);
        expect(state.regenerate(owner, session, independent)).toBe('eligible');
    });
});

describe('I3 coordinator durable preferences and stable source observation', () => {
    let db: BetterSqlite3.Database;
    const destination = { normalizedEndpoint: 'https://example.test/v1/chat/completions', model: 'model', revision: 1 };
    const owner = {};
    const durableIntent = { lifetime: 'durable_preference', target: { category: 'all-outbound', operation: 'disclose' },
        purpose: 'aipanel_default', object: 'category', destination: 'all' } as const;
    beforeEach(() => {
        vi.resetAllMocks(); db = new BetterSqlite3(':memory:');
        mocks.subjectsFactory.mockReturnValue({ resolveFirstSliceSubject: mocks.identity, getFirstSliceProgressAggregate: mocks.aggregate });
        mocks.chaptersFactory.mockReturnValue({ getFirstSliceProgressRows: mocks.detail });
        mocks.focusFactory.mockReturnValue({ getFirstSliceFocusComparison: mocks.focus });
        mocks.identity.mockReturnValue([{ id: 1, name: '线代' }]);
        mocks.focus.mockReturnValue({ periodA: ok, periodB: ok });
    });
    afterEach(() => { db.close(); });
    function assembly(stored: unknown = undefined) {
        let value = stored;
        const settings = { getSetting: vi.fn(() => value), setSetting: vi.fn((_key: string, next: string) => { value = next; }) };
        const coordinator = createFirstSliceCoordinator(db, { settings });
        const session = coordinator.openSession(owner, destination);
        const begin = (text: string, handle = session) => coordinator.beginRequest(owner, handle, { userInput: text })!;
        return { settings, coordinator, session, begin };
    }
    it.each([
        ['这次别发给AI', { ...durableIntent, lifetime: 'request', purpose: 'this_question' }],
        ['接下来别再用日记', { ...durableIntent, lifetime: 'session', purpose: 'this_conversation', target: { category: 'diary', operation: 'use' } }],
        ['别再这样', durableIntent], ['normal text', durableIntent],
    ])('temporary / ambiguous / forged %s never writes settings', (text, intent) => {
        const f = assembly(); const id = f.begin(text as string);
        f.coordinator.restrict(owner, f.session, id, intent);
        expect(f.settings.setSetting).not.toHaveBeenCalled();
    });
    it('writes only validated target/qualifiers to the fixed key and restores no old state', () => {
        const f=assembly(), old=f.begin('以后在这里一直不要发给AI');
        expect(f.coordinator.restrict(owner,f.session,old,durableIntent)).toMatchObject({applied:true,durableSaved:true});
        expect(f.settings.setSetting).toHaveBeenCalledTimes(1);
        expect(f.settings.setSetting.mock.calls[0]![0]).toBe('aiFirstSliceRestrictionsV1');
        expect(JSON.parse(f.settings.setSetting.mock.calls[0]![1])).toEqual([{ target:durableIntent.target,
            qualifiers:{purpose:'aipanel_default',object:'category',destination:'all'} }]);
        const fresh=f.coordinator.openSession(owner,destination), id=f.begin('ordinary',fresh);
        expect(f.coordinator.validity(owner,fresh,old)).toBe('invalid');
        expect(f.coordinator.reusableHistory(owner,fresh)).toEqual([]);
        expect(f.coordinator.trustedEvents.prepareChat(owner,fresh,id)).toBe(false);
    });
    it('persistence failure preserves current refusal and its invalidation boundary', () => {
        const f=assembly(), before=f.begin('ordinary');f.coordinator.trustedEvents.prepareChat(owner,f.session,before);
        f.settings.setSetting.mockImplementation(()=>{throw new Error('synthetic disk error');});
        const id=f.begin('以后在这里一直不要发给AI');
        expect(f.coordinator.restrict(owner,f.session,id,durableIntent)).toMatchObject({applied:true,durableSaved:false});
        expect(f.coordinator.validity(owner,f.session,before)).toBe('invalid');
        expect(f.coordinator.trustedEvents.prepareChat(owner,f.session,f.begin('new question'))).toBe(false);
        expect(f.settings.setSetting).toHaveBeenCalledTimes(1);
    });
    it.each(['{broken','{}','[{"allow":true}]','[{"target":{"category":"all-outbound","operation":"use"},"qualifiers":{"purpose":"aipanel_default","object":"category","destination":"all"}}]'])('corrupt %s remains unchanged and fails outbound closed', stored => {
        const f=assembly(stored),id=f.begin('ordinary');
        expect(f.coordinator.trustedEvents.prepareChat(owner,f.session,id)).toBe(false);
        expect(f.coordinator.restrict(owner,f.session,f.begin('以后在这里一直不要发给AI'),durableIntent)).toMatchObject({applied:true,durableSaved:false});
        expect(f.settings.setSetting).not.toHaveBeenCalled();
        expect(f.settings.getSetting()).toBe(stored);
    });
    it('unreadable key is not equivalent to a missing key', () => {
        const settings={getSetting:()=>{throw new Error('unreadable');},setSetting:vi.fn()};
        const c=createFirstSliceCoordinator(db,{settings}),s=c.openSession(owner,destination),id=c.beginRequest(owner,s,{userInput:'ordinary'})!;
        expect(c.trustedEvents.prepareChat(owner,s,id)).toBe(false);expect(settings.setSetting).not.toHaveBeenCalled();
        const f=assembly();expect(f.coordinator.trustedEvents.prepareChat(owner,f.session,f.begin('ordinary'))).toBe(true);
    });
    it('endpoint-specific durable scope does not become a refusal at another endpoint or local use', () => {
        const f=assembly();
        const intent={...durableIntent,target:{category:'diary',operation:'disclose'},destination:'current_provider'};
        f.coordinator.restrict(owner,f.session,f.begin('以后默认不要把日记发给这个Provider'),intent);
        const saved=JSON.parse(f.settings.setSetting.mock.calls[0]![1]);
        expect(saved[0].qualifiers.destination).toEqual({normalizedEndpoint:destination.normalizedEndpoint});
        for(const [endpoint,permitted] of [[destination.normalizedEndpoint,false],['https://other.test/v1/chat/completions',true]] as const) {
            const s=f.coordinator.openSession(owner,{...destination,normalizedEndpoint:endpoint});
            const id=f.begin('analysis',s);
            expect(f.coordinator.trustedEvents.prepareChat(owner,s,id,[{source:'diary',text:'synthetic'}])).toBe(permitted);
        }
    });
    it('stable resolver observation is retained; changed observation discards without retry', () => {
        let revision=0;
        const sourceStamp=()=>({connectionGeneration:1,dataRevision:revision,externalDataVersion:1,observedDate:'2026-09-27'});
        const c=createFirstSliceCoordinator(db,{sourceStamp}),s=c.openSession(owner,destination);
        const first=c.beginRequest(owner,s,{userInput:'compare'})!;
        expect(c.resolveEvidence(owner,s,first,focus).kind).toBe('resolved');
        expect(c.prepareDisclosure(owner,s,first,{share:true,acceptLimited:false})).not.toBeNull();
        mocks.focus.mockImplementation(()=>{revision++;return {periodA:ok,periodB:ok};});
        const next=c.beginRequest(owner,s,{userInput:'compare again'})!;
        mocks.focus.mockClear();
        expect(c.resolveEvidence(owner,s,next,focus)).toEqual({kind:'stopped',reason:'invalidated',status:'unavailable'});
        expect(mocks.focus).toHaveBeenCalledTimes(1);
        expect(c.prepareDisclosure(owner,s,next,{share:true,acceptLimited:false})).toBeNull();
        expect(c.prepareDisclosure(owner,s,first,{share:true,acceptLimited:false})).toBeNull();
    });
});

describe('I3 temporary restriction reload isolation',()=>{
    it('new session does not restore a prior session refusal',()=>{
        const settings={getSetting:vi.fn(()=>undefined),setSetting:vi.fn()};
        const c=createFirstSliceCoordinator(null,{settings}),owner={};
        const destination={normalizedEndpoint:'https://example.test/v1/chat/completions',model:'m',revision:1};
        const old=c.openSession(owner,destination);
        const refuse=c.beginRequest(owner,old,{userInput:'接下来别再用日记'})!;
        c.restrict(owner,old,refuse,{lifetime:'session',target:{category:'diary',operation:'use'},purpose:'this_conversation',object:'category',destination:'all'});
        const blocked=c.beginRequest(owner,old,{userInput:'help'})!;
        expect(c.trustedEvents.prepareChat(owner,old,blocked,[{source:'diary',text:'synthetic'}])).toBe(false);
        c.trustedEvents.reloadBoundary(owner,old);
        const fresh=c.openSession(owner,destination),allowed=c.beginRequest(owner,fresh,{userInput:'help'})!;
        expect(c.trustedEvents.prepareChat(owner,fresh,allowed,[{source:'diary',text:'synthetic'}])).toBe(true);
        expect(c.validity(owner,fresh,blocked)).toBe('invalid');expect(settings.setSetting).not.toHaveBeenCalled();
    });
});

describe('I3 Parent correction: exact trusted diary object scope', () => {
    const providerA = { normalizedEndpoint: 'https://a.test/v1/chat/completions', model: 'm', revision: 1 };
    const providerB = { ...providerA, normalizedEndpoint: 'https://b.test/v1/chat/completions' };
    const diary = (diaryId: number) => ({ category: 'diary' as const, diaryId });
    type Material = Parameters<ReturnType<typeof createFirstSliceCoordinator>['trustedEvents']['prepareChat']>[3];
    const preference = (object: 'category' | { diaryId: number }, destination: 'all' | { normalizedEndpoint: string } = 'all', operation: 'use' | 'disclose' = 'disclose') => ({
        target: { category: 'diary' as const, operation },
        qualifiers: { purpose: 'aipanel_default' as const, object, destination },
    });
    function assembly(stored: unknown = undefined, destination = providerA) {
        let value = stored;
        const settings = { getSetting: vi.fn((key: string) => {
            expect(key).toBe(FIRST_SLICE_RESTRICTIONS_KEY); return value;
        }), setSetting: vi.fn((key: string, next: string) => {
            expect(key).toBe(FIRST_SLICE_RESTRICTIONS_KEY); value = next;
        }) };
        const c = createFirstSliceCoordinator(null, { settings }), owner = {};
        const session = c.openSession(owner, destination);
        const begin = (text: string) => c.beginRequest(owner, session, { userInput: text })!;
        return { c, owner, session, settings, begin };
    }
    it.each(['use', 'disclose'] as const)('restored %s restriction respects exact object, category and unknown sources', operation => {
        for (const [object, source, allowed] of [
            [{ diaryId: 17 }, diary(17), false],
            [{ diaryId: 17 }, diary(18), true],
            ['category', diary(17), false],
            ['category', diary(18), false],
            [{ diaryId: 17 }, 'unknown', false],
            [{ diaryId: 17 }, 'diary', false],
            [{ diaryId: 17 }, null, true],
        ] as const) {
            const f = assembly(JSON.stringify([preference(object, 'all', operation)]));
            const materials: Material = source === null ? [] : [{ source, text: 'trusted data' }];
            expect(f.c.trustedEvents.prepareChat(f.owner, f.session, f.begin('question'), materials)).toBe(allowed);
            expect(f.settings.setSetting).not.toHaveBeenCalled();
        }
    });
    it.each([
        [17, providerA, false], [18, providerA, true],
        [17, providerB, true], [18, providerB, true],
    ] as const)('combines diary %s with destination %j without broadening', (id, destination, allowed) => {
        const saved = JSON.stringify([preference({ diaryId: 17 }, { normalizedEndpoint: providerA.normalizedEndpoint })]);
        const f = assembly(saved, destination);
        expect(f.c.trustedEvents.prepareChat(f.owner, f.session, f.begin('question'), [{ source: diary(id), text: 'trusted' }])).toBe(allowed);
        expect(f.settings.getSetting(FIRST_SLICE_RESTRICTIONS_KEY)).toBe(saved);
    });
    it.each(['specific', 'category', 'other-provider'] as const)('live %s preference preserves unrelated requests and history', variant => {
        const f = assembly();
        const a = f.begin('A'), b = f.begin('B'), independent = f.begin('independent'), unknown = f.begin('unknown');
        // Prepare independently before adopting, so B does not inherit A's diary.
        expect(f.c.trustedEvents.prepareChat(f.owner, f.session, a, [{ source: diary(17), text: 'A data' }])).toBe(true);
        expect(f.c.trustedEvents.prepareChat(f.owner, f.session, b, [{ source: diary(18), text: 'B data' }])).toBe(true);
        expect(f.c.trustedEvents.prepareChat(f.owner, f.session, independent)).toBe(true);
        expect(f.c.trustedEvents.prepareChat(f.owner, f.session, unknown, [{ source: 'unknown', text: 'uncertain' }])).toBe(true);
        for (const [id, answer] of [[a, 'answer A'], [b, 'answer B'], [independent, 'answer independent'], [unknown, 'answer unknown']] as const) {
            expect(f.c.trustedEvents.adoptResult(f.owner, f.session, id, answer)).toBe(true);
        }
        const added = preference(variant === 'category' ? 'category' : { diaryId: 17 },
            variant === 'other-provider' ? { normalizedEndpoint: providerB.normalizedEndpoint } : 'all');
        f.c.trustedEvents.durablePreferenceAdded(f.owner, f.session, added);
        expect(f.c.validity(f.owner, f.session, a)).toBe(variant === 'other-provider' ? 'completed' : 'invalid');
        expect(f.c.validity(f.owner, f.session, b)).toBe(variant === 'category' ? 'invalid' : 'completed');
        expect(f.c.validity(f.owner, f.session, independent)).toBe('completed');
        expect(f.c.validity(f.owner, f.session, unknown)).toBe(variant === 'other-provider' ? 'completed' : 'invalid');
        const expected = variant === 'other-provider' ? ['A', 'answer A', 'B', 'answer B', 'independent', 'answer independent', 'unknown', 'answer unknown']
            : variant === 'category' ? ['independent', 'answer independent'] : ['B', 'answer B', 'independent', 'answer independent'];
        expect(f.c.reusableHistory(f.owner, f.session).map(m => m.content)).toEqual(expected);
        expect(f.c.regenerate(f.owner, f.session, b)).toBe(variant === 'category' ? 'unavailable' : 'eligible');
        expect(f.settings.setSetting).not.toHaveBeenCalled();
    });
    it.each([17, 18])('history derived from diary %s retains copied identity for later restrictions', diaryId => {
        const f = assembly(), source = diary(diaryId), original = f.begin('original');
        expect(f.c.trustedEvents.prepareChat(f.owner, f.session, original, [{ source, text: 'trusted data' }])).toBe(true);
        source.diaryId = 99; // The caller cannot mutate the stored lineage afterward.
        expect(f.c.trustedEvents.adoptResult(f.owner, f.session, original, 'derived answer')).toBe(true);
        const later = f.begin('follow up');
        expect(f.c.trustedEvents.prepareChat(f.owner, f.session, later)).toBe(true);
        expect(f.c.trustedEvents.adoptResult(f.owner, f.session, later, 'follow up answer')).toBe(true);
        f.c.trustedEvents.durablePreferenceAdded(f.owner, f.session, preference({ diaryId: 17 }));
        expect(f.c.validity(f.owner, f.session, original)).toBe(diaryId === 17 ? 'invalid' : 'completed');
        expect(f.c.validity(f.owner, f.session, later)).toBe(diaryId === 17 ? 'invalid' : 'completed');
        expect(f.c.reusableHistory(f.owner, f.session)).toHaveLength(diaryId === 17 ? 0 : 4);
    });
    it('parse, merge, save and reload preserve the exact diaryId object without extra fields', () => {
        const scoped = preference({ diaryId: 17 }, { normalizedEndpoint: providerA.normalizedEndpoint });
        const f = assembly(JSON.stringify([scoped]));
        const request = f.begin('以后默认不要把日记发给这个Provider');
        expect(f.c.restrict(f.owner, f.session, request, {
            lifetime: 'durable_preference', target: { category: 'diary', operation: 'disclose' },
            purpose: 'aipanel_default', object: 'category', destination: 'current_provider',
        })).toMatchObject({ applied: true, durableSaved: true });
        const expected = [scoped, preference('category', { normalizedEndpoint: providerA.normalizedEndpoint })];
        const serialized = f.settings.setSetting.mock.calls[0]![1];
        expect(serialized).toBe(JSON.stringify(expected));
        expect(readFirstSliceDurablePreferences(serialized)).toEqual(expected);
        expect(readFirstSliceDurablePreferences(serialized)[0]!.qualifiers.object).toEqual({ diaryId: 17 });
        const restored = assembly(serialized, providerB);
        expect(restored.c.trustedEvents.prepareChat(restored.owner, restored.session, restored.begin('question'), [{ source: diary(18), text: 'other' }])).toBe(true);
        expect(restored.settings.setSetting).not.toHaveBeenCalled();
        expect(restored.settings.getSetting(FIRST_SLICE_RESTRICTIONS_KEY)).toBe(serialized);
    });
});
