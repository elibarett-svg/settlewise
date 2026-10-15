# SettleWise

**One life event. Multiple organizations. One connected plan.**

SettleWise is a Personal Digital Case Management System for newcomers to Canada. Each life
event (moving home, international travel, a new job, a family change, PR preparation) becomes a
*case*: a personalised plan of tasks, documents, costs, referrals and reminders. Its core idea is
**event impact analysis**: when one date changes, SettleWise shows every linked task, cost and
referral that needs review, and changes only what the user approves.

This repository turns the *Project Vision v0.1* (BUS 4062, Group 2) into working software:

| Part | What it is |
|---|---|
| [`mobile/`](mobile) | Native iPhone and Android app - Expo SDK 57, React Native 0.86, TypeScript, expo-router |
| [`backend/`](backend) | Python API - FastAPI + SQLAlchemy. **Every feature is a plugin** (`settlewise/plugins/*`) |
| [`docs/`](docs) | Architecture, plugin guide and the function -> API -> screen traceability matrix |

All **53 functions** from the product decomposition are implemented and traced in
[docs/TRACEABILITY.md](docs/TRACEABILITY.md). MVP features are on by default; Growth (auto-fill)
and Enterprise (settlement worker portal) features switch on with one setting.

## Quick start

You need Python 3.11+ and Node.js 20+.

```bash
make setup
```

```bash
make api
```

The API runs at http://localhost:8000 (interactive docs at http://localhost:8000/docs) with
synthetic demo data: **Sarah**, the persona from the Project Vision, with a move and a new job
already planned. Demo logins are in [`backend/.env.example`](backend/.env.example).

In a second terminal:

```bash
make mobile
```

Install **Expo Go** on your iPhone or Android phone, scan the QR code, and the app opens. The phone
must be on the same Wi-Fi as your computer; the app finds the API automatically. To point it at
another server, set `EXPO_PUBLIC_API_URL` (see [`mobile/.env.example`](mobile/.env.example)).

### Try the core scenario

1. Sign in as Sarah, open **Plans -> Move to the new apartment**.
2. Tap **Change date** and move the date later.
3. SettleWise lists the linked items - utilities, insurance, movers, mail forwarding, budget costs,
   the open referral - with what needs confirming with a provider.
4. Approve the ones you want. Provider-linked tasks are marked **Review** until you record the
   provider's answer; the cash-flow forecast follows the new date.

## What's in the app

| Tab / screen | Features (Project Vision IDs) |
|---|---|
| **Today** | Next steps this week, items to review, active plans, notification bell (2.4, 4.5, 9.4) |
| **Plans** | Create a plan from a life event; personalised steps, dependencies, costs, referrals; change date -> impact review; close (2.1-2.5, 4.4, 5.6) |
| **Tasks** | Filter by status, plan, keyword; dependencies; guidance with official sources (4.1-4.5) |
| **Ask** | AI Settlement Assistant: answers from reviewed official sources, confidence and uncertainty, referral to a licensed professional, one-tap "add to plan" (3.1-3.6) |
| **More** | Profile & household, documents (numbers never stored), money (budget, expenses, bills, savings goals, 90-day forecast), referrals & handoffs, privacy & sharing with audit history, notifications, account settings incl. two-step verification, data export and account deletion (1.x, 5.x, 6.x, 7.x, 9.x, 10.x) |
| **Worker portal** | For settlement-worker accounts when Enterprise is enabled: request access, client dashboard, progress, follow-up notes - only consented fields, every view audited (8.1-8.5) |

English and French are built in (10.3).

## The AI assistant

With `ANTHROPIC_API_KEY` set, questions are answered by Claude (`claude-opus-5-5` by default)
using only the curated official sources in
[`sources.yaml`](backend/settlewise/plugins/assistant/sources.yaml), with structured output so
every answer carries its sources, a confidence level, an uncertainty note and suggested next steps.
Without a key, it answers offline from the same sources. In both modes:

- case-specific legal or immigration questions are routed to a licensed professional (3.4),
- only sources from the knowledge base can be cited,
- the model never receives names, contact details or document numbers.

Each source has a `reviewed_on` field that stays empty until a content reviewer checks it; the app
shows "Pending content review" until then. `make check-sources` checks every link.

## Building the native apps

Expo Go is enough for development. For installable builds:

- **iOS Simulator:** `make ios` (needs Xcode).
- **Android emulator / device:** `make android` (needs Android Studio).
- **TestFlight / Play Store:** `npm install -g eas-cli`, then in `mobile/`: `eas init`,
  `eas build --profile preview --platform all`. Set the production API URL in
  [`mobile/eas.json`](mobile/eas.json). Push notifications need the EAS project id that `eas init` adds.

## Running in Docker

```bash
docker compose up --build
```

Runs PostgreSQL and the API on port 8000.

## Configuration

Everything is set with `SETTLEWISE_*` environment variables - see
[`backend/.env.example`](backend/.env.example). The important ones:

| Variable | Default | |
|---|---|---|
| `SETTLEWISE_ENABLED_PHASES` | `["MVP"]` | Add `"Growth"` and/or `"Enterprise"` to turn on those plugins |
| `SETTLEWISE_DISABLED_PLUGINS` | `[]` | Turn individual plugins off; plugins that depend on them turn off too |
| `SETTLEWISE_DATABASE_URL` | SQLite file | `postgresql+psycopg://...` in production |
| `SETTLEWISE_SECRET_KEY` | dev value | **Must** be set to a long random value in production |
| `ANTHROPIC_API_KEY` | unset | Enables Claude answers in the assistant |

## Development

```bash
make test
```

```bash
make lint
```

```bash
make traceability
```

`make help` lists everything. CI (`.github/workflows/ci.yml`) runs the backend tests and linters and
typechecks the app.

**macOS note:** if `settlewise` cannot be imported from the virtualenv (`ModuleNotFoundError`),
macOS has marked the editable-install `.pth` file hidden and Python skips hidden `.pth` files. Fix:
`chflags nohidden backend/.venv/lib/python3.*/site-packages/*.pth`.

## Scope boundaries (from the Project Vision)

SettleWise does not give legal or immigration advice, does not submit applications or change
records held by providers or government, and does not predict approval or eligibility. The
completion score is task completion only. All demo data, including the provider directory, is
synthetic and labelled as samples.
