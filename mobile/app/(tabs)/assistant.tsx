import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { api } from '../../src/api/client';
import { keys, useApiMutation, useAssistantStatus, useEvents, useHistory } from '../../src/api/hooks';
import type { Answer } from '../../src/api/types';
import { SourceLinks } from '../../src/components/domain';
import { Badge, Body, Button, Card, Chip, EmptyState, Muted, QueryView, Row, Screen, TextField } from '../../src/components/ui';
import { useT } from '../../src/i18n';
import { showError } from '../../src/lib/alerts';
import { spacing, useColors } from '../../src/theme';

const STARTERS = [
  'What do I need to update after moving?',
  'Do I need a PR card to fly back to Canada?',
  'What forms do I give a new employer?',
  'How do I apply for a health card in Ontario?',
];

const CONFIDENCE_TONE = { high: 'success', medium: 'info', low: 'warning' } as const;

/** 3.0 AI Settlement Assistant. */
export default function Assistant() {
  const t = useT();
  const qc = useQueryClient();
  const [question, setQuestion] = useState('');
  const [eventId, setEventId] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const history = useHistory();
  const status = useAssistantStatus();
  const events = useEvents('active');

  const ask = async (text: string) => {
    if (text.trim().length < 3) return;
    setBusy(true);
    try {
      await api<Answer>('/assistant/ask', { method: 'POST', body: { question: text.trim(), life_event_id: eventId } });
      setQuestion('');
      await qc.invalidateQueries({ queryKey: keys.history });
    } catch (e) {
      showError(e, 'Could not get an answer');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Muted>{t.assistant.disclaimer}</Muted>
      <TextField label={t.assistant.title} value={question} onChangeText={setQuestion} placeholder={t.assistant.placeholder} multiline />
      {!!events.data?.length && (
        <Row style={{ flexWrap: 'wrap' }}>
          <Chip label="General" selected={!eventId} onPress={() => setEventId(undefined)} />
          {events.data.map((ev) => (
            <Chip key={ev.id} label={ev.title} selected={eventId === ev.id} onPress={() => setEventId(ev.id)} />
          ))}
        </Row>
      )}
      <Button title="Ask" icon="send" onPress={() => ask(question)} loading={busy} disabled={question.trim().length < 3} />
      {status.data && (
        <Muted style={{ fontSize: 12 }}>{status.data.mode === 'claude' ? `Answers by Claude (${status.data.model})` : 'Offline mode: answers come straight from the source summaries.'}</Muted>
      )}
      <QueryView query={history}>
        {(answers) =>
          answers.length === 0 ? (
            <View style={{ gap: spacing.sm }}>
              <EmptyState icon="chatbubbles-outline" title="Ask your first question" body="Try one of these:" />
              {STARTERS.map((s) => (
                <Chip key={s} label={s} onPress={() => ask(s)} />
              ))}
            </View>
          ) : (
            <View style={{ gap: spacing.md }}>
              {answers.map((a) => (
                <AnswerCard key={a.id} answer={a} />
              ))}
            </View>
          )
        }
      </QueryView>
    </Screen>
  );
}

function AnswerCard({ answer }: { answer: Answer }) {
  const t = useT();
  const c = useColors();
  const add = useApiMutation((index: number) =>
    api(`/assistant/history/${answer.id}/actions/${index}`, { method: 'POST', body: {} }),
  );
  return (
    <Card>
      <Body style={{ fontWeight: '700' }}>{answer.question}</Body>
      <Body>{answer.answer}</Body>
      <Row style={{ flexWrap: 'wrap' }}>
        <Badge label={`Confidence: ${answer.confidence}`} tone={CONFIDENCE_TONE[answer.confidence]} />
        {answer.uncertainty_note ? <Badge label={t.assistant.uncertain} tone="warning" icon="help-circle-outline" /> : null}
      </Row>
      {answer.uncertainty_note ? <Muted>{answer.uncertainty_note}</Muted> : null}
      {answer.needs_professional && (
        <View style={{ backgroundColor: c.infoSoft, borderRadius: 12, padding: spacing.md, gap: spacing.sm }}>
          <Row>
            <Ionicons name="person-circle-outline" size={20} color={c.info} />
            <Body style={{ fontWeight: '600', color: c.info }}>{t.assistant.professional}</Body>
          </Row>
          <Muted>{answer.professional_reason}</Muted>
          <Button
            small
            variant="secondary"
            title={t.assistant.findProfessional}
            onPress={() => router.push({ pathname: '/referrals/new', params: { serviceType: answer.professional_service_types[0] ?? 'immigration_consultant', reason: answer.question } })}
          />
        </View>
      )}
      <SourceLinks sources={answer.sources} />
      {answer.suggested_actions.length > 0 && (
        <View style={{ gap: spacing.xs }}>
          <Muted style={{ fontWeight: '600' }}>Suggested next steps</Muted>
          {answer.suggested_actions.map((action, i) => (
            <Row key={action.title} style={{ justifyContent: 'space-between' }}>
              <Body style={{ flex: 1, fontSize: 15 }}>{action.title}</Body>
              {action.added_task_id ? (
                <Badge label={t.assistant.added} tone="success" icon="checkmark" />
              ) : (
                <Button small variant="secondary" title={t.assistant.addToPlan} onPress={() => add.mutate(i, { onError: (e) => showError(e) })} />
              )}
            </Row>
          ))}
        </View>
      )}
    </Card>
  );
}
