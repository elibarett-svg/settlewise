import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { api } from '../../src/api/client';
import { useApiMutation, useTask, useTasks } from '../../src/api/hooks';
import type { Source, Task, TaskStatus } from '../../src/api/types';
import { SourceLinks, taskTone } from '../../src/components/domain';
import { Badge, Body, Button, Card, ChipGroup, DateField, ListRow, Muted, QueryView, Row, Screen, Section, Sheet, TextField, Title } from '../../src/components/ui';
import { useT } from '../../src/i18n';
import { confirm, showError } from '../../src/lib/alerts';
import { humanize } from '../../src/lib/format';
import { spacing } from '../../src/theme';

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'todo', label: 'To do' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'needs_review', label: 'Needs review' },
  { value: 'done', label: 'Done' },
  { value: 'skipped', label: 'Not needed' },
];

export default function TaskDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const task = useTask(id);
  const siblings = useTasks(task.data?.life_event_id ? { life_event_id: task.data.life_event_id } : { status: 'open' });
  const sources = useQuery({ queryKey: ['assistant', 'sources'], queryFn: () => api<Source[]>('/assistant/sources'), staleTime: Infinity });
  const [editing, setEditing] = useState(false);
  const [linking, setLinking] = useState(false);

  const update = useApiMutation((body: Partial<Task>) => api<Task>(`/tasks/${id}`, { method: 'PATCH', body }));
  const link = useApiMutation((dependsOn: string) => api(`/tasks/${id}/dependencies`, { method: 'POST', body: { depends_on_id: dependsOn } }));
  const unlink = useApiMutation((dependsOn: string) => api(`/tasks/${id}/dependencies/${dependsOn}`, { method: 'DELETE' }));
  const remove = useApiMutation(() => api(`/tasks/${id}`, { method: 'DELETE' }));

  const save = (body: Partial<Task>) => update.mutate(body, { onError: (e) => showError(e, 'Could not update task') });

  return (
    <QueryView query={task}>
      {(tk) => {
        const byId = new Map((siblings.data ?? []).map((x) => [x.id, x]));
        const taskSources = (sources.data ?? []).filter((s) => tk.source_ids.includes(s.id));
        const { label, tone } = taskTone(tk);
        return (
          <Screen>
            <Title>{tk.title}</Title>
            <Row style={{ flexWrap: 'wrap' }}>
              <Badge label={label} tone={tone} />
              <Badge label={humanize(tk.category)} />
              <Badge label={`${humanize(tk.priority)} priority`} tone={tk.priority === 'high' ? 'warning' : 'neutral'} />
            </Row>
            {tk.description ? <Body>{tk.description}</Body> : null}

            <Card>
              <ChipGroup value={tk.status} onChange={(status) => save({ status })} options={STATUS_OPTIONS} />
              <DateField label="Due date" value={tk.due_date} optional onChange={(due_date) => save({ due_date })} />
              {tk.offset_days !== null && <Muted>Linked to the plan's key date ({tk.offset_days >= 0 ? '+' : ''}{tk.offset_days} days). Changing the date here unlinks it.</Muted>}
              <Muted>Owner: {tk.owner === 'me' ? 'You' : tk.owner}</Muted>
              {tk.external_party ? <Muted>Involves: {tk.external_party}</Muted> : null}
              <Button small variant="secondary" icon="create-outline" title={t.common.edit} onPress={() => setEditing(true)} />
            </Card>

            {tk.guidance ? (
              <Section title={t.tasks.guidance}>
                <Card>
                  <Body>{tk.guidance}</Body>
                </Card>
              </Section>
            ) : null}

            {taskSources.length > 0 && (
              <Section title={t.tasks.sources}>
                <Card>
                  <SourceLinks sources={taskSources} />
                </Card>
              </Section>
            )}

            <Section title={t.tasks.blockedBy} action={<Button small variant="ghost" icon="link" title="Link" onPress={() => setLinking(true)} />}>
              <Card style={{ paddingVertical: spacing.xs }}>
                {tk.depends_on.length === 0 && <Muted>Nothing - this task can start any time.</Muted>}
                {tk.depends_on.map((depId) => {
                  const dep = byId.get(depId);
                  const waiting = tk.blocked_by.includes(depId);
                  return (
                    <ListRow
                      key={depId}
                      icon={waiting ? 'lock-closed-outline' : 'checkmark-circle-outline'}
                      tone={waiting ? 'warning' : 'success'}
                      title={dep?.title ?? 'Task'}
                      subtitle={waiting ? 'Not finished yet' : 'Finished'}
                      onPress={() => router.push(`/task/${depId}`)}
                      right={<Button small variant="ghost" icon="close" title="" onPress={() => unlink.mutate(depId)} />}
                    />
                  );
                })}
              </Card>
            </Section>

            {tk.life_event_id && <Button title="Open plan" variant="secondary" onPress={() => router.push(`/event/${tk.life_event_id}`)} />}
            <Button
              title={t.common.delete}
              variant="danger"
              onPress={async () => {
                if (await confirm('Delete this task?', tk.title, 'Delete', true)) remove.mutate(undefined, { onSuccess: () => router.back() });
              }}
            />

            <EditSheet task={tk} visible={editing} onClose={() => setEditing(false)} onSave={(body) => { save(body); setEditing(false); }} />
            <Sheet visible={linking} onClose={() => setLinking(false)} title="This task waits on…">
              {(siblings.data ?? [])
                .filter((x) => x.id !== tk.id && !tk.depends_on.includes(x.id))
                .map((x) => (
                  <ListRow
                    key={x.id}
                    title={x.title}
                    subtitle={humanize(x.status)}
                    onPress={() => link.mutate(x.id, { onSuccess: () => setLinking(false), onError: (e) => showError(e) })}
                  />
                ))}
            </Sheet>
          </Screen>
        );
      }}
    </QueryView>
  );
}

function EditSheet({ task, visible, onClose, onSave }: { task: Task; visible: boolean; onClose: () => void; onSave: (body: Partial<Task>) => void }) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [owner, setOwner] = useState(task.owner);
  const [priority, setPriority] = useState(task.priority);
  return (
    <Sheet visible={visible} onClose={onClose} title="Edit task">
      <TextField label="Title" value={title} onChangeText={setTitle} />
      <TextField label="Notes" value={description} onChangeText={setDescription} multiline />
      <TextField label="Owner" value={owner} onChangeText={setOwner} hint='"me", a household member, or a provider' />
      <ChipGroup
        value={priority}
        onChange={setPriority}
        options={[
          { value: 'low', label: 'Low' },
          { value: 'medium', label: 'Medium' },
          { value: 'high', label: 'High' },
        ]}
      />
      <Button title="Save" onPress={() => onSave({ title, description, owner, priority })} disabled={!title.trim()} />
    </Sheet>
  );
}
