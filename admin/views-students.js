// Students: searchable list, full profile with lessons, payments and
// messages, and the create / edit form.
(function () {
  'use strict';
  window.VIEWS = window.VIEWS || {};
  const { h, api, t, card, empty, fmtDate, fmtDateTime, fmtMoney, statusBadge, composeMessage, paymentDialog, link, modal, field, input, textarea, select, enumSelect, checkbox, formValues, errorBox, scheduleEditor, toast, confirmDialog, initials, scheduleText } = window.UI;

  window.VIEWS.students = async ({ id, query, refresh }) => {
    if (id) return studentDetail(id, refresh);
    if (query.new) {
      const defaults = {};
      for (const key of ['firstName', 'lastName', 'userPhone', 'parentPhone', 'parentEmail', 'groupId']) if (query[key]) defaults[key] = query[key];
      setTimeout(() => studentForm({ defaults, onSaved: (student) => { location.hash = `#/students/${student.id}`; } }), 0);
    }
    return studentList(query, refresh);
  };

  async function studentList(query, refresh) {
    const state = { q: query.q || '', status: query.status || '', groupId: query.groupId || '' };
    const listNode = h('div');
    const load = async () => {
      const params = new URLSearchParams();
      if (state.q) params.set('q', state.q);
      if (state.status) params.set('status', state.status);
      if (state.groupId) params.set('groupId', state.groupId);
      const data = await api(`/students?${params}`);
      window.UI.clear(listNode).append(renderTable(data.students));
      sub.textContent = t('studentsSub', { n: data.students.length, active: data.students.filter((student) => student.status === 'active').length });
    };
    const sub = h('span');
    const searchBox = h('input', { type: 'search', value: state.q, placeholder: t('search'), oninput: (event) => { state.q = event.target.value; clearTimeout(searchBox._timer); searchBox._timer = setTimeout(load, 250); } });
    const statusSelect = enumSelect('status', window.VOCAB.studentStatuses, 'status', state.status, { blank: t('filterStatus') });
    statusSelect.addEventListener('change', () => { state.status = statusSelect.value; load(); });
    const groupSelect = select('groupId', [['', t('filterGroup')], ...window.APP.groups.map((group) => [group.id, group.name])], state.groupId);
    groupSelect.addEventListener('change', () => { state.groupId = groupSelect.value; load(); });

    await load();
    return h('div', null,
      window.UI.pageHead(t('studentsTitle'), sub, [h('button', { class: 'btn btn-primary', type: 'button', onclick: () => studentForm({ onSaved: (student) => { location.hash = `#/students/${student.id}`; } }) }, `+ ${t('newStudent')}`)]),
      h('div', { class: 'filters' }, searchBox, statusSelect, groupSelect),
      h('div', { class: 'card' }, listNode)
    );
  }

  function renderTable(students) {
    if (!students.length) return empty(t('noStudents'));
    return h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', null, h('tr', null, h('th', null, t('name')), h('th', null, t('age')), h('th', null, t('group')), h('th', null, t('level')), h('th', null, t('parent')), h('th', null, t('status')), h('th', null, t('payments')))),
      h('tbody', null, students.map((student) => h('tr', { class: 'clickable', onclick: () => { location.hash = `#/students/${student.id}`; } },
        h('td', null, h('div', { class: 'row', style: { gap: '8px' } }, h('span', { class: 'avatar', style: { width: '30px', height: '30px', fontSize: '12px', borderRadius: '9px' } }, initials(student.name)), h('span', { class: 'strong' }, student.name))),
        h('td', null, student.age ?? ''),
        h('td', null, student.groupName || (student.lessonType === 'private' ? t('lessonType.private') : h('span', { class: 'muted' }, t('noGroup')))),
        h('td', null, t(`level.${student.level}`), student.chesscomRating ? h('span', { class: 'muted small' }, ` · ${student.chesscomRating}`) : null),
        h('td', { class: 'small' }, student.parentName, h('div', { class: 'muted tiny', dir: 'ltr' }, student.parentPhone)),
        h('td', null, statusBadge(student.status)),
        h('td', null, ['active', 'trial'].includes(student.status) ? statusBadge(student.paymentState, 'pay') : '')
      )))
    ));
  }

  // ----------------------------------------------------------- detail
  async function studentDetail(id, refresh) {
    const data = await api(`/students/${id}`);
    const student = data.student;
    const tz = window.SETTINGS.businessTimezone;
    const group = window.APP.groups.find((entry) => entry.id === student.groupId);

    const head = h('div', { class: 'card' }, h('div', { class: 'row-between' },
      h('div', { class: 'profile-head' },
        h('span', { class: 'avatar ink' }, initials(student.name)),
        h('div', null,
          h('div', { class: 'profile-name' }, student.name),
          h('div', { class: 'profile-meta' },
            statusBadge(student.status),
            h('span', { class: 'badge' }, t(`lessonType.${student.lessonType}`)),
            student.age ? h('span', { class: 'badge' }, `${t('age')} ${student.age}`) : null,
            h('span', { class: 'badge' }, t(`level.${student.level}`)),
            student.chesscomRating ? h('span', { class: 'badge badge-gold' }, `♟ ${student.chesscomRating}`) : null,
            group ? h('span', { class: 'badge badge-gold' }, link(`#/groups/${group.id}`, group.name)) : null,
            student.userPhone ? h('span', { class: 'badge badge-sage' }, t('portalLinked')) : null
          )
        )
      ),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-wa', type: 'button', onclick: () => composeMessage({ kind: 'progress', studentId: student.id, name: student.parentName || student.name, onSent: refresh }) }, t('sendMessage')),
        h('button', { class: 'btn', type: 'button', onclick: () => paymentDialog({ student, onSaved: refresh }) }, t('recordPayment')),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => studentForm({ student, onSaved: refresh }) }, t('edit'))
      )
    ));

    const payment = data.payment;
    const paymentLine = ['active', 'trial'].includes(student.status)
      ? h('div', { class: `alert ${payment.state === 'overdue' ? 'alert-danger' : payment.state === 'due_soon' ? 'alert-warn' : 'alert-sage'}` },
        statusBadge(payment.state, 'pay'),
        h('span', null, student.billingType === 'monthly'
          ? `${t('nextPaymentAt')}: ${fmtDate(payment.nextPaymentAt)} · ${fmtMoney(student.price, student.currency)} / ${t('billing.monthly')}`
          : `${t('lessonsLeft', { n: payment.lessonsRemaining ?? 0 })} · ${fmtMoney(student.price, student.currency)} × ${student.packageSize || 1}`),
        payment.lastPaymentAt ? h('span', { class: 'muted small' }, `${t('lastPayment')}: ${fmtDate(payment.lastPaymentAt)} (${fmtMoney(payment.lastPaymentAmount, student.currency)})`) : null
      )
      : null;

    const detail = (label, value, pre = false) => value ? h('div', { class: 'detail' }, h('dt', null, label), h('dd', { class: pre ? 'pre' : '' }, value)) : null;
    const details = card(t('details'), h('div', { class: 'stack' },
      h('dl', { class: 'detail-grid' },
        detail(t('parentName'), student.parentName),
        detail(t('whatsapp'), student.parentPhone ? h('a', { href: `https://wa.me/${student.parentPhone.replace(/\D/g, '')}`, target: '_blank', rel: 'noopener', dir: 'ltr' }, student.parentPhone) : ''),
        detail(t('parentPhone2'), student.parentPhone2),
        detail(t('email'), student.parentEmail),
        detail(t('country'), student.country),
        detail(t('timezone'), student.timezone),
        detail(t('language'), t(`lang.${student.language}`)),
        detail(t('chesscomUsername'), student.chesscomUsername),
        detail(t('teacher'), student.teacher),
        detail(t('joinedAt'), fmtDate(student.joinedAt, { year: 'numeric' })),
        detail(t('leftAt'), fmtDate(student.leftAt, { year: 'numeric' })),
        detail(t('source'), student.source),
        detail(t('schedule'), group ? scheduleText(student.groupSchedule) : ''),
        detail(t('privateSchedule'), scheduleText(student.privateSchedule)),
        detail(t('privateZoomLink'), student.privateZoomLink ? h('a', { href: student.privateZoomLink, target: '_blank', rel: 'noopener' }, 'Zoom') : ''),
        detail(t('billingType'), `${t(`billing.${student.billingType}`)}${student.billingDay ? ` · ${t('billingDay')} ${student.billingDay}` : ''}`),
        detail(t('paymentTerms'), student.paymentTerms),
        detail(t('reminders'), student.remindersEnabled ? `${t('yes')}${student.reminderLeadHours !== null ? ` · ${student.reminderLeadHours}h` : ''}` : t('no')),
        detail(t('userPhone'), student.userPhone)
      ),
      data.nextLessonAt ? h('div', { class: 'alert alert-info' }, t('nextLessonIn', { when: fmtDateTime(data.nextLessonAt, tz) }), student.timezone && student.timezone !== tz ? h('span', { class: 'small' }, ` (${t('inParentTime', { time: fmtDateTime(data.nextLessonAt, student.timezone) })})`) : null) : null
    ));

    const learning = card(t('chess'), h('div', { class: 'stack' },
      h('dl', { class: 'detail-grid' },
        detail(t('strengths'), student.strengths, true),
        detail(t('weaknesses'), student.weaknesses, true),
        detail(t('goals'), student.goals, true),
        detail(t('progressNotes'), student.notes, true)
      ),
      h('div', null, h('div', { class: 'small strong', style: { marginBottom: '6px' } }, t('topics')), data.topics.length ? h('div', { class: 'chips' }, data.topics.map((topic) => h('span', { class: 'chip' }, topic))) : h('div', { class: 'muted small' }, t('noTopics')))
    ));

    const lessons = card(t('lessonHistory'), data.lessons.length ? h('div', { class: 'list' }, data.lessons.map((lesson) => h('div', { class: 'list-item clickable', onclick: () => { location.hash = `#/lessons/${lesson.id}`; } },
      h('div', { class: 'list-main' },
        h('div', { class: 'list-title' }, fmtDate(lesson.date, { year: 'numeric' }), h('span', { class: 'strong' }, lesson.topic || '—'), lesson.myAttendance ? statusBadge(lesson.myAttendance, 'attendance') : null, lesson.status === 'cancelled' ? statusBadge('cancelled', 'lessonStatus') : null),
        h('div', { class: 'list-sub' }, [lesson.homework ? `${t('homework')}: ${lesson.homework}` : '', lesson.nextSteps ? `${t('nextSteps')}: ${lesson.nextSteps}` : ''].filter(Boolean).join(' · '))
      )
    ))) : empty(t('noLessonsYet')), { count: data.lessons.length, sub: t('attendanceSummary', { attended: data.attendance.attended, absent: data.attendance.absent }), actions: [h('a', { class: 'btn btn-sm', href: `#/lessons?new=1&studentId=${student.id}` }, `+ ${t('logLesson')}`)] });

    const payments = card(t('paymentHistory'), data.payments.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', null, h('tr', null, h('th', null, t('date')), h('th', { class: 'num' }, t('amount')), h('th', null, t('method')), h('th', null, t('periodLabel')), h('th', null, t('receipt')), h('th', null, ''))),
      h('tbody', null, data.payments.map((payment) => h('tr', null,
        h('td', null, fmtDate(payment.paidAt, { year: 'numeric' })),
        h('td', { class: 'num strong' }, fmtMoney(payment.amount, payment.currency)),
        h('td', null, t(`method.${payment.method}`)),
        h('td', null, payment.periodLabel, payment.lessonsCount ? ` · ${payment.lessonsCount} ${t('lessons')}` : ''),
        h('td', null, payment.receiptIssued ? h('span', { class: 'badge badge-sage' }, payment.receiptNumber || '✓') : h('span', { class: 'badge badge-warn' }, '—')),
        h('td', null, h('button', { class: 'btn btn-xs btn-ghost', type: 'button', onclick: () => paymentDialog({ student, payment, onSaved: refresh }) }, t('edit')))
      )))
    )) : empty(t('noPaymentsYet')), { count: data.payments.length, sub: `${t('totalPaid')}: ${fmtMoney(payment.totalPaid, student.currency)}`, actions: [h('button', { class: 'btn btn-sm', type: 'button', onclick: () => paymentDialog({ student, onSaved: refresh }) }, `+ ${t('recordPayment')}`)] });

    const messages = card(t('messageHistory'), data.messages.length ? h('div', { class: 'list' }, data.messages.map((message) => h('div', { class: 'list-item' },
      h('div', { class: 'list-main' },
        h('div', { class: 'list-title' }, t(`msg.${message.kind}`), h('span', { class: `badge ${message.status === 'sent' ? 'badge-sage' : ''}` }, t(message.status === 'sent' ? 'sent' : 'notSent')), h('span', { class: 'muted small' }, fmtDateTime(message.createdAt, tz))),
        h('div', { class: 'list-sub', style: { whiteSpace: 'pre-wrap' } }, message.body.slice(0, 220))
      )
    ))) : empty(t('noMessagesYet')), { count: data.messages.length });

    const danger = h('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '16px' } },
      h('button', { class: 'btn btn-danger btn-sm', type: 'button', onclick: async () => {
        if (!(await confirmDialog(t('confirmDeleteStudent', { name: student.name })))) return;
        await api(`/students/${student.id}`, { method: 'DELETE' });
        toast(t('deleted'));
        location.hash = '#/students';
      } }, t('deleteStudent'))
    );

    return h('div', null,
      h('div', { class: 'breadcrumb' }, link('#/students', t('navStudents')), '›', student.name),
      head,
      paymentLine ? h('div', { style: { marginTop: '12px' } }, paymentLine) : null,
      h('div', { class: 'grid grid-2', style: { marginTop: '16px' } },
        h('div', { class: 'stack' }, details, lessons),
        h('div', { class: 'stack' }, learning, payments, messages)
      ),
      danger
    );
  }

  // ----------------------------------------------------------- form
  function studentForm({ student = null, defaults = {}, onSaved }) {
    const s = student || { status: 'active', language: 'he', level: 'beginner', lessonType: 'group', billingType: 'monthly', currency: window.SETTINGS.defaultCurrency || 'ILS', price: window.SETTINGS.defaultGroupPrice, remindersEnabled: true, timezone: window.SETTINGS.businessTimezone, ...defaults };
    modal({
      title: student ? t('editStudent') : t('newStudent'),
      size: 'modal-lg',
      body: (dialog) => {
        const schedule = scheduleEditor(s.privateSchedule || []);
        const form = h('form', { class: 'form form-3' },
          h('div', { class: 'form-section' }, t('personal')),
          field(t('firstName'), input('firstName', s.firstName || '', { required: true })),
          field(t('lastName'), input('lastName', s.lastName || '')),
          field(t('age'), h('input', { name: 'age', type: 'number', min: 3, max: 99, value: s.age ?? '' })),
          field(t('birthDate'), h('input', { name: 'birthDate', type: 'date', value: s.birthDate || '' })),
          field(t('country'), input('country', s.country || '')),
          field(t('timezone'), input('timezone', s.timezone || '', { placeholder: 'Asia/Jerusalem', dir: 'ltr' }), { hint: t('timezoneHint') }),
          field(t('language'), enumSelect('language', window.VOCAB.languages, 'lang', s.language)),
          field(t('status'), enumSelect('status', window.VOCAB.studentStatuses, 'status', s.status)),
          field(t('joinedAt'), h('input', { name: 'joinedAt', type: 'date', value: s.joinedAt || '' })),
          field(t('parentName'), input('parentName', s.parentName || '')),
          field(t('parentPhone'), input('parentPhone', s.parentPhone || '', { dir: 'ltr', placeholder: '+972…' })),
          field(t('parentPhone2'), input('parentPhone2', s.parentPhone2 || '', { dir: 'ltr' })),
          field(t('parentEmail'), input('parentEmail', s.parentEmail || '', { type: 'email', dir: 'ltr' })),
          field(t('source'), input('source', s.source || '')),
          field(t('userPhone'), input('userPhone', s.userPhone || '', { dir: 'ltr', placeholder: '+972…' })),

          h('div', { class: 'form-section' }, t('chess')),
          field(t('level'), enumSelect('level', window.VOCAB.levels, 'level', s.level)),
          field(t('rating'), h('input', { name: 'chesscomRating', type: 'number', min: 0, max: 4000, value: s.chesscomRating ?? '' })),
          field(t('chesscomUsername'), input('chesscomUsername', s.chesscomUsername || '', { dir: 'ltr' })),
          field(t('strengths'), textarea('strengths', s.strengths || '', { rows: 2 })),
          field(t('weaknesses'), textarea('weaknesses', s.weaknesses || '', { rows: 2 })),
          field(t('goals'), textarea('goals', s.goals || '', { rows: 2 })),
          field(t('progressNotes'), textarea('notes', s.notes || '', { rows: 3 }), { full: true }),
          field(t('topicsManual'), input('topicsLearned', (s.topicsLearned || []).join(', ')), { full: true }),

          h('div', { class: 'form-section' }, t('placement')),
          field(t('lessonType'), enumSelect('lessonType', window.VOCAB.lessonTypes, 'lessonType', s.lessonType)),
          field(t('group'), select('groupId', [['', t('noGroup')], ...window.APP.groups.map((group) => [group.id, `${group.name} (${group.studentCount}/${group.seatsTotal})`])], s.groupId || '')),
          field(t('teacher'), input('teacher', s.teacher || window.SETTINGS.teacherName || '')),
          field(t('privateSchedule'), schedule, { full: true }),
          field(t('privateZoomLink'), input('privateZoomLink', s.privateZoomLink || '', { dir: 'ltr' }), { full: true }),

          h('div', { class: 'form-section' }, t('billing')),
          field(t('billingType'), enumSelect('billingType', window.VOCAB.billingTypes, 'billing', s.billingType)),
          field(t('price'), h('input', { name: 'price', type: 'number', step: '0.01', min: 0, value: s.price ?? '' })),
          field(t('currency'), select('currency', window.VOCAB.currencies, s.currency || 'ILS')),
          field(t('packageSize'), h('input', { name: 'packageSize', type: 'number', min: 1, value: s.packageSize ?? '' })),
          field(t('billingDay'), h('input', { name: 'billingDay', type: 'number', min: 1, max: 28, value: s.billingDay ?? '' })),
          field(t('nextPaymentAt'), h('input', { name: 'nextPaymentAt', type: 'date', value: s.nextPaymentAt || '' })),
          field(t('paymentTerms'), input('paymentTerms', s.paymentTerms || ''), { full: true }),
          checkbox('remindersEnabled', s.remindersEnabled, t('remindersEnabled')),
          field(t('reminderLeadHours'), h('input', { name: 'reminderLeadHours', type: 'number', min: 0, max: 72, value: s.reminderLeadHours ?? '' })),

          h('div', { class: 'form-actions' },
            h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, t('cancel')),
            h('button', { class: 'btn btn-primary', type: 'submit' }, t('save'))
          )
        );
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const values = formValues(form);
          values.privateSchedule = schedule.read();
          try {
            const response = student
              ? await api(`/students/${student.id}`, { method: 'PATCH', body: values })
              : await api('/students', { method: 'POST', body: values });
            toast(t('saved'), 'success');
            dialog.close();
            if (onSaved) onSaved(response.student);
          } catch (error) {
            form.querySelector('.form-error')?.remove();
            form.prepend(errorBox(error.message));
            form.scrollIntoView({ block: 'start' });
          }
        });
        return form;
      }
    });
  }

  window.VIEWS.studentForm = studentForm;
})();
