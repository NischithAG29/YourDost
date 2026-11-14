// Fictional demo profiles. No real people or data.

export const DEMO_PROFILES = {
  karan: {
    label: "Karan, 29, backend engineer (heavy AI use)",
    answers: {
      drained: 4,
      role: "Engineering",
      start: "09:30",
      end: "19:00",
      meetings: "3-4",
      aiHours: "3-4",
      aiFeel: "More intense",
      wall: "After lunch",
      lightest: "Used to be writing tests and small fixes, but Copilot does those now.",
      prefs: ["Tea or coffee", "Short walk", "Music"],
    },
    calendar: [
      { start: "09:30", end: "09:45", title: "Daily standup" },
      { start: "10:00", end: "11:00", title: "Code review: payments refactor" },
      { start: "11:00", end: "12:00", title: "Incident review: checkout outage" },
      { start: "14:00", end: "15:00", title: "Sprint planning" },
      { start: "15:00", end: "16:30", title: "Architecture review: AI agent rollout" },
      { start: "17:00", end: "17:30", title: "1:1 with manager" },
      { start: "18:00", end: "18:45", title: "Interview: backend candidate" },
    ],
    // Steps per hour from 09:00 to 19:00
    activity: { startHour: 9, steps: [700, 160, 90, 60, 1300, 110, 70, 40, 90, 220] },
  },
  priya: {
    label: "Priya, 35, HR operations (light AI use)",
    answers: {
      drained: 2,
      role: "Ops",
      start: "09:00",
      end: "17:30",
      meetings: "1-2",
      aiHours: "<1",
      aiFeel: "About the same",
      wall: "Late afternoon",
      lightest: "Updating trackers and chatting with new joiners.",
      prefs: ["Tea or coffee", "Chatting with someone"],
    },
    calendar: [
      { start: "10:00", end: "10:30", title: "Team sync" },
      { start: "12:00", end: "12:30", title: "New joiner orientation" },
      { start: "15:00", end: "16:00", title: "Policy review with legal" },
    ],
    activity: { startHour: 9, steps: [800, 600, 450, 900, 1200, 500, 650, 400, 300] },
  },
};
