import { useEffect, useState } from 'react';
import { Modal, Pressable, View } from 'react-native';

import { setDialogHost, type DialogSpec } from '../lib/alerts';
import { radius, spacing, useColors } from '../theme';
import { Body, Button, Heading, Row } from './ui';

/** Draws alert/confirm dialogs on web, where the browser's own are unavailable. */
export function DialogHost() {
  const c = useColors();
  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  useEffect(() => {
    setDialogHost(setDialog);
    return () => setDialogHost(null);
  }, []);
  if (!dialog) return null;
  const close = (onPress?: () => void) => {
    setDialog(null);
    onPress?.();
  };
  const cancel = dialog.buttons.find((b) => b.label === 'Cancel') ?? dialog.buttons[0];
  return (
    <Modal transparent visible animationType="fade" onRequestClose={() => close(cancel.onPress)}>
      <Pressable
        onPress={() => close(cancel.onPress)}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: spacing.xl }}
      >
        <Pressable
          onPress={() => undefined}
          accessibilityRole="alert"
          style={{ backgroundColor: c.surface, borderRadius: radius.lg, padding: spacing.xl, gap: spacing.md, maxWidth: 420, width: '100%', alignSelf: 'center' }}
        >
          <Heading>{dialog.title}</Heading>
          {dialog.message ? <Body>{dialog.message}</Body> : null}
          <Row style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            {dialog.buttons.map((b) => (
              <View key={b.label}>
                <Button
                  small
                  title={b.label}
                  variant={b.destructive ? 'danger' : b === cancel && dialog.buttons.length > 1 ? 'ghost' : 'primary'}
                  onPress={() => close(b.onPress)}
                />
              </View>
            ))}
          </Row>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
