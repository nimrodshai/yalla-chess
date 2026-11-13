// Students: searchable list, full profile with lessons, payments and
// messages, and the create / edit form.
(function () {
  'use strict';
  window.VIEWS = window.VIEWS || {};
  const { h, api, t, card, empty, fmtDate, fmtDateTime, fmtMoney, statusBadge, composeMessage, paymentDialog, link, modal, field, input, textarea, select, enumSelect, checkbox, formValues, errorBox, scheduleEditor, toast, confirmDialog, initials, scheduleText, ratingsText, availabilityEditor, availabilityText } = window.UI;

  window.VIEWS.students = async ({ id, query, refresh }) => {
    if (id) return studentDetail(id, refresh);
    if (query.new && window.APP.isAdmin) {
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
      window.UI.pageHead(window.APP.isAdmin ? t('studentsTitle') : t('myStudentsTitle'), sub, window.APP.isAdmin ? [h('button', { class: 'btn btn-primary', type: 'button', onclick: () => studentForm({ onSaved: (student) => { location.hash = `#/students/${student.id}`; } }) }, `+ ${t('newStudent')}`)] : []),
      h('div', { class: 'filters' }, searchBox, groupSelect),
      h('div', { class: 'card' }, listNode)
    );
  }

  // A teacher's list has no payments column: billing is the admin's.
  function renderTable(students) {
    if (!students.length) return empty(t('noStudents'));
    const admin = window.APP.isAdmin;
    return h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', null, h('tr', null, h('th', null, t('name')), h('th', null, t('age')), h('th', null, t('group')), h('th', null, t('level')), h('th', null, t('parent')), admin ? h('th', null, t('payments')) : null)),
      h('tbody', null, students.map((student) => h('tr', { class: 'clickable', onclick: () => { location.hash = `#/students/${student.id}`; } },
        h('td', null, h('div', { class: 'row', style: { gap: '8px' } }, h('span', { class: 'avatar', style: { width: '30px', height: '30px', fontSize: '12px', borderRadius: '9px' } }, initials(student.name)), h('a', { class: 'strong', href: `#/students/${student.id}` }, student.name))),
        h('td', null, student.age ?? ''),
        h('td', null, student.groupName || (student.lessonType === 'private' ? t('lessonType.private') : h('span', { class: 'muted' }, t('noGroup')))),
        h('td', null, t(`level.${student.level}`), ratingsText(student) ? h('span', { class: 'muted small' }, ` · ${ratingsText(student)}`) : null),
        h('td', { class: 'small' }, student.parentName, h('div', { class: 'muted tiny', dir: 'ltr' }, student.parentPhone)),
        admin ? h('td', null, statusBadge(student.paymentState, 'pay')) : null
      )))
    ));
  }

  // ----------------------------------------------------------- detail
  async function studentDetail(id, refresh) {
    const data = await api(`/students/${id}`);
    const student = data.student;
    const admin = window.APP.isAdmin;
    const tz = window.SETTINGS.businessTimezone;
    const groups = (student.groupIds || []).map((groupId) => window.APP.groups.find((entry) => entry.id === groupId)).filter(Boolean);

    const head = h('div', { class: 'card' }, h('div', { class: 'row-between' },
      h('div', { class: 'profile-head' },
        h('span', { class: 'avatar ink' }, initials(student.name)),
        h('div', null,
          h('div', { class: 'profile-name' }, student.name),
          h('div', { class: 'profile-meta' },
            h('span', { class: 'badge' }, t(`lessonType.${student.lessonType}`)),
            student.age ? h('span', { class: 'badge' }, `${t('age')} ${student.age}`) : null,
            h('span', { class: 'badge' }, t(`level.${student.level}`)),
            student.chesscomRating ? h('span', { class: 'badge badge-gold' }, `Chess.com ${student.chesscomRating}`) : null,
            student.lichessRating ? h('span', { class: 'badge badge-gold' }, `Lichess ${student.lichessRating}`) : null,
            ...groups.map((group) => h('span', { class: 'badge badge-gold' }, link(`#/groups/${group.id}`, group.name))),
            student.userPhone ? h('span', { class: 'badge badge-sage' }, t('portalLinked')) : null
          )
        )
      ),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-wa', type: 'button', onclick: () => composeMessage({ kind: 'progress', studentId: student.id, name: student.parentName || student.name, onSent: refresh }) }, t('sendMessage')),
        admin ? h('button', { class: 'btn', type: 'button', onclick: () => paymentDialog({ student: payer, onSaved: refresh }) }, t('recordPayment')) : null,
        admin ? h('button', { class: 'btn btn-primary', type: 'button', onclick: () => studentForm({ student, onSaved: refresh }) }, t('edit')) : null
      )
    ));

    const payment = data.payment;
    // A new payment starts at what the student owes, or the next month.
    const payer = { ...student, balance: payment?.balance, nextChargeAmount: payment?.nextChargeAmount };
    // A student who has left shows where they stand only while they owe.
    const paymentLine = admin && (student.status !== 'inactive' || data.payment.balance < 0)
      ? h('div', { class: `alert ${payment.state === 'overdue' ? 'alert-danger' : payment.state === 'due_soon' ? 'alert-warn' : 'alert-sage'}` },
        statusBadge(payment.state, 'pay'),
        h('span', null, window.UI.standingText(payment, student.currency)),
        payment.lastPaymentAt ? h('span', { class: 'muted small' }, `${t('lastPayment')}: ${fmtDate(payment.lastPaymentAt)} (${fmtMoney(payment.lastPaymentAmount, payment.lastPaymentCurrency || student.currency)})`) : null
      )
      : null;

    const detail = (label, value, pre = false) => value ? h('div', { class: 'detail' }, h('dt', null, label), h('dd', { class: pre ? 'pre' : '' }, value)) : null;
    const details = card(t('details'), h('div', { class: 'stack' },
      h('dl', { class: 'detail-grid' },
        detail(t('parentName'), student.parentName),
        detail(t('whatsapp'), student.parentPhone ? h('a', { href: `https://wa.me/${student.parentPhone.replace(/\D/g, '')}`, target: '_blank', rel: 'noopener', dir: 'ltr' }, student.parentPhone) : ''),
        detail(t('parentPhone2'), student.parentPhone2),
        detail(t('email'), student.parentEmail),
        detail(t('country'), [countryName(student.country), student.region].filter(Boolean).join(' · ')),
        detail(t('timezone'), student.timezone),
        detail(t('whenFree'), availabilityText(student.availability)),
        detail(t('sex'), student.sex ? t(`sex.${student.sex}`) : ''),
        detail(t('language'), t(`lang.${student.language}`)),
        detail(t('parentLanguage'), t(`lang.${student.parentLanguage || (student.language === 'en' ? 'en' : 'he')}`)),
        detail(t('chesscomUsername'), student.chesscomUsername),
        detail(t('lichessUsername'), student.lichessUsername),
        detail(t('teacher'), student.teacher),
        detail(t('joinedAt'), fmtDate(student.joinedAt, { year: 'numeric' })),
        detail(t('leftAt'), fmtDate(student.leftAt, { year: 'numeric' })),
        admin ? detail(t('source'), sourceLabel(student)) : null,
        detail(t('schedule'), groups.length ? scheduleText(student.groupSchedule) : ''),
        detail(t('privateSchedule'), scheduleText(student.privateSchedule)),
        detail(t('privateZoomLink'), student.privateZoomLink ? h('a', { href: student.privateZoomLink, target: '_blank', rel: 'noopener' }, 'Zoom') : ''),
        admin ? detail(t('prices'), h('div', null, (student.prices || []).length ? student.prices.map((item) => h('div', null, window.UI.priceText(item, student.currency))) : t('noPrices'))) : null,
        admin ? detail(t('paymentTerms'), student.paymentTerms) : null,
        detail(t('autoMessagesStudent'), student.autoMessages ? t('autoOn') : student.autoMessagesOptedOutAt ? t('autoOptedOutOn', { date: fmtDate(student.autoMessagesOptedOutAt.slice(0, 10), { year: 'numeric' }) }) : t('autoOff')),
        detail(t('userPhone'), student.userPhone)
      ),
      window.UI.nextLesson(data.nextLesson, { timezone: student.timezone, onSaved: refresh })
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

    // Lessons that took place but were never logged sit in the history by
    // date, waiting for a summary.
    const loggedRow = (lesson) => h('div', { class: 'list-item clickable', onclick: () => { location.hash = `#/lessons/${lesson.id}`; } },
      h('div', { class: 'list-main' },
        h('div', { class: 'list-title' }, fmtDate(lesson.date, { year: 'numeric' }), h('span', { class: 'strong' }, lesson.topic || '—'), lesson.myAttendance ? statusBadge(lesson.myAttendance, 'attendance') : null, lesson.status === 'cancelled' ? statusBadge('cancelled', 'lessonStatus') : null),
        h('div', { class: 'list-sub' }, [lesson.homework ? `${t('homework')}: ${lesson.homework}` : '', lesson.nextSteps ? `${t('nextSteps')}: ${lesson.nextSteps}` : ''].filter(Boolean).join(' · ')),
        window.UI.gameChips(lesson) ? h('div', { style: { marginTop: '4px' } }, window.UI.gameChips(lesson)) : null
      )
    );
    const awaitingRow = (occurrence) => h('div', { class: 'list-item' },
      h('div', { class: 'list-main' },
        h('div', { class: 'list-title' }, fmtDate(occurrence.date, { year: 'numeric' }), h('span', { class: 'strong' }, occurrence.groupId ? occurrence.title : t(`kind.${occurrence.kind}`)), h('span', { class: 'badge badge-warn' }, t('awaitingSummary')))
      ),
      h('div', { class: 'list-side' },
        h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => window.VIEWS.logLesson({ occurrence: occurrence.key, slot: occurrence, durationMinutes: occurrence.durationMinutes, onSaved: refresh }) }, t('writeSummary')))
    );
    const awaiting = data.awaitingSummary || [];
    const history = [...data.lessons.map((lesson) => ({ date: lesson.date, row: () => loggedRow(lesson) })), ...awaiting.map((occurrence) => ({ date: occurrence.date, row: () => awaitingRow(occurrence) }))]
      .sort((a, b) => b.date.localeCompare(a.date));
    const lessons = card(t('lessonHistory'), history.length ? h('div', { class: 'list' }, history.map((entry) => entry.row())) : empty(t('noLessonsYet')), { count: history.length, sub: t('attendanceSummary', { attended: data.attendance.attended, absent: data.attendance.absent }), actions: [h('button', { class: 'btn btn-sm', type: 'button', onclick: () => window.VIEWS.logLesson({ studentId: student.id, onSaved: refresh }) }, `+ ${t('logLesson')}`)] });

    const payments = admin ? card(t('paymentHistory'), data.payments.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', null, h('tr', null, h('th', null, t('date')), h('th', { class: 'num' }, t('amount')), h('th', null, t('method')), h('th', null, t('periodLabel')), h('th', null, t('receipt')), h('th', null, ''))),
      h('tbody', null, data.payments.map((payment) => h('tr', null,
        h('td', null, fmtDate(payment.paidAt, { year: 'numeric' })),
        h('td', { class: 'num strong' }, fmtMoney(payment.amount, payment.currency)),
        h('td', null, t(`method.${payment.method}`)),
        h('td', null, payment.periodLabel),
        h('td', null, payment.receiptIssued ? h('span', { class: 'badge badge-sage' }, payment.receiptNumber || '✓') : h('span', { class: 'badge badge-warn' }, '—')),
        h('td', null, h('button', { class: 'btn btn-xs btn-ghost', type: 'button', onclick: () => paymentDialog({ student, payment, onSaved: refresh }) }, t('edit')))
      )))
    )) : empty(t('noPaymentsYet')), { count: data.payments.length, sub: `${t('totalPaid')}: ${fmtMoney(payment.totalPaid, student.currency)}`, actions: [h('button', { class: 'btn btn-sm', type: 'button', onclick: () => paymentDialog({ student: payer, onSaved: refresh }) }, `+ ${t('recordPayment')}`)] }) : null;

    // Every charge and payment, newest first, with the balance after each.
    const priceById = Object.fromEntries((student.prices || []).map((item) => [item.id, item]));
    const accountLabel = (entry) => {
      const item = priceById[entry.priceId];
      const price = item ? window.UI.priceText(item, student.currency) : '';
      if (entry.kind === 'opening') return t(entry.amount < 0 ? 'ledger.openingOwed' : 'ledger.openingCredit', { date: fmtDate(entry.date, { year: 'numeric' }) });
      if (entry.kind === 'payment') return `${t('ledger.payment')}${entry.method ? ` · ${t(`method.${entry.method}`)}` : ''}`;
      if (entry.kind === 'month') {
        return [
          t('ledger.month', { month: window.UI.fmtMonth(entry.month) }),
          item ? window.UI.priceKindText(item) : '',
          entry.partial ? t('ledger.partialMonth', { n: entry.count, amount: fmtMoney(entry.lessonAmount, student.currency) }) : ''
        ].filter(Boolean).join(' · ');
      }
      if (entry.kind === 'lessons') return t('ledger.lessons', { month: window.UI.fmtMonth(entry.month), n: entry.count });
      return [`${t(`priceKind.${entry.lessonKind}`)}${entry.topic ? `: ${entry.topic}` : ''}`, price].filter(Boolean).join(' · ');
    };
    const accountEntries = (data.account || []).slice().reverse();
    // This month's per-lesson lessons, charged at its end: shown, not counted.
    const pending = data.accountPending;
    const account = admin ? card(t('account'), accountEntries.length || pending ? h('div', { class: 'table-wrap account-table' }, h('table', { class: 'table' },
      h('thead', null, h('tr', null, h('th', null, t('date')), h('th', null, t('description')), h('th', { class: 'num' }, t('amount')), h('th', { class: 'num' }, t('balance')))),
      h('tbody', null, pending ? h('tr', { class: 'muted' },
        h('td', null, fmtDate(pending.date, { year: 'numeric' })),
        h('td', null, t('ledger.pending', { month: window.UI.fmtMonth(pending.month), n: pending.count })),
        h('td', { class: 'num' }, `(${fmtMoney(pending.amount, student.currency)})`),
        h('td', null, '')
      ) : null, accountEntries.map((entry) => h('tr', null,
        h('td', null, entry.kind === 'opening' ? '' : fmtDate(entry.date, { year: 'numeric' })),
        h('td', null, accountLabel(entry), entry.unpriced ? h('span', { class: 'badge badge-warn', style: { marginInlineStart: '6px' } }, t('ledger.unpriced')) : null),
        h('td', { class: `num ${entry.amount > 0 ? 'strong' : ''}` }, entry.unpriced ? '—' : `${entry.amount > 0 ? '+' : entry.amount < 0 ? '−' : ''}${fmtMoney(Math.abs(entry.amount), student.currency)}`),
        h('td', { class: 'num muted' }, `${entry.balance < 0 ? '−' : ''}${fmtMoney(Math.abs(entry.balance), student.currency)}`)
      )))
    )) : empty(t('noAccountYet')), { sub: window.UI.balanceText(payment, student.currency) }) : null;

    const messages = card(t('messageHistory'), data.messages.length ? h('div', { class: 'list' }, data.messages.map((message) => h('div', { class: 'list-item' },
      h('div', { class: 'list-main' },
        h('div', { class: 'list-title' }, t(`msg.${message.kind}`), window.UI.messageStatusBadge(message), h('span', { class: 'muted small' }, fmtDateTime(message.createdAt, tz))),
        h('div', { class: 'list-sub', style: { whiteSpace: 'pre-wrap' } }, message.body.slice(0, 220))
      )
    ))) : empty(t('noMessagesYet')), { count: data.messages.length });

    const danger = admin && h('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '16px' } },
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
      h('div', { style: { marginTop: '16px' } }, window.UI.masonry([details, learning, lessons, payments, account, messages].filter(Boolean))),
      danger || null
    );
  }

  // ----------------------------------------------------------- source
  // Where the family heard of the school: a pick from the list, and who
  // recommended it when that was a referral. Older students may hold free
  // text from before the list; it is kept and shown as written.
  function sourceLabel(record) {
    if (!record.source) return '';
    const name = window.VOCAB.leadSources.includes(record.source) ? t(`source.${record.source}`) : record.source;
    return record.source === 'referral' && record.referredBy ? `${name} · ${record.referredBy}` : name;
  }

  // The countries most students come from, picked rather than typed. Older
  // records typed the name in either language; those read as the same
  // country, and any other name stays as it was.
  const COUNTRIES = ['IL', 'CA', 'US'];
  const COUNTRY_ALIASES = { IL: ['ישראל', 'israel'], CA: ['קנדה', 'canada'], US: ['ארצות הברית', 'ארה״ב', 'ארה"ב', 'usa', 'us', 'united states'] };
  const countryCode = (value) => {
    const name = String(value || '').trim();
    if (COUNTRIES.includes(name)) return name;
    return COUNTRIES.find((code) => COUNTRY_ALIASES[code].includes(name.toLowerCase())) || name;
  };
  const countryName = (value) => {
    const code = countryCode(value);
    return COUNTRIES.includes(code) ? t(`countryName.${code}`) : code;
  };
  // The dashboard counts students by country with the same reading.
  window.VIEWS.countryName = countryName;

  // Canada and the USA are big enough that the country alone does not say
  // much, so picking either opens a line for where in it.
  function countryFields(record) {
    const value = countryCode(record.country);
    const options = [['', '—'], ...COUNTRIES.map((code) => [code, t(`countryName.${code}`)])];
    const countrySelect = select('country', options, value);
    const regionField = field(t('region'), input('region', record.region || '', { placeholder: t('regionPlaceholder') }));
    const sync = () => { regionField.hidden = !['CA', 'US'].includes(countrySelect.value); };
    countrySelect.addEventListener('change', () => {
      sync();
      if (regionField.hidden) regionField.querySelector('input').value = '';
      else regionField.querySelector('input').focus();
    });
    sync();
    return [field(t('country'), countrySelect), regionField];
  }

  function sourceFields(record) {
    const value = record.source || '';
    const options = [['', '—'], ...window.VOCAB.leadSources.map((entry) => [entry, t(`source.${entry}`)])];
    if (value && !window.VOCAB.leadSources.includes(value)) options.push([value, value]);
    const sourceSelect = select('source', options, value);
    const referredField = field(t('referredBy'), input('referredBy', record.referredBy || '', { placeholder: t('referredByPlaceholder') }));
    const sync = () => { referredField.hidden = sourceSelect.value !== 'referral'; };
    sourceSelect.addEventListener('change', () => {
      sync();
      if (!referredField.hidden) referredField.querySelector('input').focus();
    });
    sync();
    return [field(t('source'), sourceSelect), referredField];
  }

  // ----------------------------------------------------------- draft
  // A new student being typed in is kept in this browser as it is typed, so
  // a dialog closed by mistake opens again where it was left. Saving or
  // Cancel drops it, and it is forgotten after two hours.
  const DRAFT_KEY = 'yallaChessStudentDraft';
  const DRAFT_TTL_MS = 2 * 60 * 60 * 1000;
  const readDraft = () => {
    try {
      const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
      if (draft && Date.now() - draft.savedAt < DRAFT_TTL_MS) return draft;
      localStorage.removeItem(DRAFT_KEY);
    } catch (error) { /* ignore */ }
    return null;
  };
  const writeDraft = (draft) => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...draft, savedAt: Date.now() })); } catch (error) { /* ignore */ }
  };
  const dropDraft = () => {
    try { localStorage.removeItem(DRAFT_KEY); } catch (error) { /* ignore */ }
  };

  // ----------------------------------------------------------- form
  // A new student is added in five short steps. Only the first is required;
  // every later step can be skipped, and "finish" saves from anywhere. When
  // editing, the same steps are tabs and Save is always available.
  function studentForm({ student = null, defaults = {}, onSaved }) {
    const isNew = !student;
    // Only a blank new student picks up a draft: one started from a lead or
    // a portal account comes with its own details.
    const draft = isNew && !Object.keys(defaults).length ? readDraft() : null;
    const today = window.UI.todayIso(window.SETTINGS.businessTimezone);
    const s = student || { status: 'active', language: 'he', level: 'basic', lessonType: 'group', currency: 'ILS', remindersEnabled: true, autoMessages: Boolean(window.SETTINGS.autoMessages?.newStudents), timezone: window.SETTINGS.businessTimezone, joinedAt: today, teacher: window.APP.teachers.some((teacher) => teacher.name === window.SETTINGS.teacherName) ? window.SETTINGS.teacherName : '', ...defaults, ...(draft?.values || {}) };

    modal({
      title: isNew ? t('newStudent') : `${t('editStudent')}: ${[s.firstName, s.lastName].filter(Boolean).join(' ')}`,
      body: (dialog) => {
        const form = h('form', { class: 'wizard', novalidate: true });
        // A new student starts with one slot to fill in; a draft brings back
        // exactly the slots it had, none if they were all removed.
        const schedule = scheduleEditor(s.privateSchedule?.length || !isNew || draft ? (s.privateSchedule || []) : [{ weekday: 0, startTime: '17:00', durationMinutes: 60 }]);

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
        // Messages go out in the parent's language. Until it is picked by
        // hand it follows the child's: English for an English-only child.
        const childLanguage = enumSelect('language', window.VOCAB.languages, 'lang', s.language);
        const parentLanguage = enumSelect('parentLanguage', window.VOCAB.parentLanguages, 'lang', s.parentLanguage || (s.language === 'en' ? 'en' : 'he'));
        let parentLanguageTouched = Boolean(s.parentLanguage);
        parentLanguage.addEventListener('change', () => { parentLanguageTouched = true; });
        childLanguage.addEventListener('change', () => { if (!parentLanguageTouched) parentLanguage.value = childLanguage.value === 'en' ? 'en' : 'he'; });
        const basics = h('div', { class: 'form' },
          field(t('firstName') + ' *', firstName),
          field(t('lastName'), input('lastName', s.lastName || '', { autocomplete: 'off' })),
          field(t('age'), h('input', { name: 'age', type: 'number', min: 3, max: 99, value: s.age ?? '', inputmode: 'numeric' })),
          field(t('sex'), enumSelect('sex', window.VOCAB.sexes, 'sex', s.sex || '', { blank: '—' })),
          field(t('language'), childLanguage),
          field(t('parentLanguage'), parentLanguage, { hint: t('parentLanguageHint') }),
          field(t('parentFirstName'), input('parentFirstName', s.parentFirstName || '', { autocomplete: 'off' })),
          field(t('parentLastName'), input('parentLastName', s.parentLastName || '', { autocomplete: 'off' })),
          field(t('parentPhone'), input('parentPhone', s.parentPhone || '', { dir: 'ltr', placeholder: '050-1234567', inputmode: 'tel' }), { hint: t('wizPhoneHint') })
        );

        // ---- step 2: where
        // A student can be in any number of groups, ticked in a list.
        // Closed groups are left out, except ones the student is already in:
        // dropping those from the list would silently take them out.
        let chosenGroups = s.groupIds || (s.groups ? s.groups.map((entry) => entry.groupId) : s.groupId ? [s.groupId] : []);
        const groupChoices = window.APP.groups.filter((group) => group.profile.status !== 'closed' || chosenGroups.includes(group.id));
        const groupLabel = (group) => `${group.name}${group.profile.gender && group.profile.gender !== 'mixed' ? ` (${t(`groupGender.${group.profile.gender}`)})` : ''} · ${window.UI.scheduleText(group.schedule)} · ${group.seatsFree ? t('seatsFreeOf', { free: group.seatsFree, total: group.seatsTotal }) : t('full')}`;
        const groupPicker = h('div', { class: 'pick-list', role: 'group', 'aria-label': t('groupsField') });
        const renderGroupPicker = () => {
          window.UI.clear(groupPicker);
          if (!groupChoices.length) groupPicker.append(h('div', { class: 'pick-empty muted small' }, t('noGroupsYet')));
          for (const group of groupChoices) {
            const on = chosenGroups.includes(group.id);
            const box = h('input', { type: 'checkbox', tabindex: -1, 'aria-hidden': 'true' });
            box.checked = on;
            const toggle = () => {
              setGroups(on ? chosenGroups.filter((id) => id !== group.id) : [...chosenGroups, group.id]);
              renderGroupPicker();
              groupPicker.querySelector(`[data-group="${group.id}"]`)?.focus();
            };
            groupPicker.append(h('div', { class: `pick-item${on ? ' selected' : ''}`, role: 'checkbox', tabindex: 0, 'aria-checked': String(on), 'data-group': group.id, onclick: toggle, onkeydown: (event) => {
              if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); toggle(); }
            } }, box, h('span', { class: 'pick-label', dir: 'auto' }, groupLabel(group))));
          }
        };
        renderGroupPicker();
        const availability = availabilityEditor(s.availability || []);
        const groupField = field(t('groupsField'), groupPicker, { full: true, hint: t('groupsFieldHint') });
        const scheduleField = field(t('privateSchedule'), schedule, { full: true });
        const lessonType = choice('lessonType', [['group', t('lessonType.group')], ['private', t('lessonType.private')], ['both', t('lessonType.both')]], s.lessonType);
        const placement = h('div', { class: 'form' },
          field(t('lessonType'), lessonType, { full: true }),
          groupField,
          scheduleField,
          field(t('whenFree'), availability, { full: true, hint: t('availabilityHintStudent') }),
          field(t('joinedAt'), h('input', { name: 'joinedAt', type: 'date', value: s.joinedAt || '' })),
          // Leaving ends their lessons and charges from that day.
          !isNew ? field(t('leftAt'), h('input', { name: 'leftAt', type: 'date', value: s.leftAt || '', max: today }), { hint: t('leftAtHint') }) : null,
          field(t('teacher'), window.UI.teacherSelect('teacher', s.teacher || ''))
        );
        const syncPlacement = () => {
          const type = form.elements.lessonType.value;
          groupField.hidden = type === 'private';
          scheduleField.hidden = type === 'group';
        };

        // ---- step 3: money
        // The student's own prices: one per kind of lesson they take, each
        // billed per lesson, monthly or as a package. A new student starts
        // from what fits their lessons when the step opens: their group's
        // price a month, the default private price for each private length.
        // Until the teacher edits them, the suggested prices follow the
        // currency: switching it suggests that currency's defaults instead.
        let pricesTouched = !isNew || Boolean(s.prices?.length);
        let suggested = false;
        let suggesting = false;
        // One currency for all of a student's prices, picked first; every
        // amount shows it.
        const currencySelect = select('currency', window.VOCAB.currencies, s.currency || 'ILS');
        const prices = window.UI.priceEditor(s.prices || [], { currency: currencySelect.value, groupIds: chosenGroups, onChange: () => { if (!suggesting) { pricesTouched = true; suggested = false; } } });
        // A month in a group: the group's own price when it is in this
        // currency, else the default.
        const groupDefault = (groupId, currency) => {
          const group = window.APP.groups.find((entry) => entry.id === groupId);
          const own = group && group.profile.price !== null && (group.profile.currency || 'ILS') === currency ? group.profile.price : null;
          return own ?? window.SETTINGS.defaultPrices?.[currency]?.group ?? null;
        };
        // Ticking or unticking a group. Prices not set up yet are suggested
        // again; set ones keep what was typed: a group left takes its price
        // along, and a group joined gets its default. With more than one
        // group, each has its own price, so one for any group becomes the
        // first group's.
        const setGroups = (next) => {
          const before = chosenGroups;
          chosenGroups = next;
          prices.setGroups(next);
          if (suggested) { prices.clear(); suggestPrices({ again: true }); return; }
          if (!pricesTouched) return;
          const rows = prices.read();
          const stayed = next.filter((id) => before.includes(id));
          if (next.length > 1 && stayed.length === 1 && !rows.some((item) => item.groupId === stayed[0])) prices.assignGeneral(stayed[0]);
          for (const id of next.filter((entry) => !before.includes(entry))) {
            const current = prices.read();
            if (current.some((item) => item.groupId === id)) continue;
            if (next.length === 1 && current.some((item) => item.kind !== 'private' && !item.groupId)) continue;
            prices.add({ kind: 'group', groupId: next.length > 1 ? id : '', model: 'monthly', amount: groupDefault(id, currencySelect.value) });
          }
        };
        currencySelect.addEventListener('change', () => {
          prices.setCurrency(currencySelect.value);
          if (suggested) { prices.clear(); suggestPrices({ again: true }); }
        });
        const billing = h('div', { class: 'form' },
          field(t('pricesCurrency'), currencySelect, { hint: t('pricesCurrencyHint') }),
          field(t('prices'), prices, { full: true, hint: t('pricesHint') }),
          h('div', { class: 'field' },
            checkbox('autoMessages', s.autoMessages, t('autoMessagesStudentToggle')),
            // The parent asked to stop: ticking the box again is the school's
            // call, so say what it means.
            s.autoMessagesOptedOutAt ? h('div', { class: 'hint' }, t('autoOptedOutHint', { date: fmtDate(s.autoMessagesOptedOutAt.slice(0, 10), { year: 'numeric' }) })) : null)
        );
        // A group's own price, in its currency, wins over the default; the
        // first time, a group with a price brings its currency along.
        const suggestPrices = ({ again = false } = {}) => {
          if (pricesTouched && !again) return;
          pricesTouched = true;
          suggesting = true;
          const type = form.elements.lessonType.value;
          const group = window.APP.groups.find((entry) => entry.id === chosenGroups[0]);
          const groupPrice = group?.profile.price ?? null;
          const groupCurrency = group?.profile.currency || 'ILS';
          if (!again && type !== 'private' && groupPrice !== null) {
            // A group still priced in a currency no longer offered brings it along.
            if (![...currencySelect.options].some((option) => option.value === groupCurrency)) currencySelect.append(h('option', { value: groupCurrency }, groupCurrency));
            currencySelect.value = groupCurrency;
            prices.setCurrency(groupCurrency);
          }
          const currency = currencySelect.value;
          const defaults = window.SETTINGS.defaultPrices?.[currency] || {};
          if (type !== 'private') {
            for (const id of chosenGroups) prices.add({ kind: 'group', groupId: chosenGroups.length > 1 ? id : '', model: 'monthly', amount: groupDefault(id, currency) });
          }
          if (type !== 'group') {
            for (const length of new Set(schedule.read().map((row) => row.durationMinutes))) {
              prices.add({ kind: 'private', model: 'per_lesson', durationMinutes: length, amount: defaults.private ?? null });
            }
          }
          suggesting = false;
          suggested = true;
        };
        // Every price needs an amount, and a package its number of lessons.
        const pricesProblem = () => {
          const rows = prices.read();
          if (rows.some((item) => item.amount === null)) return t('priceNeedsAmount');
          if (rows.some((item) => item.model === 'package' && !item.packageSize)) return t('packageNeedsSize');
          return '';
        };

        // ---- step 4: chess
        const chess = h('div', { class: 'form' },
          field(t('level'), enumSelect('level', window.VOCAB.levels, 'level', s.level)),
          field(t('rating'), h('input', { name: 'chesscomRating', type: 'number', min: 0, max: 4000, value: s.chesscomRating ?? '', inputmode: 'numeric' })),
          field(t('chesscomUsername'), input('chesscomUsername', s.chesscomUsername || '', { dir: 'ltr' })),
          field(t('lichessRating'), h('input', { name: 'lichessRating', type: 'number', min: 0, max: 4000, value: s.lichessRating ?? '', inputmode: 'numeric' })),
          field(t('lichessUsername'), input('lichessUsername', s.lichessUsername || '', { dir: 'ltr' })),
          field(t('strengths'), textarea('strengths', s.strengths || '', { rows: 2 })),
          field(t('weaknesses'), textarea('weaknesses', s.weaknesses || '', { rows: 2 })),
          field(t('goals'), textarea('goals', s.goals || '', { rows: 2 }), { full: true })
        );

        // ---- step 5: everything else
        const more = h('div', { class: 'form' },
          ...countryFields(s),
          field(t('timezone'), window.UI.timezoneSelect('timezone', s.timezone || '', { blank: '—' })),
          field(t('parentEmail'), input('parentEmail', s.parentEmail || '', { type: 'email', dir: 'ltr' })),
          field(t('parentPhone2'), input('parentPhone2', s.parentPhone2 || '', { dir: 'ltr', inputmode: 'tel' })),
          ...sourceFields(s),
          field(t('privateZoomLink'), input('privateZoomLink', s.privateZoomLink || '', { dir: 'ltr' }), { full: true }),
          field(t('progressNotes'), textarea('notes', s.notes || '', { rows: 3 }), { full: true }),
          // The portal phone is not edited here, but a student created from a
          // portal account carries it so the two stay linked.
          isNew && s.userPhone ? h('input', { type: 'hidden', name: 'userPhone', value: s.userPhone }) : null,
          !isNew ? field(t('topicsManual'), input('topicsLearned', (s.topicsLearned || []).join(', ')), { full: true }) : null
        );

        const steps = [
          { key: 'basics', label: t('wizBasics'), title: t('wizBasicsTitle'), intro: t('wizBasicsIntro'), body: basics, required: true },
          { key: 'placement', label: t('wizPlacement'), title: t('wizPlacementTitle'), intro: t('wizPlacementIntro'), body: placement },
          { key: 'billing', label: t('wizBilling'), title: t('wizBillingTitle'), intro: t('wizBillingIntro'), body: billing },
          { key: 'chess', label: t('wizChess'), title: t('wizChessTitle'), intro: t('wizChessIntro'), body: chess },
          { key: 'more', label: t('wizMore'), title: t('wizMoreTitle'), body: more }
        ];

        let current = draft ? Math.min(Number(draft.step) || 0, steps.length - 1) : 0;
        const visited = new Set(Array.from({ length: current + 1 }, (_, index) => index));
        const stepper = h('ol', { class: 'stepper' });
        const panels = steps.map((step) => h('section', { class: 'wizard-panel', hidden: true },
          h('h3', { class: 'wizard-title' }, step.title),
          step.intro ? h('p', { class: 'wizard-intro' }, step.intro) : null,
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
          values.groupIds = lessonType === 'private' && typeChanged ? [] : chosenGroups;
          const problem = pricesProblem();
          if (problem) {
            go(steps.findIndex((step) => step.key === 'billing'));
            window.UI.clear(errorHost).append(errorBox(problem));
            return;
          }
          values.prices = prices.read();
          values.availability = availability.read();
          for (const button of footer.querySelectorAll('button')) button.disabled = true;
          try {
            const response = student
              ? await api(`/students/${student.id}`, { method: 'PATCH', body: values })
              : await api('/students', { method: 'POST', body: values });
            if (isNew) dropDraft();
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
          if (isNew && steps[current].key === 'billing') suggestPrices();

          const last = current === steps.length - 1;
          const step = steps[current];
          window.UI.clear(footer);
          const start = h('div', { class: 'row' },
            current > 0
              ? h('button', { class: 'btn', type: 'button', onclick: () => go(current - 1) }, `${window.I18N.lang === 'he' ? '→' : '←'} ${t('back')}`)
              : h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { if (isNew) dropDraft(); dialog.close(); } }, t('cancel'))
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
        });
        // Enter moves to the next step for a new student and saves an edit.
        form.addEventListener('submit', (event) => {
          event.preventDefault();
          if (isNew && current < steps.length - 1) go(current + 1);
          else save();
        });

        const keepDraft = () => {
          // Cancel drops the draft and closes; nothing is kept after that.
          if (!isNew || !form.isConnected) return;
          const values = formValues(form);
          // The private slots and the availability windows share field
          // names, so they are read on their own.
          for (const name of ['weekday', 'startTime', 'endTime', 'durationMinutes']) delete values[name];
          values.privateSchedule = schedule.read();
          values.availability = availability.read();
          values.groupIds = chosenGroups;
          values.prices = prices.read();
          writeDraft({ values, step: current });
        };
        form.addEventListener('input', keepDraft);
        form.addEventListener('change', keepDraft);
        // Steps, and adding or removing a private slot, change the form
        // without an input event.
        form.addEventListener('click', (event) => { if (event.target.closest('button')) setTimeout(keepDraft, 0); });

        const draftNote = draft ? h('div', { class: 'row-between draft-note' },
          h('span', null, t('draftRestored')),
          h('button', { class: 'btn btn-xs btn-ghost', type: 'button', onclick: () => {
            dropDraft();
            dialog.close();
            studentForm({ student, defaults, onSaved });
          } }, t('draftStartOver'))
        ) : null;

        form.append(stepper, ...(draftNote ? [draftNote] : []), errorHost, ...panels, footer);
        render();
        if (isNew) setTimeout(() => (panels[current].querySelector('input:not([type=hidden]), select, textarea') || firstName).focus(), 50);
        return form;
      }
    });
  }

  window.VIEWS.studentForm = studentForm;
  window.VIEWS.sourceFields = sourceFields;
  window.VIEWS.countryFields = countryFields;
  window.VIEWS.sourceLabel = sourceLabel;
})();
