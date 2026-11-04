import { Alert, Platform } from 'react-native';

export interface DialogButton {
  label: string;
  destructive?: boolean;
  onPress?: () => void;
}
export interface DialogSpec {
  title: string;
  message?: string;
  buttons: DialogButton[];
}

// Browsers (and the sandboxed frame the web demo runs in) block window.alert and
// window.confirm, so on web dialogs are drawn by <DialogHost /> in the app itself.
let host: ((dialog: DialogSpec) => void) | null = null;

export function setDialogHost(show: ((dialog: DialogSpec) => void) | null) {
  host = show;
}

export function notify(title: string, message?: string) {
  if (Platform.OS === 'web') host?.({ title, message, buttons: [{ label: 'OK' }] });
  else Alert.alert(title, message);
}

export function showError(error: unknown, title = 'Something went wrong') {
  notify(title, error instanceof Error ? error.message : String(error));
}

export function confirm(title: string, message: string, confirmLabel = 'Confirm', destructive = false): Promise<boolean> {
  return new Promise((resolve) => {
    const buttons: DialogButton[] = [
      { label: 'Cancel', onPress: () => resolve(false) },
      { label: confirmLabel, destructive, onPress: () => resolve(true) },
    ];
    if (Platform.OS === 'web') {
      if (host) host({ title, message, buttons });
      else resolve(false);
      return;
    }
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
    ]);
  });
}
