// Day planner, shared by the server and the browser.
// 1. buildSkeleton: turns answers + calendar into time blocks (deterministic).
// 2. rulesPlan: a rule-based reading of the day. Used as the fallback when
//    the AI is unavailable, and as a sanity baseline for the AI's output.

import { actionById } from "./actions.js";

export const toMin = (hhmm) => {
  const [h, m] = String(hhmm || "0:0").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};
export const toHHMM = (mins) => {
  const m = Math.max(0, Math.round(mins));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
export const fmt12 = (hhmm) => {
  const m = toMin(hhmm);
  const h = Math.floor(m / 60), mm = m % 60;
  return `${((h + 11) % 12) + 1}:${String(mm).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

const HOURS = { "<1": 0.5, "1-2": 1.5, "3-4": 3.5, "5+": 5 };
export const hoursOf = (v) => HOURS[v] ?? 1.5;

// When the person said they usually hit a wall, as a time window.
const WALL_WINDOWS = { "Late morning": ["11:00", "12:30"], "After lunch": ["13:30", "15:00"], "Late afternoon": ["15:30", "17:30"], Evening: ["18:00", "20:00"] };
export function saidWindow(answers, dayStart, dayEnd) {
  const w = WALL_WINDOWS[answers.wall];
  if (!w) return null;
  const s = Math.max(toMin(w[0]), dayStart), e = Math.min(toMin(w[1]), dayEnd);
  return e - s >= 20 ? { start: toHHMM(s), end: toHHMM(e), label: answers.wall } : null;
}

// Wearable (watch / band / ring): first hour where the stress score reaches 70+.
export function stressHighFrom(wearable, dayStart, threshold = 70) {
  if (!wearable || !Array.isArray(wearable.stress)) return null;
  for (let i = 0; i < wearable.stress.length; i++) {
    const t = (wearable.startHour + i) * 60;
    if (t >= dayStart && wearable.stress[i] >= threshold) return toHHMM(t);
  }
  return null;
}

// Move a break out of awkward spots: to the nearest edge of a calendar meeting it lands in,
// and to just after lunch if it falls in the 45 min before lunch or during it.
export function adjustNudgeTime(time, blocks) {
  let t = toMin(time);
  const dayStart = toMin(blocks[0].start), dayEnd = toMin(blocks[blocks.length - 1].end);
  const m = blocks.find((b) => b.kind === "meeting" && b.source === "calendar" && t > toMin(b.start) && t < toMin(b.end));
  if (m) { const s0 = toMin(m.start), e0 = toMin(m.end); t = t - s0 <= e0 - t && s0 > dayStart + 20 ? s0 : e0; }
  const lunch = blocks.find((b) => b.kind === "lunch");
  if (lunch && t >= toMin(lunch.start) - 45 && t < toMin(lunch.end)) t = toMin(lunch.end) + 15;
  if (t <= dayStart + 20 || t >= dayEnd) return null;
  return toHHMM(t);
}

// Timing rules for breaks, applied to both the rules engine and the AI's suggestions:
// nothing from 45 min before lunch until lunch ends; tea/coffee only mid-morning or mid/late afternoon.
export function nudgeAllowed(time, actionId, blocks) {
  const t = toMin(time);
  const lunch = blocks.find((b) => b.kind === "lunch");
  if (lunch && t >= toMin(lunch.start) - 45 && t < toMin(lunch.end)) return false;
  if (actionId === "tea" && !((t >= 630 && t <= 705) || (t >= 900 && t <= 1050))) return false;
  return true;
}

// ---------- 1. skeleton ----------
export function buildSkeleton(answers, calendar) {
  const dayStart = toMin(answers.start || "09:30");
  const dayEnd = Math.max(toMin(answers.end || "18:30"), dayStart + 120);
  let blocks = [];

  if (Array.isArray(calendar) && calendar.length) {
    const events = calendar
      .map((e) => ({ s: Math.max(toMin(e.start), dayStart), e: Math.min(toMin(e.end), dayEnd), title: String(e.title || "Meeting").slice(0, 80) }))
      .filter((e) => e.e > e.s)
      .sort((a, b) => a.s - b.s);
    let cursor = dayStart;
    for (const ev of events) {
      if (ev.s - cursor >= 10) blocks.push({ s: cursor, e: ev.s, title: "Unscheduled time", kind: "gap" });
      const s = Math.max(ev.s, cursor);
      if (ev.e > s) blocks.push({ s, e: ev.e, title: ev.title, kind: "meeting" });
      cursor = Math.max(cursor, ev.e);
    }
    if (dayEnd - cursor >= 10) blocks.push({ s: cursor, e: dayEnd, title: "Unscheduled time", kind: "gap" });
    blocks = blocks.map((b) => ({ ...b, source: "calendar" }));
  } else {
    // No calendar: estimate a typical day from the questionnaire.
    const mH = hoursOf(answers.meetings) * 60;
    const morning = Math.min(Math.round(mH / 2), 120);
    const afternoon = Math.min(Math.round(mH - morning), 180);
    const m1 = dayStart + 30, m2 = 14 * 60 + 30;
    const plan = [
      { s: dayStart, e: m1, title: "Email & catch-up", kind: "gap" },
      { s: m1, e: m1 + morning, title: "Meetings (estimated)", kind: "meeting" },
      { s: m1 + morning, e: m2, title: "Unscheduled time", kind: "gap" },
      { s: m2, e: m2 + afternoon, title: "Meetings (estimated)", kind: "meeting" },
      { s: m2 + afternoon, e: dayEnd, title: "Unscheduled time", kind: "gap" },
    ];
    blocks = plan
      .map((b) => ({ ...b, s: Math.max(b.s, dayStart), e: Math.min(b.e, dayEnd) }))
      .filter((b) => b.e - b.s >= 10)
      .map((b) => ({ ...b, source: "estimate" }));
  }

  // Carve out a likely lunch from an unscheduled gap.
  for (const L of [13 * 60, 12 * 60 + 30, 13 * 60 + 30]) {
    const i = blocks.findIndex((b) => b.kind === "gap" && b.s <= L && b.e >= L + 30);
    if (i >= 0) {
      const g = blocks[i];
      const parts = [];
      if (L - g.s >= 10) parts.push({ ...g, e: L });
      parts.push({ ...g, s: L, e: L + 30, title: "Lunch (likely)", kind: "lunch" });
      if (g.e - (L + 30) >= 10) parts.push({ ...g, s: L + 30 });
      blocks.splice(i, 1, ...parts);
      break;
    }
  }

  return blocks.map((b, i) => ({ id: `b${i + 1}`, start: toHHMM(b.s), end: toHHMM(b.e), title: b.title, kind: b.kind, source: b.source }));
}

// ---------- 2. rules ----------
const HIGH = /review|incident|outage|debug|design|architect|planning|interview|postmortem|deadline|demo|escalat|launch|roadmap|refactor|legal/i;
const LOW = /1:1|one.on.one|coffee|social|orientation|welcome|catch.?up|email/i;
const MED = /standup|stand-up|sync|all.?hands|town.?hall/i;

export function classifyRules(block, answers) {
  const aiH = hoursOf(answers.aiHours);
  const mins = toMin(block.end) - toMin(block.start);
  if (block.kind === "lunch") return { load: "recovery", label: "Lunch" };
  if (block.kind === "meeting") {
    if (block.source === "estimate") return { load: "medium", label: block.title };
    if (LOW.test(block.title)) return { load: "low", label: block.title };
    if (MED.test(block.title)) return { load: "medium", label: block.title };
    if (HIGH.test(block.title)) return { load: "high", label: block.title };
    return { load: "medium", label: block.title };
  }
  if (LOW.test(block.title)) return { load: "low", label: block.title };
  if (mins <= 20) return { load: "low", label: "Short gap" };
  if (aiH >= 3) return { load: "high", label: "Focus work: likely reviewing AI output & debugging" };
  return { load: "medium", label: "Focus work" };
}

export function sittingStreaks(activity) {
  if (!activity || !Array.isArray(activity.steps)) return [];
  const out = [];
  let run = null;
  activity.steps.forEach((n, i) => {
    const h = activity.startHour + i;
    if (n < 250) run = run ? { ...run, e: h + 1 } : { s: h, e: h + 1 };
    else { if (run && run.e - run.s >= 2) out.push(run); run = null; }
  });
  if (run && run.e - run.s >= 2) out.push(run);
  return out.map((r) => ({ start: toHHMM(r.s * 60), end: toHHMM(r.e * 60), hours: r.e - r.s }));
}

const WEIGHT = { high: 2, medium: 1, low: 0.3, recovery: 0 };

function findWall(blocks) {
  let c = 0;
  for (const b of blocks) {
    const s = toMin(b.start), e = toMin(b.end);
    if (b.load === "recovery") { c = Math.max(0, c - 3); continue; }
    const rate = WEIGHT[b.load] / 60;
    if (rate > 0 && c + rate * (e - s) >= 5) return toHHMM(s + (5 - c) / rate);
    c += rate * (e - s);
  }
  return null;
}

const PREF_TO_ACTION = { "Tea or coffee": "tea", "Short walk": "walk", Stretching: "stretch", Breathing: "breathing", Music: "music", "Chatting with someone": "chat" };

function pickAction(answers, context, used = []) {
  const prefs = (answers.prefs || []).map((p) => PREF_TO_ACTION[p]).filter((a) => a && !used.includes(a));
  const first = (list) => list.find((a) => !used.includes(a)) || list[0];
  if (context === "sitting") return first([...prefs.filter((a) => a === "walk" || a === "stretch"), "stretch", "walk"]);
  if (context === "screen") return first(hoursOf(answers.aiHours) >= 3 ? ["eyes", "breathing", ...prefs] : ["breathing", ...prefs]);
  return first([...prefs, "breathing", "stretch"]);
}

const inStreak = (t, streaks) => streaks.some((s) => toMin(t) >= toMin(s.start) && toMin(t) < toMin(s.end));

export function rulesPlan(answers, skeleton, activity, wearable = null) {
  const blocks = skeleton.map((b) => ({ ...b, ...classifyRules(b, answers) }));
  const streaks = sittingStreaks(activity);
  const total = blocks.reduce((n, b) => n + toMin(b.end) - toMin(b.start), 0) || 1;
  const highShare = blocks.filter((b) => b.load === "high").reduce((n, b) => n + toMin(b.end) - toMin(b.start), 0) / total;
  const aiH = hoursOf(answers.aiHours);
  const intense = answers.aiFeel === "More intense";
  const detected = intense && (aiH >= 3 || highShare >= 0.5);

  const dayStart = toMin(blocks[0].start);
  const dayEnd = toMin(blocks[blocks.length - 1]?.end || answers.end);
  const said = saidWindow(answers, dayStart, dayEnd);
  const loadWall = findWall(blocks);
  const stressAt = stressHighFrom(wearable, dayStart);
  const sleepShort = wearable && Number(wearable.sleepHours) > 0 && wearable.sleepHours < 6.5;
  const hasData = blocks[0].source === "calendar" || !!wearable;

  // Data first when we have it; the person's own sense of timing when we don't.
  let wallMin = null;
  const dataTimes = [loadWall, stressAt].filter(Boolean).map(toMin);
  if (hasData && dataTimes.length) wallMin = Math.min(...dataTimes);
  else if (said) wallMin = loadWall ? Math.min(Math.max(toMin(loadWall), toMin(said.start)), toMin(said.end)) : (toMin(said.start) + toMin(said.end)) / 2;
  else if (loadWall) wallMin = toMin(loadWall);
  if (wallMin != null && sleepShort) wallMin = Math.max(dayStart + 60, wallMin - 30);
  const wallTime = wallMin != null ? toHHMM(Math.round(wallMin / 5) * 5) : null;

  const why = [];
  if (wallTime) {
    if (stressAt && toMin(stressAt) <= toMin(wallTime) + 30) why.push(`Your watch shows stress climbing to 70+ from ${fmt12(stressAt)}.`);
    else if (hasData) why.push("Heavy work builds up before this point with no real break.");
    if (sleepShort) why.push(`You slept ${wearable.sleepHours} h last night, so it may come sooner.`);
    if (said) {
      const inside = toMin(wallTime) >= toMin(said.start) && toMin(wallTime) <= toMin(said.end);
      if (!hasData) why.push(`Based on when you said you hit a wall (${said.label.toLowerCase()}) and your answers.`);
      else if (inside) why.push(`That matches when you said you hit a wall (${said.label.toLowerCase()}).`);
      else why.push(`You said ${said.label.toLowerCase()}, but your ${stressAt ? "watch and calendar suggest" : "calendar suggests"} it starts ${toMin(wallTime) < toMin(said.start) ? "earlier" : "later"}.`);
    }
  }
  const nudges = [];
  const used = () => nudges.map((n) => n.action_id);
  // msg(action) builds the message once the final action is known.
  const add = (mins, action_id, msg, context = "pref") => {
    const at = adjustNudgeTime(toHHMM(Math.round(mins / 5) * 5), blocks);
    if (!at) return;
    const t = toMin(at);
    if (nudges.some((n) => Math.abs(toMin(n.time) - t) < 45)) return;
    // Tea only at sensible times; otherwise pick the next best break.
    if (!nudgeAllowed(toHHMM(t), action_id, blocks)) action_id = pickAction(answers, context, [...used(), "tea"]);
    if (!nudgeAllowed(toHHMM(t), action_id, blocks)) return;
    nudges.push({ time: toHHMM(t), action_id, message: msg(actionById(action_id)) });
  };

  if (wallTime) {
    const t = toMin(wallTime) - 20;
    const ctx = inStreak(toHHMM(t), streaks) ? "sitting" : "pref";
    const a = pickAction(answers, ctx, used());
    add(t, a, (x) => `Your energy is likely to dip around ${fmt12(wallTime)}. ${x.title} now, before it hits?`, ctx);
  }
  // Longest run of consecutive high-load blocks
  let best = null, run = null;
  for (const b of blocks) {
    if (b.load === "high") run = run ? { ...run, e: toMin(b.end) } : { s: toMin(b.start), e: toMin(b.end) };
    else { if (run && (!best || run.e - run.s > best.e - best.s)) best = run; run = null; }
  }
  if (run && (!best || run.e - run.s > best.e - best.s)) best = run;
  if (best && best.e - best.s >= 90) {
    const mid = (best.s + best.e) / 2;
    const ctx = inStreak(toHHMM(mid), streaks) ? "sitting" : "screen";
    const a = pickAction(answers, ctx, used());
    add(mid, a, (x) => `You're in ${Math.round((best.e - best.s) / 60 * 10) / 10} hours of heavy work with no break. ${x.title}?`, ctx);
  }
  if (streaks.length) {
    const s = streaks.reduce((x, y) => (y.hours > x.hours ? y : x));
    const a = pickAction(answers, "sitting", used());
    add(toMin(s.start) + 75, a, (x) => `You've barely moved since ${fmt12(s.start)}. ${x.title}?`, "sitting");
  }
  if (detected) add(dayEnd - 25, "shutdown", () => "Wrapping up soon. A 3-minute shutdown so work doesn't follow you home?");
  nudges.sort((a, b) => toMin(a.time) - toMin(b.time));

  const drained = Number(answers.drained) || 3;
  let next;
  if (drained >= 5) next = { id: "counselling", why: "You said you're very drained at the end of most days. Talking it through with a counsellor is the strongest next step.", alt_id: "program_recovery" };
  else if (detected) next = { id: "program_recovery", why: "Your day has become mostly heavy work since AI tools arrived. This program rebuilds the light moments that help you recover.", alt_id: drained >= 4 ? "counselling" : "article_ai_load" };
  else if (drained >= 3) next = { id: "assessment_load", why: "A short check will show whether this is about workload, sleep or something else.", alt_id: "program_workstress" };
  else next = { id: "program_gratitude", why: "Your day looks fairly balanced. A light daily habit helps keep it that way.", alt_id: "assessment_load" };

  return {
    blocks,
    streaks,
    pattern: detected
      ? { detected: true, headline: "Your day has lost its easy parts", explanation: `About ${Math.round(highShare * 100)}% of your day is heavy work. AI now handles the lighter tasks that used to give your brain a break, so the recovery has gone and the hard work remains.` }
      : { detected: false, headline: "No AI-overload pattern in your day", explanation: "Your day still has a mix of heavy and light work. We'll still suggest small breaks where they'll help most." },
    wall: wallTime ? { time: wallTime, reason: why.join(" ") } : null,
    said,
    nudges: nudges.slice(0, 3),
    next_step: next,
    signals: { highShare: Math.round(highShare * 100) / 100, confidence: 0.5 },
    source: "rules",
  };
}
