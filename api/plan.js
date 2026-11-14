// POST /api/plan
// Body: { answers, calendar?: [{start,end,title}], activity?: {startHour, steps[]} }
// Returns a day plan: blocks with load, pattern, wall, nudges, next_step.
//
// Flow: safety check -> deterministic skeleton -> AI reads the day -> validate -> rules fallback.

import { CATALOG, CATALOG_IDS } from "../public/lib/catalog.js";
import { ACTIONS, ACTION_IDS } from "../public/lib/actions.js";
import { detectCrisis } from "../public/lib/safety.js";
import { buildSkeleton, rulesPlan, sittingStreaks, toMin } from "../public/lib/planner.js";

const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const TIMEOUT_MS = 25000;
const LOADS = ["high", "medium", "low", "recovery"];

const SYSTEM_PROMPT = `You are the planning engine inside "DOST Compass", an employee wellbeing app.
You receive an employee's onboarding answers, their workday split into time blocks (from their calendar, or estimated), and optionally hours where they barely moved.

Your job:
1. For EVERY block, judge its cognitive load: "high" (decisions, reviews, debugging, incidents, interviews, reviewing or fixing AI output), "medium", "low" (light admin, casual 1:1s, social), or "recovery" (real breaks, lunch). Use the meeting title, the person's role, and their answers. Unscheduled time for someone spending 3+ hours a day on AI output is usually high load. Give each block a short human label (max 7 words).
2. Decide whether the "AI-overload" pattern is present: AI tools have absorbed the light, easy tasks, so the day is now mostly heavy work with few natural breaks. Evidence: workday feels more intense since AI, many hours on AI output, a high share of heavy blocks, lost light tasks. Do NOT force this pattern if the evidence is weak.
3. Predict when they are most likely to hit a wall (HH:MM), considering load build-up, lack of recovery, sitting streaks, and what they told you.
4. Suggest at most 3 nudges in the day, at least 45 minutes apart, placed just before the wall, inside long heavy stretches, or during long sitting streaks. Each uses one action id from the list. Respect their break preferences where sensible; favour movement after sitting streaks. Message: max 22 words, specific to their day, warm, no guilt.
5. Choose the single best next step from the catalogue, with a one-sentence why that references their situation, and one alternative.

Rules: never diagnose or name conditions; never say "burnout risk" as a verdict; plain, kind language; no emojis.

ACTIONS:
${ACTIONS.map((a) => `- ${a.id}: ${a.title} (${a.mins} min). ${a.when}`).join("\n")}

CATALOGUE:
${CATALOG.map((c) => `- ${c.id}: ${c.title}. Best for: ${c.fit}`).join("\n")}

Respond with JSON only:
{
  "blocks": [{ "id": string, "load": "high"|"medium"|"low"|"recovery", "label": string }],
  "pattern": { "detected": boolean, "headline": string (max 8 words), "explanation": string (max 45 words, speak to them as "you") },
  "wall": { "time": "HH:MM", "reason": string (max 20 words) } | null,
  "nudges": [{ "time": "HH:MM", "action_id": string, "message": string }],
  "next_step": { "id": string, "why": string, "alt_id": string },
  "confidence": number between 0 and 1
}`;

const CRISIS = {
  type: "crisis",
  message: "Thank you for sharing that. It sounds like you're carrying something really heavy, and you deserve support from a person right now.",
  source: "safety-filter",
};

function cleanAnswers(a = {}) {
  const pick = (v, list, d) => (list.includes(v) ? v : d);
  const time = (v, d) => (/^\d{2}:\d{2}$/.test(v || "") ? v : d);
  return {
    drained: Math.min(5, Math.max(1, Number(a.drained) || 3)),
    role: String(a.role || "Other").slice(0, 40),
    start: time(a.start, "09:30"),
    end: time(a.end, "18:30"),
    meetings: pick(a.meetings, ["<1", "1-2", "3-4", "5+"], "1-2"),
    aiHours: pick(a.aiHours, ["<1", "1-2", "3-4", "5+"], "1-2"),
    aiFeel: pick(a.aiFeel, ["Lighter", "About the same", "More intense"], "About the same"),
    wall: String(a.wall || "No pattern").slice(0, 30),
    lightest: String(a.lightest || "").slice(0, 300),
    prefs: Array.isArray(a.prefs) ? a.prefs.slice(0, 6).map((p) => String(p).slice(0, 30)) : [],
  };
}

function cleanCalendar(cal) {
  if (!Array.isArray(cal)) return null;
  const ok = cal
    .slice(0, 20)
    .filter((e) => e && /^\d{2}:\d{2}$/.test(e.start) && /^\d{2}:\d{2}$/.test(e.end))
    .map((e) => ({ start: e.start, end: e.end, title: String(e.title || "Meeting").slice(0, 80) }));
  return ok.length ? ok : null;
}

function cleanActivity(act) {
  if (!act || !Array.isArray(act.steps)) return null;
  return { startHour: Math.min(23, Math.max(0, Number(act.startHour) || 9)), steps: act.steps.slice(0, 16).map((n) => Math.max(0, Number(n) || 0)) };
}

async function callGemini(payload) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("NO_KEY");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      signal: ctrl.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: JSON.stringify(payload) }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.3 },
      }),
    });
    if (!res.ok) throw new Error(`GEMINI_${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    // Newer models may include "thought" parts; keep only the answer text.
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const text = parts.filter((p) => !p.thought).map((p) => p.text || "").join("");
    if (!text) throw new Error(`AI_EMPTY (${data?.candidates?.[0]?.finishReason || data?.promptFeedback?.blockReason || "no text"})`);
    const a = text.indexOf("{"), b = text.lastIndexOf("}");
    try {
      return JSON.parse(a >= 0 && b > a ? text.slice(a, b + 1) : text);
    } catch {
      throw new Error("AI_BAD_JSON");
    }
  } finally {
    clearTimeout(timer);
  }
}

// Merge AI output onto the rules plan, field by field. Anything invalid keeps the rules value.
function merge(ai, base, dayStart, dayEnd) {
  if (!ai || typeof ai !== "object") return null;
  const inDay = (t) => /^\d{2}:\d{2}$/.test(t || "") && toMin(t) > dayStart && toMin(t) < dayEnd;
  const byId = Object.fromEntries((Array.isArray(ai.blocks) ? ai.blocks : []).map((b) => [b?.id, b]));
  let aiBlocks = 0;
  const blocks = base.blocks.map((b) => {
    const a = byId[b.id];
    if (a && LOADS.includes(a.load)) {
      aiBlocks++;
      return { ...b, load: a.load, label: typeof a.label === "string" && a.label.trim() ? a.label.slice(0, 60) : b.label };
    }
    return b;
  });

  const nudges = (Array.isArray(ai.nudges) ? ai.nudges : [])
    .filter((n) => n && inDay(n.time) && ACTION_IDS.includes(n.action_id) && typeof n.message === "string")
    .sort((x, y) => toMin(x.time) - toMin(y.time))
    .filter((n, i, arr) => i === 0 || toMin(n.time) - toMin(arr[i - 1].time) >= 30)
    .slice(0, 3)
    .map((n) => ({ time: n.time, action_id: n.action_id, message: n.message.slice(0, 160) }));

  const ns = ai.next_step;
  const next_step = ns && CATALOG_IDS.includes(ns.id)
    ? { id: ns.id, why: String(ns.why || "").slice(0, 240), alt_id: CATALOG_IDS.includes(ns.alt_id) && ns.alt_id !== ns.id ? ns.alt_id : base.next_step.alt_id }
    : base.next_step;

  const p = ai.pattern;
  const pattern = p && typeof p.detected === "boolean" && p.headline && p.explanation
    ? { detected: p.detected, headline: String(p.headline).slice(0, 60), explanation: String(p.explanation).slice(0, 320) }
    : base.pattern;

  const wall = ai.wall && inDay(ai.wall.time) ? { time: ai.wall.time, reason: String(ai.wall.reason || "").slice(0, 160) } : base.wall;

  return {
    ...base,
    blocks,
    pattern,
    wall,
    nudges: nudges.length ? nudges : base.nudges,
    next_step,
    signals: { ...base.signals, confidence: Math.min(1, Math.max(0, Number(ai.confidence) || 0.6)), aiBlocks: `${aiBlocks}/${blocks.length}` },
    source: aiBlocks === blocks.length && nudges.length ? "ai" : "ai + rules (partial)",
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body || "{}"); } catch { body = {}; } }
  body = body || {};

  const answers = cleanAnswers(body.answers);
  const calendar = cleanCalendar(body.calendar);
  const activity = cleanActivity(body.activity);

  // 1. Safety first: the only free text is "lightest part of the day".
  if (detectCrisis(answers.lightest)) return res.status(200).json(CRISIS);

  // 2. Deterministic structure + rules baseline.
  const skeleton = buildSkeleton(answers, calendar);
  const base = rulesPlan(answers, skeleton, activity);
  const dayStart = toMin(skeleton[0].start), dayEnd = toMin(skeleton[skeleton.length - 1].end);

  // 3. AI reads the day; 4. validate & merge; 5. fall back to rules.
  try {
    const ai = await callGemini({
      answers,
      blocks: skeleton.map(({ id, start, end, title, kind, source }) => ({ id, start, end, title, kind, source })),
      sitting_streaks: sittingStreaks(activity),
      data_sources: { calendar: !!calendar, health_data: !!activity },
    });
    const merged = merge(ai, base, dayStart, dayEnd);
    return res.status(200).json(merged || { ...base, source: "rules (AI output invalid)" });
  } catch (err) {
    if (err.message !== "NO_KEY") console.error("AI error:", err.message);
    // Short, non-secret reason shown in the reviewer panel (e.g. GEMINI_404, AI_BAD_JSON, timeout).
    const reason = err.name === "AbortError" ? "timeout" : String(err.message).split(":")[0].slice(0, 40);
    return res.status(200).json({ ...base, source: err.message === "NO_KEY" ? "rules (no API key set)" : `rules (AI unavailable: ${reason}, model ${MODEL})` });
  }
}
