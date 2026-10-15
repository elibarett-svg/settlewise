import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';

import { api } from './client';
import type * as T from './types';

type Q = Record<string, string | number | boolean | null | undefined>;

export const keys = {
  meta: ['meta'] as const,
  me: ['me'] as const,
  profile: ['profile'] as const,
  profileOptions: ['profile', 'options'] as const,
  household: ['household'] as const,
  documents: ['documents'] as const,
  templates: ['templates'] as const,
  events: (status?: string) => ['events', status ?? 'all'] as const,
  event: (id: string) => ['event', id] as const,
  tasks: (q?: Q) => ['tasks', q ?? {}] as const,
  task: (id: string) => ['task', id] as const,
  impact: (id: string) => ['impact', id] as const,
  history: ['assistant', 'history'] as const,
  assistantStatus: ['assistant', 'status'] as const,
  finance: ['finance'] as const,
  providers: (q?: Q) => ['providers', q ?? {}] as const,
  referrals: (q?: Q) => ['referrals', q ?? {}] as const,
  referral: (id: string) => ['referral', id] as const,
  grants: ['consent', 'grants'] as const,
  consentFields: ['consent', 'fields'] as const,
  audit: ['consent', 'audit'] as const,
  requests: ['consent', 'requests'] as const,
  notifications: ['notifications'] as const,
  unread: ['notifications', 'unread'] as const,
  reminders: ['notifications', 'reminders'] as const,
  prefs: ['notifications', 'prefs'] as const,
  clients: ['worker', 'clients'] as const,
  client: (id: string) => ['worker', 'client', id] as const,
  notes: (id: string) => ['worker', 'notes', id] as const,
};

/** Data that changes together when plans, tasks or dates change. */
const PLAN_KEYS: QueryKey[] = [['events'], ['event'], ['tasks'], ['task'], ['finance'], ['referrals'], ['notifications']];

export function useApiMutation<TVars, TResult = unknown>(
  fn: (vars: TVars) => Promise<TResult>,
  invalidate: QueryKey[] = PLAN_KEYS,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => Promise.all(invalidate.map((key) => qc.invalidateQueries({ queryKey: key }))),
  });
}

// --- meta / account ---------------------------------------------------------------
export const useMeta = () => useQuery({ queryKey: keys.meta, queryFn: () => api<T.Meta>('/meta'), staleTime: 300_000 });

export function useFeatures() {
  const { data } = useMeta();
  const enabled = new Set(data?.plugins.map((p) => p.name) ?? []);
  return { ready: !!data, has: (name: string) => enabled.has(name), meta: data };
}

// --- profile -----------------------------------------------------------------------
export const useProfile = () => useQuery({ queryKey: keys.profile, queryFn: () => api<T.Profile>('/profile') });
export const useProfileOptions = () =>
  useQuery({ queryKey: keys.profileOptions, queryFn: () => api<T.ProfileOptions>('/profile/options'), staleTime: Infinity });
export const useHousehold = () =>
  useQuery({ queryKey: keys.household, queryFn: () => api<T.HouseholdMember[]>('/profile/household') });
export const useDocuments = () =>
  useQuery({ queryKey: keys.documents, queryFn: () => api<T.DocumentRecord[]>('/profile/documents') });

// --- planning / tasks --------------------------------------------------------------
export const useTemplates = () =>
  useQuery({ queryKey: keys.templates, queryFn: () => api<T.LifeEventTemplate[]>('/events/templates'), staleTime: Infinity });
export const useEvents = (status?: string) =>
  useQuery({ queryKey: keys.events(status), queryFn: () => api<T.LifeEvent[]>('/events', { query: { status } }) });
export const useEvent = (id: string) =>
  useQuery({ queryKey: keys.event(id), queryFn: () => api<T.LifeEventDetail>(`/events/${id}`), enabled: !!id });
export const useTasks = (q?: Q) =>
  useQuery({ queryKey: keys.tasks(q), queryFn: () => api<T.Task[]>('/tasks', { query: q }) });
export const useTask = (id: string) =>
  useQuery({ queryKey: keys.task(id), queryFn: () => api<T.Task>(`/tasks/${id}`), enabled: !!id });
export const useImpact = (id: string) =>
  useQuery({ queryKey: keys.impact(id), queryFn: () => api<T.ImpactReview>(`/impact/${id}`), enabled: !!id });

// --- assistant ---------------------------------------------------------------------
export const useHistory = () =>
  useQuery({ queryKey: keys.history, queryFn: () => api<T.Answer[]>('/assistant/history') });
export const useAssistantStatus = () =>
  useQuery({
    queryKey: keys.assistantStatus,
    queryFn: () => api<{ mode: 'claude' | 'offline'; model: string | null }>('/assistant/status'),
  });

// --- finance -----------------------------------------------------------------------
export const useFinanceOverview = () =>
  useQuery({ queryKey: [...keys.finance, 'overview'], queryFn: () => api<T.FinanceOverview>('/finance/overview') });
export const useForecast = (days: number, startingBalance: number) =>
  useQuery({
    queryKey: [...keys.finance, 'forecast', days, startingBalance],
    queryFn: () => api<T.Forecast>('/finance/forecast', { query: { days, starting_balance: startingBalance } }),
  });
export const useBudgets = () => useQuery({ queryKey: [...keys.finance, 'budgets'], queryFn: () => api<T.Budget[]>('/finance/budgets') });
export const useBills = () => useQuery({ queryKey: [...keys.finance, 'bills'], queryFn: () => api<T.Bill[]>('/finance/bills') });
export const useGoals = () => useQuery({ queryKey: [...keys.finance, 'goals'], queryFn: () => api<T.SavingsGoal[]>('/finance/goals') });
export const useExpenses = (month?: string) =>
  useQuery({ queryKey: [...keys.finance, 'expenses', month], queryFn: () => api<T.Expense[]>('/finance/expenses', { query: { month } }) });
export const useEventCosts = (lifeEventId?: string) =>
  useQuery({
    queryKey: [...keys.finance, 'costs', lifeEventId],
    queryFn: () => api<T.EventCost[]>('/finance/event-costs', { query: { life_event_id: lifeEventId } }),
  });

// --- referrals ---------------------------------------------------------------------
export const useProviders = (q?: Q) =>
  useQuery({ queryKey: keys.providers(q), queryFn: () => api<T.Provider[]>('/providers', { query: q }) });
export const useServiceTypes = () =>
  useQuery({ queryKey: ['providers', 'types'], queryFn: () => api<string[]>('/providers/service-types'), staleTime: Infinity });
export const useReferrals = (q?: Q) =>
  useQuery({ queryKey: keys.referrals(q), queryFn: () => api<T.Referral[]>('/referrals', { query: q }) });
export const useReferral = (id: string) =>
  useQuery({ queryKey: keys.referral(id), queryFn: () => api<T.Referral>(`/referrals/${id}`), enabled: !!id });

// --- consent -----------------------------------------------------------------------
export const useGrants = () => useQuery({ queryKey: keys.grants, queryFn: () => api<T.Grant[]>('/consent/grants') });
export const useConsentFields = () =>
  useQuery({ queryKey: keys.consentFields, queryFn: () => api<Record<string, string>>('/consent/fields'), staleTime: Infinity });
export const useAudit = () => useQuery({ queryKey: keys.audit, queryFn: () => api<T.AuditEntry[]>('/consent/audit') });
export const useAccessRequests = () =>
  useQuery({ queryKey: keys.requests, queryFn: () => api<T.AccessRequest[]>('/consent/requests') });

// --- notifications -----------------------------------------------------------------
export const useNotifications = () =>
  useQuery({ queryKey: keys.notifications, queryFn: () => api<T.AppNotification[]>('/notifications') });
export const useUnreadCount = () =>
  useQuery({
    queryKey: keys.unread,
    queryFn: () => api<{ unread: number }>('/notifications/unread-count'),
    refetchInterval: 60_000,
  });
export const useReminders = () =>
  useQuery({ queryKey: keys.reminders, queryFn: () => api<T.Reminder[]>('/notifications/reminders') });
export const usePrefs = () =>
  useQuery({ queryKey: keys.prefs, queryFn: () => api<T.NotificationPrefs>('/notifications/preferences') });

// --- worker portal -----------------------------------------------------------------
export const useClients = () => useQuery({ queryKey: keys.clients, queryFn: () => api<T.ClientSummary[]>('/worker/clients') });
export const useClient = (id: string) =>
  useQuery({ queryKey: keys.client(id), queryFn: () => api<T.SharedView>(`/worker/clients/${id}`), enabled: !!id });
export const useClientNotes = (id: string) =>
  useQuery({ queryKey: keys.notes(id), queryFn: () => api<T.FollowUpNote[]>(`/worker/clients/${id}/notes`), enabled: !!id });
