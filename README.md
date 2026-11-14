# DOST Compass: a calmer AI-era workday

A prototype for YourDOST (Product Manager task 3).

**The problem:** AI tools have taken over the easy, low-effort tasks that used to give the brain a break between hard ones. What's left is a day of only heavy work, with no natural recovery, and people blame themselves for being drained.

**What it does:** a 2-minute onboarding (plus optional calendar and phone health data) → the AI maps which parts of the day are heavy vs light → predicts when the person is likely to hit a wall → schedules at most 3 well-timed break nudges with guided follow-alongs → recommends one YourDOST next step (program, assessment or counsellor).

All data in this prototype is fictional. Nothing is stored.

## Run it locally

Needs Node.js 18+ (`node -v`). No packages to install.

1. Open this folder in VS Code, open a terminal (`` Ctrl+` ``).
2. Copy `.env.example` to `.env` and paste your Gemini API key (from https://aistudio.google.com/apikey).
3. `node dev-server.js`, then open http://localhost:3000

Without a key it still works using the rules engine. Tick "Show AI reasoning" at the bottom: `Source` says `ai` when Gemini is being used.

## Deploy to Vercel

1. Push this folder to a new GitHub repo (`.env` is git-ignored, so your key stays private):
   ```
   git init && git add . && git commit -m "DOST Compass prototype"
   git branch -M main
   git remote add origin https://github.com/<you>/dost-compass.git
   git push -u origin main
   ```
2. https://vercel.com/new → import the repo → Framework preset **Other** → leave build settings empty.
3. Environment Variables: `GEMINI_API_KEY` = your key (optional: `GEMINI_MODEL`).
4. Deploy. If `Source` shows `rules (AI unavailable)`, check the key, or set `GEMINI_MODEL` to a current model name from AI Studio.

## Journeys to demo

- **Karan (heavy AI use):** reviewer shortcut on the first screen. Shows the pattern detected, a mostly-red day, sitting streaks, wall vs. what he said, 3 nudges, Recovery Rhythm program.
- **Priya (light AI use):** shows the app does *not* force the AI-overload story. Balanced day, one nudge, lighter next step.
- **Your own answers:** go through the 9 questions; try with and without connections.
- **Notification + check-in:** "Preview nudge" → tap 4 or 5 on the check-in → offers talk-to-someone.
- **Safety:** type something like "I want to die" in the free-text question → crisis screen with helplines; the AI is never called.

## How it works

```
Answers (+ optional calendar, step data)
      │
      ├─► Safety filter on free text (deterministic) ──► crisis screen, no AI
      ▼
Skeleton: rules turn calendar/answers into time blocks (no AI)
      ▼
AI (Gemini): labels each block's load, detects the AI-overload pattern,
             predicts the wall, picks ≤3 nudges + next step
      ▼
Validator: every field checked (block ids, load values, times inside the day,
           action/catalogue ids, nudge spacing). Invalid parts use the rules version.
      ▼
Rules fallback for everything if the AI fails or times out.
```

| File | Purpose |
|---|---|
| `public/app.js`, `index.html`, `style.css` | UI: trust screen → questionnaire → connections → day map → nudges → follow-along → next step |
| `public/lib/planner.js` | Builds the day's time blocks; rule-based plan (fallback and baseline) |
| `public/lib/actions.js` | Break exercises and their guided steps |
| `public/lib/catalog.js` | Fictional YourDOST offerings the AI can recommend |
| `public/lib/demo-data.js` | Fictional profiles, calendars and step data |
| `public/lib/safety.js` | Crisis detection and helplines |
| `api/plan.js` | Serverless function: safety → skeleton → Gemini → validate → fallback |
| `dev-server.js` | Local server that mimics Vercel |

## Product decisions (review these and make them yours)

- **Trust first.** The first screen says what the employer can and can't see before asking anything. Employers see only anonymous trends for groups of 20+.
- **Connections are optional and minimal.** The calendar is read-only, times and titles only. Health data is steps per hour only. The questionnaire alone produces a useful (estimated) map.
- **Real integrations in production:** Google Calendar API (OAuth, read-only scope); phone health data via Health Connect (Android) / HealthKit (iOS). The Google Fit APIs are being shut down in 2026, so they are not an option.
- **A tool for overload must not add load.** Max 3 nudges a day, at least 45 minutes apart, with snooze / not today. Skips teach the system.
- **AI is used where it adds understanding,** not everywhere. Rules can spot "3 hours back-to-back"; the AI is needed to read meeting titles ("Incident review" vs "coffee chat"), weigh the person's own words, and write nudges specific to their day.
- **Don't force the story.** If the AI-overload pattern isn't there (Priya), the app says so.
- **Not a diagnosis.** We say "heavy stretch" and "likely wall", never "burnout risk". The break exercises are general wellbeing practices; YourDOST's clinical team would review them before launch.
- **Escalation to humans:** check-ins of 4–5 offer someone to talk to; persistent high check-ins (2+ weeks) → counsellor; crisis language → helplines and on-call counsellor, without AI.

Before submitting, verify the helpline numbers in `public/lib/safety.js`.
