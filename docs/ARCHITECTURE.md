# Architecture

```
 iPhone / Android app (Expo, React Native)
          │  HTTPS + JSON, bearer token (stored in Keychain / Keystore)
          ▼
 FastAPI app  ── /api/v1/meta  (enabled plugins = the app's feature flags)
   │
   ├── core/          config · database · auth (scrypt, JWT, TOTP) · event bus · plugin registry
   │
   └── plugins/       one per feature in the product decomposition
        account 10.0   profile 1.0   autofill 1.5 (Growth)   planning 2.0
        assistant 3.0  tasks 4.0     finance 5.0             referrals 6.0
        consent 7.0    worker_portal 8.0 (Enterprise)        notifications 9.0
          │
          ▼
 SQLite (dev) / PostgreSQL (prod)        Claude API (assistant, optional)        Expo push service
```

## The case model

A **life event** (`core.models.LifeEvent`) is the case. It lives in the core because every plugin
attaches something to it: tasks, expected costs, referrals, reminders, assistant questions.

## How plugins cooperate

Plugins never call each other's routes. They cooperate in three ways:

1. **Events** (`core/events.py`). A plugin publishes a domain event and others react inside the same
   database transaction. Examples:
   - `life_event.created` -> tasks generates the plan, finance creates the expected costs.
   - `task.saved`, `bill.saved`, `document.saved`, `referral.saved` -> notifications schedules or
     moves the matching reminder.
2. **Hooks on the `Plugin` base class** (`core/plugin.py`):
   - `propose_impact` / `apply_impact` - event impact analysis (4.4).
   - `export_user_data` / `delete_user_data` - data export (10.4) and erasure (10.5) cover every
     plugin automatically.
   - `seed` - reference data such as the provider directory.
3. **Shared services** imported directly when one feature is built on another, declared with
   `requires` - e.g. the worker portal reads client data only through `consent.service.shared_view`,
   which filters to consented fields and writes the audit entry.

## Event impact analysis (4.4)

```
POST /impact/preview {life_event_id, new_key_date}
   └─ every plugin's propose_impact()  ->  ImpactItems (task / cost / referral ...)
       stored as a pending ImpactReview; nothing changes yet
POST /impact/{id}/apply {approved_item_ids}
   └─ each plugin's apply_impact() for its own approved items
   └─ key date updated, life_event.date_changed published
```

Template tasks keep their offset from the key date, so the proposal is exact. Tasks that involve an
outside party are marked `requires_external_confirmation` and move to **needs review** when applied:
SettleWise changes only the user's own plan, and provider records stay pending until the user
records a response.

## Privacy by design

- Document numbers are reduced to their last 4 characters before storage.
- Sharing is field-level, purpose-bound and time-limited; revocation is immediate.
- Every access by someone else is written to the owner's audit history.
- Account deletion runs every plugin's `delete_user_data`.
- The assistant sends the model coarse context only (province, status, household size, active plan
  types) - never names, contact details or document numbers.

## Delivery phases

Plugins declare `phase = "MVP" | "Growth" | "Enterprise"`. The registry loads only phases listed in
`SETTLEWISE_ENABLED_PHASES`, and drops plugins whose `requires` are missing. The app reads
`/api/v1/meta` and hides screens for plugins that are off.

## Known limits / next steps

- Schema is created with `create_all`; add Alembic migrations before the first production release.
- Password-reset email is not sent yet (the token is logged, and returned in dev).
- Growth-phase provider integrations (authorised APIs, verified referral status) are not built;
  the `autofill` plugin shows the consent-checked pattern they will follow.
- The app is tested by typecheck, Metro bundles for iOS and Android, and a web preview; run it on
  devices with `make ios` / `make android` or Expo Go.
