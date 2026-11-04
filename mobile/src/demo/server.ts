/**
 * Browser demo of the SettleWise API.
 *
 * Built only when EXPO_PUBLIC_DEMO=1 (the shareable web demo). It ports the server
 * logic the app relies on - plan generation, dependencies, event impact analysis,
 * the cash-flow forecast, referrals, consent and the offline assistant - and keeps
 * one synthetic user's data in localStorage, so the demo runs with no server.
 * The source of truth stays in backend/settlewise; keep the two in step.
 */
import type * as T from '../api/types';
import { addDays, daysFromToday, parseDate, todayISO, toISODate } from '../lib/format';
import content from './content.json';

// ---------------------------------------------------------------------------------
// Types and content

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type Query = Record<string, string | undefined>;

interface TemplateTask {
  key: string;
  title: string;
  category?: string;
  offset_days?: number;
  priority?: 'low' | 'medium' | 'high';
  depends_on?: string[];
  date_sensitive?: boolean;
  external_party?: string;
  guidance?: string;
  source_ids?: string[];
  when?: Record<string, unknown>;
}
interface Template {
  id: string;
  title: string;
  description?: string;
  key_date_label?: string;
  tasks: TemplateTask[];
  costs?: { label: string; category?: string; amount?: number; offset_days?: number }[];
}
interface SourceRec {
  id: string;
  title: string;
  publisher: string;
  url: string;
  reviewed_on: string | null;
  tags: string[];
  summary: string;
}

const TEMPLATES = content.templates as unknown as Template[];
const SOURCES = content.sources as unknown as SourceRec[];

type TaskRec = Omit<T.Task, 'depends_on' | 'blocked_by' | 'overdue'>;
type EventRec = Omit<T.LifeEvent, 'progress' | 'key_date_label'>;
type DocRec = Omit<T.DocumentRecord, 'days_until_expiry' | 'number_masked'> & { number_last4: string };
type RefRec = Omit<T.Referral, 'follow_up_overdue' | 'allowed_transitions'>;
type GrantRec = Omit<T.Grant, 'status' | 'recipient_has_account'>;
type QuestionRec = Omit<T.Answer, 'sources' | 'professional_service_types'> & { source_ids: string[] };
type BudgetRec = Omit<T.Budget, 'lines'>;

interface State {
  version: 1;
  user: T.User;
  profile: T.Profile;
  household: T.HouseholdMember[];
  documents: DocRec[];
  events: EventRec[];
  tasks: TaskRec[];
  deps: [string, string][]; // [task, depends_on]
  costs: T.EventCost[];
  budgets: BudgetRec[];
  lines: T.BudgetLine[];
  bills: T.Bill[];
  goals: T.SavingsGoal[];
  expenses: T.Expense[];
  providers: T.Provider[];
  referrals: RefRec[];
  grants: GrantRec[];
  audit: T.AuditEntry[];
  requests: T.AccessRequest[];
  notifications: T.AppNotification[];
  prefs: T.NotificationPrefs;
  questions: QuestionRec[];
  reviews: T.ImpactReview[];
}

export class DemoError extends Error {
  status: number;
  detail: unknown;

  constructor(status: number, detail: unknown) {
    super(typeof detail === 'string' ? detail : 'Request failed');
    this.status = status;
    this.detail = detail;
  }
}

const fail = (status: number, detail: unknown): never => {
  throw new DemoError(status, detail);
};

const newId = () => Array.from({ length: 24 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
const nowISO = () => new Date().toISOString();
const CLOSED = ['done', 'skipped'];

// ---------------------------------------------------------------------------------
// Storage

const STORAGE_KEY = 'settlewise.demo.v1';
let state: State | null = null;

function load(): State {
  if (state) return state;
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw) state = JSON.parse(raw) as State;
  } catch {
    state = null;
  }
  if (!state || state.version !== 1) state = seed();
  return state;
}

function save() {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private windows may block storage; the demo still works for this visit.
  }
}

/** Start over with Sarah's sample data. */
export function resetDemo() {
  state = seed();
  save();
}

// ---------------------------------------------------------------------------------
// Seed: the Project Vision persona, Sarah (fictional)

function emptyState(user: T.User): State {
  return {
    version: 1,
    user,
    profile: {
      immigration_status: 'permanent_resident',
      arrival_date: null,
      country_of_origin: '',
      preferred_language: 'English',
      phone: '',
      contact_email: user.email,
      address_line: '',
      city: '',
      province: 'ON',
      postal_code: '',
      employment_status: '',
      has_vehicle: false,
    },
    household: [],
    documents: [],
    events: [],
    tasks: [],
    deps: [],
    costs: [],
    budgets: [],
    lines: [],
    bills: [],
    goals: [],
    expenses: [],
    providers: (content.providers as Json[]).map((p, i) => ({
      id: `provider${i + 1}`,
      name: p.name,
      service_types: p.service_types,
      city: p.city,
      province: p.province,
      phone: p.phone,
      website: p.website,
      languages: p.languages,
      description: p.description,
      reviewed_on: null,
      is_sample: true,
    })),
    referrals: [],
    grants: [],
    audit: [],
    requests: [],
    notifications: [],
    prefs: {
      push_enabled: true,
      email_enabled: false,
      timezone: 'America/Toronto',
      quiet_start: '21:00',
      quiet_end: '08:00',
      reminder_hour: 9,
      task_lead_days: 1,
      bill_lead_days: 3,
      follow_up_lead_days: 0,
      document_lead_days: [90, 30, 7],
    },
    questions: [],
    reviews: [],
  };
}

function seed(): State {
  const today = todayISO();
  state = emptyState({
    id: 'sarah',
    email: 'sarah@example.com',
    full_name: 'Sarah Santos',
    role: 'newcomer',
    display_language: 'en',
    totp_enabled: false,
  });
  const s = state;
  Object.assign(s.profile, {
    arrival_date: addDays(today, -120),
    country_of_origin: 'Philippines',
    phone: '416-555-0199',
    address_line: '100 Example St, Unit 4',
    city: 'Toronto',
    postal_code: 'M5V 0A0',
    employment_status: 'employed',
  });
  s.documents = [
    { id: newId(), doc_type: 'passport', label: 'Philippine passport', issuer: '', member_id: null, number_last4: '7731', issued_on: null, expires_on: addDays(today, 400), notes: '' },
    { id: newId(), doc_type: 'pr_card', label: 'PR card', issuer: '', member_id: null, number_last4: '0042', issued_on: null, expires_on: addDays(today, 1700), notes: '' },
    { id: newId(), doc_type: 'insurance_policy', label: 'Tenant insurance', issuer: 'Trillium Home & Tenant Insurance (sample)', member_id: null, number_last4: '', issued_on: null, expires_on: addDays(today, 60), notes: '' },
  ];
  const move = createEvent('moving', addDays(today, 30), 'Move to the new apartment', '');
  createEvent('new_job', addDays(today, -10), 'New job at a software company', '');
  s.tasks.filter((t) => t.life_event_id === move.id && (t.offset_days ?? 0) <= -45).forEach((t) => (t.status = 'done'));

  const budget: BudgetRec = { id: newId(), name: 'Monthly budget', life_event_id: null, is_active: true };
  s.budgets.push(budget);
  const lines: [T.BudgetLine['kind'], string, string, number, number][] = [
    ['income', 'salary', 'Salary (net)', 5200, 1],
    ['expense', 'housing', 'Rent', 2400, 1],
    ['expense', 'food', 'Groceries', 600, 5],
    ['expense', 'travel', 'Transit', 156, 1],
    ['expense', 'personal', 'Personal and other', 400, 15],
  ];
  lines.forEach(([kind, category, label, amount, day]) =>
    s.lines.push({ id: newId(), budget_id: budget.id, kind, category, label, amount, day_of_month: day }),
  );
  s.bills.push(
    { id: newId(), name: 'Phone plan', provider: 'Sample Mobile', category: 'utilities', amount: 55, frequency: 'monthly', next_due_date: addDays(today, 5), autopay: false, notes: '' },
    { id: newId(), name: 'Internet', provider: 'Sample Internet', category: 'utilities', amount: 70, frequency: 'monthly', next_due_date: addDays(today, 12), autopay: true, notes: '' },
  );
  s.goals.push({ id: newId(), name: 'Emergency fund', kind: 'emergency', target_amount: 9000, saved_amount: 3200, target_date: null });

  createReferral({
    provider_id: 'provider1',
    reason: 'Help finding a family doctor near the new apartment',
    info_needed: ['New address', 'Health card'],
    life_event_id: move.id,
  });

  s.requests.push({
    id: newId(),
    requester_name: 'Amara Okafor (settlement worker, sample)',
    requester_type: 'advisor',
    fields: ['plans', 'referrals', 'tasks'],
    purpose: 'Settlement support for your move',
    duration_days: 90,
    status: 'pending',
    created_at: nowISO(),
  });
  s.notifications.push(
    { id: newId(), kind: 'bill', title: `Phone plan $55.00 due ${shortDate(addDays(today, 5))}`, body: 'Remember to pay this bill.', link: '/finance', status: 'unread', snoozed_until: null, created_at: nowISO() },
    { id: newId(), kind: 'document', title: 'Tenant insurance expires in 60 days', body: 'Check how long renewal takes.', link: '/documents', status: 'unread', snoozed_until: null, created_at: nowISO() },
  );
  return s;
}

function shortDate(iso: string) {
  return parseDate(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
}

// ---------------------------------------------------------------------------------
// Planning (2.0) and tasks (4.0)

function templateFor(type: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === type);
}

function planningContext(s: State): Record<string, unknown> {
  return {
    immigration_status: s.profile.immigration_status,
    province: s.profile.province,
    city: s.profile.city,
    has_vehicle: s.profile.has_vehicle,
    has_household: s.household.length > 0,
    has_children: s.household.some((m) => m.relationship === 'child'),
    has_spouse: s.household.some((m) => m.relationship === 'spouse' || m.relationship === 'partner'),
    household_size: 1 + s.household.length,
  };
}

function matches(when: Record<string, unknown> | undefined, ctx: Record<string, unknown>) {
  return Object.entries(when ?? {}).every(([key, expected]) =>
    Array.isArray(expected) ? expected.includes(ctx[key]) : ctx[key] === expected,
  );
}

function createEvent(type: string, keyDate: string, title: string | undefined, notes: string): EventRec {
  const s = load();
  const tpl = templateFor(type) ?? fail(422, `Unknown life event. Choose one of: ${TEMPLATES.map((t) => t.id).join(', ')}`);
  const ev: EventRec = { id: newId(), event_type: type, title: title || tpl.title, key_date: keyDate, status: 'active', notes };
  s.events.push(ev);
  const ctx = planningContext(s);
  const chosen = tpl.tasks.filter((t) => matches(t.when, ctx));
  const ordered = chosen.map((t, i) => [t, i] as const).sort((a, b) => (a[0].offset_days ?? 0) - (b[0].offset_days ?? 0) || a[1] - b[1]);
  const byKey: Record<string, string> = {};
  ordered.forEach(([spec], position) => {
    const id = newId();
    byKey[spec.key] = id;
    s.tasks.push({
      id,
      life_event_id: ev.id,
      title: spec.title,
      description: '',
      category: spec.category ?? 'general',
      owner: 'me',
      priority: spec.priority ?? 'medium',
      status: 'todo',
      due_date: spec.offset_days !== undefined ? addDays(keyDate, spec.offset_days) : null,
      position,
      date_sensitive: !!spec.date_sensitive,
      external_party: spec.external_party ?? '',
      guidance: spec.guidance ?? '',
      source_ids: spec.source_ids ?? [],
      offset_days: spec.offset_days ?? null,
    });
  });
  chosen.forEach((spec) =>
    (spec.depends_on ?? []).forEach((dep) => byKey[dep] && s.deps.push([byKey[spec.key], byKey[dep]])),
  );
  (tpl.costs ?? []).forEach((c) =>
    s.costs.push({
      id: newId(),
      life_event_id: ev.id,
      label: c.label,
      category: c.category ?? 'general',
      amount: c.amount ?? 0,
      due_date: addDays(keyDate, c.offset_days ?? 0),
      paid: false,
      offset_days: c.offset_days ?? 0,
    }),
  );
  return ev;
}

const dependsOn = (s: State, taskId: string) => s.deps.filter(([t]) => t === taskId).map(([, d]) => d);

function blockedBy(s: State, task: TaskRec): string[] {
  return dependsOn(s, task.id).filter((d) => {
    const dep = s.tasks.find((t) => t.id === d);
    return dep && !CLOSED.includes(dep.status);
  });
}

function taskOut(s: State, t: TaskRec): T.Task {
  return {
    ...t,
    depends_on: dependsOn(s, t.id),
    blocked_by: blockedBy(s, t),
    overdue: !!t.due_date && t.due_date < todayISO() && !CLOSED.includes(t.status),
  };
}

const eventTasks = (s: State, eventId: string) =>
  s.tasks.filter((t) => t.life_event_id === eventId).sort((a, b) => a.position - b.position || (a.due_date ?? '').localeCompare(b.due_date ?? ''));

function progress(s: State, eventId: string): T.Progress {
  const today = todayISO();
  const tasks = eventTasks(s, eventId);
  const c = { completed: 0, upcoming: 0, overdue: 0, blocked: 0, needs_review: 0, skipped: 0 };
  for (const t of tasks) {
    if (t.status === 'done') c.completed++;
    else if (t.status === 'skipped') c.skipped++;
    else if (blockedBy(s, t).length) c.blocked++;
    else if (t.status === 'needs_review') c.needs_review++;
    else if (t.due_date && t.due_date < today) c.overdue++;
    else c.upcoming++;
  }
  const total = tasks.length - c.skipped;
  const next = tasks.find((t) => !CLOSED.includes(t.status) && !blockedBy(s, t).length);
  return {
    ...c,
    total,
    completion_percent: total ? Math.round((100 * c.completed) / total) : 0,
    score_note: 'Task completion only - not an eligibility or settlement-success estimate.',
    next_task_id: next?.id ?? null,
    next_task_title: next?.title ?? null,
  };
}

function eventOut(s: State, ev: EventRec): T.LifeEvent {
  return { ...ev, key_date_label: templateFor(ev.event_type)?.key_date_label ?? 'Key date', progress: progress(s, ev.id) };
}

function searchTasks(s: State, q: Query): T.Task[] {
  let tasks = s.tasks.slice();
  if (q.life_event_id) tasks = tasks.filter((t) => t.life_event_id === q.life_event_id);
  if (q.owner) tasks = tasks.filter((t) => t.owner === q.owner);
  if (q.category) tasks = tasks.filter((t) => t.category === q.category);
  if (q.due_from) tasks = tasks.filter((t) => t.due_date && t.due_date >= q.due_from!);
  if (q.due_to) tasks = tasks.filter((t) => t.due_date && t.due_date <= q.due_to!);
  if (q.q) {
    const needle = q.q.toLowerCase();
    tasks = tasks.filter((t) => `${t.title} ${t.description}`.toLowerCase().includes(needle));
  }
  const status = q.status;
  if (status && ['todo', 'in_progress', 'needs_review', 'done', 'skipped'].includes(status)) tasks = tasks.filter((t) => t.status === status);
  else if (status && ['open', 'overdue', 'blocked'].includes(status)) tasks = tasks.filter((t) => !CLOSED.includes(t.status));
  if (status === 'overdue') tasks = tasks.filter((t) => t.due_date && t.due_date < todayISO());
  if (status === 'blocked') tasks = tasks.filter((t) => blockedBy(s, t).length);
  tasks.sort((a, b) => {
    if (!a.due_date !== !b.due_date) return a.due_date ? -1 : 1;
    return (a.due_date ?? '').localeCompare(b.due_date ?? '') || a.position - b.position;
  });
  return tasks.map((t) => taskOut(s, t));
}

function wouldCycle(s: State, taskId: string, dependsOnId: string) {
  const seen = new Set<string>();
  const stack = [dependsOnId];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === taskId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    stack.push(...dependsOn(s, cur));
  }
  return false;
}

const findTask = (s: State, id: string) => s.tasks.find((t) => t.id === id) ?? fail(404, 'Task not found');
const findEvent = (s: State, id: string) => s.events.find((e) => e.id === id) ?? fail(404, 'Life event not found');

// --- 4.4 Review Change Impact ------------------------------------------------------

function proposeImpact(s: State, ev: EventRec, newDate: string): T.ImpactItem[] {
  const items: T.ImpactItem[] = [];
  const delta = daysFromToday(newDate) - daysFromToday(ev.key_date);
  const when = delta > 0 ? 'later' : 'earlier';
  for (const t of eventTasks(s, ev.id)) {
    const external = t.date_sensitive && !!t.external_party;
    if (CLOSED.includes(t.status)) {
      if (t.date_sensitive)
        items.push({
          id: newId(), plugin: 'tasks', kind: 'task', ref_id: t.id, title: t.title, category: t.category, action: 'review',
          reason: `Already done for the old date. Confirm the new date with ${t.external_party || 'the provider'}.`,
          current_value: t.status, proposed_value: 'needs_review', requires_external_confirmation: external,
        });
      continue;
    }
    if (t.offset_days === null || !t.due_date) continue;
    const proposed = addDays(newDate, t.offset_days);
    if (proposed === t.due_date) continue;
    let reason = `Linked to the key date, which moves ${Math.abs(delta)} days ${when}.`;
    if (t.date_sensitive) reason += ` Review the date with ${t.external_party || 'the provider'}.`;
    if (proposed < todayISO()) reason += ' The new due date is already past.';
    items.push({
      id: newId(), plugin: 'tasks', kind: 'task', ref_id: t.id, title: t.title, category: t.category, action: 'reschedule',
      reason, current_value: t.due_date, proposed_value: proposed, requires_external_confirmation: external,
    });
  }
  for (const c of s.costs.filter((x) => x.life_event_id === ev.id && !x.paid)) {
    const proposed = c.offset_days !== null ? addDays(newDate, c.offset_days) : addDays(c.due_date, delta);
    if (proposed === c.due_date) continue;
    items.push({
      id: newId(), plugin: 'finance', kind: 'cost', ref_id: c.id, category: 'budget', action: 'recalculate',
      title: `${c.label} ($${c.amount.toLocaleString('en-CA', { maximumFractionDigits: 0 })})`,
      reason: 'Expected cost moves with the key date; your cash-flow forecast will be recalculated.',
      current_value: c.due_date, proposed_value: proposed, requires_external_confirmation: false,
    });
  }
  for (const r of s.referrals.filter((x) => x.life_event_id === ev.id && ['requested', 'accepted', 'scheduled'].includes(x.status))) {
    items.push({
      id: newId(), plugin: 'referrals', kind: 'referral', ref_id: r.id, category: 'referral', action: 'review',
      title: `Referral to ${r.recipient_name}`,
      reason: 'Tell the provider about the new date. The referral stays pending until you record their response.',
      current_value: r.follow_up_date, proposed_value: r.follow_up_date ? addDays(r.follow_up_date, delta) : null,
      requires_external_confirmation: true,
    });
  }
  return items;
}

function applyImpact(s: State, review: T.ImpactReview, approved: Set<string>) {
  const ev = findEvent(s, review.life_event_id);
  const delta = daysFromToday(review.new_date) - daysFromToday(review.old_date);
  const items = review.items.filter((i) => approved.has(i.id));
  for (const item of items) {
    if (item.plugin === 'tasks') {
      const t = s.tasks.find((x) => x.id === item.ref_id);
      if (!t) continue;
      if (item.action === 'review') t.status = 'needs_review';
      else if (item.proposed_value) {
        t.due_date = item.proposed_value;
        if (item.requires_external_confirmation && t.status === 'todo') t.status = 'needs_review';
      }
    } else if (item.plugin === 'finance') {
      const c = s.costs.find((x) => x.id === item.ref_id);
      if (c && item.proposed_value) c.due_date = item.proposed_value;
    } else if (item.plugin === 'referrals') {
      const r = s.referrals.find((x) => x.id === item.ref_id);
      if (!r) continue;
      if (item.proposed_value) r.follow_up_date = item.proposed_value;
      r.next_owner = 'me';
      r.history.push({ status: r.status, note: `Key date moved ${delta >= 0 ? '+' : ''}${delta} days - confirm with provider`, by: 'system', created_at: nowISO() });
    }
  }
  ev.key_date = review.new_date;
  review.status = 'applied';
  review.approved_item_ids = items.map((i) => i.id);
}

function summarize(items: T.ImpactItem[]) {
  const out: Record<string, number> = {};
  items.forEach((i) => (out[i.category] = (out[i.category] ?? 0) + 1));
  return out;
}

// ---------------------------------------------------------------------------------
// Finance (5.0)

const MONTHLY_FACTOR: Record<string, number> = { once: 0, weekly: 52 / 12, biweekly: 26 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 };

function addMonths(iso: string, months: number): string {
  const d = parseDate(iso);
  const day = d.getDate();
  const target = new Date(d.getFullYear(), d.getMonth() + months, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, last));
  return toISODate(target);
}

function nextOccurrence(iso: string, frequency: string): string | null {
  switch (frequency) {
    case 'weekly':
      return addDays(iso, 7);
    case 'biweekly':
      return addDays(iso, 14);
    case 'monthly':
      return addMonths(iso, 1);
    case 'quarterly':
      return addMonths(iso, 3);
    case 'yearly':
      return addMonths(iso, 12);
    default:
      return null;
  }
}

const activeLines = (s: State) => s.lines.filter((l) => s.budgets.find((b) => b.id === l.budget_id)?.is_active);

function forecast(s: State, days: number, start: number): T.Forecast {
  const today = todayISO();
  const end = addDays(today, days);
  const flows: T.Forecast['flows'] = [];
  for (const line of activeLines(s)) {
    let month = `${today.slice(0, 7)}-01`;
    while (month <= end) {
      const d = parseDate(month);
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      const when = `${month.slice(0, 8)}${String(Math.min(line.day_of_month, last)).padStart(2, '0')}`;
      if (when >= today && when <= end) flows.push({ date: when, label: line.label, amount: line.kind === 'income' ? line.amount : -line.amount, source: 'budget' });
      month = addMonths(month, 1);
    }
  }
  for (const bill of s.bills) {
    let cur: string | null = bill.next_due_date;
    while (cur && cur <= end) {
      if (cur >= today) flows.push({ date: cur, label: bill.name, amount: -bill.amount, source: 'bill' });
      cur = nextOccurrence(cur, bill.frequency);
    }
  }
  for (const c of s.costs) {
    const ev = s.events.find((e) => e.id === c.life_event_id);
    if (c.paid || ev?.status !== 'active') continue;
    const when = c.due_date < today ? today : c.due_date;
    if (when <= end) flows.push({ date: when, label: c.label, amount: -c.amount, source: 'life_event', life_event_id: c.life_event_id });
  }
  const byDay: Record<string, number> = {};
  flows.forEach((f) => (byDay[f.date] = (byDay[f.date] ?? 0) + f.amount));
  let balance = start;
  let lowest = { date: today, balance: start };
  const points: T.Forecast['points'] = [];
  for (let i = 0; i <= days; i++) {
    const d = addDays(today, i);
    balance += byDay[d] ?? 0;
    points.push({ date: d, balance: Math.round(balance * 100) / 100 });
    if (balance < lowest.balance) lowest = { date: d, balance: Math.round(balance * 100) / 100 };
  }
  const warnings: string[] = [];
  if (lowest.balance < 0) warnings.push(`Your balance is projected to go below zero on ${lowest.date}.`);
  const emergency = s.goals.find((g) => g.kind === 'emergency');
  if (emergency && emergency.saved_amount < emergency.target_amount)
    warnings.push(`Emergency fund is at ${emergency.saved_amount.toFixed(0)} of ${emergency.target_amount.toFixed(0)}.`);
  flows.sort((a, b) => a.date.localeCompare(b.date));
  return { start_date: today, end_date: end, starting_balance: start, ending_balance: Math.round(balance * 100) / 100, lowest, points, flows, warnings };
}

// ---------------------------------------------------------------------------------
// Referrals (6.0)

const STATUS_FLOW: Record<string, T.ReferralStatus[]> = {
  requested: ['accepted', 'declined', 'cancelled'],
  accepted: ['scheduled', 'completed', 'cancelled'],
  scheduled: ['completed', 'accepted', 'cancelled'],
  completed: [],
  declined: ['requested'],
  cancelled: ['requested'],
};
const NEXT_OWNER: Record<string, T.Referral['next_owner']> = {
  requested: 'provider', accepted: 'me', scheduled: 'me', completed: 'none', declined: 'me', cancelled: 'none',
};

function referralOut(r: RefRec): T.Referral {
  return {
    ...r,
    follow_up_overdue: !!r.follow_up_date && r.follow_up_date < todayISO() && !['completed', 'cancelled'].includes(r.status),
    allowed_transitions: [...STATUS_FLOW[r.status]].sort(),
  };
}

function createReferral(body: Json): RefRec {
  const s = load();
  let recipient: string | undefined = body.recipient_name;
  let serviceType: string = body.service_type ?? '';
  if (body.provider_id) {
    const p = s.providers.find((x) => x.id === body.provider_id) ?? fail(404, 'Provider not found');
    recipient = recipient || p.name;
    serviceType = serviceType || p.service_types[0] || '';
  }
  if (!recipient) fail(422, 'Choose a provider or enter who the referral is for');
  if (!body.reason?.trim()) fail(422, 'reason: Field required');
  const r: RefRec = {
    id: newId(), recipient_name: recipient!, provider_id: body.provider_id ?? null, service_type: serviceType, reason: body.reason,
    info_needed: body.info_needed ?? [], life_event_id: body.life_event_id ?? null, task_id: body.task_id ?? null,
    status: 'requested', next_owner: 'provider', follow_up_date: body.follow_up_date ?? addDays(todayISO(), 7),
    scheduled_for: null, outcome: '', created_by: 'self',
    history: [{ status: 'requested', note: 'Referral created', by: 'self', created_at: nowISO() }],
  };
  s.referrals.push(r);
  return r;
}

// ---------------------------------------------------------------------------------
// Consent (7.0)

const FIELD_CATALOGUE: Record<string, string> = {
  'profile.contact': 'Name, phone and contact email',
  'profile.address': 'Current address',
  'profile.status': 'Immigration status and arrival date',
  household: 'Household members',
  documents: 'Document list and expiry dates (numbers are never shared)',
  plans: 'Life events and plan progress',
  tasks: 'Tasks and due dates',
  referrals: 'Referrals and follow-ups',
  'finance.summary': 'Monthly budget summary and upcoming bills',
};

function grantOut(g: GrantRec): T.Grant {
  const status = g.revoked_at ? 'revoked' : g.expires_at > nowISO() ? 'active' : 'expired';
  return { ...g, status, recipient_has_account: false };
}

function audit(s: State, action: string, detail: string, fields: string[] = [], actor = 'You') {
  s.audit.unshift({ id: newId(), actor_label: actor, action, resource: '', fields, detail, created_at: nowISO() });
}

function createGrant(s: State, g: Omit<GrantRec, 'id' | 'created_at' | 'expires_at' | 'revoked_at'>, days: number): GrantRec {
  const grant: GrantRec = { ...g, id: newId(), created_at: nowISO(), expires_at: new Date(Date.now() + days * 86_400_000).toISOString(), revoked_at: null };
  s.grants.unshift(grant);
  audit(s, 'grant_created', `Shared with ${g.recipient_name} for ${days} days: ${g.purpose}`, g.fields);
  return grant;
}

// ---------------------------------------------------------------------------------
// Notifications (9.0) - reminders are derived from tasks, bills, documents and referrals

function reminderAt(s: State, due: string | null, lead: number): string | null {
  if (!due) return null;
  const day = addDays(due, -lead);
  const when = parseDate(day);
  when.setHours(s.prefs.reminder_hour, 0, 0, 0);
  if (when.getTime() > Date.now()) return when.toISOString();
  return due >= todayISO() ? nowISO() : null;
}

function reminders(s: State): T.Reminder[] {
  const out: T.Reminder[] = [];
  const add = (r: Omit<T.Reminder, 'id' | 'status' | 'source'>) =>
    r.remind_at && out.push({ ...r, id: `${r.kind}-${r.ref_id}-${r.remind_at}`, status: 'scheduled', source: 'auto' });
  s.tasks
    .filter((t) => !CLOSED.includes(t.status))
    .forEach((t) => {
      const at = reminderAt(s, t.due_date, s.prefs.task_lead_days);
      if (at) add({ kind: 'task', ref_id: t.id, title: `Due ${shortDate(t.due_date!)}: ${t.title}`, body: t.guidance.slice(0, 200), link: `/task/${t.id}`, remind_at: at });
    });
  s.bills.forEach((b) => {
    const at = reminderAt(s, b.next_due_date, s.prefs.bill_lead_days);
    if (at) add({ kind: 'bill', ref_id: b.id, title: `${b.name} $${b.amount.toFixed(2)} due ${shortDate(b.next_due_date)}`, body: '', link: '/finance', remind_at: at });
  });
  s.documents.forEach((d) =>
    s.prefs.document_lead_days.forEach((lead) => {
      if (!d.expires_on) return;
      const when = parseDate(addDays(d.expires_on, -lead));
      when.setHours(s.prefs.reminder_hour, 0, 0, 0);
      if (when.getTime() > Date.now())
        add({ kind: 'document', ref_id: d.id, title: `${d.label || d.doc_type} expires in ${lead} days`, body: '', link: '/documents', remind_at: when.toISOString() });
    }),
  );
  s.referrals
    .filter((r) => ['requested', 'accepted', 'scheduled'].includes(r.status))
    .forEach((r) => {
      const at = reminderAt(s, r.follow_up_date, s.prefs.follow_up_lead_days);
      if (at) add({ kind: 'follow_up', ref_id: r.id, title: `Follow up: ${r.recipient_name}`, body: '', link: `/referral/${r.id}`, remind_at: at });
    });
  return out.sort((a, b) => a.remind_at.localeCompare(b.remind_at));
}

// ---------------------------------------------------------------------------------
// Assistant (3.0) - offline answers from the reviewed sources

const STOP = new Set(
  'a an and are as at be by can do does for from how i if in is it me my of on or so that the this to was what when where which who will with you your should need'.split(' '),
);
const tokenize = (text: string) => (text.toLowerCase().match(/[a-z0-9']+/g) ?? []).filter((w) => !STOP.has(w));

const INDEX = (() => {
  const docs = SOURCES.map((src) => {
    const counts: Record<string, number> = {};
    tokenize([src.title, src.title, (src.tags.join(' ') + ' ').repeat(2), src.summary].join(' ')).forEach((w) => (counts[w] = (counts[w] ?? 0) + 1));
    return counts;
  });
  const df: Record<string, number> = {};
  docs.forEach((d) => Object.keys(d).forEach((w) => (df[w] = (df[w] ?? 0) + 1)));
  const avg = docs.reduce((n, d) => n + Object.values(d).reduce((a, b) => a + b, 0), 0) / docs.length;
  return { docs, df, avg };
})();

function searchSources(query: string, k = 4): [SourceRec, number][] {
  const { docs, df, avg } = INDEX;
  const n = docs.length;
  const terms = tokenize(query);
  const scored: [SourceRec, number][] = [];
  docs.forEach((doc, i) => {
    const len = Object.values(doc).reduce((a, b) => a + b, 0);
    let score = 0;
    for (const t of terms) {
      const tf = doc[t];
      if (!tf) continue;
      const idf = Math.log(1 + (n - df[t] + 0.5) / (df[t] + 0.5));
      score += (idf * tf * 2.2) / (tf + 1.2 * (0.25 + (0.75 * len) / avg));
    }
    if (score > 0) scored.push([SOURCES[i], score]);
  });
  return scored.sort((a, b) => b[1] - a[1]).slice(0, k);
}

const PROFESSIONAL = [
  /\bam i eligible\b/, /\bis my (?:application|case)\b/, /\bwill (?:my|i) (?:application|be approved|get)\b/,
  /\bchances?\b.*\b(?:approv|accept|refus)/, /\b(?:appeal|judicial review)\b/, /\brefus(?:al|ed)\b/, /\binadmissib/,
  /\bdeport/, /\bremoval order\b/, /\bmisrepresent/, /\bcriminal (?:record|charge)/, /\blose my (?:pr|status)\b/,
  /\bshould i (?:apply|sponsor|claim)\b/, /\bsponsor(?:ship)? (?:my|for)\b/, /\bcan i stay\b/, /\bout of status\b/,
  /\brestor(?:e|ation) (?:my )?status\b/, /\blegal advice\b/, /\bsue\b/, /\blawsuit\b/, /\btribunal\b/,
];
const PRO_REASON =
  'This depends on the details of your own case. A licensed immigration consultant or lawyer can give advice; SettleWise can only share general information.';

function sourceOut(src: SourceRec): T.Source {
  return { id: src.id, title: src.title, publisher: src.publisher, url: src.url, reviewed_on: src.reviewed_on, review_status: src.reviewed_on ? 'reviewed' : 'pending_review' };
}

function answerOut(q: QuestionRec): T.Answer {
  const { source_ids, ...rest } = q;
  return {
    ...rest,
    sources: source_ids.map((id) => SOURCES.find((x) => x.id === id)).filter((x): x is SourceRec => !!x).map(sourceOut),
    professional_service_types: q.needs_professional ? ['immigration_consultant', 'legal_clinic'] : [],
  };
}

function ask(s: State, question: string, lifeEventId: string | null): QuestionRec {
  const lower = question.toLowerCase();
  const pro = PROFESSIONAL.some((re) => re.test(lower));
  const hits = searchSources(question);
  let answer: string;
  let confidence: T.Answer['confidence'] = 'low';
  let uncertainty = '';
  let sourceIds: string[] = [];
  if (!hits.length) {
    answer = 'I could not find a reviewed source that covers this question. Try rephrasing it, or contact a free settlement agency who can help in person.';
    uncertainty = 'No reviewed source matched this question.';
  } else {
    const top = hits.slice(0, 2);
    answer = `Here is what the official sources say:\n\n${top.map(([src]) => `• ${src.title}: ${src.summary.trim()}`).join('\n\n')}`;
    sourceIds = top.map(([src]) => src.id);
    confidence = top[0][1] >= 4 ? 'medium' : 'low';
    if (confidence === 'low') uncertainty = 'These sources may only partly answer your question. Check the linked pages.';
  }
  if (pro && !sourceIds.includes('cicc-find-consultant')) sourceIds.push('cicc-find-consultant');
  const seen = new Set<string>();
  const actions: T.SuggestedAction[] = [];
  for (const tpl of TEMPLATES)
    for (const t of tpl.tasks)
      if ((t.source_ids ?? []).some((id) => sourceIds.includes(id)) && !seen.has(t.title) && actions.length < 3) {
        seen.add(t.title);
        actions.push({ title: t.title, category: t.category ?? 'general', added_task_id: null });
      }
  const q: QuestionRec = {
    id: newId(), question, answer, source_ids: sourceIds, confidence, uncertainty_note: uncertainty, needs_professional: pro,
    professional_reason: pro ? PRO_REASON : '', suggested_actions: actions, life_event_id: lifeEventId, model: 'offline', created_at: nowISO(),
  };
  s.questions.unshift(q);
  return q;
}

// ---------------------------------------------------------------------------------
// Router

const META: T.Meta = {
  version: '0.1.0-demo',
  phases: ['MVP'],
  skipped: { autofill: 'Growth phase not enabled', worker_portal: 'Enterprise phase not enabled' },
  plugins: [
    ['account', '10.0', 'Account Administration'], ['profile', '1.0', 'Newcomer Profile Hub'],
    ['planning', '2.0', 'Life Event Planning Engine'], ['assistant', '3.0', 'AI Settlement Assistant'],
    ['tasks', '4.0', 'Task & Dependency Management'], ['finance', '5.0', 'Financial Readiness Center'],
    ['referrals', '6.0', 'Referral & Handoff Management'], ['consent', '7.0', 'Consent & Privacy Center'],
    ['notifications', '9.0', 'Notifications & Reminders'],
  ].map(([name, feature_id, title]) => ({ name, feature_id, title, phase: 'MVP' as const, functions: {} })),
};

const PROFILE_OPTIONS: T.ProfileOptions = {
  immigration_statuses: ['permanent_resident', 'protected_person', 'work_permit', 'study_permit', 'visitor', 'citizen', 'other'],
  document_types: ['passport', 'pr_card', 'copr', 'work_permit', 'study_permit', 'sin_confirmation', 'health_card', 'drivers_licence', 'insurance_policy', 'lease', 'other'],
};

const token = (s: State): T.TokenResponse => ({ access_token: 'demo-token', token_type: 'bearer', user: s.user });

function docOut(d: DocRec): T.DocumentRecord {
  const { number_last4, ...rest } = d;
  return {
    ...rest,
    label: d.label || d.doc_type.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()),
    number_masked: number_last4 ? `•••• ${number_last4}` : '',
    days_until_expiry: d.expires_on ? daysFromToday(d.expires_on) : null,
  };
}

function patch<O extends object>(obj: O, body: Json, keys?: string[]): O {
  Object.entries(body ?? {}).forEach(([k, v]) => {
    if (v !== undefined && (!keys || keys.includes(k))) (obj as Json)[k] = v;
  });
  return obj;
}

function remove<T extends { id: string }>(list: T[], id: string, label: string) {
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) fail(404, `${label} not found`);
  list.splice(i, 1);
}

function route(method: string, path: string, q: Query, body: Json): unknown {
  const s = load();
  const m = (pattern: RegExp) => path.match(pattern);
  let r: RegExpMatchArray | null;

  // meta and account (10.0)
  if (path === '/meta') return META;
  if (path === '/auth/login') {
    if (!body?.email?.trim()) fail(422, 'email: Field required');
    return token(s);
  }
  if (path === '/auth/register') {
    state = emptyState({ id: newId(), email: body.email.toLowerCase(), full_name: body.full_name ?? '', role: 'newcomer', display_language: body.display_language ?? 'en', totp_enabled: false });
    return token(state);
  }
  if (path === '/auth/password/reset-request') return { status: 'If the account exists, a reset link has been sent.' };
  if (path === '/auth/password/change') return token(s);
  if (path === '/auth/logout-all') return undefined;
  if (path === '/auth/2fa/setup') return { secret: 'DEMO2FASECRETKEY', otpauth_url: '' };
  if ((r = m(/^\/auth\/2fa\/(enable|disable)$/))) {
    if (!/^\d{6}$/.test(body?.code ?? '')) fail(400, 'Verification code is incorrect');
    s.user.totp_enabled = r[1] === 'enable';
    return s.user;
  }
  if (path === '/account/me') return method === 'PATCH' ? patch(s.user, body, ['full_name', 'display_language']) : s.user;
  if (path === '/account/export') return JSON.parse(JSON.stringify(s));
  if (path === '/account/delete') {
    resetDemo();
    return undefined;
  }

  // profile (1.0)
  if (path === '/profile') return method === 'PUT' ? patch(s.profile, body) : s.profile;
  if (path === '/profile/options') return PROFILE_OPTIONS;
  if (path === '/profile/household') {
    if (method === 'POST') {
      const member = { id: newId(), full_name: body.full_name, relationship: body.relationship, date_of_birth: body.date_of_birth ?? null, notes: body.notes ?? '' };
      s.household.push(member);
      return member;
    }
    return s.household;
  }
  if ((r = m(/^\/profile\/household\/(\w+)$/))) return remove(s.household, r[1], 'Household member');
  if (path === '/profile/documents') {
    if (method === 'POST') {
      const num = String(body.number ?? '').replace(/[^a-z0-9]/gi, '');
      const doc: DocRec = { id: newId(), doc_type: body.doc_type, label: body.label ?? '', issuer: body.issuer ?? '', member_id: null, number_last4: num.slice(-4), issued_on: null, expires_on: body.expires_on ?? null, notes: '' };
      s.documents.push(doc);
      return docOut(doc);
    }
    return s.documents.map(docOut).sort((a, b) => (a.expires_on ?? '9').localeCompare(b.expires_on ?? '9'));
  }
  if ((r = m(/^\/profile\/documents\/(\w+)$/))) return remove(s.documents, r[1], 'Document');

  // planning (2.0)
  if (path === '/events/templates')
    return TEMPLATES.map((t) => ({ id: t.id, title: t.title, description: t.description ?? '', key_date_label: t.key_date_label ?? 'Key date', task_count: t.tasks.length }));
  if (path === '/events') {
    if (method === 'POST') {
      if (!body.key_date) fail(422, 'key_date: Field required');
      const ev = createEvent(body.event_type, body.key_date, body.title, body.notes ?? '');
      return { ...eventOut(s, ev), tasks: eventTasks(s, ev.id).map((t) => taskOut(s, t)) };
    }
    return s.events
      .filter((e) => !q.status || e.status === q.status)
      .sort((a, b) => a.key_date.localeCompare(b.key_date))
      .map((e) => eventOut(s, e));
  }
  if ((r = m(/^\/events\/(\w+)\/(close|reopen)$/))) {
    const ev = findEvent(s, r[1]);
    ev.status = r[2] === 'close' ? 'closed' : 'active';
    return eventOut(s, ev);
  }
  if ((r = m(/^\/events\/(\w+)\/progress$/))) return progress(s, findEvent(s, r[1]).id);
  if ((r = m(/^\/events\/(\w+)$/))) {
    const ev = findEvent(s, r[1]);
    if (method === 'DELETE') {
      s.tasks = s.tasks.filter((t) => t.life_event_id !== ev.id);
      s.costs = s.costs.filter((c) => c.life_event_id !== ev.id);
      s.referrals.forEach((x) => x.life_event_id === ev.id && (x.life_event_id = null));
      return remove(s.events, ev.id, 'Life event');
    }
    if (method === 'PATCH') return eventOut(s, patch(ev, body, ['title', 'notes']));
    return { ...eventOut(s, ev), tasks: eventTasks(s, ev.id).map((t) => taskOut(s, t)) };
  }

  // tasks (4.0)
  if (path === '/tasks') {
    if (method === 'POST') {
      if (!body.title?.trim()) fail(422, 'title: Field required');
      const position = body.life_event_id ? eventTasks(s, body.life_event_id).length : 0;
      const t: TaskRec = {
        id: newId(), life_event_id: body.life_event_id ?? null, title: body.title, description: body.description ?? '',
        category: body.category ?? 'general', owner: body.owner ?? 'me', priority: body.priority ?? 'medium', status: 'todo',
        due_date: body.due_date ?? null, position, date_sensitive: !!body.date_sensitive, external_party: body.external_party ?? '',
        guidance: '', source_ids: [], offset_days: null,
      };
      s.tasks.push(t);
      return taskOut(s, t);
    }
    return searchTasks(s, q);
  }
  if (path === '/tasks/reorder') {
    const tasks = eventTasks(s, body.life_event_id);
    const ids: string[] = body.task_ids;
    [...ids.map((id) => tasks.find((t) => t.id === id)!).filter(Boolean), ...tasks.filter((t) => !ids.includes(t.id))].forEach((t, i) => (t.position = i));
    return eventTasks(s, body.life_event_id).map((t) => taskOut(s, t));
  }
  if ((r = m(/^\/tasks\/(\w+)\/dependencies\/(\w+)$/))) {
    s.deps = s.deps.filter(([t, d]) => !(t === r![1] && d === r![2]));
    return taskOut(s, findTask(s, r[1]));
  }
  if ((r = m(/^\/tasks\/(\w+)\/dependencies$/))) {
    const t = findTask(s, r[1]);
    const dep = findTask(s, body.depends_on_id);
    if (t.id === dep.id || wouldCycle(s, t.id, dep.id)) fail(409, 'That link would create a loop of tasks waiting on each other');
    if (!s.deps.some(([a, b]) => a === t.id && b === dep.id)) s.deps.push([t.id, dep.id]);
    return taskOut(s, t);
  }
  if ((r = m(/^\/tasks\/(\w+)$/))) {
    const t = findTask(s, r[1]);
    if (method === 'DELETE') {
      s.deps = s.deps.filter(([a, b]) => a !== t.id && b !== t.id);
      return remove(s.tasks, t.id, 'Task');
    }
    if (method === 'PATCH') {
      const { status, ...rest } = body;
      if (status !== undefined) {
        const waiting = blockedBy(s, t);
        if (['in_progress', 'done'].includes(status) && waiting.length && q.force !== 'true')
          fail(409, { message: 'Finish the prerequisite tasks first', blocked_by: waiting.map((id) => findTask(s, id).title) });
        t.status = status;
      }
      if ('due_date' in rest) t.offset_days = null;
      patch(t, rest, ['title', 'description', 'category', 'owner', 'priority', 'due_date', 'external_party', 'date_sensitive']);
    }
    return taskOut(s, t);
  }

  // impact (4.4)
  if (path === '/impact/preview') {
    const ev = findEvent(s, body.life_event_id);
    if (ev.status !== 'active') fail(409, 'This life event is closed');
    if (body.new_key_date === ev.key_date) fail(422, 'The new date is the same as the current date');
    s.reviews.forEach((x) => x.life_event_id === ev.id && x.status === 'pending' && (x.status = 'superseded'));
    const items = proposeImpact(s, ev, body.new_key_date);
    const review: T.ImpactReview = {
      id: newId(), life_event_id: ev.id, old_date: ev.key_date, new_date: body.new_key_date,
      delta_days: daysFromToday(body.new_key_date) - daysFromToday(ev.key_date), status: 'pending', items,
      approved_item_ids: [], summary: summarize(items),
    };
    s.reviews.push(review);
    return review;
  }
  if ((r = m(/^\/impact\/(\w+)(?:\/(apply|dismiss))?$/))) {
    const review = s.reviews.find((x) => x.id === r![1]) ?? fail(404, 'Impact review not found');
    if (r[2] === 'apply') {
      if (review.status !== 'pending') fail(409, `This review is already ${review.status}`);
      applyImpact(s, review, new Set(body.approved_item_ids));
    } else if (r[2] === 'dismiss' && review.status === 'pending') review.status = 'dismissed';
    return review;
  }

  // assistant (3.0)
  if (path === '/assistant/status') return { mode: 'offline', model: null };
  if (path === '/assistant/sources') return SOURCES.map(sourceOut);
  if (path === '/assistant/history') return s.questions.map(answerOut);
  if (path === '/assistant/ask') {
    if ((body.question ?? '').trim().length < 3) fail(422, 'question: too short');
    return answerOut(ask(s, body.question.trim(), body.life_event_id ?? null));
  }
  if ((r = m(/^\/assistant\/history\/(\w+)\/actions\/(\d+)$/))) {
    const question = s.questions.find((x) => x.id === r![1]) ?? fail(404, 'Question not found');
    const action = question.suggested_actions[Number(r[2])] ?? fail(404, 'Suggestion not found');
    if (!action.added_task_id) {
      const eventId = body?.life_event_id ?? question.life_event_id;
      const t: TaskRec = {
        id: newId(), life_event_id: eventId ?? null, title: action.title, description: '', category: action.category, owner: 'me',
        priority: 'medium', status: 'todo', due_date: null, position: eventId ? eventTasks(s, eventId).length : 0,
        date_sensitive: false, external_party: '', guidance: 'Suggested by the SettleWise assistant.', source_ids: question.source_ids, offset_days: null,
      };
      s.tasks.push(t);
      action.added_task_id = t.id;
    }
    return answerOut(question);
  }

  // finance (5.0)
  if (path === '/finance/overview') {
    const lines = activeLines(s);
    const income = lines.filter((l) => l.kind === 'income').reduce((n, l) => n + l.amount, 0);
    const planned = lines.filter((l) => l.kind === 'expense').reduce((n, l) => n + l.amount, 0);
    const bills = s.bills.reduce((n, b) => n + b.amount * (MONTHLY_FACTOR[b.frequency] ?? 1), 0);
    const soon = addDays(todayISO(), 30);
    return {
      monthly_income: income, monthly_planned_expenses: planned, monthly_bills: Math.round(bills * 100) / 100,
      monthly_surplus: Math.round((income - planned - bills) * 100) / 100,
      bills_due_30_days: s.bills.filter((b) => b.next_due_date <= soon),
      goals: s.goals.map((g) => ({ ...g, percent: g.target_amount ? Math.round((100 * g.saved_amount) / g.target_amount) : 0 })),
    };
  }
  if (path === '/finance/forecast') return forecast(s, Number(q.days ?? 90), Number(q.starting_balance ?? 0));
  if (path === '/finance/budgets') {
    if (method === 'POST') {
      const b: BudgetRec = { id: newId(), name: body.name, life_event_id: body.life_event_id ?? null, is_active: true };
      s.budgets.push(b);
      return { ...b, lines: [] };
    }
    return s.budgets.map((b) => ({ ...b, lines: s.lines.filter((l) => l.budget_id === b.id) }));
  }
  if ((r = m(/^\/finance\/budgets\/(\w+)\/lines$/))) {
    const line: T.BudgetLine = { id: newId(), budget_id: r[1], kind: body.kind, category: body.category ?? 'general', label: body.label, amount: body.amount, day_of_month: body.day_of_month ?? 1 };
    s.lines.push(line);
    return line;
  }
  if ((r = m(/^\/finance\/lines\/(\w+)$/))) return remove(s.lines, r[1], 'Budget line');
  if (path === '/finance/bills') {
    if (method === 'POST') {
      const bill: T.Bill = { id: newId(), name: body.name, provider: body.provider ?? '', category: body.category ?? 'utilities', amount: body.amount, frequency: body.frequency ?? 'monthly', next_due_date: body.next_due_date, autopay: !!body.autopay, notes: body.notes ?? '' };
      s.bills.push(bill);
      return bill;
    }
    return s.bills.slice().sort((a, b) => a.next_due_date.localeCompare(b.next_due_date));
  }
  if ((r = m(/^\/finance\/bills\/(\w+)\/paid$/))) {
    const bill = s.bills.find((b) => b.id === r![1]) ?? fail(404, 'Bill not found');
    bill.next_due_date = nextOccurrence(bill.next_due_date, bill.frequency) ?? fail(409, 'One-time bill - delete it once paid');
    return bill;
  }
  if ((r = m(/^\/finance\/bills\/(\w+)$/))) return remove(s.bills, r[1], 'Bill');
  if (path === '/finance/goals') {
    if (method === 'POST') {
      const goal: T.SavingsGoal = { id: newId(), name: body.name, kind: body.kind ?? 'custom', target_amount: body.target_amount, saved_amount: body.saved_amount ?? 0, target_date: body.target_date ?? null };
      s.goals.push(goal);
      return goal;
    }
    return s.goals;
  }
  if ((r = m(/^\/finance\/goals\/(\w+)\/contribute$/))) {
    const goal = s.goals.find((g) => g.id === r![1]) ?? fail(404, 'Savings goal not found');
    goal.saved_amount = Math.round((goal.saved_amount + Number(body.amount)) * 100) / 100;
    return goal;
  }
  if (path === '/finance/expenses') {
    if (method === 'POST') {
      const e: T.Expense = { id: newId(), amount: body.amount, category: body.category ?? 'general', spent_on: body.spent_on, note: body.note ?? '', budget_id: body.budget_id ?? null, life_event_id: body.life_event_id ?? null };
      s.expenses.push(e);
      return e;
    }
    return s.expenses.filter((e) => !q.month || e.spent_on.startsWith(q.month));
  }
  if (path === '/finance/event-costs')
    return s.costs.filter((c) => !q.life_event_id || c.life_event_id === q.life_event_id).sort((a, b) => a.due_date.localeCompare(b.due_date));

  // referrals (6.0)
  if (path === '/providers/service-types') return [...new Set(s.providers.flatMap((p) => p.service_types))].sort();
  if (path === '/providers')
    return s.providers.filter(
      (p) =>
        (!q.service_type || p.service_types.includes(q.service_type)) &&
        (!q.city || p.city.toLowerCase() === q.city.toLowerCase()) &&
        (!q.province || p.province === q.province.toUpperCase()) &&
        (!q.language || p.languages.some((l) => l.toLowerCase() === q.language!.toLowerCase())) &&
        (!q.q || `${p.name} ${p.description}`.toLowerCase().includes(q.q.toLowerCase())),
    );
  if (path === '/referrals') {
    if (method === 'POST') return referralOut(createReferral(body));
    return s.referrals
      .filter(
        (x) =>
          (!q.life_event_id || x.life_event_id === q.life_event_id) &&
          (!q.status || x.status === q.status) &&
          (q.open_only !== 'true' || !['completed', 'cancelled', 'declined'].includes(x.status)),
      )
      .slice()
      .reverse()
      .map(referralOut);
  }
  if ((r = m(/^\/referrals\/(\w+)\/status$/))) {
    const ref = s.referrals.find((x) => x.id === r![1]) ?? fail(404, 'Referral not found');
    if (!STATUS_FLOW[ref.status].includes(body.status))
      fail(409, `Cannot move from ${ref.status} to ${body.status}. Allowed: ${STATUS_FLOW[ref.status].join(', ') || 'none'}`);
    ref.status = body.status;
    ref.next_owner = NEXT_OWNER[body.status];
    if (body.scheduled_for) {
      ref.scheduled_for = body.scheduled_for;
      ref.follow_up_date = addDays(body.scheduled_for, 1);
    }
    if (body.outcome !== undefined) ref.outcome = body.outcome;
    if (['completed', 'cancelled'].includes(body.status)) ref.follow_up_date = null;
    ref.history.push({ status: body.status, note: body.note ?? '', by: 'self', created_at: nowISO() });
    return referralOut(ref);
  }
  if ((r = m(/^\/referrals\/(\w+)$/))) {
    const ref = s.referrals.find((x) => x.id === r![1]) ?? fail(404, 'Referral not found');
    if (method === 'DELETE') return remove(s.referrals, ref.id, 'Referral');
    if (method === 'PATCH') patch(ref, body, ['next_owner', 'follow_up_date', 'reason', 'info_needed']);
    return referralOut(ref);
  }

  // consent (7.0)
  if (path === '/consent/fields') return FIELD_CATALOGUE;
  if (path === '/consent/audit') return s.audit;
  if (path === '/consent/grants') {
    if (method === 'POST') {
      if (!body.fields?.length) fail(422, 'fields: choose at least one field');
      return grantOut(
        createGrant(s, { recipient_type: body.recipient_type, recipient_name: body.recipient_name, recipient_email: body.recipient_email ?? '', fields: [...body.fields].sort(), purpose: body.purpose }, body.duration_days ?? 30),
      );
    }
    return s.grants.map(grantOut);
  }
  if ((r = m(/^\/consent\/grants\/(\w+)\/revoke$/))) {
    const g = s.grants.find((x) => x.id === r![1]) ?? fail(404, 'Sharing permission not found');
    if (!g.revoked_at) {
      g.revoked_at = nowISO();
      audit(s, 'grant_revoked', `Access withdrawn from ${g.recipient_name}`, g.fields);
    }
    return grantOut(g);
  }
  if (path === '/consent/requests') return s.requests;
  if ((r = m(/^\/consent\/requests\/(\w+)\/(approve|decline)$/))) {
    const req = s.requests.find((x) => x.id === r![1]) ?? fail(404, 'Access request not found');
    if (req.status !== 'pending') fail(409, `This request is already ${req.status}`);
    if (r[2] === 'decline') {
      req.status = 'declined';
      audit(s, 'request_declined', `Declined ${req.requester_name}`, req.fields);
      return req;
    }
    req.status = 'approved';
    const grant = createGrant(s, { recipient_type: 'advisor', recipient_name: req.requester_name, recipient_email: '', fields: req.fields, purpose: req.purpose }, req.duration_days);
    audit(s, 'viewed', 'worker portal: monitor progress (sample access)', req.fields, req.requester_name);
    return grantOut(grant);
  }

  // notifications (9.0)
  if (path === '/notifications') return s.notifications.filter((n) => (q.status ? n.status === q.status : ['unread', 'read'].includes(n.status)));
  if (path === '/notifications/unread-count') return { unread: s.notifications.filter((n) => n.status === 'unread').length };
  if (path === '/notifications/read-all') {
    s.notifications.forEach((n) => n.status === 'unread' && (n.status = 'read'));
    return undefined;
  }
  if ((r = m(/^\/notifications\/(\w+)\/action$/))) {
    const n = s.notifications.find((x) => x.id === r![1]) ?? fail(404, 'Notification not found');
    const map: Record<string, T.AppNotification['status']> = { read: 'read', unread: 'unread', done: 'done', dismiss: 'dismissed', snooze: 'snoozed' };
    n.status = map[body.action] ?? n.status;
    n.snoozed_until = body.action === 'snooze' ? new Date(Date.now() + 86_400_000).toISOString() : null;
    return n;
  }
  if (path === '/notifications/reminders') return reminders(s);
  if (path === '/notifications/preferences') return method === 'PUT' ? patch(s.prefs, body) : s.prefs;
  if (path === '/notifications/push-tokens') return undefined;

  return fail(404, 'This feature is not available in the web demo');
}

/** Handle one API call in the browser. Mutations are saved to localStorage. */
export async function demoApi(method: string, path: string, query: Query, body: unknown): Promise<unknown> {
  await new Promise((resolve) => setTimeout(resolve, 60)); // feel like a network call
  const result = route(method, path, query, body ?? {});
  if (method !== 'GET') save();
  return result === undefined ? undefined : JSON.parse(JSON.stringify(result));
}
