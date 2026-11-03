// Teachers: the list groups and students pick their teacher from, and each
// teacher's page with the lessons they taught and what they are owed.
(function () {
  'use strict';
  window.VIEWS = window.VIEWS || {};
  const { h, api, t, initials, modal, field, input, phoneInput, fmtPhone, textarea, select, formValues, errorBox, toast, confirmDialog, card, stat, empty, link, fmtDate, fmtMoney, fmtMonth, statusBadge, todayIso } = window.UI;

  window.VIEWS.teachers = async ({ id, query, refresh }) => {
    // A teacher has one page here: their own.
    if (!window.APP.isAdmin) return teacherDetail(window.APP.me.id, query, refresh);
    if (id) return teacherDetail(id, query, refresh);
    const teachers = window.APP.teachers;
    const add = () => teacherForm(null, refresh);
    return h('div', null,
      window.UI.pageHead(t('teachersTitle'), t('teachersSub'), [
        h('button', { class: 'btn btn-primary', type: 'button', onclick: add }, `+ ${t('newTeacher')}`)
      ]),
      teachers.length
        ? h('div', { class: 'card' }, h('div', { class: 'table-wrap' }, h('table', { class: 'table teachers-table' },
          h('thead', null, h('tr', null, h('th', null, t('name')), h('th', { class: 'center' }, t('phone')), h('th', { class: 'center' }, t('email')), h('th', { class: 'center' }, t('teacherGroups')), h('th', { class: 'center' }, t('teacherStudents')), h('th', { class: 'center' }, t('hourlyRate')), h('th', null))),
          h('tbody', null, teachers.map((teacher) => teacherRow(teacher, refresh)))
        )))
        : h('div', { class: 'card teacher-empty' },
          h('div', { class: 'teacher-empty-icon' }, '🎓'),
          h('p', null, t('noTeachers')),
          h('button', { class: 'btn btn-primary', type: 'button', onclick: add }, `+ ${t('newTeacher')}`))
    );
  };

  // Clicking a row opens the teacher's page; links and buttons inside it do their own thing.
  function teacherRow(teacher, refresh) {
    const groups = window.APP.groups.filter((group) => group.profile.teacher === teacher.name);
    const edit = () => teacherForm(teacher, refresh);
    const open = () => { location.hash = `#/teachers/${teacher.id}`; };
    const stop = (event) => event.stopPropagation();
    const remove = async (event) => {
      event.stopPropagation();
      if (!(await confirmDialog(t('confirmDeleteTeacher', { name: teacher.name, groups: teacher.groupCount, students: teacher.assignedStudentCount })))) return;
      await api(`/teachers/${teacher.id}`, { method: 'DELETE' });
      toast(t('teacherRemoved'));
      refresh();
    };
    return h('tr', { class: 'clickable', onclick: open },
      h('td', null,
        h('div', { class: 'row', style: { gap: '8px', flexWrap: 'nowrap' } },
          h('span', { class: 'avatar ink', style: { width: '30px', height: '30px', fontSize: '12px', borderRadius: '9px', flexShrink: 0 } }, initials(teacher.name)),
          h('a', { class: 'strong', href: `#/teachers/${teacher.id}`, onclick: stop }, teacher.name)
        ),
        teacher.notes ? h('div', { class: 'muted tiny teacher-notes', title: teacher.notes }, teacher.notes) : null
      ),
      h('td', { class: 'center' }, teacher.phone ? h('a', { class: 'link', href: `https://wa.me/${teacher.phone.replace(/\D/g, '')}`, target: '_blank', rel: 'noopener', dir: 'ltr', onclick: stop }, fmtPhone(teacher.phone)) : h('span', { class: 'muted' }, '—')),
      h('td', { class: 'center' }, teacher.email ? h('a', { class: 'link', href: `mailto:${teacher.email}`, dir: 'ltr', onclick: stop }, teacher.email) : h('span', { class: 'muted' }, '—')),
      h('td', { class: 'center teacher-groups' }, groups.length
        ? h('div', { class: 'chips' }, groups.map((group) => h('a', { class: 'chip teacher-group', href: `#/groups/${group.id}`, onclick: stop }, group.name)))
        : h('span', { class: 'muted small' }, t('teacherNoGroups'))),
      h('td', { class: 'center num-center' }, teacher.studentCount),
      h('td', { class: 'center num-center', style: { whiteSpace: 'nowrap' } }, teacher.hourlyRate !== null ? rateText(teacher) : h('span', { class: 'muted' }, '—')),
      h('td', { class: 'teacher-actions' },
        h('button', { class: 'btn btn-xs btn-ghost', type: 'button', onclick: (event) => { event.stopPropagation(); edit(); } }, t('edit')),
        h('button', { class: 'btn btn-xs btn-ghost teacher-delete', type: 'button', onclick: remove }, t('delete'))
      )
    );
  }

  function teacherForm(teacher, refresh) {
    modal({
      title: teacher ? `${t('editTeacher')}: ${teacher.name}` : t('newTeacher'),
      size: 'modal-sm',
      body: (dialog) => {
        const form = h('form', { class: 'form' },
          field(t('name'), input('name', teacher?.name || '', { required: true, maxlength: 120 })),
          field(t('phone'), phoneInput('phone', teacher?.phone || ''), { hint: t('teacherPhoneHint') }),
          field(t('email'), input('email', teacher?.email || '', { type: 'email', dir: 'ltr', placeholder: 'name@example.com' })),
          h('div', { class: 'row', style: { gap: '12px', alignItems: 'flex-start', flexWrap: 'nowrap' } },
            field(t('hourlyRate'), h('input', { name: 'hourlyRate', type: 'number', min: 0, step: 'any', dir: 'ltr', value: teacher?.hourlyRate ?? '' }), { hint: t('hourlyRateHint') }),
            field(t('currency'), select('currency', window.VOCAB.currencies, teacher?.currency || window.SETTINGS.defaultCurrency || 'ILS'))
          ),
          field(t('notes'), textarea('notes', teacher?.notes || '', { rows: 3, placeholder: t('teacherNotesPlaceholder') })),
          h('div', { class: 'form-actions' },
            h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, t('cancel')),
            h('button', { class: 'btn btn-primary', type: 'submit' }, t('save'))
          )
        );
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          try {
            if (teacher) await api(`/teachers/${teacher.id}`, { method: 'PATCH', body: formValues(form) });
            else await api('/teachers', { method: 'POST', body: formValues(form) });
            toast(t('saved'), 'success');
            dialog.close();
            refresh();
          } catch (error) {
            form.querySelector('.form-error')?.remove();
            form.prepend(errorBox(error.message));
          }
        });
        return form;
      }
    });
  }

  const rateText = (teacher) => `${fmtMoney(teacher.hourlyRate, teacher.currency)} ${t('perHour')}`;
  const hoursText = (minutes) => t('hoursCount', { n: Math.round((minutes / 60) * 100) / 100 });
  const shiftMonth = (label, delta) => {
    const [year, month] = label.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1 + delta, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  };

  // ----------------------------------------------------------- detail
  async function teacherDetail(id, query, refresh) {
    const month = /^\d{4}-\d{2}$/.test(query.month || '') ? query.month : '';
    const data = await api(`/teachers/${id}${month ? `?month=${month}` : ''}`);
    const { teacher, pay, currency } = data;
    const admin = window.APP.isAdmin;
    const money = (amount) => (amount === null ? '—' : fmtMoney(amount, currency));
    const goMonth = (label) => { location.hash = `#/teachers/${teacher.id}?month=${label}`; };
    const isCurrent = data.month === data.today.slice(0, 7);
    const isPast = data.month < data.today.slice(0, 7);

    const head = h('div', { class: 'card' }, h('div', { class: 'row-between' },
      h('div', { class: 'profile-head' },
        h('span', { class: 'avatar ink' }, initials(teacher.name)),
        h('div', null,
          h('div', { class: 'profile-name' }, teacher.name),
          h('div', { class: 'profile-meta' },
            teacher.hourlyRate !== null ? h('span', { class: 'badge badge-gold' }, rateText(teacher)) : h('span', { class: 'badge badge-warn' }, t('noHourlyRate')),
            teacher.phone ? h('span', { class: 'badge' }, h('a', { href: `https://wa.me/${teacher.phone.replace(/\D/g, '')}`, target: '_blank', rel: 'noopener', dir: 'ltr' }, fmtPhone(teacher.phone))) : null,
            teacher.email ? h('span', { class: 'badge' }, h('a', { href: `mailto:${teacher.email}`, dir: 'ltr' }, teacher.email)) : null,
            h('span', { class: 'badge' }, `${t('teacherGroups')}: ${teacher.groupCount}`),
            h('span', { class: 'badge' }, `${t('teacherStudents')}: ${teacher.studentCount}`)
          )
        )
      ),
      admin ? h('button', { class: 'btn btn-primary', type: 'button', onclick: () => teacherForm(teacher, refresh) }, t('edit')) : null
    ));

    // ‹ is always back in time and › forward, in both languages, as on the
    // calendar's week buttons.
    const monthNav = h('div', { class: 'row', style: { gap: '8px', alignItems: 'center' } },
      h('button', { class: 'btn btn-sm', type: 'button', 'aria-label': t('prevMonth'), onclick: () => goMonth(shiftMonth(data.month, -1)) }, '‹'),
      h('span', { class: 'strong' }, fmtMonth(data.month)),
      h('button', { class: 'btn btn-sm', type: 'button', 'aria-label': t('nextMonth'), onclick: () => goMonth(shiftMonth(data.month, 1)) }, '›'),
      isCurrent ? null : h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => goMonth(todayIso(window.SETTINGS.businessTimezone).slice(0, 7)) }, t('thisMonth'))
    );

    const summary = (bucket) => `${t('teacherLessonsCount', { n: bucket.lessons })} · ${hoursText(bucket.minutes)}`;
    const stats = h('div', { class: 'stats' },
      stat(isPast ? t('teacherPayMonth') : t('teacherPayEarned'), money(pay.earned.amount), { sub: summary(pay.earned), tone: isPast ? 'gold' : '' }),
      isPast ? null : stat(t('teacherPayScheduled'), money(pay.scheduled.amount), { sub: summary(pay.scheduled) }),
      isPast ? null : stat(t('teacherPayExpected'), money(pay.expected.amount), { sub: summary(pay.expected), tone: 'gold' }),
      stat(t('hourlyRate'), teacher.hourlyRate !== null ? fmtMoney(teacher.hourlyRate, currency) : '—', { sub: t('teacherAllTime', { hours: hoursText(data.totals.minutes), amount: money(data.totals.amount) }) })
    );

    const noRate = teacher.hourlyRate === null
      ? h('div', { class: 'alert alert-warn', style: { marginBottom: '16px' } },
        h('span', null, admin ? t('teacherNoRateAlert') : t('teacherNoRateAlertOwn')),
        admin ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => teacherForm(teacher, refresh) }, t('setHourlyRate')) : null)
      : null;

    const logButton = (occurrence) => h('button', { class: 'btn btn-xs', type: 'button', onclick: () => window.VIEWS.logLesson({ occurrence: occurrence.key, slot: occurrence, durationMinutes: occurrence.minutes, onSaved: refresh }) }, t('logThisLesson'));
    const unlogged = data.unlogged.length
      ? h('div', { class: 'alert alert-warn stack', style: { marginBottom: '16px', alignItems: 'stretch' } },
        h('div', { class: 'strong' }, t('teacherUnlogged', { n: data.unlogged.length })),
        h('div', { class: 'list' }, data.unlogged.map((occurrence) => h('div', { class: 'list-item' },
          h('div', { class: 'list-main' }, h('div', { class: 'list-title' }, fmtDate(occurrence.date), h('span', { dir: 'ltr' }, occurrence.startTime), h('span', { class: 'strong' }, occurrence.title), h('span', { class: 'muted small' }, `${occurrence.minutes} ${t('minutes')}`))),
          logButton(occurrence)
        ))))
      : null;

    const lessonsCard = card(t('teacherLessonsMonth', { month: fmtMonth(data.month) }), data.lessons.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', null, h('tr', null, h('th', null, t('date')), h('th', null, t('lesson')), h('th', null, t('topic')), h('th', { class: 'num' }, t('duration')), h('th', { class: 'num' }, t('amount')))),
      h('tbody', null, data.lessons.map((lesson) => h('tr', { class: 'clickable', onclick: () => { location.hash = `#/lessons/${lesson.id}`; } },
        h('td', null, fmtDate(lesson.date), lesson.startTime ? h('div', { class: 'muted tiny', dir: 'ltr' }, lesson.startTime) : null),
        h('td', null,
          h('div', null, lesson.groupName || lesson.students.join(', ') || '—'),
          h('div', { class: 'muted tiny' }, t(`kind.${lesson.kind}`), lesson.groupName && lesson.students.length ? ` · ${t('lessonsCountStudents', { n: lesson.students.length })}` : '')
        ),
        h('td', null, lesson.topic || '—', lesson.status === 'cancelled' ? h('span', { style: { marginInlineStart: '6px' } }, statusBadge('cancelled', 'lessonStatus')) : null),
        h('td', { class: 'num' }, `${lesson.minutes} ${t('minutes')}`),
        h('td', { class: 'num strong' }, lesson.status === 'held' ? money(lesson.amount) : h('span', { class: 'muted' }, '—'))
      )))
    )) : empty(t('teacherNoLessonsMonth')), { count: data.lessons.filter((lesson) => lesson.status === 'held').length, sub: t('teacherPayRule') });

    const upcomingCard = !isPast ? card(t('teacherUpcoming'), data.upcoming.length ? h('div', { class: 'list' }, data.upcoming.map((occurrence) => h('div', { class: 'list-item' },
      h('div', { class: 'list-main' },
        h('div', { class: 'list-title' }, fmtDate(occurrence.date), h('span', { dir: 'ltr' }, occurrence.startTime), h('span', { class: 'strong' }, occurrence.title)),
        h('div', { class: 'list-sub' }, `${t(`kind.${occurrence.kind}`)} · ${occurrence.minutes} ${t('minutes')}`)
      ),
      h('span', { class: 'muted small' }, money(teacher.hourlyRate === null ? null : Math.round((occurrence.minutes / 60) * teacher.hourlyRate * 100) / 100))
    ))) : empty(t('teacherNoUpcoming')), { count: data.upcoming.length }) : null;

    const historyCard = card(t('teacherHistory'), data.history.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', null, h('tr', null, h('th', null, t('month')), h('th', { class: 'num' }, t('lessons')), h('th', { class: 'num' }, t('hours')), h('th', { class: 'num' }, t('amount')))),
      h('tbody', null, data.history.map((row) => h('tr', { class: `clickable${row.month === data.month ? ' selected' : ''}`, onclick: () => goMonth(row.month) },
        h('td', { class: row.month === data.month ? 'strong' : '' }, fmtMonth(row.month)),
        h('td', { class: 'num' }, row.lessons),
        h('td', { class: 'num' }, Math.round((row.minutes / 60) * 100) / 100),
        h('td', { class: 'num strong' }, money(row.amount))
      )))
    )) : empty(t('teacherNoHistory')), { sub: teacher.hourlyRate !== null ? t('teacherHistoryRate') : '' });

    return h('div', null,
      admin ? h('div', { class: 'breadcrumb' }, link('#/teachers', t('navTeachers')), '›', teacher.name) : null,
      head,
      h('div', { class: 'row-between', style: { margin: '20px 0 12px' } }, h('h2', { class: 'card-title', style: { margin: 0 } }, t('teacherPayTitle')), monthNav),
      noRate,
      stats,
      unlogged,
      window.UI.masonry([lessonsCard, upcomingCard, historyCard])
    );
  }
})();
