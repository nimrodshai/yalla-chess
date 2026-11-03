// Demo data for the management app on a development database. Every name,
// phone and email here is fictional and unroutable; production never calls
// this (server.mjs guards on NODE_ENV).

import * as store from './business-db.mjs';
import {
  normalizeContent,
  normalizeEvent,
  normalizeExpense,
  normalizeGroupProfile,
  normalizeLead,
  normalizeLesson,
  normalizePayment,
  normalizeStudent,
  normalizeTeacher
} from './business.mjs';
import { addDays, todayInZone, weekdayOfIsoDate } from './time.mjs';

function lastWeekday(fromIso, weekday, offsetWeeks = 0) {
  let date = fromIso;
  while (weekdayOfIsoDate(date) !== weekday) date = addDays(date, -1);
  return addDays(date, -7 * offsetWeeks);
}

export function seedBusinessDemo({ groups = [] } = {}) {
  const today = todayInZone('Asia/Jerusalem');
  // Pick three distinct groups to populate, by id first and by title keyword
  // as a fallback, so the demo reads sensibly on any development database.
  const used = new Set();
  const pick = (ids, keywords) => {
    const byId = groups.find((group) => ids.includes(group.id) && !used.has(group.id));
    const titleOf = (group) => `${group.title?.en || ''} ${group.title?.he || ''} ${group.id}`.toLowerCase();
    const byTitle = groups.find((group) => !used.has(group.id) && keywords.some((keyword) => titleOf(group).includes(keyword)));
    const any = groups.find((group) => !used.has(group.id));
    const chosen = byId || byTitle || any;
    if (chosen) used.add(chosen.id);
    return chosen ? chosen.id : '';
  };
  const rookies = pick(['rookies', 'beginners-a'], ['rookie', 'beginner', 'מתחיל']);
  const tactics = pick(['tactics', 'intermediate'], ['tactic', 'intermediate', 'טקטיק', 'מתקדמים']);
  const champions = pick(['champions', 'tournament-squad'], ['champion', 'advanced', 'tournament', 'אלופ', 'נבחרת']);
  const weekdayOf = (groupId) => {
    const group = groups.find((entry) => entry.id === groupId);
    const row = group?.schedule?.rows?.[0] || group?.schedule || {};
    return Number.isInteger(row.weekday) ? row.weekday : 1;
  };
  const timeOf = (groupId) => {
    const group = groups.find((entry) => entry.id === groupId);
    const row = group?.schedule?.rows?.[0] || group?.schedule || {};
    return row.startTime || '17:00';
  };

  const profiles = [
    normalizeGroupProfile({ minAge: 6, maxAge: 9, level: 'beginner', ratingMin: 0, ratingMax: 600, language: 'he', teacher: 'דולב', status: 'active', price: 250, currency: 'ILS', description: 'קבוצת מתחילים: חוקי המשחק, מט בסיסי, טקטיקה ראשונה' }, null, rookies),
    normalizeGroupProfile({ minAge: 9, maxAge: 13, level: 'intermediate', ratingMin: 600, ratingMax: 1100, language: 'he', teacher: 'דולב', status: 'active', price: 280, currency: 'ILS', description: 'טקטיקה: מזלגות, ריתוקים, שיפודים, חישוב וריאציות' }, null, tactics),
    normalizeGroupProfile({ minAge: 11, maxAge: 16, level: 'advanced', ratingMin: 1100, ratingMax: 1600, language: 'en', teacher: 'דולב', status: 'forming', price: 95, currency: 'USD', description: 'Advanced group for English speakers: openings, endgames, annotated master games' }, null, champions)
  ];
  for (const profile of profiles) store.groupProfiles.put(profile);

  const studentSpecs = [
    { firstName: 'נועם', lastName: 'לוי', age: 8, country: 'ישראל', timezone: 'Asia/Jerusalem', language: 'he', parentName: 'מיכל לוי', parentPhone: '+972500000104', parentEmail: 'michal@example.test', level: 'beginner', chesscomUsername: 'noam_rook', chesscomRating: 480, groupId: rookies, lessonType: 'group', joinedAt: addDays(today, -95), status: 'active', price: 250, currency: 'ILS', billingType: 'monthly', billingDay: 1, strengths: 'חשיבה מהירה, זוכר פתיחות', weaknesses: 'ממהר, לא בודק איומים של היריב', goals: 'להגיע ל-700 בצ׳ס.קום עד סוף השנה', notes: 'מרוכז בשיעורי בוקר, פחות אחרי הצהריים.', userPhone: '+972500000004' },
    { firstName: 'תמר', lastName: 'כהן', age: 7, country: 'ישראל', timezone: 'Asia/Jerusalem', language: 'he', parentName: 'יעל כהן', parentPhone: '+972500000105', level: 'beginner', chesscomRating: 350, groupId: rookies, lessonType: 'group', joinedAt: addDays(today, -60), status: 'active', price: 250, currency: 'ILS', billingType: 'monthly', billingDay: 10, strengths: 'סבלנית, אוהבת חידות מט', weaknesses: 'סיומים', goals: 'להשתתף בטורניר בית ספרי' },
    { firstName: 'איתי', lastName: 'פרידמן', age: 9, country: 'ישראל', timezone: 'Asia/Jerusalem', language: 'he', parentName: 'רון פרידמן', parentPhone: '+972500000106', level: 'novice', chesscomRating: 620, groupId: rookies, lessonType: 'group', joinedAt: addDays(today, -40), status: 'active', price: 250, currency: 'ILS', billingType: 'monthly', billingDay: 15, notes: 'עבר מקבוצה פרטית, מתקדם מהר' },
    { firstName: 'Daniel', lastName: 'Katz', age: 11, country: 'USA', timezone: 'America/New_York', language: 'en', parentName: 'Sarah Katz', parentPhone: '+12025550121', parentEmail: 'sarah@example.test', level: 'intermediate', chesscomUsername: 'dkatz_chess', chesscomRating: 920, groupId: tactics, lessonType: 'group', joinedAt: addDays(today, -120), status: 'active', price: 90, currency: 'USD', billingType: 'monthly', billingDay: 1, strengths: 'Tactics, pattern recognition', weaknesses: 'Time management in long games', goals: 'Reach 1200 on Chess.com' },
    { firstName: 'מאיה', lastName: 'שפירא', age: 10, country: 'ישראל', timezone: 'Asia/Jerusalem', language: 'he', parentName: 'דנה שפירא', parentPhone: '+972500000108', level: 'intermediate', chesscomRating: 780, groupId: tactics, lessonType: 'group', joinedAt: addDays(today, -200), status: 'active', price: 280, currency: 'ILS', billingType: 'monthly', billingDay: 5, strengths: 'חישוב', weaknesses: 'פתיחות עם שחור' },
    { firstName: 'יונתן', lastName: 'ברק', age: 12, country: 'ישראל', timezone: 'Asia/Jerusalem', language: 'he', parentName: 'אורית ברק', parentPhone: '+972500000109', level: 'intermediate', chesscomRating: 1010, groupId: tactics, lessonType: 'both', privateSchedule: [{ weekday: 0, startTime: '16:00', durationMinutes: 45 }], joinedAt: addDays(today, -150), status: 'active', price: 280, currency: 'ILS', billingType: 'monthly', billingDay: 20, notes: 'שיעור פרטי נוסף בימי ראשון לקראת טורניר' },
    { firstName: 'Ella', lastName: 'Rosen', age: 13, country: 'UK', timezone: 'Europe/London', language: 'en', parentName: 'Jonathan Rosen', parentPhone: '+447700900123', level: 'advanced', chesscomUsername: 'ella_r', chesscomRating: 1240, groupId: champions, lessonType: 'group', joinedAt: addDays(today, -30), status: 'active', price: 95, currency: 'USD', billingType: 'monthly', billingDay: 1, strengths: 'Endgames, calm under pressure', goals: 'Play a rated OTB tournament' },
    { firstName: 'עומר', lastName: 'גל', age: 14, country: 'ישראל', timezone: 'Asia/Jerusalem', language: 'he', parentName: 'שירה גל', parentPhone: '+972500000111', level: 'advanced', chesscomRating: 1380, groupId: '', lessonType: 'private', privateSchedule: [{ weekday: 2, startTime: '19:30', durationMinutes: 60 }], privateZoomLink: 'https://zoom.us/j/00000000001', joinedAt: addDays(today, -300), status: 'active', price: 160, currency: 'ILS', billingType: 'package', packageSize: 8, strengths: 'הבנה פוזיציונית', weaknesses: 'סיומי צריחים', goals: 'דירוג 1600' },
    { firstName: 'ליאם', lastName: 'אברהם', age: 6, country: 'ישראל', timezone: 'Asia/Jerusalem', language: 'he', parentName: 'נטע אברהם', parentPhone: '+972500000112', level: 'beginner', groupId: rookies, lessonType: 'group', joinedAt: addDays(today, -5), status: 'trial', price: 250, currency: 'ILS', billingType: 'monthly', notes: 'שיעור ניסיון ראשון עבר יפה, ההורים מתלבטים' },
    { firstName: 'Ariel', lastName: 'Mizrahi', age: 9, country: 'Canada', timezone: 'America/Toronto', language: 'en', parentName: 'Tal Mizrahi', parentPhone: '+14165550199', level: 'novice', chesscomRating: 560, groupId: '', lessonType: 'group', joinedAt: '', status: 'waitlist', price: 85, currency: 'USD', billingType: 'monthly', notes: 'Waiting for an English-speaking beginner group in the evening (EST)' },
    { firstName: 'רועי', lastName: 'נחום', age: 10, country: 'ישראל', timezone: 'Asia/Jerusalem', language: 'he', parentName: 'גלית נחום', parentPhone: '+972500000114', level: 'novice', chesscomRating: 600, groupId: '', lessonType: 'group', joinedAt: addDays(today, -250), leftAt: addDays(today, -20), status: 'inactive', price: 250, currency: 'ILS', billingType: 'monthly', notes: 'עזב בגלל חוגים אחרים, ביקש לחזור בקיץ' }
  ];

  const students = studentSpecs.map((spec) => {
    const record = normalizeStudent(spec);
    store.students.put(record);
    return record;
  });
  const byName = Object.fromEntries(students.map((student) => [student.firstName, student]));

  const contentSpecs = [
    { key: 'greco', kind: 'game', title: 'Gioachino Greco vs NN, Rome 1620', white: 'Gioachino Greco', black: 'NN', event: 'Rome', gameDate: '1620', result: '1-0', topic: 'פתיחה איטלקית', level: 'novice', pgn: '[White "Gioachino Greco"]\n[Black "NN"]\n[Date "1620"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 Nf6 5. d4 exd4 6. cxd4 Bb4+ 7. Nc3 Nxe4 8. O-O Nxc3 9. bxc3 Bxc3 10. Qb3 Bxa1 11. Bxf7+ Kf8 12. Bg5 Ne7 13. Ne5 Bxd4 14. Bg6 d5 15. Qf3+ Bf5 16. Bxf5 Bxe5 17. Be6+ Bf6 18. Bxf6 gxf6 19. Qxf6+ Ke8 20. Qf7# 1-0', body: 'התקפה מהירה בפתיחה האיטלקית: למה לא לאכול חומר על חשבון פיתוח.', tags: ['פתיחה', 'משחק מפורסם'] },
    { kind: 'plan', title: 'מערך שיעור: מזלג פרש (40 דק׳)', topic: 'מזלג', level: 'beginner', ageMin: 6, ageMax: 10, durationMinutes: 40, body: '1. חימום (5 דק׳): פאזל מט ב-1.\n2. הסבר (10 דק׳): מהו מזלג, למה הפרש מסוכן.\n3. תרגול (15 דק׳): 6 עמדות מזלג פרש.\n4. משחק מודרך (8 דק׳).\n5. סיכום ושיעורי בית (2 דק׳).', tags: ['טקטיקה', 'פרש'], verified: true },
    { kind: 'exercise', title: 'מזלג מלכותי', topic: 'מזלג', level: 'beginner', fen: 'r3k2r/ppp2ppp/2n5/3q4/8/2N2N2/PPP2PPP/R2QKB1R w KQkq - 0 1', solution: '1.Nxd5? לא. הפתרון: 1.Nc7+ מזלג על המלך והצריח... (לבדוק לפני שימוש)', body: 'לבן משחק. מצאו מזלג שמרוויח חומר.', tags: ['מזלג'], verified: false },
    { kind: 'exercise', title: 'מט בשני מהלכים: הקרבת מלכה', topic: 'מט בשני', level: 'novice', fen: '2kr3r/ppp2ppp/8/2b1q3/8/2N5/PPP2PPP/R1BQR1K1 w - - 0 1', solution: '1.Qd8+! Rxd8 2.Re8#  (לאמת)', body: 'לבן משחק ונותן מט בשני מהלכים.', tags: ['מט', 'הקרבה'], verified: false },
    { key: 'lasker', kind: 'game', title: 'Edward Lasker vs George Alan Thomas, London 1912', white: 'Edward Lasker', black: 'George Alan Thomas', event: 'London', gameDate: '1912.10.29', result: '1-0', topic: 'התקפה על המלך', level: 'intermediate', pgn: '1. d4 e6 2. Nf3 f5 3. Nc3 Nf6 4. Bg5 Be7 5. Bxf6 Bxf6 6. e4 fxe4 7. Nxe4 b6 8. Ne5 O-O 9. Bd3 Bb7 10. Qh5 Qe7 11. Qxh7+ Kxh7 12. Nxf6+ Kh6 13. Neg4+ Kg5 14. h4+ Kf4 15. g3+ Kf3 16. Be2+ Kg2 17. Rh2+ Kg1 18. Kd2# 1-0', body: 'המשחק המפורסם ביותר של "מסע המלך": הקרבת מלכה שמובילה את המלך השחור לצד השני של הלוח.', tags: ['הקרבת מלכה', 'משחק מפורסם'], verified: true },
    { key: 'legal', kind: 'game', title: 'Légal vs Saint-Brie, Paris 1750 (Légal Trap)', white: 'Légal', black: 'Saint-Brie', event: 'Paris', gameDate: '1750', result: '1-0', topic: 'ריתוק', level: 'beginner', pgn: '1. e4 e5 2. Bc4 d6 3. Nf3 Bg4 4. Nc3 g6 5. Nxe5 Bxd1 6. Bxf7+ Ke7 7. Nd5# 1-0', body: 'מלכודת לגאל: ריתוק "מדומה" של הפרש. מתאים להסביר למה ריתוק יחסי לא תמיד מחייב.', tags: ['ריתוק', 'מלכודת'], verified: true },
    { kind: 'homework', title: 'שיעורי בית: 10 פאזלים של מזלג', topic: 'מזלג', level: 'beginner', body: 'פתרו 10 פאזלים בנושא Fork בצ׳ס.קום (Puzzles > Themes > Fork). צלמו את התוצאה ושלחו בוואטסאפ.', tags: ['שיעורי בית'] },
    { kind: 'curriculum', title: 'תוכנית לימודים: מתחילים (12 שבועות)', topic: 'תוכנית', level: 'beginner', ageMin: 6, ageMax: 9, body: '1. הלוח והכלים\n2. מט בסיסי: מלכה ומלך\n3. מט בשני מהלכים\n4. מזלג\n5. ריתוק\n6. שיפוד\n7. הסרת מגן\n8. פתיחה: 3 עקרונות\n9. סיום: מלך ומלכה נגד מלך\n10. סיום: צריח ומלך נגד מלך\n11. משחקים מפורסמים\n12. טורניר פנימי', tags: ['תוכנית לימודים'], verified: true }
  ];
  // Content first, so lessons can point at the games they showed.
  const contentByKey = {};
  for (const { key, ...spec } of contentSpecs) {
    const item = normalizeContent(spec, null, 'seed');
    store.content.put(item);
    if (key) contentByKey[key] = item;
  }
  const gameRefs = (...keys) => keys.map((key) => contentByKey[key]).filter(Boolean).map((item) => ({ id: item.id, title: item.title }));

  const lessonSpecs = [
    { groupId: rookies, weeksAgo: 3, topic: 'מט בשני מהלכים', topics: ['מט בשני מהלכים', 'כוח המלכה'], exercises: '5 תרגילי מט ב-2 מהספר של פולגאר', games: '', successes: 'נועם ותמר פתרו את כל התרגילים', difficulties: 'איתי התקשה בזיהוי איומי מט', homework: '3 תרגילי מט ב-2 בצ׳ס.קום', nextSteps: 'לחזור על איומי מט, להתחיל מזלגות', attendance: { [byName['נועם'].id]: 'present', [byName['תמר'].id]: 'present', [byName['איתי'].id]: 'late' } },
    { groupId: rookies, weeksAgo: 2, topic: 'מזלג פרש', topics: ['מזלג', 'פרש'], exercises: '6 תרגילי מזלג פרש', games: '', successes: 'כולם זיהו מזלג מלכותי', difficulties: 'תמר התבלבלה בין מזלג לריתוק', homework: 'לשחק 3 משחקים ולחפש מזלגות', nextSteps: 'ריתוקים', attendance: { [byName['נועם'].id]: 'present', [byName['תמר'].id]: 'present', [byName['איתי'].id]: 'present' } },
    { groupId: rookies, weeksAgo: 1, topic: 'ריתוק מוחלט וריתוק יחסי', topics: ['ריתוק'], exercises: '4 תרגילי ריתוק', games: '', gameRefs: gameRefs('legal'), successes: 'איתי הבין מיד את ההבדל', difficulties: 'נועם ממהר ולא בודק מה היריב מאיים', homework: 'תרגילי ריתוק בצ׳ס.קום', nextSteps: 'שיפודים, ואז חזרה על מט בסיסי', rawSummary: 'קבוצת מתחילים למדה ריתוקים, הראיתי את המשחק של לגאל', attendance: { [byName['נועם'].id]: 'present', [byName['תמר'].id]: 'absent', [byName['איתי'].id]: 'present' } },
    { groupId: tactics, weeksAgo: 2, topic: 'חישוב וריאציות: משחק לסקר-תומאס', topics: ['חישוב', 'התקפה על המלך', 'הקרבת מלכה'], exercises: '3 תרגילי "מצא את ההקרבה"', games: '', gameRefs: gameRefs('lasker'), successes: 'מאיה חישבה את כל הוריאציה עד הסוף', difficulties: 'דניאל ויונתן התקשו בחישוב מעבר ל-3 מהלכים', homework: '5 פאזלים ברמת 1000+ בצ׳ס.קום', nextSteps: 'שיפודים ומתקפות כפולות', attendance: { [byName.Daniel.id]: 'present', [byName['מאיה'].id]: 'present', [byName['יונתן'].id]: 'present' } },
    { groupId: tactics, weeksAgo: 1, topic: 'שיפודים', topics: ['שיפוד'], exercises: '8 תרגילי שיפוד', games: '', successes: 'יונתן זיהה שיפודים במשחקים שלו', difficulties: 'מאיה - סיומים עם שיפוד צריח', homework: 'לנתח משחק אחד שלכם ולמצוא שיפוד', nextSteps: 'הסרת מגן', attendance: { [byName.Daniel.id]: 'present', [byName['מאיה'].id]: 'present', [byName['יונתן'].id]: 'absent' } },
    { kind: 'private', studentIds: [byName['עומר'].id], weeksAgo: 2, weekday: 2, startTime: '19:30', durationMinutes: 60, topic: 'סיומי צריחים: עמדת לוסנה', topics: ['סיום צריחים', 'לוסנה'], exercises: 'בניית גשר', successes: 'הבין את הרעיון של הגשר', difficulties: 'עמדת פילידור', homework: 'לתרגל לוסנה נגד מחשב', nextSteps: 'פילידור' },
    { kind: 'private', studentIds: [byName['עומר'].id], weeksAgo: 1, weekday: 2, startTime: '19:30', durationMinutes: 60, topic: 'סיומי צריחים: פילידור', topics: ['סיום צריחים', 'פילידור'], exercises: 'הגנת שורה שישית', successes: 'שלט בהגנה', difficulties: '', homework: 'לשחק 5 סיומי צריח בצ׳ס.קום', nextSteps: 'מעבר לסיומי פילים' },
    { groupId: champions, weeksAgo: 1, topic: 'Opening principles: the Italian Game', topics: ['Italian Game', 'Opening principles'], exercises: 'Find the best developing move (4 positions)', games: '', gameRefs: gameRefs('greco'), successes: 'Ella recognised the Fried Liver threat', difficulties: '', homework: 'Play 3 games with the Italian as White', nextSteps: 'Castling and king safety', attendance: { [byName.Ella.id]: 'present' } }
  ];

  const lessons = lessonSpecs.map((spec) => {
    const { weeksAgo, weekday, ...rest } = spec;
    const day = rest.groupId ? weekdayOf(rest.groupId) : weekday;
    const record = normalizeLesson({
      kind: rest.groupId ? 'group' : 'private',
      date: lastWeekday(today, day, weeksAgo),
      startTime: rest.groupId ? timeOf(rest.groupId) : rest.startTime,
      durationMinutes: 60,
      teacher: 'דולב',
      ...rest
    }, null, 'seed');
    store.lessons.put(record);
    return record;
  });

  // Topics learned follow from the lessons.
  for (const lesson of lessons) {
    const ids = new Set(lesson.studentIds);
    if (lesson.groupId) for (const student of students) if (student.groupId === lesson.groupId) ids.add(student.id);
    for (const id of ids) {
      if (lesson.attendance?.[id] === 'absent') continue;
      const student = store.students.get(id);
      if (!student) continue;
      store.students.put({ ...student, topicsLearned: Array.from(new Set([...(student.topicsLearned || []), ...lesson.topics])) });
    }
  }

  const paymentSpecs = [
    { student: 'נועם', monthsAgo: [2, 1], method: 'bit' },
    { student: 'תמר', monthsAgo: [1], method: 'paybox' },
    { student: 'איתי', monthsAgo: [1], method: 'bank' },
    { student: 'Daniel', monthsAgo: [3, 2, 1], method: 'paypal' },
    { student: 'מאיה', monthsAgo: [2], method: 'bit' },
    { student: 'יונתן', monthsAgo: [1], method: 'bit' },
    { student: 'Ella', monthsAgo: [0], method: 'paypal' },
    { student: 'עומר', monthsAgo: [2], method: 'bank', lessonsCount: 8 }
  ];
  const payments = [];
  for (const spec of paymentSpecs) {
    const student = byName[spec.student];
    for (const monthsAgo of spec.monthsAgo) {
      const year = Number(today.slice(0, 4));
      const month = Number(today.slice(5, 7)) - monthsAgo;
      const date = new Date(Date.UTC(year, month - 1, Math.min(student.billingDay || 3, 28)));
      const paidAt = date.toISOString().slice(0, 10);
      const record = normalizePayment({
        studentId: student.id,
        amount: student.billingType === 'package' ? student.price * (spec.lessonsCount || 1) : student.price,
        currency: student.currency,
        paidAt: paidAt > today ? today : paidAt,
        method: spec.method,
        periodLabel: paidAt.slice(0, 7),
        lessonsCount: spec.lessonsCount ?? null,
        receiptIssued: monthsAgo > 0
      }, null, 'seed');
      store.payments.put(record);
      payments.push(record);
    }
  }

  const leadSpecs = [
    { parentName: 'הילה מור', parentPhone: '+972500000201', childName: 'אורי מור', childAge: 8, level: 'beginner', chesscomRating: 450, language: 'he', country: 'ישראל', availability: 'שלישי, חמישי אחרי 17:00', preference: 'group', priceQuoted: 250, currency: 'ILS', source: 'facebook', status: 'new', notes: 'פנתה דרך הפוסט על קבוצת המתחילים' },
    { parentName: 'Rachel Green', parentPhone: '+12125550144', childName: 'Max Green', childAge: 10, level: 'novice', chesscomRating: 700, language: 'en', country: 'USA', timezone: 'America/New_York', availability: 'Mon/Wed evenings EST', preference: 'group', priceQuoted: 90, currency: 'USD', source: 'instagram', status: 'trial_scheduled', trialAt: new Date(Date.parse(`${addDays(today, 2)}T16:00:00Z`)).toISOString(), lastContactAt: addDays(today, -2) },
    { parentName: 'אסף רז', parentPhone: '+972500000203', childName: 'נגה רז', childAge: 12, level: 'intermediate', chesscomRating: 950, language: 'he', country: 'ישראל', availability: 'רביעי', preference: 'either', priceQuoted: 280, currency: 'ILS', source: 'referral', status: 'trial_done', trialAt: new Date(Date.parse(`${addDays(today, -4)}T15:30:00Z`)).toISOString(), trialResult: 'שיעור מצוין, מתאימה לקבוצת הטקטיקה', lastContactAt: addDays(today, -4), nextFollowupAt: addDays(today, -1) },
    { parentName: 'Lena Fischer', parentPhone: '+4915112345678', childName: 'Jonas Fischer', childAge: 9, level: 'beginner', language: 'en', country: 'Germany', timezone: 'Europe/Berlin', availability: 'Tue/Thu 17:00 CET', preference: 'group', priceQuoted: 80, currency: 'EUR', source: 'website', status: 'waiting_group', lastContactAt: addDays(today, -10), notes: 'Wants an English beginners group; none open yet' },
    { parentName: 'ענת שלו', parentPhone: '+972500000205', childName: 'גיא שלו', childAge: 7, level: 'beginner', language: 'he', country: 'ישראל', availability: 'שני', preference: 'group', priceQuoted: 250, currency: 'ILS', source: 'website', status: 'contacted', lastContactAt: addDays(today, -8), notes: 'ביקשה לחזור אליה אחרי החגים' },
    { parentName: 'דוד אלון', parentPhone: '+972500000206', childName: 'שירה אלון', childAge: 11, level: 'novice', language: 'he', country: 'ישראל', preference: 'private', priceQuoted: 160, currency: 'ILS', source: 'referral', status: 'lost', lastContactAt: addDays(today, -30), notes: 'המחיר היה גבוה מדי עבורם' },
    { parentName: 'Nina Cohen', parentPhone: '+13105550177', childName: 'Leo Cohen', childAge: 8, level: 'beginner', language: 'en', country: 'USA', timezone: 'America/Los_Angeles', availability: 'weekends', preference: 'group', priceQuoted: 85, currency: 'USD', source: 'facebook', status: 'waiting_group', lastContactAt: addDays(today, -6) }
  ];
  const leads = leadSpecs.map((spec) => {
    const record = normalizeLead(spec);
    store.leads.put(record);
    return record;
  });


  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const monthStart = (offset) => new Date(Date.UTC(year, month - 1 - offset, 1)).toISOString().slice(0, 10);
  const expenseSpecs = [
    { date: addDays(monthStart(0), 2), category: 'advertising', amount: 400, description: 'קמפיין פייסבוק: קבוצת מתחילים' },
    { date: addDays(monthStart(0), 1), category: 'software', amount: 55, description: 'Zoom Pro' },
    { date: addDays(monthStart(1), 3), category: 'advertising', amount: 600, description: 'פייסבוק + אינסטגרם' },
    { date: addDays(monthStart(1), 1), category: 'software', amount: 55, description: 'Zoom Pro' },
    { date: addDays(monthStart(1), 20), category: 'teacher', amount: 800, description: 'מורה נוסף: 4 שיעורים' },
    { date: addDays(monthStart(2), 3), category: 'advertising', amount: 300, description: 'פייסבוק' },
    { date: addDays(monthStart(2), 1), category: 'software', amount: 55, description: 'Zoom Pro' }
  ];
  for (const spec of expenseSpecs) store.expenses.put(normalizeExpense({ ...spec, date: spec.date > today ? today : spec.date, currency: 'ILS' }));

  const trialLead = leads[1];
  const events = [
    normalizeEvent({ kind: 'trial', date: addDays(today, 2), startTime: '18:00', durationMinutes: 40, leadId: trialLead.id, title: `שיעור ניסיון: ${trialLead.childName}`, note: 'שיעור ניסיון באנגלית' }),
    normalizeEvent({ kind: 'cancel', date: lastWeekday(addDays(today, 14), weekdayOf(champions)), groupId: champions, note: 'חופשה' }),
    normalizeEvent({ kind: 'makeup', date: addDays(today, 3), startTime: '20:00', durationMinutes: 45, studentId: byName['יונתן'].id, title: 'השלמה: יונתן', note: 'השלמה על השיעור שהחסיר' })
  ];
  for (const event of events) store.scheduleEvents.put(event);

  for (const spec of [{ name: 'דולב', phone: '0500000001' }, { name: 'נועה', notes: 'מחליפה בשיעורים פרטיים' }]) store.teachers.put(normalizeTeacher(spec));
  store.setSetting('teacherName', 'דולב');
  store.setSetting('usdToIls', 3.7);

  return { students, lessons: lessons.length, payments: payments.length, leads: leads.length, content: contentSpecs.length, expenses: expenseSpecs.length, events: events.length };
}
