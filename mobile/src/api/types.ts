// Mirrors the SettleWise API schemas (backend/settlewise/plugins/*).

export type ISODate = string; // YYYY-MM-DD
export type ISODateTime = string;

export interface User {
  id: string;
  email: string;
  full_name: string;
  role: 'newcomer' | 'worker' | 'admin';
  display_language: string;
  totp_enabled: boolean;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export interface PluginManifest {
  name: string;
  feature_id: string;
  title: string;
  phase: 'MVP' | 'Growth' | 'Enterprise';
  functions: Record<string, string>;
}

export interface Meta {
  version: string;
  phases: string[];
  plugins: PluginManifest[];
  skipped: Record<string, string>;
}

// 1.0 Profile
export interface Profile {
  immigration_status: string;
  arrival_date: ISODate | null;
  country_of_origin: string;
  preferred_language: string;
  phone: string;
  contact_email: string;
  address_line: string;
  city: string;
  province: string;
  postal_code: string;
  employment_status: string;
  has_vehicle: boolean;
}

export interface HouseholdMember {
  id: string;
  full_name: string;
  relationship: string;
  date_of_birth: ISODate | null;
  notes: string;
}

export interface DocumentRecord {
  id: string;
  doc_type: string;
  label: string;
  issuer: string;
  member_id: string | null;
  number_masked: string;
  issued_on: ISODate | null;
  expires_on: ISODate | null;
  days_until_expiry: number | null;
  notes: string;
}

export interface ProfileOptions {
  immigration_statuses: string[];
  document_types: string[];
}

// 2.0 Planning
export interface Progress {
  completed: number;
  upcoming: number;
  overdue: number;
  blocked: number;
  needs_review: number;
  skipped: number;
  total: number;
  completion_percent: number;
  score_note: string;
  next_task_id: string | null;
  next_task_title: string | null;
}

export interface LifeEventTemplate {
  id: string;
  title: string;
  description: string;
  key_date_label: string;
  task_count: number;
}

export interface LifeEvent {
  id: string;
  event_type: string;
  title: string;
  key_date: ISODate;
  key_date_label: string;
  status: 'active' | 'closed';
  notes: string;
  progress: Progress;
}

export interface LifeEventDetail extends LifeEvent {
  tasks: Task[];
}

// 4.0 Tasks
export type TaskStatus = 'todo' | 'in_progress' | 'needs_review' | 'done' | 'skipped';

export interface Task {
  id: string;
  life_event_id: string | null;
  title: string;
  description: string;
  category: string;
  owner: string;
  priority: 'low' | 'medium' | 'high';
  status: TaskStatus;
  due_date: ISODate | null;
  position: number;
  date_sensitive: boolean;
  external_party: string;
  guidance: string;
  source_ids: string[];
  offset_days: number | null;
  depends_on: string[];
  blocked_by: string[];
  overdue: boolean;
}

export interface ImpactItem {
  id: string;
  plugin: string;
  kind: string;
  ref_id: string;
  title: string;
  category: string;
  reason: string;
  current_value: string | null;
  proposed_value: string | null;
  action: 'reschedule' | 'review' | 'recalculate' | 'info';
  requires_external_confirmation: boolean;
}

export interface ImpactReview {
  id: string;
  life_event_id: string;
  old_date: ISODate;
  new_date: ISODate;
  delta_days: number;
  status: 'pending' | 'applied' | 'dismissed' | 'superseded';
  items: ImpactItem[];
  approved_item_ids: string[];
  summary: Record<string, number>;
}

// 3.0 Assistant
export interface Source {
  id: string;
  title: string;
  publisher: string;
  url: string;
  reviewed_on: ISODate | null;
  review_status: 'reviewed' | 'pending_review';
}

export interface SuggestedAction {
  title: string;
  category: string;
  added_task_id: string | null;
}

export interface Answer {
  id: string;
  question: string;
  answer: string;
  sources: Source[];
  confidence: 'high' | 'medium' | 'low';
  uncertainty_note: string;
  needs_professional: boolean;
  professional_reason: string;
  professional_service_types: string[];
  suggested_actions: SuggestedAction[];
  life_event_id: string | null;
  model: string;
  created_at: ISODateTime;
}

// 5.0 Finance
export interface BudgetLine {
  id: string;
  budget_id: string;
  kind: 'income' | 'expense';
  category: string;
  label: string;
  amount: number;
  day_of_month: number;
}

export interface Budget {
  id: string;
  name: string;
  life_event_id: string | null;
  is_active: boolean;
  lines: BudgetLine[];
}

export interface Bill {
  id: string;
  name: string;
  provider: string;
  category: string;
  amount: number;
  frequency: 'once' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';
  next_due_date: ISODate;
  autopay: boolean;
  notes: string;
}

export interface SavingsGoal {
  id: string;
  name: string;
  kind: string;
  target_amount: number;
  saved_amount: number;
  target_date: ISODate | null;
  percent?: number;
}

export interface Expense {
  id: string;
  amount: number;
  category: string;
  spent_on: ISODate;
  note: string;
  budget_id: string | null;
  life_event_id: string | null;
}

export interface EventCost {
  id: string;
  life_event_id: string;
  label: string;
  category: string;
  amount: number;
  due_date: ISODate;
  paid: boolean;
  offset_days: number | null;
}

export interface FinanceOverview {
  monthly_income: number;
  monthly_planned_expenses: number;
  monthly_bills: number;
  monthly_surplus: number;
  bills_due_30_days: Bill[];
  goals: SavingsGoal[];
}

export interface Forecast {
  start_date: ISODate;
  end_date: ISODate;
  starting_balance: number;
  ending_balance: number;
  lowest: { date: ISODate; balance: number };
  points: { date: ISODate; balance: number }[];
  flows: { date: ISODate; label: string; amount: number; source: string; life_event_id?: string }[];
  warnings: string[];
}

// 6.0 Referrals
export interface Provider {
  id: string;
  name: string;
  service_types: string[];
  city: string;
  province: string;
  phone: string;
  website: string;
  languages: string[];
  description: string;
  reviewed_on: ISODate | null;
  is_sample: boolean;
}

export type ReferralStatus = 'requested' | 'accepted' | 'scheduled' | 'completed' | 'declined' | 'cancelled';

export interface Referral {
  id: string;
  recipient_name: string;
  provider_id: string | null;
  service_type: string;
  reason: string;
  info_needed: string[];
  life_event_id: string | null;
  task_id: string | null;
  status: ReferralStatus;
  next_owner: 'me' | 'provider' | 'household' | 'none';
  follow_up_date: ISODate | null;
  scheduled_for: ISODate | null;
  outcome: string;
  created_by: string;
  follow_up_overdue: boolean;
  allowed_transitions: ReferralStatus[];
  history: { status: string; note: string; by: string; created_at: ISODateTime }[];
}

// 7.0 Consent
export interface Grant {
  id: string;
  recipient_type: 'advisor' | 'provider' | 'household' | 'other';
  recipient_name: string;
  recipient_email: string;
  fields: string[];
  purpose: string;
  created_at: ISODateTime;
  expires_at: ISODateTime;
  revoked_at: ISODateTime | null;
  status: 'active' | 'expired' | 'revoked';
  recipient_has_account: boolean;
}

export interface AuditEntry {
  id: string;
  actor_label: string;
  action: string;
  resource: string;
  fields: string[];
  detail: string;
  created_at: ISODateTime;
}

export interface AccessRequest {
  id: string;
  requester_name: string;
  requester_type: string;
  fields: string[];
  purpose: string;
  duration_days: number;
  status: 'pending' | 'approved' | 'declined';
  created_at: ISODateTime;
}

// 8.0 Worker portal
export interface ClientSummary {
  client_id: string;
  name: string;
  grant_id: string;
  fields: string[];
  purpose: string;
  expires_at: ISODateTime;
  open_tasks: number | null;
  overdue_tasks: number | null;
  open_referrals: number | null;
}

export interface FollowUpNote {
  id: string;
  note: string;
  next_step: string;
  next_contact_date: ISODate | null;
  contact_method: string;
  created_at: ISODateTime;
}

export interface SharedView {
  contact?: { full_name: string; phone: string; email: string };
  address?: { address_line: string; city: string; province: string; postal_code: string };
  status?: { immigration_status: string; arrival_date: ISODate | null };
  household?: { full_name: string; relationship: string }[];
  documents?: Omit<DocumentRecord, 'number_masked'>[];
  plans?: { id: string; title: string; event_type: string; key_date: ISODate; status: string; progress: Progress }[];
  tasks?: { id: string; title: string; status: string; category: string; due_date: ISODate | null; overdue: boolean }[];
  referrals?: { id: string; recipient_name: string; status: string; next_owner: string; follow_up_date: ISODate | null; reason: string }[];
  finance_summary?: { monthly_income: number; monthly_planned_expenses: number };
}

// 9.0 Notifications
export interface AppNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string;
  status: 'unread' | 'read' | 'done' | 'dismissed' | 'snoozed';
  snoozed_until: ISODateTime | null;
  created_at: ISODateTime;
}

export interface Reminder {
  id: string;
  kind: string;
  ref_id: string | null;
  title: string;
  body: string;
  link: string;
  remind_at: ISODateTime;
  status: string;
  source: 'auto' | 'manual';
}

export interface NotificationPrefs {
  push_enabled: boolean;
  email_enabled: boolean;
  timezone: string;
  quiet_start: string;
  quiet_end: string;
  reminder_hour: number;
  task_lead_days: number;
  bill_lead_days: number;
  follow_up_lead_days: number;
  document_lead_days: number[];
}
