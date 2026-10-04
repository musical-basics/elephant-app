import { describe, expect, it } from 'vitest';
import {
  addItem, addProject, completeCurrent, createDemoState, createEmptyState,
  deleteItem, exportCsv, moveItem, renameItem, reorderItem, reprocess,
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

  it('seeds all active projects but leaves inactive and empty ones out', () => {
    const state: AppState = { ...createEmptyState(), projects: [project('p'), project('q'), project('r', 'inactive'), project('empty')], items: [item('p1', 'p'), item('q1', 'q'), item('r1', 'r')] };
    expect(resolveQueue(reprocess(state)).map((entry) => entry.item.id)).toEqual(['p1', 'q1']);
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

  it('finishes a nonempty project after its final item, and reopens it on adding', () => {
    let state: AppState = { ...createEmptyState(), projects: [project('p')], items: [item('p1', 'p')], queue: [slot('a', 'p')] };
    state = completeCurrent(state);
    expect(state.projects[0]).toMatchObject({ status: 'completed' });
    expect(state.projects[0].completedAt).toBeTruthy();
    expect(state.queue).toHaveLength(0);
    state = addItem(state, 'Another small step', 'p');
    expect(state.projects[0]).toMatchObject({ status: 'active', completedAt: null });
    expect(resolveQueue(state)[0].item.title).toBe('Another small step');
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
    expect(next.queue).toHaveLength(0);
    expect(next.projects[0]).toMatchObject({ status: 'active', completedAt: null });
    expect(validateImport(next)).toEqual(next);
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
