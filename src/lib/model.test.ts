import { describe, expect, it, vi } from 'vitest';
import {
  addItem, addProject, completeCurrent, createDemoState, createEmptyState,
  deleteItem, deleteProject, duplicateItem, ensureProjectPlaceholders, exportCsv, moveItem, putBackItem, renameItem, reorderItem, reprocess,
  resolveQueue, takeBite, updateProject, validateImport, MAX_INLINE_AVATAR_BYTES,
  type AppState, type Item, type Project, type QueueSlot,
} from './model';

const timestamp = '2026-10-04T12:00:00.000Z';
const project = (id: string, status: Project['status'] = 'active'): Project => ({
  id, name: id, status, createdAt: timestamp, dueDate: null,
  completedAt: status === 'completed' ? timestamp : null,
});
const item = (id: string, projectId: string | null): Item => ({ id, title: id, projectId, createdAt: timestamp, completedAt: null });
const slot = (id: string, projectId: string): QueueSlot => ({ id, kind: 'project', projectId, createdAt: timestamp });
const errand = (itemId: string): QueueSlot => ({ id: `slot-${itemId}`, kind: 'errand', itemId, createdAt: timestamp });

function sample(): AppState {
  return {
    ...createEmptyState(),
    projects: [project('p')],
    items: [item('p1', 'p'), item('p2', 'p'), item('p3', 'p'), item('p4', 'p'), item('e1', null), item('e2', null), item('e3', null), item('e4', null)],
    queue: [slot('a', 'p'), errand('e1'), errand('e2'), slot('b', 'p'), errand('e3'), errand('e4'), slot('c', 'p')],
  };
}

describe('project placeholder sequencing', () => {
  it('maps project placeholders to remaining items in project order', () => {
    const state = sample();
    expect(resolveQueue(state).map((entry) => entry.item.id)).toEqual(['p1', 'e1', 'e2', 'p2', 'e3', 'e4', 'p3']);
    const moved = reorderItem(state, 'p2', 'up');
    expect(resolveQueue(moved).map((entry) => entry.item.id)).toEqual(['p2', 'e1', 'e2', 'p1', 'e3', 'e4', 'p3']);
    expect(moved.queue).toBe(state.queue);
    expect(state.items[0].id).toBe('p1');
  });

  it('supports moving within a project without moving unrelated tasks', () => {
    const state = sample();
    const moved = moveItem(state, 'p1', 'p3');
    expect(resolveQueue(moved).map((entry) => entry.item.id)).toEqual(['p2', 'e1', 'e2', 'p3', 'e3', 'e4', 'p1']);
    expect(moved.queue).toBe(state.queue);
    expect(moveItem(state, 'p1', 'e1')).toBe(state);
  });

  it('skips completed steps and normalizes excess placeholders', () => {
    const state = sample();
    state.items = state.items.map((entry) => ['p1', 'p2', 'p3'].includes(entry.id) ? { ...entry, completedAt: timestamp } : entry);
    expect(resolveQueue(state).filter((entry) => entry.project).map((entry) => entry.item.id)).toEqual(['p4']);
    expect(reprocess(state).queue.map((entry) => entry.id)).toEqual(['a', 'slot-e1', 'slot-e2', 'slot-e3', 'slot-e4']);
  });
});

describe('equal project pacing', () => {
  function queueWith(projectPosition: number, length: number): AppState {
    const state = { ...createEmptyState(), projects: [project('p')], items: [item('p1', 'p'), item('p2', 'p'), item('p3', 'p')], queue: [] as QueueSlot[] };
    for (let position = 1; position <= length; position++) {
      if (position === projectPosition) state.queue.push(slot('a', 'p'));
      else {
        state.items.push(item(`e${position}`, null));
        state.queue.push(errand(`e${position}`));
      }
    }
    return state;
  }

  it('matches workbook N=11, lastPosition=7 and appends one slot', () => {
    const state = queueWith(7, 11);
    const after = reprocess(state);
    expect(after.queue).toHaveLength(12);
    expect(after.queue.slice(0, 11)).toEqual(state.queue);
    expect(after.queue[11]).toMatchObject({ kind: 'project', projectId: 'p' });
    expect(reprocess(after)).toBe(after);
  });

  it('does not activate at or below the strict one-third boundary', () => {
    for (const [position, length] of [[8, 10], [7, 9], [4, 6], [2, 3], [12, 12]]) {
      const state = queueWith(position, length);
      expect(reprocess(state)).toBe(state);
    }
  });

  it('seeds one placeholder in an empty queue and never consumes all remaining steps', () => {
    const state = queueWith(1, 1);
    state.queue = [];
    const next = reprocess(state);
    expect(next.queue).toHaveLength(1);
    expect(resolveQueue(next)[0].item.id).toBe('p1');
    expect(reprocess(next)).toBe(next);
  });

  it('appends at most one slot for each project in one pass', () => {
    const state = queueWith(1, 10);
    state.projects.push(project('q'));
    state.items.push(item('q1', 'q'), item('q2', 'q'), item('q3', 'q'));
    const after = reprocess(state);
    expect(after.queue.slice(10).map((entry) => entry.kind === 'project' ? entry.projectId : null)).toEqual(['p', 'q']);
    expect(after.queue.slice(0, 10)).toEqual(state.queue);
  });

  it('seeds active work before empty project reminders and leaves inactive projects out', () => {
    const state: AppState = { ...createEmptyState(), projects: [project('p'), project('q'), project('r', 'inactive'), project('empty')], items: [item('p1', 'p'), item('q1', 'q'), item('r1', 'r')] };
    const queued = resolveQueue(reprocess(state));
    expect(queued.slice(0, 2).map((entry) => entry.item.id)).toEqual(['p1', 'q1']);
    expect(queued.at(-1)?.item).toMatchObject({ projectId: 'empty', title: '', isPlaceholder: true });
    expect(queued).toHaveLength(3);
  });
});

describe('completion and project lifecycle', () => {
  it('completes only the current item and preserves other slots', () => {
    const state = sample();
    const next = completeCurrent(state);
    expect(next.items.find((entry) => entry.id === 'p1')?.completedAt).toBeTruthy();
    expect(state.items[0].completedAt).toBeNull();
    expect(next.queue.map((entry) => entry.id)).toEqual(['slot-e1', 'slot-e2', 'b', 'slot-e3', 'slot-e4', 'c']);
    expect(resolveQueue(next).map((entry) => entry.item.id)).toEqual(['e1', 'e2', 'p2', 'e3', 'e4', 'p3']);
    expect(next.projects[0].status).toBe('active');
  });

  it('seeds another step when completing the only project placeholder', () => {
    const state: AppState = { ...createEmptyState(), projects: [project('p')], items: [item('p1', 'p'), item('p2', 'p')], queue: [slot('a', 'p')] };
    const next = completeCurrent(state);
    expect(resolveQueue(next).map((entry) => entry.item.id)).toEqual(['p2']);
    expect(next.queue[0].id).not.toBe('a');
  });

  it('keeps a project active after its final item and queues a later addition', () => {
    let state: AppState = { ...createEmptyState(), projects: [project('p')], items: [item('p1', 'p')], queue: [slot('a', 'p')] };
    const originalProjects = state.projects;
    state = completeCurrent(state);
    expect(state.projects).toBe(originalProjects);
    expect(state.projects[0]).toMatchObject({ status: 'active', completedAt: null });
    expect(state.items[0].completedAt).toBeTruthy();
    expect(state.queue).toHaveLength(1);
    expect(resolveQueue(state)[0].item).toMatchObject({ title: '', isPlaceholder: true });
    expect(validateImport(JSON.parse(JSON.stringify(state)))).toEqual(state);
    state = addItem(state, 'Another small step', 'p');
    expect(state.projects[0]).toMatchObject({ status: 'active', completedAt: null });
    expect(resolveQueue(state)[0].item.title).toBe('Another small step');
  });

  it.each(['active', 'inactive'] as const)('explicitly completes an %s project and its unfinished items without reprocessing other projects', (status) => {
    const state = sample();
    state.projects[0] = project('p', status);
    state.projects.push(project('q'));
    state.items.push(
      { ...item('p-done', 'p'), completedAt: timestamp },
      item('q1', 'q'), item('q2', 'q'),
      { ...item('q-done', 'q'), completedAt: timestamp },
    );
    if (status === 'inactive') state.queue = state.queue.filter((entry) => entry.kind !== 'project');
    state.queue.unshift(slot('q-slot', 'q'));
    const original = structuredClone(state);
    const next = updateProject(state, 'p', { status: 'completed' });
    const completedProject = next.projects[0];
    expect(completedProject.status).toBe('completed');
    expect(completedProject.completedAt).toBeTruthy();
    for (const pending of state.items.filter((entry) => entry.projectId === 'p' && !entry.completedAt)) {
      expect(next.items.find((entry) => entry.id === pending.id)).toEqual({ ...pending, completedAt: completedProject.completedAt });
    }
    expect(next.items.find((entry) => entry.id === 'p-done')).toBe(state.items.find((entry) => entry.id === 'p-done'));
    expect(next.items.find((entry) => entry.id === 'q-done')).toBe(state.items.find((entry) => entry.id === 'q-done'));
    expect(next.projects[1]).toBe(state.projects[1]);
    expect(next.queue).toEqual(state.queue.filter((entry) => entry.kind !== 'project' || entry.projectId !== 'p'));
    expect(next.queue.map((entry) => entry.id)).toEqual(['q-slot', 'slot-e1', 'slot-e2', 'slot-e3', 'slot-e4']);
    expect(reprocess(next).queue).toHaveLength(next.queue.length + 1);
    expect(state).toEqual(original);
    expect(validateImport(JSON.parse(JSON.stringify(next)))).toEqual(next);
  });

  it.each([false, true])('explicitly completes a project with all steps already done = %s, including an empty project', (hasCompletedSteps) => {
    const state: AppState = {
      ...createEmptyState(),
      projects: [project('p')],
      items: [...(hasCompletedSteps ? [{ ...item('p1', 'p'), completedAt: timestamp }] : []), item('e1', null)],
      queue: [errand('e1')],
    };
    const next = updateProject(state, 'p', { status: 'completed' });
    expect(next.projects[0].status).toBe('completed');
    expect(next.projects[0].completedAt).toBeTruthy();
    expect(next.items).toEqual(state.items);
    expect(next.queue).toEqual(state.queue);
    expect(validateImport(JSON.parse(JSON.stringify(next)))).toEqual(next);
  });

  it('supports explicitly reopening or adding to a manually completed project while preserving item history', () => {
    const manuallyCompleted = updateProject(sample(), 'p', { status: 'completed' });
    const reopened = updateProject(manuallyCompleted, 'p', { status: 'active' });
    expect(reopened.projects[0]).toMatchObject({ status: 'active', completedAt: null });
    expect(reopened.items.slice(0, manuallyCompleted.items.length)).toEqual(manuallyCompleted.items);
    expect(reopened.items.at(-1)).toMatchObject({ title: '', projectId: 'p', isPlaceholder: true });
    expect(reopened.queue.slice(0, manuallyCompleted.queue.length)).toEqual(manuallyCompleted.queue);
    expect(reopened.queue.at(-1)).toMatchObject({ kind: 'project', projectId: 'p' });
    const withNewItem = addItem(manuallyCompleted, 'Another small step', 'p');
    expect(withNewItem.projects[0]).toMatchObject({ status: 'active', completedAt: null });
    expect(withNewItem.items.slice(0, manuallyCompleted.items.length)).toEqual(manuallyCompleted.items);
    expect(withNewItem.queue.slice(0, manuallyCompleted.queue.length)).toEqual(manuallyCompleted.queue);
    expect(resolveQueue(withNewItem).at(-1)?.item.title).toBe('Another small step');
    expect(manuallyCompleted.projects[0].status).toBe('completed');
    expect(validateImport(JSON.parse(JSON.stringify(reopened)))).toEqual(reopened);
    expect(validateImport(JSON.parse(JSON.stringify(withNewItem)))).toEqual(withNewItem);
  });

  it('pauses and resumes projects, and preserves unfinished steps', () => {
    const state = sample();
    const inactive = updateProject(state, 'p', { status: 'inactive' });
    expect(inactive.queue.every((entry) => entry.kind === 'errand')).toBe(true);
    expect(inactive.items).toBe(state.items);
    const active = updateProject(inactive, 'p', { status: 'active' });
    expect(active.queue.at(-1)).toMatchObject({ kind: 'project', projectId: 'p' });
    expect(resolveQueue(active).at(-1)?.item.id).toBe('p1');
  });

  it('does not insert slots when changing only project metadata', () => {
    const state = sample();
    state.queue = state.queue.filter((entry) => entry.id !== 'b' && entry.id !== 'c');
    expect(reprocess(state).queue).toHaveLength(6);
    const next = updateProject(state, 'p', { name: 'A new name', dueDate: '2026-10-12' });
    expect(next.projects[0]).toMatchObject({ name: 'A new name', dueDate: '2026-10-12' });
    expect(next.queue).toBe(state.queue);
  });

  it('keeps an empty project active after deleting its only item', () => {
    const state: AppState = { ...createEmptyState(), projects: [project('p')], items: [item('p1', 'p')], queue: [slot('a', 'p')] };
    const next = deleteItem(state, 'p1');
    expect(next.queue).toHaveLength(1);
    expect(resolveQueue(next)[0].item).toMatchObject({ title: '', isPlaceholder: true });
    expect(next.projects[0]).toMatchObject({ status: 'active', completedAt: null });
    expect(validateImport(next)).toEqual(next);
  });
});

describe('blank reminders for empty projects', () => {
  it('queues one blank after normal pacing when the last actual task completes', () => {
    const state: AppState = {
      ...createEmptyState(),
      projects: [project('p'), project('q')],
      items: [item('p1', 'p'), item('q1', 'q'), item('q2', 'q'), item('e1', null), item('e2', null), item('e3', null)],
      queue: [slot('p-slot', 'p'), slot('q-slot', 'q'), errand('e1'), errand('e2'), errand('e3')],
    };
    const next = completeCurrent(state, 330);
    const queued = resolveQueue(next);
    expect(queued.slice(0, -1).map((entry) => entry.item.id)).toEqual(['q1', 'e1', 'e2', 'e3', 'q2']);
    expect(queued.at(-1)?.item).toMatchObject({ projectId: 'p', title: '', completedAt: null, isPlaceholder: true });
    expect(queued.at(-1)?.item).not.toHaveProperty('timeSpentSeconds');
    expect(next.items.filter((entry) => entry.isPlaceholder)).toHaveLength(1);
    expect(next.items.find((entry) => entry.id === 'p1')).toMatchObject({ timeSpentSeconds: 330 });
    expect(next.projects).toBe(state.projects);
    expect(state.items.some((entry) => entry.isPlaceholder)).toBe(false);
    expect(ensureProjectPlaceholders(next)).toBe(next);
    expect(validateImport(JSON.parse(JSON.stringify(next)))).toEqual(next);
  });

  it('migrates old empty active and inactive projects, ignoring completed projects', () => {
    const state: AppState = { ...createEmptyState(), projects: [project('p'), project('q', 'inactive'), project('done', 'completed')], items: [item('e1', null)], queue: [errand('e1')] };
    expect(validateImport(state)).toEqual(state);
    const next = ensureProjectPlaceholders(state);
    expect(next.items.filter((entry) => entry.isPlaceholder).map((entry) => entry.projectId)).toEqual(['p', 'q']);
    expect(next.queue[0]).toBe(state.queue[0]);
    expect(resolveQueue(next).map((entry) => entry.item.projectId)).toEqual([null, 'p']);
    expect(ensureProjectPlaceholders(next)).toBe(next);
    expect(validateImport(JSON.parse(JSON.stringify(next)))).toEqual(next);
    const activated = updateProject(next, 'q', { status: 'active' });
    expect(resolveQueue(activated).at(-1)?.item.projectId).toBe('q');
    expect(activated.items).toBe(next.items);
  });

  it('gives new projects one blank and consumes it when adding the first task in its place', () => {
    const state = addProject(addItem(createEmptyState(), 'Already queued'), 'New project');
    const projectId = state.projects[0].id;
    const blank = state.items.find((entry) => entry.isPlaceholder)!;
    expect(resolveQueue(state).at(-1)?.item).toBe(blank);
    const next = addItem(state, 'First real step', projectId, blank.id);
    expect(next.items.some((entry) => entry.isPlaceholder)).toBe(false);
    expect(next.items.some((entry) => entry.id === blank.id)).toBe(false);
    expect(next.queue).toBe(state.queue);
    expect(resolveQueue(next).at(-1)?.item.title).toBe('First real step');
    expect(validateImport(next)).toEqual(next);
  });

  it('turns an edited blank into a task with fresh creation time and the same queue position', () => {
    const state = ensureProjectPlaceholders({ ...createEmptyState(), projects: [project('p')] });
    const blank = state.items[0];
    const created = '2030-01-02T03:04:05.000Z';
    vi.useFakeTimers();
    try {
      vi.setSystemTime(created);
      const next = renameItem(state, blank.id, '  Next step\nwith details  ');
      expect(next.items[0]).toEqual({ ...blank, title: 'Next step\nwith details', createdAt: created, isPlaceholder: undefined });
      expect(next.items[0]).not.toHaveProperty('isPlaceholder');
      expect(next.queue).toBe(state.queue);
      expect(state.items[0]).toBe(blank);
      expect(validateImport(next)).toEqual(next);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not finish, duplicate, or split the blank as if it were real work', () => {
    const state = addProject(createEmptyState(), 'Empty');
    const blank = state.items[0];
    expect(completeCurrent(state)).toBe(state);
    expect(completeCurrent(state, 30)).toBe(state);
    expect(duplicateItem(state, blank.id)).toBe(state);
    expect(takeBite(state, 'First', 'Rest')).toBe(state);
    expect(() => renameItem(state, blank.id, ' ')).toThrow(/enter a name/);
  });

  it('removes the blank when closing or deleting a project without adding false completed history', () => {
    const history = { ...item('done', 'p'), completedAt: timestamp, timeSpentSeconds: 30 };
    const state = ensureProjectPlaceholders({ ...createEmptyState(), projects: [project('p')], items: [history] });
    const closed = updateProject(state, 'p', { status: 'completed' });
    expect(closed.items).toEqual([history]);
    expect(closed.queue).toEqual([]);
    expect(closed.projects[0].status).toBe('completed');
    expect(validateImport(closed)).toEqual(closed);
    const deleted = deleteProject(state, 'p');
    expect(deleted.items).toEqual([{ ...history, projectId: null, deletedProjectName: 'p' }]);
    expect(deleted.queue).toEqual([]);
    expect(validateImport(deleted)).toEqual(deleted);
  });

  it('replaces the blank with a put-back task at the front without leaving excess project slots', () => {
    const source = { ...item('done', 'p'), completedAt: timestamp, timeSpentSeconds: 30 };
    const state = ensureProjectPlaceholders({ ...createEmptyState(), projects: [project('p')], items: [source, item('e1', null)], queue: [errand('e1')] });
    const restored = putBackItem(state, source.id);
    expect(resolveQueue(restored).map((entry) => entry.item.id)).toEqual(['done', 'e1']);
    expect(restored.items.some((entry) => entry.isPlaceholder)).toBe(false);
    expect(restored.items.find((entry) => entry.id === source.id)).not.toHaveProperty('timeSpentSeconds');
    expect(validateImport(restored)).toEqual(restored);
    const completedAgain = completeCurrent(restored);
    expect(resolveQueue(completedAgain).at(-1)?.item.isPlaceholder).toBe(true);
    expect(completedAgain.items.filter((entry) => entry.isPlaceholder)).toHaveLength(1);
  });

  it('duplicates completed project work into its blank slot and keeps completed errands absolutely last', () => {
    const source = { ...item('done', 'p'), completedAt: timestamp };
    const state = ensureProjectPlaceholders({ ...createEmptyState(), projects: [project('p')], items: [source, item('e1', null)], queue: [errand('e1')] });
    const copied = duplicateItem(state, source.id);
    expect(copied.items.some((entry) => entry.isPlaceholder)).toBe(false);
    expect(copied.items[0]).toBe(source);
    expect(resolveQueue(copied).at(-1)?.item).toMatchObject({ title: 'done', projectId: 'p', completedAt: null });
    expect(copied.queue).toBe(state.queue);
    const oldState: AppState = { ...createEmptyState(), projects: [project('p')], items: [{ ...item('old', null), completedAt: timestamp }] };
    const errandCopy = duplicateItem(oldState, 'old');
    expect(resolveQueue(errandCopy)[0].item.isPlaceholder).toBe(true);
    expect(resolveQueue(errandCopy).at(-1)?.item).toMatchObject({ title: 'old', projectId: null, completedAt: null });
    expect(validateImport(errandCopy)).toEqual(errandCopy);
  });

  it('rejects malformed, completed, orphaned, duplicate, or coexisting placeholder items in backups', () => {
    const state = addProject(createEmptyState(), 'Empty');
    const blank = state.items[0];
    for (const patch of [
      { title: 'Not blank' }, { title: ' ' }, { completedAt: timestamp },
      { projectId: null }, { projectId: 'missing' }, { deletedProjectName: 'Deleted' },
      { timeSpentSeconds: 0 }, { isPlaceholder: false }, { isPlaceholder: 1 },
    ]) {
      expect(() => validateImport({ ...state, items: [{ ...blank, ...patch }] })).toThrow(/Invalid backup/);
    }
    expect(() => validateImport({ ...state, items: [blank, { ...blank, id: 'second-blank' }] })).toThrow(/only unfinished item/);
    expect(() => validateImport({ ...state, items: [blank, item('real', blank.projectId)] })).toThrow(/only unfinished item/);
    expect(() => validateImport({ ...state, items: [{ ...blank, isPlaceholder: undefined }] })).toThrow(/item title/);
    expect(exportCsv(state, 'items')).toContain('"Placeholder"');
    expect(exportCsv(state, 'completed').split('\r\n')).toHaveLength(1);
  });
});

describe('recording task time', () => {
  it.each([0, 300, 330, Number.MAX_SAFE_INTEGER])('records %s elapsed seconds on only the completed item', (seconds) => {
    const state = sample();
    const original = structuredClone(state);
    const next = completeCurrent(state, seconds);
    expect(next.items[0]).toMatchObject({ id: 'p1', timeSpentSeconds: seconds });
    expect(next.items[0].completedAt).toBeTruthy();
    expect(next.items.slice(1)).toEqual(state.items.slice(1));
    expect(next.queue.map((entry) => entry.id)).toEqual(['slot-e1', 'slot-e2', 'b', 'slot-e3', 'slot-e4', 'c']);
    expect(next.projects).toBe(state.projects);
    expect(state).toEqual(original);
    expect(validateImport(JSON.parse(JSON.stringify(next)))).toEqual(next);
  });

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, null, '300'])('rejects invalid elapsed seconds %s', (seconds) => {
    const state = sample();
    const original = structuredClone(state);
    expect(() => completeCurrent(state, seconds as number)).toThrow(/Time spent/);
    expect(state).toEqual(original);
  });

  it('completes without recording time when it is omitted, clearing any stale value', () => {
    const state = sample();
    // Defensively discard a stale value even if a caller supplies an invalid
    // in-memory active item rather than a validated backup.
    state.items[0].timeSpentSeconds = 330;
    const next = completeCurrent(state);
    expect(next.items[0].completedAt).toBeTruthy();
    expect(next.items[0]).not.toHaveProperty('timeSpentSeconds');
    expect(state.items[0].timeSpentSeconds).toBe(330);
    expect(validateImport(JSON.parse(JSON.stringify(next)))).toEqual(next);
  });

  it.each([false, true])('clears saved time on put back, including deleted-project history = %s', (deleteParent) => {
    const completed = completeCurrent(sample(), 330);
    const history = deleteParent ? deleteProject(completed, 'p') : completed;
    const restored = putBackItem(history, 'p1');
    const current = resolveQueue(restored)[0].item;
    expect(current.id).toBe('p1');
    expect(current.completedAt).toBeNull();
    expect(current).not.toHaveProperty('timeSpentSeconds');
    expect(history.items.find((entry) => entry.id === 'p1')?.timeSpentSeconds).toBe(330);
    expect(validateImport(JSON.parse(JSON.stringify(restored)))).toEqual(restored);
    expect(completeCurrent(restored).items.find((entry) => entry.id === 'p1')).not.toHaveProperty('timeSpentSeconds');
    expect(completeCurrent(restored, 45).items.find((entry) => entry.id === 'p1')?.timeSpentSeconds).toBe(45);
  });

  it('preserves recorded time when renaming, completing the parent, or deleting the project', () => {
    const completed = completeCurrent(sample(), 330);
    const renamed = renameItem(completed, 'p1', 'Finished step');
    const completedProject = updateProject(renamed, 'p', { status: 'completed' });
    const deleted = deleteProject(completedProject, 'p');
    for (const state of [renamed, completedProject, deleted]) {
      expect(state.items.find((entry) => entry.id === 'p1')).toMatchObject({ title: 'Finished step', timeSpentSeconds: 330 });
      expect(validateImport(JSON.parse(JSON.stringify(state)))).toEqual(state);
    }
    expect(deleted.items[0]).toMatchObject({ projectId: null, deletedProjectName: 'p' });
    expect(completedProject.items.filter((entry) => entry.id !== 'p1').every((entry) => entry.timeSpentSeconds === undefined)).toBe(true);
  });

  it.each([false, true])('does not copy recorded time into a duplicate with errand source = %s', (isErrand) => {
    const source = isErrand ? addItem(createEmptyState(), 'An errand') : sample();
    const completed = completeCurrent(source, 330);
    const completedId = source.items[0].id;
    const duplicated = duplicateItem(completed, completedId);
    const copy = duplicated.items.find((entry) => !completed.items.some((old) => old.id === entry.id))!;
    expect(copy.completedAt).toBeNull();
    expect(copy).not.toHaveProperty('timeSpentSeconds');
    expect(duplicated.items.find((entry) => entry.id === completedId)?.timeSpentSeconds).toBe(330);
    expect(validateImport(JSON.parse(JSON.stringify(duplicated)))).toEqual(duplicated);
  });

  it('keeps new items and bite remainders untimed while retaining completed history', () => {
    const completed = completeCurrent(sample(), 330);
    const added = addItem(completed, 'A new step', 'p');
    const split = takeBite(added, 'First bite', 'Remainder');
    expect(split.items.find((entry) => entry.id === 'p1')?.timeSpentSeconds).toBe(330);
    expect(split.items.filter((entry) => !entry.completedAt).every((entry) => !Object.hasOwn(entry, 'timeSpentSeconds'))).toBe(true);
    expect(validateImport(JSON.parse(JSON.stringify(split)))).toEqual(split);
  });
});

describe('putting completed items back', () => {
  it('restores a later project step to the front while keeping all existing queue contents and slots in order', () => {
    const state = sample();
    state.items[2] = { ...state.items[2], completedAt: timestamp };
    state.projects.push(project('q'));
    state.items.push(item('q1', 'q'), item('q2', 'q'), { ...item('other-done', null), completedAt: timestamp });
    state.queue.splice(1, 0, slot('q-slot', 'q'));
    const source = state.items[2];
    const original = structuredClone(state);
    const originalOrder = resolveQueue(state).map((entry) => entry.item.id);
    const next = putBackItem(state, source.id);

    expect(next.items).toHaveLength(state.items.length);
    expect(next.items.filter((entry) => entry.id === source.id)).toEqual([{ ...source, completedAt: null }]);
    expect(next.items.filter((entry) => entry.projectId === 'p').map((entry) => entry.id)).toEqual(['p3', 'p1', 'p2', 'p4']);
    expect(resolveQueue(next).map((entry) => entry.item.id)).toEqual([source.id, ...originalOrder]);
    expect(next.queue.slice(1)).toEqual(state.queue);
    expect(next.queue[1]).toBe(state.queue[0]);
    expect(next.queue[0]).toMatchObject({ kind: 'project', projectId: 'p' });
    expect(state.queue.some((entry) => entry.id === next.queue[0].id)).toBe(false);
    expect(next.items.find((entry) => entry.id === 'other-done')).toBe(state.items.at(-1));
    // The unrelated q project is eligible, but restoring must not append it.
    expect(reprocess(next).queue).toHaveLength(next.queue.length + 1);
    expect(next.projects).toBe(state.projects);
    expect(state).toEqual(original);
    expect(validateImport(JSON.parse(JSON.stringify(next)))).toEqual(next);
  });

  it('restores an errand with the same identity and a fresh dedicated slot at the front', () => {
    const state = sample();
    const source = { ...item('errand-done', null), completedAt: timestamp };
    state.items.push(source);
    const original = structuredClone(state);
    const next = putBackItem(state, source.id);

    expect(resolveQueue(next)[0].item).toEqual({ ...source, completedAt: null });
    expect(next.queue[0]).toMatchObject({ kind: 'errand', itemId: source.id });
    expect(next.queue.slice(1)).toEqual(state.queue);
    expect(next.items.map((entry) => entry.id)).toEqual(state.items.map((entry) => entry.id));
    expect(next.items).toHaveLength(state.items.length);
    expect(next.projects).toBe(state.projects);
    expect(state).toEqual(original);
    expect(validateImport(JSON.parse(JSON.stringify(next)))).toEqual(next);
  });

  it.each(['completed', 'inactive'] as const)('activates a %s parent and puts its restored step ahead of existing work', (status) => {
    const state: AppState = {
      ...createEmptyState(),
      projects: [project('p', status)],
      items: [
        { ...item('p1', 'p'), completedAt: status === 'completed' ? timestamp : null },
        { ...item('p2', 'p'), completedAt: timestamp },
        { ...item('p3', 'p'), completedAt: timestamp },
        item('e1', null),
      ],
      queue: [errand('e1')],
    };
    const original = structuredClone(state);
    const next = putBackItem(state, 'p2');
    expect(next.projects[0]).toEqual({ ...state.projects[0], status: 'active', completedAt: null });
    expect(resolveQueue(next).map((entry) => entry.item.id)).toEqual(['p2', 'e1']);
    expect(next.items.find((entry) => entry.id === 'p3')).toBe(state.items[2]);
    expect(next.items.find((entry) => entry.id === 'p1')?.completedAt).toBe(state.items[0].completedAt);
    expect(next.queue.slice(1)).toEqual(state.queue);
    expect(state).toEqual(original);
    expect(validateImport(JSON.parse(JSON.stringify(next)))).toEqual(next);
  });

  it('restores multiple completed steps from the same project in last-restored-first order', () => {
    const state = sample();
    state.items = state.items.map((entry) => ['p2', 'p3'].includes(entry.id) ? { ...entry, completedAt: timestamp } : entry);
    state.queue = state.queue.filter((entry) => entry.id !== 'c');
    const existingOrder = resolveQueue(state).map((entry) => entry.item.id);
    const first = putBackItem(state, 'p2');
    const second = putBackItem(first, 'p3');
    expect(resolveQueue(second).map((entry) => entry.item.id)).toEqual(['p3', 'p2', ...existingOrder]);
    expect(second.queue.slice(1)).toEqual(first.queue);
    expect(second.queue.slice(2)).toEqual(state.queue);
    expect(new Set(second.queue.map((entry) => entry.id)).size).toBe(second.queue.length);
    expect(second.items).toHaveLength(state.items.length);
    expect(putBackItem(second, 'p2')).toBe(second);
    expect(validateImport(JSON.parse(JSON.stringify(second)))).toEqual(second);
  });

  it('completes a restored item normally without losing any original queue slot', () => {
    const state = sample();
    state.items[2] = { ...state.items[2], completedAt: timestamp };
    const restored = putBackItem(state, 'p3');
    const completed = completeCurrent(restored);
    expect(completed.items.find((entry) => entry.id === 'p3')?.completedAt).toBeTruthy();
    expect(completed.items).toHaveLength(state.items.length);
    expect(completed.queue).toEqual(state.queue);
    expect(resolveQueue(completed).map((entry) => entry.item.id)).toEqual(resolveQueue(state).map((entry) => entry.item.id));
    const again = putBackItem(completed, 'p3');
    expect(resolveQueue(again)[0].item.id).toBe('p3');
    expect(again.queue.slice(1)).toEqual(state.queue);
    expect(again.queue[0].id).not.toBe(restored.queue[0].id);
    expect(validateImport(JSON.parse(JSON.stringify(again)))).toEqual(again);
  });

  it('keeps a reopened project active after completing its restored final step', () => {
    const state: AppState = {
      ...createEmptyState(),
      projects: [project('p', 'completed')],
      items: [{ ...item('p1', 'p'), completedAt: timestamp }, item('e1', null)],
      queue: [errand('e1')],
    };
    const completed = completeCurrent(putBackItem(state, 'p1'));
    expect(completed.projects[0]).toMatchObject({ status: 'active', completedAt: null });
    expect(completed.items[0].completedAt).toBeTruthy();
    expect(completed.queue.slice(0, state.queue.length)).toEqual(state.queue);
    expect(resolveQueue(completed)[0].item.id).toBe('e1');
    expect(resolveQueue(completed).at(-1)?.item).toMatchObject({ projectId: 'p', title: '', isPlaceholder: true });
    expect(validateImport(JSON.parse(JSON.stringify(completed)))).toEqual(completed);
  });

  it('returns the original state for missing or already unfinished items', () => {
    const state = sample();
    expect(putBackItem(state, 'missing')).toBe(state);
    expect(putBackItem(state, 'p1')).toBe(state);
    expect(putBackItem(state, 'e1')).toBe(state);
  });
});

describe('deleting completed items', () => {
  it.each([
    ['an active project', 'p-done'],
    ['a manually completed project', 'completed-done'],
    ['a deleted project', 'former-done'],
    ['an errand', 'errand-done'],
  ])('removes only the completed history entry from %s', (_kind, targetId) => {
    const state = sample();
    state.projects.push(project('completed', 'completed'), project('upcoming', 'inactive'));
    state.items.push(
      { ...item('p-done', 'p'), completedAt: timestamp },
      { ...item('completed-done', 'completed'), completedAt: timestamp },
      item('upcoming-step', 'upcoming'),
      { ...item('upcoming-done', 'upcoming'), completedAt: timestamp },
      { ...item('former-done', null), completedAt: timestamp, deletedProjectName: 'An earlier project' },
      { ...item('errand-done', null), completedAt: timestamp },
    );
    state.queue = state.queue.filter((entry) => entry.id !== 'b' && entry.id !== 'c');
    const original = structuredClone(state);
    expect(validateImport(JSON.parse(JSON.stringify(state)))).toEqual(state);
    const next = deleteItem(state, targetId);

    expect(next.items).toEqual(state.items.filter((entry) => entry.id !== targetId));
    expect(next.items).toHaveLength(state.items.length - 1);
    for (const entry of next.items) expect(entry).toBe(state.items.find((old) => old.id === entry.id));
    expect(next.items.filter((entry) => entry.completedAt)).toEqual(state.items.filter((entry) => entry.completedAt && entry.id !== targetId));
    expect(next.projects).toBe(state.projects);
    expect(next.projects.find((entry) => entry.id === 'completed')).toMatchObject({ status: 'completed', completedAt: timestamp });
    expect(next.queue).toEqual(state.queue);
    next.queue.forEach((entry, index) => expect(entry).toBe(state.queue[index]));
    expect(resolveQueue(next).map((entry) => entry.item.id)).toEqual(resolveQueue(state).map((entry) => entry.item.id));
    // The active project could gain a slot, but history deletion must not
    // reprocess it or change what the user will see next.
    expect(reprocess(next).queue).toHaveLength(next.queue.length + 1);
    expect(next.profile).toBe(state.profile);
    expect(next.settings).toBe(state.settings);
    expect(state).toEqual(original);
    expect(validateImport(JSON.parse(JSON.stringify(next)))).toEqual(next);
  });
});

describe('deleting projects', () => {
  it('removes unfinished steps and slots while keeping completed history and other queue entries', () => {
    const state = sample();
    state.projects[0].name = 'Sunday dinner';
    state.projects.push(project('q'));
    state.items.push(
      { ...item('p-done', 'p'), completedAt: timestamp },
      item('q1', 'q'),
      item('q2', 'q'),
      { ...item('q-done', 'q'), completedAt: timestamp },
      { ...item('errand-done', null), completedAt: timestamp },
    );
    state.queue.splice(1, 0, slot('q-slot', 'q'));
    const original = structuredClone(state);
    const next = deleteProject(state, 'p');

    expect(next.projects).toEqual([state.projects[1]]);
    expect(next.items.map((entry) => entry.id)).toEqual(['e1', 'e2', 'e3', 'e4', 'p-done', 'q1', 'q2', 'q-done', 'errand-done']);
    expect(next.items.find((entry) => entry.id === 'p-done')).toEqual({ ...state.items.find((entry) => entry.id === 'p-done'), projectId: null, deletedProjectName: 'Sunday dinner' });
    expect(next.items.find((entry) => entry.id === 'q-done')).toBe(state.items.find((entry) => entry.id === 'q-done'));
    expect(next.items.find((entry) => entry.id === 'errand-done')).toBe(state.items.find((entry) => entry.id === 'errand-done'));
    expect(next.queue.map((entry) => entry.id)).toEqual(['q-slot', 'slot-e1', 'slot-e2', 'slot-e3', 'slot-e4']);
    expect(resolveQueue(next).map((entry) => entry.item.id)).toEqual(['q1', 'e1', 'e2', 'e3', 'e4']);
    // Project q qualifies for insertion after removal, but deletion must not
    // trigger that pass or append q2 to its preserved queue.
    expect(reprocess(next).queue).toHaveLength(next.queue.length + 1);
    expect(next.queue).toHaveLength(5);
    expect(next.profile).toBe(state.profile);
    expect(next.settings).toBe(state.settings);
    expect(next.projects[0]).toBe(state.projects[1]);
    expect(next.queue[0]).toBe(state.queue[1]);
    expect(state).toEqual(original);
    expect(validateImport(JSON.parse(JSON.stringify(next)))).toEqual(next);
  });

  it.each(['inactive', 'completed'] as const)('deletes an %s project but keeps its completed items without touching the active queue', (status) => {
    const state = sample();
    state.projects.push(project('removed', status));
    state.items.push({ ...item('removed-1', 'removed'), completedAt: status === 'completed' ? timestamp : null });
    state.items.push({ ...item('removed-done', 'removed'), completedAt: timestamp });
    const original = structuredClone(state);
    const next = deleteProject(state, 'removed');
    expect(next.projects).toEqual([state.projects[0]]);
    const keptHistory = state.items.filter((entry) => entry.projectId === 'removed' && entry.completedAt)
      .map((entry) => ({ ...entry, projectId: null, deletedProjectName: 'removed' }));
    expect(next.items).toEqual([...sample().items, ...keptHistory]);
    expect(next.queue).toEqual(state.queue);
    expect(state).toEqual(original);
    expect(validateImport(JSON.parse(JSON.stringify(next)))).toEqual(next);
  });

  it('restores retained history as an errand and safely completes it again', () => {
    const state: AppState = {
      ...createEmptyState(),
      projects: [{ ...project('p'), name: 'A finished chapter' }],
      items: [item('p1', 'p'), { ...item('p-done', 'p'), completedAt: timestamp }, item('e1', null)],
      queue: [slot('p-slot', 'p'), errand('e1')],
    };
    const deleted = deleteProject(state, 'p');
    const retained = deleted.items.find((entry) => entry.id === 'p-done')!;
    expect(retained).toEqual({ ...state.items[1], projectId: null, deletedProjectName: 'A finished chapter' });
    expect(resolveQueue(deleted).map((entry) => entry.item.id)).toEqual(['e1']);
    const restored = putBackItem(deleted, retained.id);
    expect(resolveQueue(restored)[0]).toMatchObject({ item: { ...retained, completedAt: null }, project: null, slot: { kind: 'errand', itemId: retained.id } });
    expect(restored.queue.slice(1)).toEqual(deleted.queue);
    expect(restored.projects).toHaveLength(0);
    expect(validateImport(JSON.parse(JSON.stringify(restored)))).toEqual(restored);
    const completed = completeCurrent(restored);
    expect(completed.items.find((entry) => entry.id === retained.id)).toMatchObject({ id: retained.id, title: retained.title, createdAt: retained.createdAt, projectId: null, deletedProjectName: 'A finished chapter' });
    expect(completed.items.find((entry) => entry.id === retained.id)?.completedAt).toBeTruthy();
    expect(completed.queue).toEqual(deleted.queue);
    expect(completed.projects).toHaveLength(0);
    expect(validateImport(JSON.parse(JSON.stringify(completed)))).toEqual(completed);
  });

  it('duplicates retained history as a new unfinished errand without changing the archived original', () => {
    const state: AppState = {
      ...createEmptyState(),
      projects: [project('p', 'completed')],
      items: [{ ...item('p-done', 'p'), completedAt: timestamp }, item('e1', null)],
      queue: [errand('e1')],
    };
    const deleted = deleteProject(state, 'p');
    const original = deleted.items[0];
    const duplicated = duplicateItem(deleted, original.id);
    const copy = duplicated.items.at(-1)!;
    expect(copy).toMatchObject({ title: original.title, projectId: null, completedAt: null });
    expect(copy.id).not.toBe(original.id);
    expect(copy.deletedProjectName).toBeUndefined();
    expect(duplicated.items[0]).toBe(original);
    expect(original.completedAt).toBe(timestamp);
    expect(duplicated.queue.slice(0, deleted.queue.length)).toEqual(deleted.queue);
    expect(duplicated.queue.at(-1)).toMatchObject({ kind: 'errand', itemId: copy.id });
    expect(duplicated.projects).toHaveLength(0);
    expect(validateImport(JSON.parse(JSON.stringify(duplicated)))).toEqual(duplicated);
  });

  it('keeps the former project label in CSV exports and escapes formula-like labels', () => {
    const state: AppState = {
      ...createEmptyState(),
      projects: [{ ...project('p', 'completed'), name: '=HYPERLINK("old project")' }],
      items: [{ ...item('p-done', 'p'), completedAt: timestamp }],
    };
    const deleted = deleteProject(state, 'p');
    for (const list of ['completed', 'items'] as const) {
      expect(exportCsv(deleted, list)).toContain('"p-done","\'=HYPERLINK(""old project"")","Completed"');
    }
    expect(exportCsv(putBackItem(deleted, 'p-done'), 'queue')).toContain('"p-done","\'=HYPERLINK(""old project"")","Active"');
  });

  it('deletes an empty project and leaves an importable empty workspace', () => {
    const state: AppState = { ...createEmptyState(), projects: [project('empty')] };
    const next = deleteProject(state, 'empty');
    expect(next).toEqual(createEmptyState());
    expect(state.projects).toEqual([project('empty')]);
    expect(validateImport(JSON.parse(JSON.stringify(next)))).toEqual(next);
  });

  it('returns the original state when the project does not exist', () => {
    const state = sample();
    expect(deleteProject(state, 'missing')).toBe(state);
  });
});

describe('taking a bite', () => {
  it('reproduces spreadsheet slots 1, 4, 7 and displaces the last active step', () => {
    const state = sample();
    const after = takeBite(state, 'A small first bite', 'The next bite');
    expect(after.queue).toBe(state.queue);
    expect(resolveQueue(after).map((entry) => entry.item.title)).toEqual(['A small first bite', 'e1', 'e2', 'The next bite', 'e3', 'e4', 'p2']);
    expect(after.items.filter((entry) => entry.projectId === 'p').map((entry) => entry.title)).toEqual(['A small first bite', 'The next bite', 'p2', 'p3', 'p4']);
    expect(after.items.every((entry) => entry.completedAt === null)).toBe(true);
    expect(after.projects).toBe(state.projects);
    expect(state.items[0].title).toBe('p1');
  });

  it('does not run reprocess even when a project would qualify for insertion', () => {
    const state = sample();
    state.queue = state.queue.filter((entry) => entry.id !== 'b' && entry.id !== 'c');
    expect(reprocess(state).queue).toHaveLength(6);
    expect(takeBite(state, 'First', 'Second').queue).toBe(state.queue);
  });

  it('keeps the first errand bite in place and appends the remainder to the bottom', () => {
    const state = addItem(addItem(createEmptyState(), 'Clean the kitchen'), 'Water the plants');
    const after = takeBite(state, 'Clear the counter', 'Wash the dishes');
    expect(resolveQueue(after).map((entry) => entry.item.title)).toEqual(['Clear the counter', 'Water the plants', 'Wash the dishes']);
    expect(after.queue.slice(0, state.queue.length)).toEqual(state.queue);
    expect(after.items.every((entry) => entry.completedAt === null)).toBe(true);
    expect(validateImport(after)).toEqual(after);
  });
});

describe('adding and editing', () => {
  it('creates named projects, inserts sibling steps, and appends errands', () => {
    let state = addProject(createEmptyState(), '  A small project  ');
    const projectId = state.projects[0].id;
    expect(state.projects[0].name).toBe('A small project');
    state = addItem(state, 'First', projectId);
    const firstId = state.items[0].id;
    state = addItem(state, 'Third', projectId);
    state = addItem(state, 'Second', projectId, firstId);
    expect(state.items.map((entry) => entry.title)).toEqual(['First', 'Second', 'Third']);
    const previousQueue = state.queue;
    state = addItem(state, 'An errand');
    expect(state.queue.slice(0, previousQueue.length)).toEqual(previousQueue);
    expect(resolveQueue(state)[1].item.title).toBe('An errand');
    expect(validateImport(state)).toEqual(state);
  });

  it('renames immutably and rejects blank edits', () => {
    const state = sample();
    expect(renameItem(state, 'p1', '  New title  ').items[0].title).toBe('New title');
    expect(state.items[0].title).toBe('p1');
    expect(() => renameItem(state, 'p1', '  ')).toThrow();
    expect(() => takeBite(state, 'A bite', '')).toThrow();
    expect(() => addProject(state, '')).toThrow();
  });
});

describe('duplicating items', () => {
  it('inserts an independent unfinished copy immediately after the source project step', () => {
    const state = sample();
    const original = structuredClone(state);
    const before = Date.now();
    const next = duplicateItem(state, 'p2');
    const copy = next.items.find((entry) => !state.items.some((old) => old.id === entry.id))!;

    expect(copy).toMatchObject({ title: 'p2', projectId: 'p', completedAt: null });
    expect(copy.id).not.toBe('p2');
    expect(new Set(next.items.map((entry) => entry.id)).size).toBe(next.items.length);
    expect(Date.parse(copy.createdAt)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(copy.createdAt)).toBeLessThanOrEqual(Date.now());
    expect(next.items.filter((entry) => entry.projectId === 'p').map((entry) => entry.id)).toEqual(['p1', 'p2', copy.id, 'p3', 'p4']);
    expect(next.queue).toEqual(state.queue);
    expect(resolveQueue(next).map((entry) => entry.item.id)).toEqual(['p1', 'e1', 'e2', 'p2', 'e3', 'e4', copy.id]);
    const renamed = renameItem(next, copy.id, 'A separate copy');
    expect(renamed.items.find((entry) => entry.id === 'p2')?.title).toBe('p2');
    expect(next.items.find((entry) => entry.id === 'p2')).toBe(state.items[1]);
    expect(state).toEqual(original);
    expect(validateImport(JSON.parse(JSON.stringify(next)))).toEqual(next);
  });

  it('runs normal insertion when the project is ready for another placeholder', () => {
    const state = sample();
    state.queue = state.queue.filter((entry) => entry.id !== 'b' && entry.id !== 'c');
    const next = duplicateItem(state, 'p1');
    expect(next.queue).toHaveLength(state.queue.length + 1);
    expect(next.queue.slice(0, state.queue.length)).toEqual(state.queue);
    expect(next.queue.at(-1)).toMatchObject({ kind: 'project', projectId: 'p' });
    expect(resolveQueue(next).at(-1)?.item.title).toBe('p1');
    expect(resolveQueue(next).at(-1)?.item.id).not.toBe('p1');
  });

  it.each([false, true])('keeps an upcoming project inactive when its copied step is completed = %s', (completed) => {
    const state: AppState = {
      ...createEmptyState(),
      projects: [project('p', 'inactive')],
      items: [{ ...item('p1', 'p'), completedAt: completed ? timestamp : null }, item('p2', 'p')],
    };
    const next = duplicateItem(state, 'p1');
    expect(next.projects).toBe(state.projects);
    expect(next.projects[0].status).toBe('inactive');
    expect(next.items.map((entry) => entry.title)).toEqual(completed ? ['p1', 'p2', 'p1'] : ['p1', 'p1', 'p2']);
    const copy = next.items.find((entry) => !state.items.some((old) => old.id === entry.id))!;
    expect(copy.completedAt).toBeNull();
    expect(next.items[0]).toBe(state.items[0]);
    expect(next.queue).toHaveLength(0);
    expect(validateImport(JSON.parse(JSON.stringify(next)))).toEqual(next);
  });

  it('appends a completed project step after every remaining step while preserving its history', () => {
    const state = sample();
    state.items[0] = { ...state.items[0], completedAt: timestamp, timeSpentSeconds: 330 };
    const original = structuredClone(state);
    const before = Date.now();
    const next = duplicateItem(state, 'p1');
    const copy = next.items.at(-1)!;
    expect(copy).toMatchObject({ title: 'p1', projectId: 'p', completedAt: null });
    expect(copy.id).not.toBe('p1');
    expect(Date.parse(copy.createdAt)).toBeGreaterThanOrEqual(before);
    expect(copy).not.toHaveProperty('timeSpentSeconds');
    expect(copy).not.toHaveProperty('deletedProjectName');
    expect(next.items.filter((entry) => entry.projectId === 'p').map((entry) => entry.id)).toEqual(['p1', 'p2', 'p3', 'p4', copy.id]);
    expect(next.items[0]).toBe(state.items[0]);
    expect(next.queue).toEqual(state.queue);
    expect(resolveQueue(next).map((entry) => entry.item.id)).toEqual(['p2', 'e1', 'e2', 'p3', 'e3', 'e4', 'p4']);
    expect(state).toEqual(original);
    expect(validateImport(JSON.parse(JSON.stringify(next)))).toEqual(next);
  });

  it('reopens a completed project and keeps every original completion record', () => {
    const state: AppState = {
      ...createEmptyState(),
      projects: [project('p', 'completed')],
      items: [{ ...item('p1', 'p'), completedAt: timestamp }, { ...item('p2', 'p'), completedAt: timestamp }, item('e1', null)],
      queue: [errand('e1')],
    };
    const original = structuredClone(state);
    const next = duplicateItem(state, 'p1');
    const copy = next.items.at(-1)!;
    expect(copy).toMatchObject({ title: 'p1', projectId: 'p', completedAt: null });
    expect(copy.id).not.toBe('p1');
    expect(next.items.map((entry) => entry.id)).toEqual(['p1', 'p2', 'e1', copy.id]);
    expect(next.items.filter((entry) => entry.completedAt)).toEqual(state.items.filter((entry) => entry.completedAt));
    expect(next.projects[0]).toMatchObject({ status: 'active', completedAt: null });
    expect(resolveQueue(next).map((entry) => entry.item.id)).toEqual(['e1', copy.id]);
    expect(state).toEqual(original);
    expect(validateImport(JSON.parse(JSON.stringify(next)))).toEqual(next);
  });

  it.each([false, true])('appends an errand copy to the queue with completed source = %s', (completed) => {
    const source: Item = { ...item('e1', null), completedAt: completed ? timestamp : null };
    const state: AppState = {
      ...createEmptyState(),
      items: [source, item('e2', null)],
      queue: [...(completed ? [] : [errand('e1')]), errand('e2')],
    };
    const original = structuredClone(state);
    const next = duplicateItem(state, source.id);
    const copy = next.items.at(-1)!;
    expect(copy).toMatchObject({ title: source.title, projectId: null, completedAt: null });
    expect(copy.id).not.toBe(source.id);
    expect(copy.createdAt).not.toBe(source.createdAt);
    expect(next.items[0]).toBe(source);
    expect(next.queue.slice(0, state.queue.length)).toEqual(state.queue);
    expect(next.queue.at(-1)).toMatchObject({ kind: 'errand', itemId: copy.id });
    expect(resolveQueue(next).at(-1)?.item.id).toBe(copy.id);
    expect(state).toEqual(original);
    expect(validateImport(JSON.parse(JSON.stringify(next)))).toEqual(next);
  });

  it.each([false, true])('keeps a completed copy last when project placeholders expand, with deleted project history = %s', (deletedProject) => {
    let state = sample();
    state.queue = state.queue.filter((entry) => entry.id !== 'b' && entry.id !== 'c');
    state.items.push({ ...item('finished', deletedProject ? 'old-project' : null), completedAt: timestamp, timeSpentSeconds: 330 });
    if (deletedProject) {
      state.projects.push(project('old-project', 'completed'));
      state = deleteProject(state, 'old-project');
    }
    const original = structuredClone(state);
    const source = state.items.at(-1)!;
    const before = Date.now();
    const next = duplicateItem(state, source.id);
    const copy = next.items.at(-1)!;
    expect(copy).toMatchObject({ title: source.title, projectId: null, completedAt: null });
    expect(copy.id).not.toBe(source.id);
    expect(Date.parse(copy.createdAt)).toBeGreaterThanOrEqual(before);
    expect(copy).not.toHaveProperty('timeSpentSeconds');
    expect(copy).not.toHaveProperty('deletedProjectName');
    expect(next.items.find((entry) => entry.id === source.id)).toBe(source);
    expect(next.queue.slice(0, state.queue.length)).toEqual(state.queue);
    expect(next.queue.at(-2)).toMatchObject({ kind: 'project', projectId: 'p' });
    expect(next.queue.at(-1)).toMatchObject({ kind: 'errand', itemId: copy.id });
    expect(resolveQueue(next).map((entry) => entry.item.id)).toEqual(['p1', 'e1', 'e2', 'e3', 'e4', 'p2', copy.id]);
    expect(state).toEqual(original);
    expect(validateImport(JSON.parse(JSON.stringify(next)))).toEqual(next);
  });

  it('returns the original state for a missing item', () => {
    const state = sample();
    expect(duplicateItem(state, 'missing')).toBe(state);
  });
});

describe('backup validation and CSV safety', () => {
  it('hides the master list by default in both an empty and demo workspace', () => {
    expect(createEmptyState().settings.showMasterList).toBe(false);
    expect(createDemoState().settings.showMasterList).toBe(false);
    expect(createDemoState().profile.name).toBe('Lionel');
  });

  it('round trips demo and empty states without changing their content', () => {
    for (const state of [createEmptyState(), createDemoState(), sample()]) {
      expect(validateImport(JSON.parse(JSON.stringify(state)))).toEqual(state);
    }
  });

  it('keeps older completed backups untimed and round trips optional task time', () => {
    const oldState = completeCurrent(sample());
    const oldRestored = validateImport(JSON.parse(JSON.stringify(oldState)));
    expect(oldRestored).toEqual(oldState);
    expect(oldRestored.items.every((entry) => !Object.hasOwn(entry, 'timeSpentSeconds'))).toBe(true);
    const timed = completeCurrent(completeCurrent(oldState, 0), 330);
    const restored = validateImport(JSON.parse(JSON.stringify(timed)));
    expect(restored).toEqual(timed);
    expect(restored.items.find((entry) => entry.id === 'p1')).not.toHaveProperty('timeSpentSeconds');
    expect(restored.items.find((entry) => entry.id === 'e1')?.timeSpentSeconds).toBe(0);
    expect(restored.items.find((entry) => entry.id === 'e2')?.timeSpentSeconds).toBe(330);
  });

  it('rejects malformed recorded time and recorded time on unfinished items', () => {
    const state = completeCurrent(sample(), 330);
    for (const timeSpentSeconds of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, null, '330', true, []]) {
      expect(() => validateImport({ ...state, items: state.items.map((entry, index) => index === 0 ? { ...entry, timeSpentSeconds } : entry) })).toThrow(/item time spent/);
    }
    for (const timeSpentSeconds of [0, 330]) {
      const active = sample();
      active.items[0].timeSpentSeconds = timeSpentSeconds;
      expect(() => validateImport(active)).toThrow(/only completed items/);
    }
  });

  it('exports seconds for timed completions and empty cells for untimed items without changing project CSVs', () => {
    const state: AppState = {
      ...createEmptyState(),
      projects: [project('p')],
      items: [
        { ...item('timed', 'p'), completedAt: timestamp, timeSpentSeconds: 330 },
        { ...item('zero', 'p'), completedAt: timestamp, timeSpentSeconds: 0 },
        { ...item('untimed', 'p'), completedAt: timestamp },
        item('pending', 'p'),
      ],
      queue: [slot('p-slot', 'p')],
    };
    const header = '"Title","Project","Status","Created at","Completed at","Time spent (seconds)"';
    const completedRows = [
      `"timed","p","Completed","${timestamp}","${timestamp}","330"`,
      `"zero","p","Completed","${timestamp}","${timestamp}","0"`,
      `"untimed","p","Completed","${timestamp}","${timestamp}",""`,
    ];
    const pendingRow = `"pending","p","Active","${timestamp}","",""`;
    expect(exportCsv(state, 'completed')).toBe([header, ...completedRows].join('\r\n'));
    expect(exportCsv(state, 'items')).toBe([header, ...completedRows, pendingRow].join('\r\n'));
    expect(exportCsv(state, 'queue')).toBe([header, pendingRow].join('\r\n'));
    expect(exportCsv(state, 'active')).toBe(`"Name","Status","Created at","Due date","Completed at"\r\n"p","active","${timestamp}","",""`);
    for (const list of ['inactive', 'completedProjects'] as const) {
      expect(exportCsv(state, list)).toBe('"Name","Status","Created at","Due date","Completed at"');
    }
  });

  it('accepts v1 backups with or without deleted-project history metadata and rejects invalid labels', () => {
    const oldState = sample();
    const oldRestored = validateImport(JSON.parse(JSON.stringify(oldState)));
    expect(oldRestored).toEqual(oldState);
    expect(oldRestored.items[0]).not.toHaveProperty('deletedProjectName');
    const history = { ...item('kept', null), completedAt: timestamp, deletedProjectName: 'A previous project' };
    const newState = { ...createEmptyState(), items: [history] };
    expect(validateImport(JSON.parse(JSON.stringify(newState)))).toEqual(newState);
    for (const deletedProjectName of ['', '   ', null, 42, ['A previous project']]) {
      expect(() => validateImport({ ...newState, items: [{ ...history, deletedProjectName }] })).toThrow(/deleted project name/);
    }
  });

  it('rejects malformed or unsupported backups', () => {
    for (const value of [null, [], {}, { ...createEmptyState(), version: 2 }, { ...createEmptyState(), settings: { showMasterList: 'yes' } }]) {
      expect(() => validateImport(value)).toThrow(/Invalid backup/);
    }
    const invalidDate = sample();
    invalidDate.items[0].createdAt = 'yesterday';
    expect(() => validateImport(invalidDate)).toThrow(/ISO timestamp/);
    const invalidDue = sample();
    invalidDue.projects[0].dueDate = '2026-02-31';
    expect(() => validateImport(invalidDue)).toThrow(/valid date/);
  });

  it('rejects calendar and time rollover and coerced non-string statuses', () => {
    for (const value of ['2026-02-29T12:00:00.000Z', '2026-04-31T12:00:00.000Z', '2026-10-04T24:00:00.000Z', '2026-10-04T12:60:00.000Z', '2026-10-04T12:00:60.000Z']) {
      const invalid = sample();
      invalid.items[0].createdAt = value;
      expect(() => validateImport(invalid)).toThrow(/ISO timestamp/);
    }
    const invalid = sample();
    expect(() => validateImport({ ...invalid, projects: [{ ...invalid.projects[0], status: ['active'] }] })).toThrow(/unknown project status/);
    const valid = sample();
    valid.items[0].createdAt = '2024-02-29T12:00:00-05:00';
    expect(validateImport(valid).items[0].createdAt).toBe('2024-02-29T12:00:00-05:00');
  });

  it('returns only supported fields without retaining untrusted extra properties', () => {
    const state = sample();
    const imported = validateImport({
      ...state,
      unexpected: { anything: true },
      profile: { ...state.profile, unexpected: 'profile' },
      settings: { ...state.settings, unexpected: 'settings' },
      projects: state.projects.map((entry) => ({ ...entry, unexpected: 'project' })),
      items: state.items.map((entry) => ({ ...entry, unexpected: 'item' })),
      queue: state.queue.map((entry) => ({ ...entry, unexpected: 'slot' })),
    });
    expect(imported).toEqual(state);
    expect(imported).not.toBe(state);
    expect(imported.items[0]).not.toBe(state.items[0]);
  });

  it('preserves supported inline profile photos and rejects remote or malformed images', () => {
    const state = createEmptyState();
    for (const type of ['png', 'jpeg', 'webp']) {
      const avatarUrl = `data:image/${type};base64,AQIDBA==`;
      const result = validateImport({ ...state, profile: { name: 'Lionel', avatarUrl, unknown: 'stripped' } });
      expect(result.profile).toEqual({ name: 'Lionel', avatarUrl });
    }
    for (const avatarUrl of ['https://example.com/photo.jpg', 'data:image/svg+xml;base64,PHN2Zy8+', 'data:image/gif;base64,AQIDBA==', 'data:image/png;base64,', 'data:image/png;base64,not valid', 'data:image/png;base64,A===', null]) {
      expect(() => validateImport({ ...state, profile: { name: 'Lionel', avatarUrl } })).toThrow(/Invalid backup/);
    }
    const oversized = `data:image/jpeg;base64,${'A'.repeat((MAX_INLINE_AVATAR_BYTES / 3 + 1) * 4)}`;
    expect(() => validateImport({ ...state, profile: { name: 'Lionel', avatarUrl: oversized } })).toThrow(/smaller than 1.5 MB/);
  });

  it('rejects duplicate IDs, dangling references, and missing or excess slots', () => {
    const duplicate = sample();
    duplicate.items.push(duplicate.items[0]);
    expect(() => validateImport(duplicate)).toThrow(/duplicate item/);
    const missingProject = sample();
    missingProject.items[0].projectId = 'missing';
    expect(() => validateImport(missingProject)).toThrow(/missing project/);
    const missingErrand = sample();
    missingErrand.queue = missingErrand.queue.filter((entry) => entry.id !== 'slot-e1');
    expect(() => validateImport(missingErrand)).toThrow(/errand is missing/);
    const excess = sample();
    excess.queue.push(slot('d', 'p'), slot('e', 'p'));
    expect(() => validateImport(excess)).toThrow(/excess task/);
    const absentProject = sample();
    absentProject.queue = absentProject.queue.filter((entry) => entry.kind !== 'project');
    expect(() => validateImport(absentProject)).toThrow(/project is missing/);
  });

  it('rejects duplicate errand references even with distinct slot IDs', () => {
    const state = sample();
    state.queue.push({ ...errand('e1'), id: 'another-slot' });
    expect(() => validateImport(state)).toThrow(/duplicate/);
  });

  it('exports project lists separately and neutralizes spreadsheet formulas', () => {
    const state = sample();
    state.projects.push(project('inactive', 'inactive'));
    state.projects[0].name = '=HYPERLINK("bad")';
    state.items[0].title = '  =1+1';
    const projectCsv = exportCsv(state, 'active');
    expect(projectCsv).toContain('"Name","Status","Created at","Due date","Completed at"');
    expect(projectCsv).toContain('"\'=HYPERLINK(""bad"")"');
    expect(projectCsv).not.toContain('"inactive"');
    expect(exportCsv(state, 'queue')).toContain('"\'  =1+1"');
    expect(exportCsv(state, 'inactive')).toContain('"inactive","inactive"');
  });
});
