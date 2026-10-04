export type ProjectStatus = 'active' | 'inactive' | 'completed';

export interface Project {
  id: string;
  name: string;
  status: ProjectStatus;
  createdAt: string;
  dueDate: string | null;
  completedAt: string | null;
}

export interface Item {
  id: string;
  projectId: string | null;
  title: string;
  createdAt: string;
  completedAt: string | null;
}

export type QueueSlot =
  | { id: string; kind: 'project'; projectId: string; createdAt: string }
  | { id: string; kind: 'errand'; itemId: string; createdAt: string };

export interface AppState {
  version: 1;
  profile: { name: string; avatarUrl?: string };
  settings: { showMasterList: boolean };
  projects: Project[];
  items: Item[];
  queue: QueueSlot[];
}

export interface ResolvedQueueEntry {
  slot: QueueSlot;
  item: Item;
  project: Project | null;
}

/** Equal pacing for every project. There is deliberately no priority field. */
export const PROJECT_INSERTION_THRESHOLD = 1 / 3;
export const MAX_INLINE_AVATAR_BYTES = 1.5 * 1024 * 1024;

const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();

function title(value: string): string {
  const result = value.trim();
  if (!result) throw new Error('Please enter a name.');
  return result;
}

function projectSlot(projectId: string): QueueSlot {
  return { id: id(), kind: 'project', projectId, createdAt: now() };
}

export function createEmptyState(): AppState {
  return {
    version: 1,
    profile: { name: '' },
    settings: { showMasterList: false },
    projects: [],
    items: [],
    queue: [],
  };
}

/** A placeholder represents a project, not an item. Item order supplies its contents. */
export function resolveQueue(state: AppState): ResolvedQueueEntry[] {
  const next = new Map<string, number>();
  const projects = new Map(state.projects.map((project) => [project.id, project]));
  const remaining = new Map<string, Item[]>();
  for (const item of state.items) {
    if (item.projectId && !item.completedAt) {
      const list = remaining.get(item.projectId) ?? [];
      list.push(item);
      remaining.set(item.projectId, list);
    }
  }
  const errands = new Map(state.items.filter((item) => !item.projectId && !item.completedAt).map((item) => [item.id, item]));
  const seenErrands = new Set<string>();
  const result: ResolvedQueueEntry[] = [];
  for (const slot of state.queue) {
    if (slot.kind === 'errand') {
      const item = errands.get(slot.itemId);
      if (item && !seenErrands.has(item.id)) {
        result.push({ slot, item, project: null });
        seenErrands.add(item.id);
      }
      continue;
    }
    const project = projects.get(slot.projectId);
    if (!project || project.status !== 'active') continue;
    const index = next.get(project.id) ?? 0;
    const item = remaining.get(project.id)?.[index];
    if (item) {
      result.push({ slot, item, project });
      next.set(project.id, index + 1);
    }
  }
  return result;
}

/** Run once after add/completion. Existing slots stay in place; new slots append. */
export function reprocess(state: AppState): AppState {
  const queue = resolveQueue(state).map(({ slot }) => slot);
  for (const project of state.projects) {
    if (project.status !== 'active') continue;
    const remaining = state.items.filter((item) => item.projectId === project.id && !item.completedAt).length;
    const positions = queue.flatMap((slot, index) => slot.kind === 'project' && slot.projectId === project.id ? [index + 1] : []);
    if (positions.length >= remaining) continue;
    const lastPosition = positions.at(-1);
    // PRS = 1 - lastPosition / queue.length. Integer comparison preserves the
    // strict > 1/3 boundary (floating point otherwise activates at equality).
    if (lastPosition === undefined || 3 * (queue.length - lastPosition) > queue.length) {
      queue.push(projectSlot(project.id));
    }
  }
  if (queue.length === state.queue.length && queue.every((slot, index) => slot === state.queue[index])) return state;
  return { ...state, queue };
}

export function addProject(state: AppState, name: string): AppState {
  const project: Project = { id: id(), name: title(name), status: 'active', createdAt: now(), dueDate: null, completedAt: null };
  return { ...state, projects: [...state.projects, project] };
}

export function addItem(state: AppState, value: string, projectId?: string | null, afterItemId?: string): AppState {
  const text = title(value);
  const project = projectId ? state.projects.find((entry) => entry.id === projectId) : undefined;
  if (projectId && !project) return state;
  const item: Item = { id: id(), projectId: project?.id ?? null, title: text, createdAt: now(), completedAt: null };
  const items = [...state.items];
  const after = afterItemId ? items.findIndex((entry) => entry.id === afterItemId && entry.projectId === item.projectId) : -1;
  items.splice(after === -1 ? items.length : after + 1, 0, item);
  const queue: QueueSlot[] = project ? state.queue : [...state.queue, { id: id(), kind: 'errand', itemId: item.id, createdAt: item.createdAt }];
  const projects = project?.status === 'completed'
    ? state.projects.map((entry): Project => entry.id === project.id ? { ...entry, status: 'active', completedAt: null } : entry)
    : state.projects;
  return reprocess({ ...state, projects, items, queue });
}

export function updateProject(state: AppState, projectId: string, patch: Partial<Pick<Project, 'name' | 'status' | 'dueDate'>>): AppState {
  const project = state.projects.find((entry) => entry.id === projectId);
  if (!project) return state;
  const timestamp = now();
  const status = patch.status ?? project.status;
  const updated: Project = {
    ...project,
    ...patch,
    name: patch.name === undefined ? project.name : title(patch.name),
    status,
    completedAt: status === 'completed' ? project.completedAt ?? timestamp : null,
  };
  const items = status === 'completed'
    ? state.items.map((item) => item.projectId === project.id && !item.completedAt ? { ...item, completedAt: timestamp } : item)
    : state.items;
  const next = { ...state, items, projects: state.projects.map((entry) => entry.id === project.id ? updated : entry) };
  if (status === project.status) return next;
  const queue = resolveQueue(next).map(({ slot }) => slot);
  if (status === 'active' && items.some((item) => item.projectId === project.id && !item.completedAt)) {
    queue.push(projectSlot(project.id));
  }
  return { ...next, queue };
}

export function renameItem(state: AppState, itemId: string, value: string): AppState {
  const text = title(value);
  if (!state.items.some((item) => item.id === itemId)) return state;
  return { ...state, items: state.items.map((item) => item.id === itemId ? { ...item, title: text } : item) };
}

export function reorderItem(state: AppState, itemId: string, direction: 'up' | 'down'): AppState {
  const index = state.items.findIndex((item) => item.id === itemId);
  if (index === -1) return state;
  const item = state.items[index];
  if (item.completedAt) return state;
  const siblings = state.items.filter((entry) => entry.projectId === item.projectId && !entry.completedAt);
  const target = siblings[siblings.findIndex((entry) => entry.id === item.id) + (direction === 'up' ? -1 : 1)];
  if (!target) return state;
  const items = [...state.items];
  const targetIndex = items.findIndex((entry) => entry.id === target.id);
  [items[index], items[targetIndex]] = [items[targetIndex], items[index]];
  if (item.projectId) return { ...state, items };
  // Errands occupy dedicated slots, so their slots move with their order.
  const queue = [...state.queue];
  const from = queue.findIndex((slot) => slot.kind === 'errand' && slot.itemId === item.id);
  const to = queue.findIndex((slot) => slot.kind === 'errand' && slot.itemId === target.id);
  if (from !== -1 && to !== -1) [queue[from], queue[to]] = [queue[to], queue[from]];
  return { ...state, items, queue };
}

/** Move a project step to another step's position within the same project. */
export function moveItem(state: AppState, itemId: string, targetItemId: string): AppState {
  const from = state.items.findIndex((item) => item.id === itemId);
  const to = state.items.findIndex((item) => item.id === targetItemId);
  if (from === -1 || to === -1 || from === to) return state;
  const item = state.items[from];
  const target = state.items[to];
  if (!item.projectId || item.projectId !== target.projectId || item.completedAt || target.completedAt) return state;
  const items = [...state.items];
  items.splice(from, 1);
  items.splice(to, 0, item);
  return { ...state, items };
}

export function deleteItem(state: AppState, itemId: string): AppState {
  if (!state.items.some((item) => item.id === itemId)) return state;
  const next = { ...state, items: state.items.filter((item) => item.id !== itemId) };
  // Deletion only removes invalid/excess slots; it does not run insertion or
  // turn an empty project into a completed project.
  return { ...next, queue: resolveQueue(next).map(({ slot }) => slot) };
}

export function completeCurrent(state: AppState): AppState {
  const current = resolveQueue(state)[0];
  if (!current) return state;
  const timestamp = now();
  const items = state.items.map((item) => item.id === current.item.id ? { ...item, completedAt: timestamp } : item);
  const projects = state.projects.map((project): Project => {
    if (project.id !== current.item.projectId) return project;
    const projectItems = items.filter((item) => item.projectId === project.id);
    return projectItems.length > 0 && projectItems.every((item) => item.completedAt)
      ? { ...project, status: 'completed', completedAt: timestamp }
      : project;
  });
  return reprocess({ ...state, items, projects, queue: state.queue.filter((slot) => slot.id !== current.slot.id) });
}

export function takeBite(state: AppState, firstTitle: string, remainderTitle: string): AppState {
  const first = title(firstTitle);
  const remainder = title(remainderTitle);
  const current = resolveQueue(state)[0];
  if (!current) return state;
  const index = state.items.findIndex((item) => item.id === current.item.id);
  const items = [...state.items];
  items[index] = { ...current.item, title: first };
  const next: Item = { id: id(), projectId: current.item.projectId, title: remainder, createdAt: now(), completedAt: null };
  items.splice(index + 1, 0, next);
  if (current.project) return { ...state, items };
  // A one-off task has no project placeholders. Its remainder appends to the
  // master list, as specified in the product writeup, without reprocessing.
  const queue: QueueSlot[] = [...state.queue, { id: id(), kind: 'errand', itemId: next.id, createdAt: next.createdAt }];
  return { ...state, items, queue };
}

export function createDemoState(): AppState {
  const createdAt = now();
  const projects: Project[] = [
    { id: 'demo-dinner', name: 'Plan a Sunday dinner', status: 'active', createdAt, dueDate: null, completedAt: null },
    { id: 'demo-creativity', name: 'Make room for creativity', status: 'active', createdAt, dueDate: null, completedAt: null },
    { id: 'demo-movement', name: 'A little more movement', status: 'inactive', createdAt, dueDate: null, completedAt: null },
  ];
  const entries: [string, string | null, string][] = [
    ['dinner-1', 'demo-dinner', 'Write a few ideas for Sunday dinner'],
    ['dinner-2', 'demo-dinner', 'Choose one simple recipe'],
    ['dinner-3', 'demo-dinner', 'Make a short shopping list'],
    ['dinner-4', 'demo-dinner', 'Invite someone you love'],
    ['dinner-5', 'demo-dinner', 'Set the table'],
    ['creative-1', 'demo-creativity', 'Clear one corner of your desk'],
    ['creative-2', 'demo-creativity', 'Choose a small creative project'],
    ['creative-3', 'demo-creativity', 'Spend ten minutes getting started'],
    ['movement-1', 'demo-movement', 'Find a walking route nearby'],
    ['movement-2', 'demo-movement', 'Put your walking shoes by the door'],
    ['errand-1', null, 'Water the plants'],
    ['errand-2', null, 'Send that quick reply'],
    ['errand-3', null, 'Pick up a few groceries'],
  ];
  const items: Item[] = entries.map(([itemId, projectId, text]) => ({ id: itemId, projectId, title: text, createdAt, completedAt: null }));
  const queue: QueueSlot[] = [
    { id: 'slot-1', kind: 'project', projectId: 'demo-dinner', createdAt },
    { id: 'slot-2', kind: 'errand', itemId: 'errand-1', createdAt },
    { id: 'slot-3', kind: 'project', projectId: 'demo-creativity', createdAt },
    { id: 'slot-4', kind: 'errand', itemId: 'errand-2', createdAt },
    { id: 'slot-5', kind: 'project', projectId: 'demo-dinner', createdAt },
    { id: 'slot-6', kind: 'errand', itemId: 'errand-3', createdAt },
  ];
  return { ...createEmptyState(), profile: { name: 'Lionel' }, projects, items, queue };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid backup: ${label} must be an object.`);
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) throw new Error(`Invalid backup: ${label} must be text.`);
  return value;
}

function timestamp(value: unknown, label: string): string {
  const result = string(value, label);
  const parts = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(result);
  if (!parts || !validDate(parts[1]) || Number(parts[2]) > 23 || Number(parts[3]) > 59 || Number(parts[4]) > 59 || !Number.isFinite(Date.parse(result))) {
    throw new Error(`Invalid backup: ${label} must be an ISO timestamp.`);
  }
  return result;
}

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString().slice(0, 10) === value;
}

function nullableTimestamp(value: unknown, label: string): string | null {
  return value === null ? null : timestamp(value, label);
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Invalid backup: ${label} must be a list.`);
  return value;
}

function unique(values: { id: string }[], label: string): void {
  if (new Set(values.map((value) => value.id)).size !== values.length) throw new Error(`Invalid backup: duplicate ${label} IDs.`);
}

function inlineAvatar(value: unknown): string {
  const result = string(value, 'profile avatar');
  const match = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(result);
  if (!match || match[1].length % 4 !== 0) throw new Error('Invalid backup: profile photo must be an inline PNG, JPEG, or WebP image.');
  const base64 = match[1];
  const bytes = base64.length * 3 / 4 - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
  if (bytes > MAX_INLINE_AVATAR_BYTES) throw new Error('Invalid backup: profile photo must be smaller than 1.5 MB.');
  return result;
}

export function validateImport(input: unknown): AppState {
  const data = record(input, 'data');
  if (data.version !== 1) throw new Error('Invalid backup: unsupported version.');
  const profile = record(data.profile, 'profile');
  const settings = record(data.settings, 'settings');
  if (typeof settings.showMasterList !== 'boolean') throw new Error('Invalid backup: showMasterList must be true or false.');
  const projects = array(data.projects, 'projects').map((value): Project => {
    const project = record(value, 'project');
    if (typeof project.status !== 'string' || !['active', 'inactive', 'completed'].includes(project.status)) throw new Error('Invalid backup: unknown project status.');
    const dueDate = project.dueDate === null ? null : string(project.dueDate, 'dueDate');
    if (dueDate && !validDate(dueDate)) throw new Error('Invalid backup: dueDate must be a valid date.');
    return { id: string(project.id, 'project ID'), name: string(project.name, 'project name'), status: project.status as ProjectStatus, createdAt: timestamp(project.createdAt, 'project createdAt'), dueDate, completedAt: nullableTimestamp(project.completedAt, 'project completedAt') };
  });
  const items = array(data.items, 'items').map((value): Item => {
    const item = record(value, 'item');
    return { id: string(item.id, 'item ID'), projectId: item.projectId === null ? null : string(item.projectId, 'item projectId'), title: string(item.title, 'item title'), createdAt: timestamp(item.createdAt, 'item createdAt'), completedAt: nullableTimestamp(item.completedAt, 'item completedAt') };
  });
  const queue = array(data.queue, 'queue').map((value): QueueSlot => {
    const slot = record(value, 'queue slot');
    const base = { id: string(slot.id, 'slot ID'), createdAt: timestamp(slot.createdAt, 'slot createdAt') };
    if (slot.kind === 'project') return { ...base, kind: 'project', projectId: string(slot.projectId, 'slot projectId') };
    if (slot.kind === 'errand') return { ...base, kind: 'errand', itemId: string(slot.itemId, 'slot itemId') };
    throw new Error('Invalid backup: unknown queue slot type.');
  });
  unique(projects, 'project');
  unique(items, 'item');
  unique(queue, 'queue slot');
  const projectMap = new Map(projects.map((project) => [project.id, project]));
  for (const item of items) {
    if (item.projectId && !projectMap.has(item.projectId)) throw new Error('Invalid backup: an item references a missing project.');
    if (item.projectId && projectMap.get(item.projectId)?.status === 'completed' && !item.completedAt) throw new Error('Invalid backup: completed project has unfinished items.');
  }
  for (const project of projects) {
    if ((project.status === 'completed') !== Boolean(project.completedAt)) throw new Error('Invalid backup: project completion date does not match its status.');
  }
  const avatarUrl = profile.avatarUrl === undefined ? undefined : inlineAvatar(profile.avatarUrl);
  const state: AppState = { version: 1, profile: { name: string(profile.name, 'profile name', true), ...(avatarUrl ? { avatarUrl } : {}) }, settings: { showMasterList: settings.showMasterList }, projects, items, queue };
  const resolved = resolveQueue(state);
  if (resolved.length !== queue.length) throw new Error('Invalid backup: queue contains a missing, inactive, duplicate, completed, or excess task.');
  const queuedErrands = new Set(queue.flatMap((slot) => slot.kind === 'errand' ? [slot.itemId] : []));
  if (items.some((item) => !item.projectId && !item.completedAt && !queuedErrands.has(item.id))) throw new Error('Invalid backup: an unfinished errand is missing from the queue.');
  for (const project of projects) {
    if (project.status === 'active' && items.some((item) => item.projectId === project.id && !item.completedAt) && !queue.some((slot) => slot.kind === 'project' && slot.projectId === project.id)) throw new Error('Invalid backup: an active project is missing from the queue.');
  }
  return state;
}

/** Quote every field and escape spreadsheet formulas before CSV download. */
function csvCell(value: string): string {
  const escaped = /^[\s\u0000-\u001f]*[=+@-]/.test(value) || /^[\t\r\n]/.test(value) ? `'${value}` : value;
  return `"${escaped.replaceAll('"', '""')}"`;
}

export function exportCsv(state: AppState, list: 'queue' | 'completed' | 'active' | 'inactive' | 'completedProjects' | 'items'): string {
  if (list === 'active' || list === 'inactive' || list === 'completedProjects') {
    const status = list === 'completedProjects' ? 'completed' : list;
    const rows = [
      ['Name', 'Status', 'Created at', 'Due date', 'Completed at'],
      ...state.projects.filter((project) => project.status === status).map((project) => [project.name, project.status, project.createdAt, project.dueDate ?? '', project.completedAt ?? '']),
    ];
    return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
  }
  const projects = new Map(state.projects.map((project) => [project.id, project]));
  let items = list === 'queue' ? resolveQueue(state).map((entry) => entry.item) : state.items;
  if (list === 'completed') items = items.filter((item) => item.completedAt);
  const rows = [
    ['Title', 'Project', 'Status', 'Created at', 'Completed at'],
    ...items.map((item) => [item.title, item.projectId ? projects.get(item.projectId)?.name ?? '' : '', item.completedAt ? 'Completed' : item.projectId && projects.get(item.projectId)?.status === 'inactive' ? 'Inactive' : 'Active', item.createdAt, item.completedAt ?? '']),
  ];
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}
