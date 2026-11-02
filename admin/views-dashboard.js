// Daily brief: today's lessons, urgent items, payments to collect, parents
// to call back, groups with seats, what to prepare, recommendations and
// the reminder queue.
(function () {
  'use strict';
  window.VIEWS = window.VIEWS || {};
  const { h, api, t, card, stat, empty, fmtTime, fmtDate, fmtDateLong, fmtDateTime, fmtMoney, statusBadge, composeMessage, link } = window.UI;

  window.VIEWS.dashboard = async ({ refresh }) => {
    const data = await api('/overview');
    const tz = data.timezone;
    const name = window.SETTINGS.teacherName || window.APP.user.firstName || '';
    const groupName = (id) => window.APP.groups.find((group) => group.id === id)?.name || id;

    const head = window.UI.pageHead(t('dashTitle', { name }), t('dashSub', { date: fmtDateLong(data.date) }), [
      h('a', { class: 'btn', href: '#/lessons?new=1' }, `+ ${t('logLesson')}`),
      h('a', { class: 'btn', href: '#/leads?new=1' }, `+ ${t('newLead')}`),
      h('a', { class: 'btn btn-primary', href: '#/students?new=1' }, `+ ${t('newStudent')}`)
    ]);

    const s = data.stats;
    const stats = h('div', { class: 'stats' },
      stat(t('statActive'), s.activeStudents, { sub: t('statPrivateGroup', { private: s.privateStudents, group: s.groupStudents }) }),
      stat(t('statGroups'), s.activeGroups, { sub: t('statTrialWait', { trial: s.trialStudents, wait: s.waitlist }) }),
      stat(t('statLessonsToday'), s.lessonsToday, { tone: 'gold' }),
      stat(t('statOverdue'), s.overdueCount, { tone: s.overdueCount ? 'danger' : 'sage' }),
      stat(t('statDueSoon'), s.dueSoonCount, { tone: s.dueSoonCount ? 'warn' : '' }),
      stat(t('statLeads'), s.openLeads),
      stat(t('statMonthIncome'), fmtMoney(s.monthIncome, 'ILS'), { tone: 'sage' }),
      stat(t('statMonthProfit'), fmtMoney(s.monthProfit, 'ILS'), { tone: s.monthProfit < 0 ? 'danger' : 'sage' })
    );

    // ---- urgent
    const urgent = data.urgent.length ? h('div', { class: 'card', style: { borderColor: 'rgba(180,68,58,0.4)' } },
      h('div', { class: 'card-head' }, h('div', { class: 'card-title' }, '🚨 ', t('urgent'))),
      h('div', { class: 'stack' }, data.urgent.map((item) => {
        if (item.type === 'payment_very_late') return h('div', { class: 'alert alert-danger' }, link(`#/students/${item.studentId}`, t('urgentPaymentLate', { name: item.name, days: item.days })));
        if (item.type === 'trial_no_result') return h('div', { class: 'alert alert-warn' }, link(`#/leads/${item.leadId}`, t('urgentTrialNoResult', { name: item.name })));
        if (item.type === 'conflict') return h('div', { class: 'alert alert-danger' }, link('#/calendar', t('urgentConflict', { name: item.name, time: fmtTime(item.startAt, tz) })));
        return null;
      }))
    ) : null;

    // ---- today's lessons
    const lessonsToday = card(t('lessonsToday'), data.lessonsToday.length ? h('div', { class: 'list' }, data.lessonsToday.map((occurrence) => lessonRow(occurrence, tz, refresh))) : empty(t('noLessonsToday')), { count: data.lessonsToday.length, actions: [h('a', { class: 'btn btn-sm', href: '#/calendar' }, t('navCalendar'))] });

    // ---- reminders
    const pending = data.reminders.filter((reminder) => reminder.enabled && !reminder.sent);
    const reminders = card(t('remindersToday'), data.reminders.length
      ? h('div', { class: 'list' }, data.reminders.map((reminder) => h('div', { class: 'list-item' },
        h('div', { class: 'list-main' },
          h('div', { class: 'list-title' }, reminder.studentName, h('span', { class: 'muted small' }, `· ${reminder.occurrenceTitle}`)),
          h('div', { class: 'list-sub' }, reminder.enabled ? `${t('sendAt', { time: fmtTime(reminder.sendAt, tz) })} · ${reminder.parentName || ''} ${reminder.parentPhone}` : t('remindersOff'))
        ),
        h('div', { class: 'list-side' },
          reminder.sent ? h('span', { class: 'badge badge-sage' }, t('sent')) : !reminder.enabled ? h('span', { class: 'badge' }, t('remindersOff')) : h('button', { class: 'btn btn-sm btn-wa', type: 'button', onclick: () => composeMessage({ kind: 'lesson_reminder', studentId: reminder.studentId, occurrenceKey: reminder.occurrenceKey, reference: reminder.reference, name: reminder.parentName || reminder.studentName, onSent: refresh }) }, t('sendReminder'))
        )
      )))
      : empty(t('noReminders')), { count: pending.length ? pending.length : undefined, sub: data.reminders.length && !pending.length ? t('allSent') : t('remindersSub') });

    // ---- payments
    const paymentRow = (entry) => h('div', { class: 'list-item' },
      h('div', { class: 'list-main' },
        h('div', { class: 'list-title' }, link(`#/students/${entry.studentId}`, entry.name), statusBadge(entry.state, 'pay')),
        h('div', { class: 'list-sub' }, [
          entry.billingType === 'monthly' ? (entry.daysUntilDue < 0 ? t('daysLate', { days: -entry.daysUntilDue }) : entry.daysUntilDue === 0 ? t('dueToday') : t('dueIn', { days: entry.daysUntilDue })) : t('lessonsLeft', { n: entry.lessonsRemaining }),
          entry.price ? ` · ${fmtMoney(entry.price, entry.currency)}` : ''
        ])
      ),
      h('div', { class: 'list-side' },
        h('button', { class: 'btn btn-sm btn-wa', type: 'button', onclick: () => composeMessage({ kind: 'payment_reminder', studentId: entry.studentId, name: entry.parentName || entry.name, onSent: refresh }) }, t('remind')),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => window.UI.paymentDialog({ student: entry, onSaved: refresh }) }, t('markPaid'))
      )
    );
    const payments = card(t('paymentsDue'), h('div', null,
      data.paymentsOverdue.length ? h('div', null, h('div', { class: 'small strong', style: { color: 'var(--danger)', marginBottom: '4px' } }, t('paymentsOverdueTitle')), h('div', { class: 'list' }, data.paymentsOverdue.map(paymentRow))) : null,
      data.paymentsDueSoon.length ? h('div', { style: { marginTop: '10px' } }, h('div', { class: 'small strong', style: { color: 'var(--warn)', marginBottom: '4px' } }, t('paymentsDueSoonTitle')), h('div', { class: 'list' }, data.paymentsDueSoon.map(paymentRow))) : null,
      !data.paymentsOverdue.length && !data.paymentsDueSoon.length ? empty(t('none')) : null
    ), { count: data.paymentsOverdue.length + data.paymentsDueSoon.length, actions: [h('a', { class: 'btn btn-sm', href: '#/payments' }, t('viewAll'))] });

    // ---- follow-ups
    const followUps = card(t('followUps'), data.followUps.length ? h('div', { class: 'list' }, data.followUps.map((lead) => h('div', { class: 'list-item' },
      h('div', { class: 'list-main' },
        h('div', { class: 'list-title' }, link(`#/leads/${lead.id}`, lead.childName || lead.parentName), statusBadge(lead.status, 'lead')),
        h('div', { class: 'list-sub' }, [lead.parentName, lead.parentPhone, lead.lastContactAt ? `${t('lastContactAt')}: ${fmtDate(lead.lastContactAt)}` : ''].filter(Boolean).join(' · '))
      ),
      h('div', { class: 'list-side' }, h('button', { class: 'btn btn-sm btn-wa', type: 'button', onclick: () => composeMessage({ kind: 'followup', leadId: lead.id, name: lead.parentName, onSent: refresh }) }, t('whatsapp')))
    ))) : empty(t('none')), { count: data.followUps.length, actions: [h('a', { class: 'btn btn-sm', href: '#/leads' }, t('viewAll'))] });

    // ---- trials
    const trials = card(t('trialsUpcoming'), data.upcomingTrials.length ? h('div', { class: 'list' }, data.upcomingTrials.map((trial) => h('div', { class: 'list-item' },
      h('span', { class: 'time-pill' }, fmtTime(trial.at, tz)),
      h('div', { class: 'list-main' },
        h('div', { class: 'list-title' }, trial.leadId ? link(`#/leads/${trial.leadId}`, trial.name) : trial.name),
        h('div', { class: 'list-sub' }, fmtDateTime(trial.at, tz))
      ),
      trial.leadId ? h('button', { class: 'btn btn-sm btn-wa', type: 'button', onclick: () => composeMessage({ kind: 'trial_invite', leadId: trial.leadId, name: trial.name, onSent: refresh }) }, t('whatsapp')) : null
    ))) : empty(t('none')), { count: data.upcomingTrials.length });

    // ---- open seats
    const seats = card(t('openSeats'), data.openSeats.length ? h('div', { class: 'list' }, data.openSeats.map((group) => h('div', { class: 'list-item' },
      h('div', { class: 'list-main' },
        h('div', { class: 'list-title' }, link(`#/groups/${group.id}`, group.name)),
        h('div', { class: 'list-sub' }, window.UI.scheduleText(group.schedule))
      ),
      h('span', { class: 'badge badge-gold' }, t('seatsFreeOf', { free: group.seatsFree, total: group.seatsTotal }))
    ))) : empty(t('none')), { count: data.openSeats.length });

    // ---- prepare
    const prepare = card(t('prepare'), data.prepare.length ? h('div', { class: 'list' }, data.prepare.map((item) => h('div', { class: 'list-item', style: { alignItems: 'flex-start' } },
      h('span', { class: 'time-pill' }, fmtTime(item.startAt, tz)),
      h('div', { class: 'list-main' },
        h('div', { class: 'list-title' }, item.title, h('span', { class: 'badge' }, t(`kind.${item.kind}`)), h('span', { class: 'muted small' }, fmtDate(item.startAt.slice(0, 10), { weekday: 'short' }))),
        item.lastTopic ? h('div', { class: 'list-sub' }, t('lastTime', { date: fmtDate(item.lastDate), topic: item.lastTopic })) : null,
        item.nextSteps ? h('div', { class: 'list-sub' }, h('strong', null, `${t('nextSteps')}: `), item.nextSteps) : null,
        item.difficulties ? h('div', { class: 'list-sub' }, h('strong', null, `${t('difficultiesLabel')}: `), item.difficulties) : null
      ),
      h('a', { class: 'btn btn-sm', href: '#/content' }, t('navContent'))
    ))) : empty(t('none')), { count: data.prepare.length });

    // ---- recommendations
    const recommendations = card(t('recommendations'), data.recommendations.length ? h('div', { class: 'stack' }, data.recommendations.map((rec) => {
      if (rec.type === 'open_group' || rec.type === 'almost_group') {
        const bucket = rec.bucket;
        const text = t(rec.type === 'open_group' ? 'recOpenGroup' : 'recAlmostGroup', { n: bucket.members.length, lang: t(`lang.${bucket.language}`), age: bucket.ageBand, level: bucket.levelBand === 'any' ? t('all') : t(`level.${bucket.levelBand}`) });
        return h('div', { class: `alert ${rec.type === 'open_group' ? 'alert-sage' : 'alert-info'}` }, h('div', null, text, h('div', { class: 'small', style: { opacity: .8 } }, bucket.members.map((member) => member.name).join(', '))));
      }
      if (rec.type === 'merge_groups') return h('div', { class: 'alert alert-info' }, t('recMerge', { a: rec.groups[0].name, na: rec.groups[0].students, b: rec.groups[1].name, nb: rec.groups[1].students }));
      if (rec.type === 'place_waitlisted') return h('div', { class: 'alert alert-sage' }, link(`#/students/${rec.student.id}`, t('recPlaceWaitlisted', { name: rec.student.name, groups: rec.groups.map((group) => group.name).join(', ') })));
      if (rec.type === 'collect_payments') return h('div', { class: 'alert alert-warn' }, link('#/payments', t('recCollect', { n: rec.count })));
      if (rec.type === 'stale_leads') return h('div', { class: 'alert alert-warn' }, link('#/leads', t('recStaleLeads', { n: rec.count })));
      return null;
    })) : empty(t('none')));

    return h('div', null,
      head,
      stats,
      urgent,
      h('div', { class: 'grid grid-2', style: { marginTop: urgent ? '16px' : 0 } },
        h('div', { class: 'stack' }, lessonsToday, reminders, prepare, trials),
        h('div', { class: 'stack' }, payments, followUps, recommendations, seats)
      )
    );
  };

  function lessonRow(occurrence, tz, refresh) {
    const kindBadge = h('span', { class: `badge ${occurrence.kind === 'group' ? 'badge-gold' : occurrence.kind === 'private' ? 'badge-sage' : 'badge-info'}` }, t(`kind.${occurrence.kind}`));
    return h('div', { class: 'list-item' },
      h('span', { class: 'time-pill' }, fmtTime(occurrence.startAt, tz)),
      h('div', { class: 'list-main' },
        h('div', { class: 'list-title' }, occurrence.groupId ? link(`#/groups/${occurrence.groupId}`, occurrence.title) : occurrence.title, kindBadge, occurrence.conflicts?.length ? h('span', { class: 'badge badge-danger' }, t('conflict')) : null, occurrence.loggedLessonId ? h('span', { class: 'badge badge-sage' }, t('lessonStatus.held')) : null),
        h('div', { class: 'list-sub' }, `${occurrence.durationMinutes} ${t('minutes')} · ${occurrence.students.join(', ') || t('none')}`)
      ),
      h('div', { class: 'list-side' },
        occurrence.zoomLink ? h('a', { class: 'btn btn-sm', href: occurrence.zoomLink, target: '_blank', rel: 'noopener' }, 'Zoom') : null,
        occurrence.loggedLessonId
          ? h('a', { class: 'btn btn-sm', href: `#/lessons/${occurrence.loggedLessonId}` }, t('viewSummary'))
          : h('a', { class: 'btn btn-sm btn-primary', href: `#/lessons?new=1&occurrence=${encodeURIComponent(occurrence.key)}` }, t('logLesson'))
      )
    );
  }
})();
