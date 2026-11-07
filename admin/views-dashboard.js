// Overview: the business at a glance. Today's lessons, groups and their
// open seats, the students, the open leads and the payments to collect.
// A teacher's overview is their own teaching: today, the week and their
// groups.
(function () {
  'use strict';
  window.VIEWS = window.VIEWS || {};
  const { h, api, t, card, stat, empty, fmtMoney, fmtTime, fmtDate, statusBadge, composeMessage, link, scheduleText } = window.UI;

  // ---- one calendar lesson, with Zoom and logging
  const lessonRow = (occurrence, tz, refresh, { withDate = false } = {}) => h('div', { class: 'list-item' },
    withDate ? h('div', { style: { minWidth: '90px' } }, h('div', { class: 'strong small' }, fmtDate(occurrence.date, { weekday: 'short' })), h('span', { class: 'time-pill' }, fmtTime(occurrence.startAt, tz))) : h('span', { class: 'time-pill' }, fmtTime(occurrence.startAt, tz)),
    h('div', { class: 'list-main' },
      h('div', { class: 'list-title' },
        occurrence.groupId ? link(`#/groups/${occurrence.groupId}`, occurrence.title)
          : occurrence.studentIds.length === 1 ? link(`#/students/${occurrence.studentIds[0]}`, occurrence.title)
          : occurrence.title,
        occurrence.kind !== 'group' ? h('span', { class: 'badge' }, t(`kind.${occurrence.kind}`)) : null,
        occurrence.conflicts?.length ? h('span', { class: 'badge badge-danger' }, t('conflict')) : null),
      h('div', { class: 'list-sub' }, `${occurrence.durationMinutes} ${t('minutes')}${occurrence.kind === 'group' ? ` · ${occurrence.students.length} ${t('students')}` : ''}`),
      window.UI.suggestedGame(occurrence)
    ),
    h('div', { class: 'list-side' },
      occurrence.zoomLink ? h('a', { class: 'btn btn-sm', href: occurrence.zoomLink, target: '_blank', rel: 'noopener' }, 'Zoom') : null,
      occurrence.loggedLessonId
        ? h('a', { class: 'btn btn-sm', href: `#/lessons/${occurrence.loggedLessonId}` }, t('viewSummary'))
        : h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => window.VIEWS.logLesson({ occurrence: occurrence.key, slot: occurrence, durationMinutes: occurrence.durationMinutes, suggestedGame: occurrence.suggestedGame, onSaved: refresh }) }, t('logLesson'))
    )
  );

  // ---- a group, with its seats
  const groupRow = (group) => h('div', { class: 'list-item' },
    h('div', { class: 'list-main' },
      h('div', { class: 'list-title' }, link(`#/groups/${group.id}`, group.name)),
      h('div', { class: 'list-sub' }, scheduleText(group.schedule) || '—')
    ),
    h('div', { class: 'list-side' },
      h('span', { class: 'muted small' }, `${group.studentCount}/${group.seatsTotal}`),
      h('span', { class: group.seatsFree ? 'badge badge-gold' : 'badge' }, group.seatsFree ? t('seatsFreeCount', { n: group.seatsFree }) : t('full'))
    )
  );

  // ---- a teacher's lessons as a table: one row per lesson, the same
  // columns in every card so today and the rest of the week line up
  const lessonsTable = (occurrences, tz, refresh, { withDate = false } = {}) => h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
    h('thead', null, h('tr', null,
      withDate ? h('th', null, t('date')) : null,
      h('th', null, t('time')),
      h('th', null, t('lesson')),
      h('th', { class: 'num' }, t('duration')),
      h('th', { class: 'num' }, t('students')),
      h('th', null, t('suggestedGame')),
      h('th', null)
    )),
    h('tbody', null, occurrences.map((occurrence) => {
      const game = occurrence.suggestedGame;
      return h('tr', null,
        withDate ? h('td', { class: 'strong', style: { whiteSpace: 'nowrap' } }, fmtDate(occurrence.date, { weekday: 'short' })) : null,
        h('td', null, h('span', { class: 'time-pill' }, fmtTime(occurrence.startAt, tz))),
        h('td', null,
          occurrence.groupId ? link(`#/groups/${occurrence.groupId}`, occurrence.title)
            : occurrence.studentIds.length === 1 ? link(`#/students/${occurrence.studentIds[0]}`, occurrence.title)
            : occurrence.title,
          occurrence.kind !== 'group' ? h('span', { class: 'badge', style: { marginInlineStart: '6px' } }, t(`kind.${occurrence.kind}`)) : null,
          occurrence.conflicts?.length ? h('span', { class: 'badge badge-danger', style: { marginInlineStart: '6px' } }, t('conflict')) : null),
        h('td', { class: 'num' }, occurrence.durationMinutes),
        h('td', { class: 'num' }, occurrence.students.length),
        h('td', { style: { minWidth: '200px' } }, game ? [
          link(`#/content/${game.id}`, game.title),
          game.seenBy ? h('div', { class: 'muted tiny' }, t('suggestedGameSeen', { n: game.seenBy, of: game.of })) : null
        ] : h('span', { class: 'muted' }, '—')),
        h('td', { class: 'num' }, h('div', { class: 'row', style: { justifyContent: 'flex-end', flexWrap: 'nowrap' } },
          occurrence.zoomLink ? h('a', { class: 'btn btn-sm', href: occurrence.zoomLink, target: '_blank', rel: 'noopener' }, 'Zoom') : null,
          occurrence.loggedLessonId
            ? h('a', { class: 'btn btn-sm', href: `#/lessons/${occurrence.loggedLessonId}` }, t('viewSummary'))
            : h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => window.VIEWS.logLesson({ occurrence: occurrence.key, slot: occurrence, durationMinutes: occurrence.durationMinutes, suggestedGame: occurrence.suggestedGame, onSaved: refresh }) }, t('logLesson'))
        ))
      );
    }))
  ));

  // ---- lessons that took place but have no summary yet, as a task list
  const summaryRow = (occurrence, tz, refresh) => h('div', { class: 'list-item' },
    h('div', { class: 'list-main' },
      h('div', { class: 'list-title' },
        occurrence.groupId ? link(`#/groups/${occurrence.groupId}`, occurrence.title)
          : occurrence.studentIds.length === 1 ? link(`#/students/${occurrence.studentIds[0]}`, occurrence.title)
          : occurrence.title,
        occurrence.kind !== 'group' ? h('span', { class: 'badge' }, t(`kind.${occurrence.kind}`)) : null),
      h('div', { class: 'list-sub' }, `${fmtDate(occurrence.date, { weekday: 'short' })} · ${fmtTime(occurrence.startAt, tz)}${occurrence.groupId ? ` · ${occurrence.students.length} ${t('students')}` : ''}`)
    ),
    h('div', { class: 'list-side' },
      h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => window.VIEWS.logLesson({ occurrence: occurrence.key, slot: occurrence, durationMinutes: occurrence.durationMinutes, onSaved: refresh }) }, t('writeSummary')))
  );
  // The newest few, the rest behind a button.
  const missingSummariesCard = (data, refresh) => {
    const all = data.missingSummaries || [];
    if (!all.length) return null;
    const shown = 5;
    const list = h('div', { class: 'list' }, all.slice(0, shown).map((occurrence) => summaryRow(occurrence, data.timezone, refresh)));
    const more = all.length > shown ? h('button', { class: 'btn btn-sm btn-ghost', type: 'button', style: { marginTop: '8px' }, onclick: () => {
      list.append(...all.slice(shown).map((occurrence) => summaryRow(occurrence, data.timezone, refresh)));
      more.remove();
    } }, t('showAllN', { n: all.length })) : null;
    return card(t('missingSummaries'), h('div', null, list, more), { count: all.length, sub: t('missingSummariesSub') });
  };

  // ---- a teacher's groups as a table
  const groupsTable = (groups) => h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
    h('thead', null, h('tr', null,
      h('th', null, t('name')),
      h('th', null, t('schedule')),
      h('th', { class: 'num' }, t('students')),
      h('th', null, t('seats'))
    )),
    h('tbody', null, groups.map((group) => h('tr', { class: 'clickable', onclick: () => { location.hash = `#/groups/${group.id}`; } },
      h('td', { class: 'strong' }, link(`#/groups/${group.id}`, group.name)),
      h('td', null, scheduleText(group.schedule) || '—'),
      h('td', { class: 'num' }, `${group.studentCount}/${group.seatsTotal}`),
      h('td', null, h('span', { class: group.seatsFree ? 'badge badge-gold' : 'badge' }, group.seatsFree ? t('seatsFreeCount', { n: group.seatsFree }) : t('full')))
    )))
  ));

  async function teacherDashboard(refresh) {
    const data = await api('/overview');
    const tz = data.timezone;
    const s = data.stats;
    const groups = window.APP.groups.filter((group) => group.profile.status !== 'closed');
    const later = data.lessonsWeek.filter((occurrence) => occurrence.date > data.date);

    const head = window.UI.pageHead(t('dashTitle', { name: data.teacher.name }), t('dashSubTeacher'), [
      h('a', { class: 'btn', href: '#/teachers' }, t('navMyPay'))
    ]);
    const stats = h('div', { class: 'stats' },
      stat(t('lessonsToday'), s.lessonsToday),
      stat(t('statLessonsWeek'), s.lessonsWeek),
      stat(t('statGroups'), s.groups),
      stat(t('statMyStudents'), s.students)
    );
    const todayCard = card(t('lessonsToday'), data.lessonsToday.length ? lessonsTable(data.lessonsToday, tz, refresh) : empty(t('noLessonsToday')), {
      count: data.lessonsToday.length || undefined,
      actions: [h('a', { class: 'btn btn-sm', href: '#/calendar' }, t('navCalendar'))]
    });
    const weekCard = card(t('laterThisWeek'), later.length ? lessonsTable(later, tz, refresh, { withDate: true }) : empty(t('noLessonsLaterWeek')), { count: later.length || undefined });
    const groupsCard = card(t('myGroupsTitle'), groups.length ? groupsTable(groups) : empty(t('noGroupsAssigned')), {
      count: groups.length,
      actions: [h('a', { class: 'btn btn-sm', href: '#/groups' }, t('viewAll'))]
    });

    return h('div', null,
      head,
      stats,
      // One card per row: each is a table and needs the full width.
      window.UI.masonry([missingSummariesCard(data, refresh), todayCard, weekCard, groupsCard].filter(Boolean), { columns: 1 })
    );
  }

  window.VIEWS.dashboard = async ({ refresh }) => {
    if (!window.APP.isAdmin) return teacherDashboard(refresh);
    const [data, leadsResponse] = await Promise.all([api('/overview'), api('/leads')]);
    const leads = leadsResponse.leads;
    const groups = window.APP.groups.filter((group) => group.profile.status !== 'closed');
    const name = window.SETTINGS.teacherName || window.APP.user.firstName || '';
    const s = data.stats;
    const freeSeats = groups.reduce((sum, group) => sum + group.seatsFree, 0);
    const toCollect = data.paymentsOverdue.length + data.paymentsDueSoon.length;

    const head = window.UI.pageHead(t('dashTitle', { name }), t('dashSub'), [
      h('a', { class: 'btn', href: '#/leads?new=1' }, `+ ${t('newLead')}`),
      h('a', { class: 'btn btn-primary', href: '#/students?new=1' }, `+ ${t('newStudent')}`)
    ]);

    const stats = h('div', { class: 'stats' },
      stat(t('statActive'), s.activeStudents, { sub: t('statPrivateGroup', { private: s.privateStudents, group: s.groupStudents }) }),
      stat(t('statGroups'), groups.length),
      stat(t('statFreeSeats'), freeSeats, { tone: freeSeats ? 'gold' : '' }),
      stat(t('statLeads'), leads.length),
      stat(t('statToCollect'), toCollect, { tone: data.paymentsOverdue.length ? 'danger' : toCollect ? 'warn' : 'sage' }),
      stat(t('statMonthIncome'), fmtMoney(s.monthIncome, 'ILS'), { tone: 'sage' })
    );

    // ---- today's lessons, in order
    const tz = data.timezone;
    const todayCard = card(t('lessonsToday'), data.lessonsToday.length ? h('div', { class: 'list' }, data.lessonsToday.map((occurrence) => lessonRow(occurrence, tz, refresh))) : empty(t('noLessonsToday')), {
      count: data.lessonsToday.length || undefined,
      actions: [h('a', { class: 'btn btn-sm', href: '#/calendar' }, t('navCalendar'))]
    });

    // ---- groups, the ones with room first
    const sortedGroups = [...groups].sort((a, b) => b.seatsFree - a.seatsFree || a.name.localeCompare(b.name));
    const groupsCard = card(t('navGroups'), groups.length ? h('div', { class: 'list' }, sortedGroups.map(groupRow)) : empty(t('none')), {
      count: groups.length,
      actions: [h('a', { class: 'btn btn-sm', href: '#/groups' }, t('viewAll'))]
    });

    // ---- payments to collect
    const paymentRow = (entry) => h('div', { class: 'list-item' },
      h('div', { class: 'list-main' },
        h('div', { class: 'list-title' }, link(`#/students/${entry.studentId}`, entry.name), statusBadge(entry.state, 'pay')),
        h('div', { class: 'list-sub' }, [
          entry.billingType === 'monthly' ? (entry.daysUntilDue < 0 ? t('daysLate', { days: -entry.daysUntilDue }) : entry.daysUntilDue === 0 ? t('dueToday') : t('dueIn', { days: entry.daysUntilDue })) : window.UI.lessonsBalanceText(entry),
          entry.price ? ` · ${fmtMoney(entry.price, entry.currency)}` : ''
        ])
      ),
      h('div', { class: 'list-side' },
        h('button', { class: 'btn btn-sm btn-wa', type: 'button', onclick: () => composeMessage({ kind: 'payment_reminder', studentId: entry.studentId, name: entry.parentName || entry.name, onSent: refresh }) }, t('remind')),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => window.UI.paymentDialog({ student: entry, onSaved: refresh }) }, t('markPaid'))
      )
    );
    const paymentsCard = card(t('paymentsDue'), toCollect
      ? h('div', { class: 'list' }, data.paymentsOverdue.map(paymentRow), data.paymentsDueSoon.map(paymentRow))
      : empty(t('allPaid')), {
      count: toCollect || undefined,
      actions: [h('a', { class: 'btn btn-sm', href: '#/payments' }, t('viewAll'))]
    });

    // ---- open leads, newest first
    const leadRow = (lead) => h('div', { class: 'list-item' },
      h('div', { class: 'list-main' },
        h('div', { class: 'list-title' }, link(`#/leads/${lead.id}`, lead.childName || lead.parentName || lead.parentPhone)),
        h('div', { class: 'list-sub' }, [lead.childName ? lead.parentName : '', lead.childAge ? `${t('age')} ${lead.childAge}` : ''].filter(Boolean).join(' · '))
      ),
      lead.parentPhone ? h('div', { class: 'list-side' }, h('button', { class: 'btn btn-sm btn-wa', type: 'button', onclick: () => composeMessage({ kind: 'followup', leadId: lead.id, name: lead.parentName, onSent: refresh }) }, t('whatsapp'))) : null
    );
    const newestLeads = [...leads].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6);
    const leadsCard = card(t('navLeads'), leads.length ? h('div', { class: 'list' }, newestLeads.map(leadRow)) : empty(t('noLeads')), {
      count: leads.length,
      actions: [h('a', { class: 'btn btn-sm', href: '#/leads' }, t('viewAll'))]
    });

    return h('div', null,
      head,
      stats,
      window.UI.masonry([missingSummariesCard(data, refresh), todayCard, paymentsCard, groupsCard, leadsCard].filter(Boolean))
    );
  };
})();
