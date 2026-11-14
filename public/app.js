import { byId } from "/lib/catalog.js";
import { ACTIONS, actionById } from "/lib/actions.js";
import { detectCrisis, HELPLINES } from "/lib/safety.js";
import { DEMO_PROFILES } from "/lib/demo-data.js";
import { buildSkeleton, rulesPlan, toMin, fmt12 } from "/lib/planner.js";

// ---------- state ----------
const blankAnswers = () => ({ drained: null, role: "", start: "09:30", end: "18:30", meetings: "", aiHours: "", aiFeel: "", wall: "", lightest: "", prefs: [] });
const state = { answers: blankAnswers(), step: 0, connectCal: false, connectFit: false, demo: null, plan: null };

// ---------- helpers ----------
const $ = (id) => document.getElementById(id);
const app = $("app");

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add("hidden"), 3400);
}

function render(...nodes) {
  app.replaceChildren(...nodes.filter((n) => n != null && n !== false));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openModal(...nodes) {
  $("modalCard").replaceChildren(...nodes.filter((n) => n != null && n !== false));
  $("modal").classList.remove("hidden");
}
function closeModal() {
  $("modal").classList.add("hidden");
  stopTimer();
}

function updateDebug(plan, ms) {
  const s = plan?.signals || {};
  $("debugBody").replaceChildren(
    h("dl", {},
      h("dt", {}, "Source"), h("dd", {}, plan?.source || "-"),
      h("dt", {}, "Pattern"), h("dd", {}, plan?.pattern ? String(plan.pattern.detected) : "-"),
      h("dt", {}, "Heavy share"), h("dd", {}, s.highShare != null ? Math.round(s.highShare * 100) + "% of day" : "-"),
      h("dt", {}, "AI-labelled"), h("dd", {}, s.aiBlocks || "-"),
      h("dt", {}, "Confidence"), h("dd", {}, s.confidence != null ? Math.round(s.confidence * 100) + "%" : "-"),
      h("dt", {}, "Data used"), h("dd", {}, ["questionnaire", state.connectCal && "calendar", state.connectFit && "health"].filter(Boolean).join(", ")),
      ms != null && h("dt", {}, "Latency"), ms != null && h("dd", {}, `${ms} ms`),
    )
  );
}

// ---------- 1. trust / welcome ----------
function welcomeView() {
  state.answers = blankAnswers(); state.step = 0; state.connectCal = false; state.connectFit = false; state.demo = null; state.plan = null;
  const promise = (icon, title, text) => h("div", { class: "promise" }, h("span", { class: "promise-icon" }, icon), h("div", {}, h("strong", {}, title), h("p", {}, text)));
  render(
    h("div", { class: "eyebrow" }, "For AI-heavy workdays"),
    h("h1", {}, "AI took the easy parts of your day. Let's put the breathing room back."),
    h("p", { class: "lead" }, "Answer 9 quick questions. We'll map where your day gets heavy, predict when you're likely to hit a wall, and suggest small breaks at the right moments."),
    h("div", { class: "promises" },
      promise("🔒", "Private to you", "Your employer never sees your answers, your day map or anything about you individually."),
      promise("👥", "Only anonymous trends", "Employers see team-level trends only, and only for groups of 20 or more people."),
      promise("🔌", "Connections are optional", "Calendar and health data are off unless you turn them on. Read-only, and you can disconnect anytime."),
      promise("🗑️", "Delete anytime", "One tap removes everything we hold about you."),
    ),
    h("p", { class: "fine" }, "This is wellbeing support, not a diagnosis. If you ever need urgent help, use \"Talk to a human now\" at the top."),
    h("button", { class: "btn", type: "button", onclick: () => questionView() }, "I understand, let's start (2 min)"),
    h("div", { class: "personas" },
      h("div", { class: "personas-title" }, "Reviewer shortcut: load a fictional profile"),
      Object.entries(DEMO_PROFILES).map(([k, p]) => h("button", { class: "persona", type: "button", onclick: () => loadDemo(k) }, h("strong", {}, p.label), h("em", {}, " · answers, calendar and health data pre-filled")))
    )
  );
}

function loadDemo(key) {
  const p = DEMO_PROFILES[key];
  state.demo = key;
  state.answers = structuredClone(p.answers);
  state.connectCal = true; state.connectFit = true;
  connectView();
}

// ---------- 2. questionnaire ----------
const QUESTIONS = [
  { key: "drained", type: "scale", q: "How drained do you feel at the end of a typical workday?", low: "Fresh", high: "Completely drained" },
  { key: "role", type: "single", q: "What kind of work do you mostly do?", options: ["Marketing", "Engineering", "HR & People", "Product", "Design", "Data", "Sales & Support", "Ops", "Finance", "Legal", "Other"] },
  { key: "hours", type: "hours", q: "What are your usual work hours?" },
  { key: "meetings", type: "single", q: "On a typical day, how many hours are you in meetings?", options: ["<1", "1-2", "3-4", "5+"], suffix: " hrs" },
  { key: "aiHours", type: "single", q: "How many hours a day do you spend prompting, reviewing or fixing AI output?", options: ["<1", "1-2", "3-4", "5+"], suffix: " hrs" },
  { key: "aiFeel", type: "single", q: "Since you started using AI tools, your workday feels…", options: ["Lighter", "About the same", "More intense"] },
  { key: "wall", type: "single", q: "When do you usually hit a wall?", options: ["Late morning", "After lunch", "Late afternoon", "Evening", "No pattern"] },
  { key: "lightest", type: "text", q: "What part of your workday feels lightest, or used to?", hint: "Optional. E.g. replying to emails, writing tests, tidying docs." },
  { key: "prefs", type: "multi", q: "When you take a break, what do you actually enjoy?", options: ["Tea or coffee", "Short walk", "Stretching", "Breathing", "Music", "Chatting with someone"], hint: "Pick any. We'll suggest these first." },
];

function answered(q) {
  const a = state.answers;
  if (q.type === "text" || q.type === "multi") return true;
  if (q.type === "hours") return a.start && a.end && toMin(a.end) - toMin(a.start) >= 120;
  return a[q.key] != null && a[q.key] !== "";
}

function questionView() {
  const q = QUESTIONS[state.step];
  const a = state.answers;
  const next = h("button", { class: "btn", type: "button", disabled: !answered(q), onclick: () => {
    if (q.type === "text" && detectCrisis(a.lightest)) return crisisView();
    if (state.step < QUESTIONS.length - 1) { state.step++; questionView(); } else connectView();
  } }, state.step < QUESTIONS.length - 1 ? "Next" : "Continue");
  const refresh = () => (next.disabled = !answered(q));

  let body;
  if (q.type === "scale") {
    const btns = [1, 2, 3, 4, 5].map((n) => h("button", { class: `scale-btn ${a.drained === n ? "on" : ""}`, type: "button", onclick: () => { a.drained = n; btns.forEach((b, i) => b.classList.toggle("on", i + 1 === n)); refresh(); } }, String(n)));
    body = h("div", {}, h("div", { class: "scale" }, btns), h("div", { class: "scale-labels" }, h("span", {}, q.low), h("span", {}, q.high)));
  } else if (q.type === "single" || q.type === "multi") {
    const chips = q.options.map((o) => {
      const on = q.type === "multi" ? a.prefs.includes(o) : a[q.key] === o;
      return h("button", { class: `chip ${on ? "on" : ""}`, type: "button", onclick: (e) => {
        if (q.type === "multi") {
          a.prefs = a.prefs.includes(o) ? a.prefs.filter((x) => x !== o) : [...a.prefs, o];
          e.currentTarget.classList.toggle("on");
        } else {
          a[q.key] = o;
          chips.forEach((c) => c.classList.toggle("on", c.dataset.v === o));
        }
        refresh();
      }, "data-v": o }, o + (q.suffix || ""));
    });
    body = h("div", { class: "chips" }, chips);
  } else if (q.type === "hours") {
    const mk = (k) => h("input", { type: "time", value: a[k], oninput: (e) => { a[k] = e.target.value; refresh(); } });
    body = h("div", { class: "hours" }, h("label", {}, "Start", mk("start")), h("label", {}, "End", mk("end")));
  } else {
    body = h("textarea", { rows: 3, maxlength: 300, placeholder: "Type here, or skip", oninput: (e) => (a.lightest = e.target.value) }, a.lightest);
  }

  render(
    h("div", { class: "progressbar" }, h("div", { style: { width: `${((state.step + 1) / QUESTIONS.length) * 100}%` } })),
    h("div", { class: "progress" }, `Question ${state.step + 1} of ${QUESTIONS.length}`),
    h("h2", {}, q.q),
    q.hint && h("p", { class: "hint" }, q.hint),
    body,
    h("div", { class: "nav" },
      h("button", { class: "btn ghost", type: "button", onclick: () => (state.step === 0 ? welcomeView() : (state.step--, questionView())) }, "Back"),
      next
    )
  );
}

// ---------- 3. connections ----------
function connectView() {
  const toggle = (key, icon, title, reads, never) => {
    const box = h("label", { class: `connect ${state[key] ? "on" : ""}` },
      h("input", { type: "checkbox", checked: state[key], onchange: (e) => { state[key] = e.target.checked; box.classList.toggle("on", e.target.checked); } }),
      h("span", { class: "connect-icon" }, icon),
      h("div", {},
        h("strong", {}, title),
        h("p", {}, h("b", {}, "We read: "), reads),
        h("p", {}, h("b", {}, "We never read: "), never))
    );
    return box;
  };
  render(
    h("h2", {}, "Want a more accurate map? (optional)"),
    h("p", { class: "lead" }, "Your answers are enough to start. Connecting helps us see your real day instead of an estimate."),
    toggle("connectCal", "📅", "Google Calendar", "event times and titles, for today only.", "descriptions, attendees, emails or chats."),
    toggle("connectFit", "👟", "Phone health data (Health Connect / Apple Health)", "steps per hour, to spot long sitting stretches.", "location, heart rate or anything medical."),
    h("p", { class: "fine" }, "Prototype note: connecting loads a fictional calendar and step data. Nothing real is accessed."),
    h("div", { class: "nav" },
      h("button", { class: "btn ghost", type: "button", onclick: () => { state.step = QUESTIONS.length - 1; questionView(); } }, "Back"),
      h("button", { class: "btn", type: "button", onclick: buildPlan }, "Map my day")
    )
  );
}

// ---------- 4. plan ----------
async function buildPlan() {
  render(h("div", { class: "loading" }, h("div", { class: "spinner" }), h("h2", {}, "Reading your day…"), h("p", { class: "lead" }, "Sorting heavy work from light work, and finding where breaks will help most.")));
  const src = DEMO_PROFILES[state.demo] || DEMO_PROFILES.karan;
  const calendar = state.connectCal ? src.calendar : null;
  const activity = state.connectFit ? src.activity : null;
  const t0 = performance.now();
  let plan;
  try {
    const r = await fetch("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answers: state.answers, calendar, activity }) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    plan = await r.json();
  } catch {
    plan = { ...rulesPlan(state.answers, buildSkeleton(state.answers, calendar), activity), source: "rules (offline)" };
  }
  plan.activity = activity;
  state.plan = plan;
  updateDebug(plan, Math.round(performance.now() - t0));
  if (plan.type === "crisis") return crisisView();
  dayView();
}

const LOAD_LABEL = { high: "Heavy", medium: "Moderate", low: "Light", recovery: "Recovery" };

function timeline(plan) {
  const s0 = toMin(plan.blocks[0].start), s1 = toMin(plan.blocks[plan.blocks.length - 1].end), span = s1 - s0;
  const pct = (t) => `${((toMin(t) - s0) / span) * 100}%`;
  const ticks = [];
  for (let m = Math.ceil(s0 / 60) * 60; m <= s1; m += 60) {
    const t = `${String(m / 60).padStart(2, "0")}:00`;
    ticks.push(h("span", { class: "tick", style: { left: pct(t) } }, fmt12(t).replace(":00", "")));
  }
  const markers = [
    plan.wall && h("div", { class: "marker wall", style: { left: pct(plan.wall.time) }, title: `Likely wall: ${fmt12(plan.wall.time)}` }, h("span", {}, "⚡")),
    ...plan.nudges.map((n) => h("button", { class: "marker nudge", type: "button", style: { left: pct(n.time) }, title: `${fmt12(n.time)}: ${actionById(n.action_id).title}`, onclick: () => nudgePreview(n) }, h("span", {}, actionById(n.action_id).icon))),
  ];
  const act = plan.activity;
  let stepsRow = null;
  if (act) {
    const max = Math.max(...act.steps, 1);
    stepsRow = h("div", { class: "steps-row" },
      h("div", { class: "row-label" }, "Steps / hour"),
      h("div", { class: "track steps-track" },
        act.steps.map((n, i) => {
          const t = `${String(act.startHour + i).padStart(2, "0")}:00`, tEnd = `${String(act.startHour + i + 1).padStart(2, "0")}:00`;
          if (toMin(tEnd) <= s0 || toMin(t) >= s1) return null;
          const left = Math.max(toMin(t), s0), right = Math.min(toMin(tEnd), s1);
          return h("div", { class: `stepbar ${n < 250 ? "sitting" : ""}`, title: `${fmt12(t)}: ${n} steps`, style: { left: `${((left - s0) / span) * 100}%`, width: `${((right - left) / span) * 100}%` } },
            h("div", { style: { height: `${Math.max(6, (n / max) * 100)}%` } }));
        })
      )
    );
  }
  return h("div", { class: "timeline" },
    h("div", { class: "legend" }, ["high", "medium", "low", "recovery"].map((l) => h("span", {}, h("i", { class: `sw ${l}` }), LOAD_LABEL[l])), h("span", {}, "⚡ likely wall"), act && h("span", {}, h("i", { class: "sw sitting" }), "sitting")),
    h("div", { class: "day-row" },
      h("div", { class: "row-label" }, "Your day"),
      h("div", { class: "track" },
        plan.blocks.map((b) => h("div", { class: `blk ${b.load}`, title: `${fmt12(b.start)}–${fmt12(b.end)} · ${b.label} (${LOAD_LABEL[b.load]})`, style: { left: pct(b.start), width: `calc(${((toMin(b.end) - toMin(b.start)) / span) * 100}% - 2px)` } })),
        markers)
    ),
    stepsRow,
    h("div", { class: "ticks" }, ticks)
  );
}

function dayView() {
  const plan = state.plan;
  const a = state.answers;
  const next = byId(plan.next_step.id);
  const alt = byId(plan.next_step.alt_id);
  const sources = state.connectCal ? "your calendar" : "your answers (estimated)";

  render(
    h("div", { class: `insight ${plan.pattern.detected ? "flag" : "ok"}` },
      h("div", { class: "eyebrow" }, plan.pattern.detected ? "Pattern we noticed" : "How your day looks"),
      h("h2", {}, plan.pattern.headline),
      h("p", {}, plan.pattern.explanation)),

    h("h3", { class: "section" }, "Your day, mapped"),
    h("p", { class: "fine" }, `Based on ${sources}${state.connectFit ? " and your step data" : ""}. Hover a block for details; tap a break icon to preview it.`),
    timeline(plan),
    plan.wall && h("div", { class: "compare" },
      h("div", {}, h("span", {}, "You said you hit a wall"), h("strong", {}, a.wall || "-")),
      h("div", {}, h("span", {}, "Your day suggests it starts building around"), h("strong", {}, fmt12(plan.wall.time)))),
    plan.wall?.reason && h("p", { class: "fine" }, plan.wall.reason),

    h("details", { class: "blocks-list" },
      h("summary", {}, "How we read each part of your day"),
      h("ul", {}, plan.blocks.map((b) => h("li", {}, h("i", { class: `sw ${b.load}` }), h("span", { class: "bt" }, `${fmt12(b.start)}–${fmt12(b.end)}`), h("span", {}, b.label), h("em", {}, LOAD_LABEL[b.load]))))),

    h("h3", { class: "section" }, "Your break plan"),
    h("p", { class: "fine" }, `${plan.nudges.length} gentle nudge${plan.nudges.length === 1 ? "" : "s"}, no more. They adapt to what you skip or enjoy.`),
    plan.nudges.length
      ? h("div", { class: "nudges" }, plan.nudges.map((n) => {
          const act = actionById(n.action_id);
          return h("div", { class: "nudge-card" },
            h("div", { class: "nudge-time" }, fmt12(n.time)),
            h("div", { class: "nudge-body" }, h("strong", {}, `${act.icon} ${act.title}`), h("span", { class: "dur" }, ` · ${act.mins} min`), h("p", {}, n.message)),
            h("div", { class: "nudge-actions" },
              h("button", { class: "btn small", type: "button", onclick: () => followAlong(act) }, "Try now"),
              h("button", { class: "link", type: "button", onclick: () => nudgePreview(n) }, "Preview nudge")));
        }))
      : h("p", {}, "Your day already has natural breaks, so we won't interrupt it."),

    h("h3", { class: "section" }, "Your next step"),
    h("div", { class: "rec" },
      h("span", { class: "type" }, next.type),
      h("h3", {}, next.title),
      h("p", {}, next.desc),
      h("p", { class: "why" }, h("strong", {}, "Why this: "), plan.next_step.why),
      h("div", { class: "meta" }, next.effort),
      h("button", { class: "btn", type: "button", onclick: () => toast(`Prototype: this would open "${next.title}" in the YourDOST app.`) }, next.cta)),
    alt && h("button", { class: "alt wide", type: "button", onclick: () => toast(`Prototype: this would open "${alt.title}".`) },
      h("div", { class: "type" }, `Or: ${alt.type}`), h("h4", {}, alt.title), h("p", {}, alt.desc)),

    h("h3", { class: "section" }, "All break exercises"),
    h("div", { class: "library" }, ACTIONS.map((x) => h("button", { class: "lib-item", type: "button", onclick: () => followAlong(x) }, h("span", {}, x.icon), h("strong", {}, x.title), h("em", {}, `${x.mins} min`)))),

    h("div", { class: "footer-actions" },
      h("button", { class: "link", type: "button", onclick: welcomeView }, "Start over"),
      h("button", { class: "link", type: "button", onclick: () => { toast("Everything about you has been deleted."); welcomeView(); } }, "Delete my data"))
  );
}

// ---------- 5. nudge preview + check-in ----------
function nudgePreview(n) {
  const act = actionById(n.action_id);
  const checkin = h("div", { class: "checkin" },
    h("p", {}, "Quick check-in: how drained are you right now?"),
    h("div", { class: "scale small" }, [1, 2, 3, 4, 5].map((v) => h("button", { class: "scale-btn", type: "button", onclick: () => afterCheckin(v) }, String(v)))));
  function afterCheckin(v) {
    if (v >= 4) {
      checkin.replaceChildren(
        h("p", {}, "Thanks for being honest. That's a lot to carry through a workday."),
        h("button", { class: "btn small", type: "button", onclick: () => { closeModal(); followAlong(act); } }, `Take the ${act.mins}-min break`),
        h("button", { class: "btn small ghost", type: "button", onclick: () => toast("Prototype: opens an instant chat with a YourDOST expert.") }, "Talk to someone today"),
        h("p", { class: "fine" }, "If check-ins stay high for two weeks, we'll gently suggest a counsellor."));
    } else {
      checkin.replaceChildren(h("p", {}, "Got it, thanks. This helps us time future nudges better."));
    }
  }
  openModal(
    h("div", { class: "eyebrow" }, "Notification preview"),
    h("div", { class: "phone" },
      h("div", { class: "notif" },
        h("div", { class: "notif-head" }, h("span", {}, h("img", { src: "/logo.png", alt: "" }), "YourDOST"), h("span", {}, fmt12(n.time))),
        h("strong", {}, `${act.icon} ${act.title} · ${act.mins} min`),
        h("p", {}, n.message),
        h("div", { class: "notif-actions" },
          h("button", { type: "button", onclick: () => { closeModal(); followAlong(act); } }, "Start"),
          h("button", { type: "button", onclick: () => { closeModal(); toast("Snoozed for 15 minutes."); } }, "Snooze 15m"),
          h("button", { type: "button", onclick: () => { closeModal(); toast("No more nudges today. Skips help us learn your rhythm."); } }, "Not today")))),
    checkin,
    h("button", { class: "link", type: "button", onclick: closeModal }, "Close")
  );
}

// ---------- 6. follow-along ----------
let timer = null;
function stopTimer() { clearInterval(timer); timer = null; }

function followAlong(act) {
  stopTimer();
  let i = 0, left = act.steps[0].secs, paused = false;
  const stepText = h("p", { class: "fa-step" });
  const clock = h("div", { class: "fa-clock" });
  const counter = h("div", { class: "fine" });
  const breath = act.mode === "breath" ? h("div", { class: "breath" }, h("div", { class: "breath-circle" }), h("div", { class: "breath-label" }, "Breathe in")) : null;
  const pauseBtn = h("button", { class: "btn small ghost", type: "button", onclick: () => { paused = !paused; pauseBtn.textContent = paused ? "Resume" : "Pause"; breath?.classList.toggle("paused", paused); } }, "Pause");

  const skipBtn = h("button", { class: "btn small ghost", type: "button", onclick: () => nextStep() });
  const paint = () => {
    skipBtn.textContent = i < act.steps.length - 1 ? "Next step" : "Skip";
    stepText.textContent = act.steps[i].text;
    clock.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
    counter.textContent = act.steps.length > 1 ? `Step ${i + 1} of ${act.steps.length}` : "";
  };
  const nextStep = () => {
    if (i < act.steps.length - 1) { i++; left = act.steps[i].secs; paint(); } else finish();
  };
  function finish() {
    stopTimer();
    $("modalCard").replaceChildren(
      h("div", { class: "fa-done" }, h("div", { class: "big-icon" }, act.icon), h("h2", {}, "Nice. Break done."), h("p", {}, "How do you feel compared to before?"),
        h("div", { class: "chips center" }, ["Better", "About the same", "Worse"].map((f) => h("button", { class: "chip", type: "button", onclick: () => { closeModal(); toast(f === "Worse" ? "Thanks for telling us. We'll suggest something different next time." : "Noted. We'll suggest more of what works for you."); } }, f))))
    );
  }
  if (breath) {
    let inhale = true;
    const label = breath.querySelector(".breath-label");
    const cycle = () => { if (!timer) return; if (!paused) { inhale = !inhale; label.textContent = inhale ? "Breathe in" : "Breathe out"; breath.classList.toggle("out", !inhale); } setTimeout(cycle, inhale ? 4000 : 6000); };
    setTimeout(cycle, 4000);
  }

  openModal(
    h("div", { class: "eyebrow" }, `${act.icon} Follow along · ${act.mins} min`),
    h("h2", {}, act.title),
    breath,
    stepText,
    clock,
    counter,
    h("div", { class: "nav" }, pauseBtn, skipBtn, h("button", { class: "btn small", type: "button", onclick: finish }, "Done")),
    h("button", { class: "link", type: "button", onclick: closeModal }, "Close")
  );
  paint();
  timer = setInterval(() => { if (paused) return; left--; if (left <= 0) nextStep(); else paint(); }, 1000);
}

// ---------- 7. crisis ----------
function crisisView() {
  $("crisisBanner").classList.remove("hidden");
  updateDebug({ source: "safety-filter", pattern: null, signals: {} });
  render(
    h("div", { class: "crisis" },
      h("h2", {}, "Thank you for telling us."),
      h("p", { class: "lead" }, "It sounds like you're carrying something really heavy right now. You don't have to deal with it alone, and talking to someone today can help."),
      HELPLINES.map((l) => h("a", { class: "helpline", href: `tel:${l.phone}` }, h("span", {}, l.name), h("strong", {}, l.phone))),
      h("button", { class: "btn", type: "button", onclick: () => toast("Prototype: connects you to YourDOST's on-call counsellor (a person, not AI) within minutes.") }, "Connect me to an on-call counsellor now"),
      h("button", { class: "btn ghost", type: "button", onclick: welcomeView }, "I'm safe right now, go back"))
  );
}

// ---------- chrome ----------
$("debugToggle").addEventListener("change", (e) => $("debug").classList.toggle("hidden", !e.target.checked));
$("humanBtn").addEventListener("click", () => $("humanSheet").classList.remove("hidden"));
$("closeSheet").addEventListener("click", () => $("humanSheet").classList.add("hidden"));
$("humanSheet").addEventListener("click", (e) => { if (e.target.id === "humanSheet") e.currentTarget.classList.add("hidden"); });
$("modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal(); });
document.querySelectorAll("[data-human]").forEach((b) =>
  b.addEventListener("click", () => {
    $("humanSheet").classList.add("hidden");
    toast(`Prototype: this would open "${byId(b.dataset.human).title}".`);
  })
);

welcomeView();
