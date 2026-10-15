# SettleWise mobile app

Expo (SDK 57) + React Native + TypeScript, one codebase for iPhone and Android.

```bash
npm install
```

```bash
npx expo start
```

Scan the QR code with Expo Go. The app talks to the API on the computer running Expo (port 8000)
unless `EXPO_PUBLIC_API_URL` is set.

- `app/` - screens, file-based routing with expo-router (`(auth)`, `(tabs)`, detail screens)
- `src/api/` - typed API client, React Query hooks, types mirroring the backend schemas
- `src/components/` - UI kit (`ui.tsx`) and SettleWise components (`domain.tsx`)
- `src/i18n/` - English and French strings
- `src/lib/` - formatting, push notification registration, secure token storage

Checks: `npx tsc --noEmit` and `npx expo-doctor`. Native builds: `npx expo run:ios`,
`npx expo run:android`, or EAS (`eas build`).
