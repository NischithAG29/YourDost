// Deterministic safety layer. Runs BEFORE any AI call, on both client and
// server, so a crisis message never depends on the model behaving well.
// Deliberately over-inclusive: a false alarm costs a moment of friction,
// a miss could cost far more.

const CRISIS_PATTERNS = [
  /\bsuicid/i,
  /\bkill(ing)?\s+my\s*self\b/i,
  /\b(hurt|harm)(ing)?\s+my\s*self\b/i,
  /\bself[\s-]?harm/i,
  /\bcut(ting)?\s+my\s*self\b/i,
  /\bend\s+(it\s+all|my\s+life)\b/i,
  /\bwant(ed)?\s+to\s+die\b/i,
  /\b(don'?t|do\s+not)\s+want\s+to\s+(live|be\s+alive|wake\s+up)\b/i,
  /\bpoint\s+(of|in)\s+(going\s+on|living|life)\b/i,
  /\bnot\s+worth\s+living\b/i,
  /\bbetter\s+off\s+(dead|without\s+me)\b/i,
  /\boverdose\b/i,
  /\b(hits?|beats?|abuses?)\s+me\b/i,
];

export function detectCrisis(text) {
  const t = String(text || "");
  return CRISIS_PATTERNS.some((re) => re.test(t));
}

// Verify these numbers before submitting.
export const HELPLINES = [
  { name: "Tele-MANAS (Govt. of India) · free, 24x7", phone: "14416", alt: "1-800-891-4416" },
  { name: "Emergency services", phone: "112" },
];
