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
    const state = { q: query.q || '', groupId: query.groupId || '' };
    const listNode = h('div');
    const load = async () => {
      const params = new URLSearchParams();
      if (state.q) params.set('q', state.q);
      if (state.groupId) params.set('groupId', state.groupId);
      const data = await api(`/students?${params}`);
      window.UI.clear(listNode).append(renderTable(data.students));
      sub.textContent = t('studentsSub', { n: data.students.length });
    };
    // User-triggered reloads report failures as a toast; the first load
    // below stays unguarded so the router can show sign-in or an error page.
    const reload = window.UI.guard(load);
    const sub = h('span');
    const searchBox = h('input', { type: 'search', value: state.q, placeholder: t('search'), oninput: (event) => { state.q = event.target.value; clearTimeout(searchBox._timer); searchBox._timer = setTimeout(reload, 250); } });
    const groupSelect = select('groupId', [['', t('filterGroup')], ...window.APP.groups.map((group) => [group.id, group.name])], state.groupId);
    groupSelect.addEventListener('change', () => { state.groupId = groupSelect.value; reload(); });

    await load();
    return h('div', null,
      window.UI.pageHead(t('studentsTitle'), sub, [h('button', { class: 'btn btn-primary', type: 'button', onclick: () => studentForm({ onSaved: (student) => { location.hash = `#/students/${student.id}`; } }) }, `+ ${t('newStudent')}`)]),
      h('div', { class: 'filters' }, searchBox, groupSelect),
      h('div', { class: 'card' }, listNode)
    );
  }

  function renderTable(students) {
    if (!students.length) return empty(t('noStudents'));
    return h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', null, h('tr', null, h('th', null, t('name')), h('th', null, t('age')), h('th', null, t('group')), h('th', null, t('level')), h('th', null, t('parent')), h('th', null, t('payments')))),
      h('tbody', null, students.map((student) => h('tr', { class: 'clickable', onclick: () => { location.hash = `#/students/${student.id}`; } },
        h('td', null, h('div', { class: 'row', style: { gap: '8px' } }, h('span', { class: 'avatar', style: { width: '30px', height: '30px', fontSize: '12px', borderRadius: '9px' } }, initials(student.name)), h('a', { class: 'strong', href: `#/students/${student.id}` }, student.name))),
        h('td', null, student.age ?? ''),
        h('td', null, student.groupName || (student.lessonType === 'private' ? t('lessonType.private') : h('span', { class: 'muted' }, t('noGroup')))),
        h('td', null, t(`level.${student.level}`), student.chesscomRating ? h('span', { class: 'muted small' }, ` · ${student.chesscomRating}`) : null),
        h('td', { class: 'small' }, student.parentName, h('div', { class: 'muted tiny', dir: 'ltr' }, student.parentPhone)),
        h('td', null, statusBadge(student.paymentState, 'pay'))
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
    const paymentLine = student.status !== 'inactive'
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
      h('div', null, h('div', { class: 'small strong', style: { marginBottom: '6px' } }, t('topics')), data.topics.length ? h('div', { class: 'chips' }, data.topics.map((topic) => h('span', { class: 'chip' }, topic))) : h('div', { class: 'muted small' }, t('noTopics'))),
      h('div', { style: { marginTop: '12px' } }, h('div', { class: 'small strong', style: { marginBottom: '6px' } }, t('gamesSeen')), data.games?.length ? h('div', { class: 'chips' }, data.games.map((game) => h('a', { class: 'chip chip-game', href: `#/content/${game.id}` }, '♞ ', game.title))) : h('div', { class: 'muted small' }, t('noGamesSeen')))
    ));

    const lessons = card(t('lessonHistory'), data.lessons.length ? h('div', { class: 'list' }, data.lessons.map((lesson) => h('div', { class: 'list-item clickable', onclick: () => { location.hash = `#/lessons/${lesson.id}`; } },
      h('div', { class: 'list-main' },
        h('div', { class: 'list-title' }, fmtDate(lesson.date, { year: 'numeric' }), h('span', { class: 'strong' }, lesson.topic || '—'), lesson.myAttendance ? statusBadge(lesson.myAttendance, 'attendance') : null, lesson.status === 'cancelled' ? statusBadge('cancelled', 'lessonStatus') : null),
        h('div', { class: 'list-sub' }, [lesson.homework ? `${t('homework')}: ${lesson.homework}` : '', lesson.nextSteps ? `${t('nextSteps')}: ${lesson.nextSteps}` : ''].filter(Boolean).join(' · ')),
        window.UI.gameChips(lesson) ? h('div', { style: { marginTop: '4px' } }, window.UI.gameChips(lesson)) : null
      )
    ))) : empty(t('noLessonsYet')), { count: data.lessons.length, sub: t('attendanceSummary', { attended: data.attendance.attended, absent: data.attendance.absent }), actions: [h('button', { class: 'btn btn-sm', type: 'button', onclick: () => window.VIEWS.logLesson({ studentId: student.id, onSaved: refresh }) }, `+ ${t('logLesson')}`)] });

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
  // A new student is added in five short steps. Only the first is required;
  // every later step can be skipped, and "finish" saves from anywhere. When
  // editing, the same steps are tabs and Save is always available.
  function studentForm({ student = null, defaults = {}, onSaved }) {
    const isNew = !student;
    const today = window.UI.todayIso(window.SETTINGS.businessTimezone);
    const s = student || { status: 'active', language: 'he', level: 'beginner', lessonType: 'group', billingType: 'monthly', currency: 'ILS', remindersEnabled: true, timezone: window.SETTINGS.businessTimezone, joinedAt: today, teacher: window.APP.teachers.some((teacher) => teacher.name === window.SETTINGS.teacherName) ? window.SETTINGS.teacherName : '', ...defaults };

    modal({
      title: isNew ? t('newStudent') : `${t('editStudent')}: ${[s.firstName, s.lastName].filter(Boolean).join(' ')}`,
      body: (dialog) => {
        const form = h('form', { class: 'wizard', novalidate: true });
        const schedule = scheduleEditor(s.privateSchedule?.length || !isNew ? (s.privateSchedule || []) : [{ weekday: 0, startTime: '17:00', durationMinutes: 60 }]);

        // ---- choice chips writing to a hidden input
        const choice = (name, options, value) => {
          const hidden = h('input', { type: 'hidden', name, value });
          const wrap = h('div', { class: 'choice' });
          for (const [optionValue, label, hint] of options) {
            const button = h('button', { type: 'button', class: `choice-item ${optionValue === value ? 'active' : ''}`, onclick: () => {
              hidden.value = optionValue;
              for (const node of wrap.querySelectorAll('.choice-item')) node.classList.toggle('active', node === button);
              hidden.dispatchEvent(new Event('change', { bubbles: true }));
            } }, h('span', { class: 'choice-label' }, label), hint ? h('span', { class: 'choice-hint' }, hint) : null);
            wrap.append(button);
          }
          return h('div', null, hidden, wrap);
        };

        // ---- step 1: who
        const firstName = input('firstName', s.firstName || '', { required: true, autocomplete: 'off' });
        const basics = h('div', { class: 'form' },
          field(t('firstName') + ' *', firstName),
          field(t('lastName'), input('lastName', s.lastName || '', { autocomplete: 'off' })),
          field(t('age'), h('input', { name: 'age', type: 'number', min: 3, max: 99, value: s.age ?? '', inputmode: 'numeric' })),
          field(t('language'), enumSelect('language', window.VOCAB.languages, 'lang', s.language)),
          field(t('parentFirstName'), input('parentFirstName', s.parentFirstName || '', { autocomplete: 'off' })),
          field(t('parentLastName'), input('parentLastName', s.parentLastName || '', { autocomplete: 'off' })),
          field(t('parentPhone'), input('parentPhone', s.parentPhone || '', { dir: 'ltr', placeholder: '050-1234567', inputmode: 'tel' }), { hint: t('wizPhoneHint') })
        );

        // ---- step 2: where
        // Closed groups are hidden from the choice, except the one the student
        // is already in: dropping it from the list would silently clear it.
        const groupOptions = [['', t('noGroup')], ...window.APP.groups.filter((group) => group.profile.status !== 'closed' || group.id === s.groupId).map((group) => [group.id, `${group.name} · ${window.UI.scheduleText(group.schedule)} · ${group.seatsFree ? t('seatsFreeOf', { free: group.seatsFree, total: group.seatsTotal }) : t('full')}`])];
        const groupSelect = select('groupId', groupOptions, s.groupId || '');
        const groupField = field(t('group'), groupSelect, { full: true });
        const scheduleField = field(t('privateSchedule'), schedule, { full: true });
        const lessonType = choice('lessonType', [['group', t('lessonType.group')], ['private', t('lessonType.private')], ['both', t('lessonType.both')]], s.lessonType);
        const placement = h('div', { class: 'form' },
          field(t('lessonType'), lessonType, { full: true }),
          groupField,
          scheduleField,
          field(t('joinedAt'), h('input', { name: 'joinedAt', type: 'date', value: s.joinedAt || '' })),
          field(t('teacher'), window.UI.teacherSelect('teacher', s.teacher || ''))
        );
        const syncPlacement = () => {
          const type = form.elements.lessonType.value;
          groupField.hidden = type === 'private';
          scheduleField.hidden = type === 'group';
        };

        // ---- step 3: money
        const priceInput = h('input', { name: 'price', type: 'number', step: '0.01', min: 0, value: s.price ?? '', inputmode: 'decimal' });
        let priceTouched = !isNew;
        priceInput.addEventListener('input', () => { priceTouched = true; });
        const billingDayField = field(t('billingDay'), h('input', { name: 'billingDay', type: 'number', min: 1, max: 28, value: s.billingDay ?? '', placeholder: '1' }));
        const packageField = field(t('packageSize'), h('input', { name: 'packageSize', type: 'number', min: 1, value: s.packageSize ?? '', placeholder: '8' }));
        const billing = h('div', { class: 'form' },
          field(t('billingType'), choice('billingType', window.VOCAB.billingTypes.map((value) => [value, t(`billing.${value}`)]), s.billingType), { full: true }),
          field(t('price'), priceInput),
          field(t('currency'), select('currency', window.VOCAB.currencies, s.currency || 'ILS')),
          billingDayField,
          packageField,
          field(t('nextPaymentAt'), h('input', { name: 'nextPaymentAt', type: 'date', value: s.nextPaymentAt || '' }), { hint: t('wizNextPaymentHint') }),
          h('div', { class: 'field' }, checkbox('remindersEnabled', s.remindersEnabled, t('remindersEnabled')))
        );
        const syncBilling = () => {
          const type = form.elements.billingType.value;
          billingDayField.hidden = type !== 'monthly';
          packageField.hidden = type !== 'package';
        };
        // A group's own price is the sensible default for a new student.
        groupSelect.addEventListener('change', () => {
          const group = window.APP.groups.find((entry) => entry.id === groupSelect.value);
          if (!priceTouched && group?.profile.price !== null && group?.profile.price !== undefined) {
            priceInput.value = group.profile.price;
            form.elements.currency.value = group.profile.currency || 'ILS';
          }
        });

        // ---- step 4: chess
        const chess = h('div', { class: 'form' },
          field(t('level'), enumSelect('level', window.VOCAB.levels, 'level', s.level)),
          field(t('rating'), h('input', { name: 'chesscomRating', type: 'number', min: 0, max: 4000, value: s.chesscomRating ?? '', inputmode: 'numeric' })),
          field(t('chesscomUsername'), input('chesscomUsername', s.chesscomUsername || '', { dir: 'ltr' }), { full: true }),
          field(t('strengths'), textarea('strengths', s.strengths || '', { rows: 2 })),
          field(t('weaknesses'), textarea('weaknesses', s.weaknesses || '', { rows: 2 })),
          field(t('goals'), textarea('goals', s.goals || '', { rows: 2 }), { full: true })
        );

        // ---- step 5: everything else
        const more = h('div', { class: 'form' },
          field(t('country'), input('country', s.country || '')),
          field(t('timezone'), window.UI.timezoneSelect('timezone', s.timezone || '', { blank: '—' })),
          field(t('parentEmail'), input('parentEmail', s.parentEmail || '', { type: 'email', dir: 'ltr' })),
          field(t('parentPhone2'), input('parentPhone2', s.parentPhone2 || '', { dir: 'ltr', inputmode: 'tel' })),
          field(t('birthDate'), h('input', { name: 'birthDate', type: 'date', value: s.birthDate || '' })),
          field(t('source'), input('source', s.source || '')),
          field(t('userPhone'), input('userPhone', s.userPhone || '', { dir: 'ltr', inputmode: 'tel' }), { full: true, hint: t('wizPortalHint') }),
          field(t('privateZoomLink'), input('privateZoomLink', s.privateZoomLink || '', { dir: 'ltr' }), { full: true }),
          field(t('paymentTerms'), input('paymentTerms', s.paymentTerms || '')),
          field(t('reminderLeadHours'), h('input', { name: 'reminderLeadHours', type: 'number', min: 0, max: 72, value: s.reminderLeadHours ?? '' })),
          field(t('progressNotes'), textarea('notes', s.notes || '', { rows: 3 }), { full: true }),
          !isNew ? field(t('topicsManual'), input('topicsLearned', (s.topicsLearned || []).join(', ')), { full: true }) : null
        );

        const steps = [
          { key: 'basics', label: t('wizBasics'), title: t('wizBasicsTitle'), intro: t('wizBasicsIntro'), body: basics, required: true },
          { key: 'placement', label: t('wizPlacement'), title: t('wizPlacementTitle'), intro: t('wizPlacementIntro'), body: placement },
          { key: 'billing', label: t('wizBilling'), title: t('wizBillingTitle'), intro: t('wizBillingIntro'), body: billing },
          { key: 'chess', label: t('wizChess'), title: t('wizChessTitle'), intro: t('wizChessIntro'), body: chess },
          { key: 'more', label: t('wizMore'), title: t('wizMoreTitle'), intro: t('wizMoreIntro'), body: more }
        ];

        let current = 0;
        const visited = new Set([0]);
        const stepper = h('ol', { class: 'stepper' });
        const panels = steps.map((step) => h('section', { class: 'wizard-panel', hidden: true },
          h('h3', { class: 'wizard-title' }, step.title),
          h('p', { class: 'wizard-intro' }, step.intro),
          step.body
        ));
        const errorHost = h('div');
        const footer = h('div', { class: 'wizard-footer' });

        const validateBasics = () => {
          if (firstName.value.trim()) return true;
          firstName.focus();
          firstName.classList.add('invalid');
          window.UI.clear(errorHost).append(errorBox(t('wizNameRequired')));
          return false;
        };
        firstName.addEventListener('input', () => { firstName.classList.remove('invalid'); window.UI.clear(errorHost); });

        const go = (index) => {
          if (index > 0 && current === 0 && !validateBasics()) return;
          current = Math.max(0, Math.min(steps.length - 1, index));
          visited.add(current);
          render();
          const focusable = panels[current].querySelector('input:not([type=hidden]), select, textarea');
          if (focusable && isNew) setTimeout(() => focusable.focus(), 30);
        };

        const save = async () => {
          if (!validateBasics()) { go(0); return; }
          const values = formValues(form);
          const lessonType = form.elements.lessonType.value;
          const typeChanged = isNew || lessonType !== s.lessonType;
          // Switching to group-only drops the private slots and switching to
          // private-only leaves the group; an edit that does not touch the
          // lesson type leaves both exactly as they were.
          values.privateSchedule = lessonType === 'group' && typeChanged ? [] : (lessonType === 'group' ? (s.privateSchedule || []) : schedule.read());
          if (lessonType === 'private' && typeChanged) values.groupId = '';
          for (const button of footer.querySelectorAll('button')) button.disabled = true;
          try {
            const response = student
              ? await api(`/students/${student.id}`, { method: 'PATCH', body: values })
              : await api('/students', { method: 'POST', body: values });
            toast(t('saved'), 'success');
            dialog.close();
            if (onSaved) onSaved(response.student);
          } catch (error) {
            window.UI.clear(errorHost).append(errorBox(error.message));
            for (const button of footer.querySelectorAll('button')) button.disabled = false;
          }
        };

        const render = () => {
          window.UI.clear(stepper);
          steps.forEach((step, index) => {
            const state = index === current ? 'active' : visited.has(index) ? 'done' : '';
            const reachable = !isNew || visited.has(index) || index === current + 1;
            stepper.append(h('li', { class: `step ${state}` },
              h('button', { type: 'button', disabled: !reachable, onclick: () => go(index) },
                h('span', { class: 'step-num' }, state === 'done' && isNew ? '✓' : String(index + 1)),
                h('span', { class: 'step-label' }, step.label),
                !step.required && isNew ? h('span', { class: 'step-optional' }, t('wizOptional')) : null
              )
            ));
          });
          panels.forEach((panel, index) => { panel.hidden = index !== current; });
          syncPlacement();
          syncBilling();

          const last = current === steps.length - 1;
          const step = steps[current];
          window.UI.clear(footer);
          const start = h('div', { class: 'row' },
            current > 0
              ? h('button', { class: 'btn', type: 'button', onclick: () => go(current - 1) }, `${window.I18N.lang === 'he' ? '→' : '←'} ${t('back')}`)
              : h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => dialog.close() }, t('cancel'))
          );
          const end = h('div', { class: 'row' });
          if (isNew) {
            if (current > 0 && !last) end.append(h('button', { class: 'btn btn-ghost', type: 'button', onclick: save }, t('wizFinishNow')));
            if (!step.required && !last) end.append(h('button', { class: 'btn', type: 'button', onclick: () => go(current + 1) }, t('wizSkip')));
            end.append(last
              ? h('button', { class: 'btn btn-primary', type: 'submit' }, `✓ ${t('wizCreate')}`)
              : h('button', { class: 'btn btn-primary', type: 'submit' }, `${t('wizNext')} ${window.I18N.lang === 'he' ? '←' : '→'}`));
          } else {
            if (!last) end.append(h('button', { class: 'btn', type: 'button', onclick: () => go(current + 1) }, `${t('wizNext')} ${window.I18N.lang === 'he' ? '←' : '→'}`));
            end.append(h('button', { class: 'btn btn-primary', type: 'submit' }, t('save')));
          }
          footer.append(start, end);
        };

        form.addEventListener('change', (event) => {
          if (event.target.name === 'lessonType') syncPlacement();
          if (event.target.name === 'billingType') syncBilling();
        });
        // Enter moves to the next step for a new student and saves an edit.
        form.addEventListener('submit', (event) => {
          event.preventDefault();
          if (isNew && current < steps.length - 1) go(current + 1);
          else save();
        });

        form.append(stepper, errorHost, ...panels, footer);
        render();
        if (isNew) setTimeout(() => firstName.focus(), 50);
        return form;
      }
    });
  }

  window.VIEWS.studentForm = studentForm;
})();
