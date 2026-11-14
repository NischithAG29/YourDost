// Fictional demo profiles. No real people or data.

export const DEMO_PROFILES = {
  karan: {
    label: "Karan, 29, marketing manager (heavy AI use)",
    answers: {
      drained: 4,
      role: "Marketing",
      start: "09:30",
      end: "19:00",
      meetings: "3-4",
      aiHours: "3-4",
      aiFeel: "More intense",
      wall: "After lunch",
      lightest: "Used to be writing social captions and resizing banners, but AI does those now.",
      prefs: ["Tea or coffee", "Short walk", "Music"],
    },
    calendar: [
      { start: "09:30", end: "09:45", title: "Daily standup" },
      { start: "10:00", end: "11:00", title: "Campaign review: festive launch creatives" },
      { start: "11:00", end: "12:00", title: "Ad performance review: Q4 campaigns" },
      { start: "14:00", end: "15:00", title: "Launch planning with product team" },
      { start: "15:00", end: "16:30", title: "Review AI-generated copy: 40 product pages" },
      { start: "17:00", end: "17:30", title: "1:1 with manager" },
      { start: "18:00", end: "18:45", title: "Agency brief: new year campaign" },
    ],
    // Steps per hour from 09:00 to 19:00
    activity: { startHour: 9, steps: [700, 160, 90, 60, 1300, 110, 70, 40, 90, 220] },
  },
  priya: {
    label: "Priya, 35, legal counsel (light AI use)",
    answers: {
      drained: 2,
      role: "Legal",
      start: "09:00",
      end: "17:30",
      meetings: "1-2",
      aiHours: "<1",
      aiFeel: "About the same",
      wall: "Late afternoon",
      lightest: "Filing documents and catching up with the team.",
      prefs: ["Tea or coffee", "Chatting with someone"],
    },
    calendar: [
      { start: "10:00", end: "10:30", title: "Team sync" },
      { start: "12:00", end: "12:30", title: "Compliance training" },
      { start: "15:00", end: "16:00", title: "Contract review with vendor" },
    ],
    activity: { startHour: 9, steps: [800, 600, 450, 900, 1200, 500, 650, 400, 300] },
  },
};
