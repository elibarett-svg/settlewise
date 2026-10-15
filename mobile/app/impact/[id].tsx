import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { api } from '../../src/api/client';
import { useApiMutation, useImpact } from '../../src/api/hooks';
import type { ImpactItem } from '../../src/api/types';
import { categoryIcon } from '../../src/components/domain';
import { Badge, Body, Button, Card, Heading, Muted, QueryView, Row, Screen } from '../../src/components/ui';
import { useT } from '../../src/i18n';
import { showError } from '../../src/lib/alerts';
import { formatDate, humanize } from '../../src/lib/format';
import { spacing, useColors } from '../../src/theme';

const isDate = (v: string | null) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** 4.4 Review Change Impact - the core SettleWise idea: when one thing changes,
 * show everything linked to it and let the user approve updates to their own plan. */
export default function ImpactReview() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const c = useColors();
  const review = useImpact(id);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (review.data) setSelected(new Set(review.data.items.map((i) => i.id)));
  }, [review.data]);
  const apply = useApiMutation(() =>
    api(`/impact/${id}/apply`, { method: 'POST', body: { approved_item_ids: [...selected] } }),
  );
  const dismiss = useApiMutation(() => api(`/impact/${id}/dismiss`, { method: 'POST' }));

  const groups = useMemo(() => {
    const out: Record<string, ImpactItem[]> = {};
    review.data?.items.forEach((item) => (out[item.category] ??= []).push(item));
    // Items someone outside SettleWise must confirm come first; budget recalculations last.
    const rank = ([category, items]: [string, ImpactItem[]]) =>
      category === 'budget' ? 2 : items.some((i) => i.requires_external_confirmation) ? 0 : 1;
    return Object.entries(out).sort((a, b) => rank(a) - rank(b));
  }, [review.data]);

  const toggle = (itemId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });

  return (
    <QueryView query={review}>
      {(r) => (
        <Screen>
          <Card>
            <Row style={{ justifyContent: 'center' }} gap={spacing.md}>
              <Body style={{ fontWeight: '600' }}>{formatDate(r.old_date)}</Body>
              <Ionicons name="arrow-forward" size={20} color={c.primary} />
              <Body style={{ fontWeight: '700', color: c.primary }}>{formatDate(r.new_date)}</Body>
            </Row>
            <Muted style={{ textAlign: 'center' }}>
              {Math.abs(r.delta_days)} days {r.delta_days > 0 ? 'later' : 'earlier'} · {r.items.length} linked items
            </Muted>
          </Card>
          {r.status !== 'pending' ? (
            <Card>
              <Badge label={humanize(r.status)} tone={r.status === 'applied' ? 'success' : 'neutral'} />
              <Muted>{r.status === 'applied' ? `${r.approved_item_ids.length} items updated.` : 'This review is closed.'}</Muted>
              <Button title="Back to plan" onPress={() => router.replace(`/event/${r.life_event_id}`)} />
            </Card>
          ) : (
            <>
              <Muted>{t.impact.intro}</Muted>
              {groups.map(([category, items]) => (
                <View key={category} style={{ gap: spacing.sm }}>
                  <Row>
                    <Ionicons name={categoryIcon(category)} size={18} color={c.primary} />
                    <Heading style={{ fontSize: 16 }}>{humanize(category)}</Heading>
                  </Row>
                  {items.map((item) => {
                    const on = selected.has(item.id);
                    return (
                      <Pressable key={item.id} onPress={() => toggle(item.id)} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                        <Card style={on ? { borderColor: c.primary } : undefined}>
                          <Row style={{ alignItems: 'flex-start' }}>
                            <Ionicons name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? c.primary : c.textMuted} />
                            <View style={{ flex: 1, gap: 4 }}>
                              <Body style={{ fontWeight: '600' }}>{item.title}</Body>
                              {isDate(item.current_value) && isDate(item.proposed_value) && (
                                <Muted>
                                  {formatDate(item.current_value)} → {formatDate(item.proposed_value)}
                                </Muted>
                              )}
                              <Muted>{item.reason}</Muted>
                              {item.requires_external_confirmation && <Badge label={t.impact.external} tone="warning" icon="people-outline" />}
                            </View>
                          </Row>
                        </Card>
                      </Pressable>
                    );
                  })}
                </View>
              ))}
              <Muted style={{ fontSize: 13 }}>{t.impact.providerNote}</Muted>
              <Button
                title={`${t.impact.apply} (${selected.size})`}
                loading={apply.isPending}
                onPress={() => apply.mutate(undefined, { onSuccess: () => router.replace(`/event/${r.life_event_id}`), onError: (e) => showError(e) })}
              />
              <Button title={t.impact.dismiss} variant="ghost" onPress={() => dismiss.mutate(undefined, { onSuccess: () => router.back(), onError: (e) => showError(e) })} />
            </>
          )}
        </Screen>
      )}
    </QueryView>
  );
}
