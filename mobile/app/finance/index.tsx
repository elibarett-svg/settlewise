import { useState } from 'react';
import { View } from 'react-native';

import { api } from '../../src/api/client';
import { useApiMutation, useBills, useBudgets, useFinanceOverview, useForecast, useGoals } from '../../src/api/hooks';
import type { Bill, Forecast } from '../../src/api/types';
import { Badge, Body, Button, Card, ChipGroup, DateField, Heading, ListRow, Muted, ProgressBar, QueryView, Row, Screen, Section, Sheet, SwitchRow, TextField } from '../../src/components/ui';
import { confirm, showError } from '../../src/lib/alerts';
import { formatDate, money, relativeDay, todayISO } from '../../src/lib/format';
import { spacing, useColors } from '../../src/theme';

type SheetKind = null | 'line' | 'bill' | 'goal' | 'expense' | 'contribute';
const num = (v: string) => Number(v.replace(/[^0-9.]/g, '')) || 0;

/** 5.0 Financial Readiness Center. */
export default function Finance() {
  const c = useColors();
  const [balance, setBalance] = useState('2000');
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [goalId, setGoalId] = useState<string | null>(null);
  const overview = useFinanceOverview();
  const forecast = useForecast(90, num(balance));
  const budgets = useBudgets();
  const bills = useBills();
  const goals = useGoals();
  const budget = budgets.data?.[0];

  const post = useApiMutation(({ path, body }: { path: string; body?: object }) => api(path, { method: 'POST', body }), [['finance']]);
  const del = useApiMutation((path: string) => api(path, { method: 'DELETE' }), [['finance']]);
  const run = (path: string, body?: object) => post.mutate({ path, body }, { onSuccess: () => setSheet(null), onError: (e) => showError(e) });

  const ensureBudget = async () => budget?.id ?? (await api<{ id: string }>('/finance/budgets', { method: 'POST', body: { name: 'Monthly budget' } })).id;

  return (
    <Screen onRefresh={() => Promise.all([overview.refetch(), forecast.refetch(), budgets.refetch(), bills.refetch(), goals.refetch()])} refreshing={overview.isRefetching}>
      <QueryView query={overview}>
        {(o) => (
          <Card>
            <Muted>Monthly surplus</Muted>
            <Heading style={{ fontSize: 28, color: o.monthly_surplus < 0 ? c.danger : c.success }}>{money(o.monthly_surplus)}</Heading>
            <Row style={{ justifyContent: 'space-between' }}>
              <Muted>Income {money(o.monthly_income)}</Muted>
              <Muted>Planned {money(o.monthly_planned_expenses)}</Muted>
              <Muted>Bills {money(o.monthly_bills)}</Muted>
            </Row>
          </Card>
        )}
      </QueryView>

      <Section title="90-day cash flow">
        <TextField label="Current balance" value={balance} onChangeText={setBalance} keyboardType="decimal-pad" />
        <QueryView query={forecast}>{(f) => <ForecastChart forecast={f} />}</QueryView>
      </Section>

      <Section title="Budget" action={<Button small variant="ghost" icon="add" title="Line" onPress={() => setSheet('line')} />}>
        <Card style={{ paddingVertical: spacing.xs }}>
          {!budget?.lines.length && <Muted>Add your income and planned monthly spending.</Muted>}
          {budget?.lines.map((line) => (
            <ListRow
              key={line.id}
              icon={line.kind === 'income' ? 'arrow-down-circle-outline' : 'arrow-up-circle-outline'}
              tone={line.kind === 'income' ? 'success' : 'neutral'}
              title={line.label}
              subtitle={`${line.category} · day ${line.day_of_month}`}
              right={<Body style={{ fontWeight: '600' }}>{money(line.amount)}</Body>}
              onPress={async () => (await confirm('Remove line?', line.label, 'Remove', true)) && del.mutate(`/finance/lines/${line.id}`)}
            />
          ))}
        </Card>
        <Button small variant="secondary" icon="receipt-outline" title="Record an expense" onPress={() => setSheet('expense')} />
      </Section>

      <Section title="Bills" action={<Button small variant="ghost" icon="add" title="Bill" onPress={() => setSheet('bill')} />}>
        <QueryView query={bills}>
          {(list) => (
            <Card style={{ paddingVertical: spacing.xs }}>
              {list.length === 0 && <Muted>No bills yet.</Muted>}
              {list.map((bill: Bill) => (
                <ListRow
                  key={bill.id}
                  icon="calendar-outline"
                  title={`${bill.name} · ${money(bill.amount)}`}
                  subtitle={`${bill.frequency} · due ${formatDate(bill.next_due_date)} (${relativeDay(bill.next_due_date)})${bill.autopay ? ' · autopay' : ''}`}
                  right={bill.frequency !== 'once' ? <Button small variant="secondary" title="Paid" onPress={() => run(`/finance/bills/${bill.id}/paid`)} /> : undefined}
                />
              ))}
            </Card>
          )}
        </QueryView>
      </Section>

      <Section title="Savings goals" action={<Button small variant="ghost" icon="add" title="Goal" onPress={() => setSheet('goal')} />}>
        <QueryView query={goals}>
          {(list) => (
            <View style={{ gap: spacing.sm }}>
              {list.length === 0 && <Muted>Try an emergency fund of 3-6 months of expenses.</Muted>}
              {list.map((g) => (
                <Card key={g.id} onPress={() => { setGoalId(g.id); setSheet('contribute'); }}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Body style={{ fontWeight: '600' }}>{g.name}</Body>
                    {g.kind === 'emergency' && <Badge label="Emergency" tone="info" />}
                  </Row>
                  <ProgressBar value={g.target_amount ? (100 * g.saved_amount) / g.target_amount : 0} tone="success" />
                  <Muted>
                    {money(g.saved_amount)} of {money(g.target_amount)}
                    {g.target_date ? ` by ${formatDate(g.target_date)}` : ''}
                  </Muted>
                </Card>
              ))}
            </View>
          )}
        </QueryView>
      </Section>

      <LineSheet visible={sheet === 'line'} onClose={() => setSheet(null)} onSave={async (body) => run(`/finance/budgets/${await ensureBudget()}/lines`, body)} />
      <BillSheet visible={sheet === 'bill'} onClose={() => setSheet(null)} onSave={(body) => run('/finance/bills', body)} />
      <GoalSheet visible={sheet === 'goal'} onClose={() => setSheet(null)} onSave={(body) => run('/finance/goals', body)} />
      <AmountSheet title="Add to goal" visible={sheet === 'contribute'} onClose={() => setSheet(null)} onSave={(amount) => goalId && run(`/finance/goals/${goalId}/contribute`, { amount })} />
      <ExpenseSheet visible={sheet === 'expense'} onClose={() => setSheet(null)} onSave={async (body) => run('/finance/expenses', { ...body, budget_id: await ensureBudget() })} />
    </Screen>
  );
}

function ForecastChart({ forecast }: { forecast: Forecast }) {
  const c = useColors();
  const step = Math.max(1, Math.floor(forecast.points.length / 30));
  const points = forecast.points.filter((_, i) => i % step === 0);
  const values = points.map((p) => p.balance);
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  return (
    <Card>
      <View style={{ height: 120, flexDirection: 'row', alignItems: 'flex-end', gap: 2 }} accessibilityLabel={`Balance goes from ${money(forecast.starting_balance)} to ${money(forecast.ending_balance)}. Lowest ${money(forecast.lowest.balance)} on ${formatDate(forecast.lowest.date)}.`}>
        {points.map((p) => (
          <View
            key={p.date}
            style={{
              flex: 1,
              height: `${Math.max(2, (100 * (p.balance - min)) / range)}%`,
              backgroundColor: p.balance < 0 ? c.danger : c.primary,
              borderRadius: 2,
              opacity: 0.85,
            }}
          />
        ))}
      </View>
      <Row style={{ justifyContent: 'space-between' }}>
        <Muted>Today {money(forecast.starting_balance)}</Muted>
        <Muted>In 90 days {money(forecast.ending_balance)}</Muted>
      </Row>
      <Muted>
        Lowest: {money(forecast.lowest.balance)} on {formatDate(forecast.lowest.date)}
      </Muted>
      {forecast.warnings.map((w) => (
        <Badge key={w} label={w} tone="warning" icon="warning-outline" />
      ))}
    </Card>
  );
}

function LineSheet({ visible, onClose, onSave }: { visible: boolean; onClose: () => void; onSave: (b: object) => void }) {
  const [kind, setKind] = useState<'income' | 'expense'>('expense');
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('general');
  const [day, setDay] = useState('1');
  return (
    <Sheet visible={visible} onClose={onClose} title="Budget line">
      <ChipGroup value={kind} onChange={setKind} options={[{ value: 'income', label: 'Income' }, { value: 'expense', label: 'Expense' }]} />
      <TextField label="Label" value={label} onChangeText={setLabel} placeholder="e.g. Groceries" />
      <TextField label="Monthly amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
      <TextField label="Category" value={category} onChangeText={setCategory} autoCapitalize="none" />
      <TextField label="Day of month" value={day} onChangeText={setDay} keyboardType="number-pad" />
      <Button title="Save" disabled={!label || !amount} onPress={() => onSave({ kind, label, amount: num(amount), category, day_of_month: Math.min(31, Math.max(1, num(day))) })} />
    </Sheet>
  );
}

function BillSheet({ visible, onClose, onSave }: { visible: boolean; onClose: () => void; onSave: (b: object) => void }) {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [frequency, setFrequency] = useState<Bill['frequency']>('monthly');
  const [due, setDue] = useState<string | null>(todayISO());
  const [autopay, setAutopay] = useState(false);
  return (
    <Sheet visible={visible} onClose={onClose} title="Recurring bill">
      <TextField label="Name" value={name} onChangeText={setName} placeholder="e.g. Hydro" />
      <TextField label="Amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
      <ChipGroup
        value={frequency}
        onChange={setFrequency}
        options={(['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly', 'once'] as const).map((f) => ({ value: f, label: f }))}
      />
      <DateField label="Next due date" value={due} onChange={setDue} />
      <SwitchRow label="Autopay" value={autopay} onChange={setAutopay} />
      <Button title="Save" disabled={!name || !amount || !due} onPress={() => onSave({ name, amount: num(amount), frequency, next_due_date: due, autopay })} />
    </Sheet>
  );
}

function GoalSheet({ visible, onClose, onSave }: { visible: boolean; onClose: () => void; onSave: (b: object) => void }) {
  const [name, setName] = useState('Emergency fund');
  const [kind, setKind] = useState('emergency');
  const [target, setTarget] = useState('');
  const [date, setDate] = useState<string | null>(null);
  return (
    <Sheet visible={visible} onClose={onClose} title="Savings goal">
      <ChipGroup
        value={kind}
        onChange={setKind}
        options={['emergency', 'moving', 'travel', 'education', 'custom'].map((k) => ({ value: k, label: k }))}
      />
      <TextField label="Name" value={name} onChangeText={setName} />
      <TextField label="Target amount" value={target} onChangeText={setTarget} keyboardType="decimal-pad" />
      <DateField label="Target date" value={date} onChange={setDate} optional />
      <Button title="Save" disabled={!name || !target} onPress={() => onSave({ name, kind, target_amount: num(target), target_date: date })} />
    </Sheet>
  );
}

function ExpenseSheet({ visible, onClose, onSave }: { visible: boolean; onClose: () => void; onSave: (b: object) => void }) {
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('general');
  const [note, setNote] = useState('');
  const [date, setDate] = useState<string | null>(todayISO());
  return (
    <Sheet visible={visible} onClose={onClose} title="Expense">
      <TextField label="Amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
      <TextField label="Category" value={category} onChangeText={setCategory} autoCapitalize="none" hint="Use the same category as the budget line" />
      <TextField label="Note" value={note} onChangeText={setNote} />
      <DateField label="Date" value={date} onChange={setDate} />
      <Button title="Save" disabled={!amount || !date} onPress={() => onSave({ amount: num(amount), category, note, spent_on: date })} />
    </Sheet>
  );
}

function AmountSheet({ title, visible, onClose, onSave }: { title: string; visible: boolean; onClose: () => void; onSave: (n: number) => void }) {
  const [amount, setAmount] = useState('');
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <TextField label="Amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" autoFocus />
      <Button title="Save" disabled={!num(amount)} onPress={() => onSave(num(amount))} />
    </Sheet>
  );
}
