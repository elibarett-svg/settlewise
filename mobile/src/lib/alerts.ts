import { Alert } from 'react-native';

export function showError(error: unknown, title = 'Something went wrong') {
  Alert.alert(title, error instanceof Error ? error.message : String(error));
}

export function confirm(title: string, message: string, confirmLabel = 'Confirm', destructive = false): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
    ]);
  });
}
