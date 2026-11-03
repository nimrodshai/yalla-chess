// Overview: the business at a glance. Groups and their open seats, the
// students, the open leads and the payments to collect, nothing else.
(function () {
  'use strict';
  window.VIEWS = window.VIEWS || {};
  const { h, api, t, card, stat, empty, fmtMoney, statusBadge, composeMessage, link, scheduleText } = window.UI;

  window.VIEWS.dashboard = async ({ refresh }) => {
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

    // ---- groups, the ones with room first
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
          entry.billingType === 'monthly' ? (entry.daysUntilDue < 0 ? t('daysLate', { days: -entry.daysUntilDue }) : entry.daysUntilDue === 0 ? t('dueToday') : t('dueIn', { days: entry.daysUntilDue })) : t('lessonsLeft', { n: entry.lessonsRemaining }),
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
      h('div', { class: 'grid grid-2' },
        h('div', { class: 'stack' }, groupsCard),
        h('div', { class: 'stack' }, paymentsCard, leadsCard)
      )
    );
  };
})();
