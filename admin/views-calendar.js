// Calendar: week view of every occurrence (group, private, trial, make-up),
// with cancel / reschedule / add-event actions and conflict flags.
(function () {
  'use strict';
  window.VIEWS = window.VIEWS || {};
  const { h, api, t, card, empty, fmtTime, fmtDate, fmtDateTime, link, modal, field, input, textarea, select, enumSelect, formValues, errorBox, toast, todayIso, addDays, weekdayOf, composeMessage, confirmDialog } = window.UI;

  window.VIEWS.calendar = async ({ query, refresh }) => {
    const tz = window.SETTINGS.businessTimezone;
    const today = todayIso(tz);
    const anchor = /^\d{4}-\d{2}-\d{2}$/.test(query.from || '') ? query.from : addDays(today, -weekdayOf(today));
    const from = anchor;
    const to = addDays(from, 6);
    const mode = query.mode === 'agenda' ? 'agenda' : 'week';
    const data = await api(`/calendar?from=${from}&to=${to}`);
    const nav = (target) => `#/calendar?from=${target}${mode === 'agenda' ? '&mode=agenda' : ''}`;

    const head = window.UI.pageHead(t('calendarTitle'), t('calendarSub', { tz }), [
      h('div', { class: 'seg' },
        h('a', { class: `btn btn-ghost btn-sm ${mode === 'week' ? 'active' : ''}`, href: `#/calendar?from=${from}` }, t('weekView')),
        h('a', { class: `btn btn-ghost btn-sm ${mode === 'agenda' ? 'active' : ''}`, href: `#/calendar?from=${from}&mode=agenda` }, t('agenda'))
      ),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => eventForm({ defaults: { date: today }, onSaved: refresh }) }, `+ ${t('addEvent')}`)
    ]);

    const calNav = h('div', { class: 'cal-nav', style: { marginBottom: '14px' } },
      h('a', { class: 'btn btn-sm', href: nav(addDays(from, -7)) }, `‹ ${t('prevWeek')}`),
      h('a', { class: 'btn btn-sm', href: nav(addDays(today, -weekdayOf(today))) }, t('today')),
      h('a', { class: 'btn btn-sm', href: nav(addDays(from, 7)) }, `${t('nextWeek')} ›`),
      h('span', { class: 'cal-range' }, `${fmtDate(from)} – ${fmtDate(to, { year: 'numeric' })}`)
    );

    const byDate = {};
    for (const occurrence of data.occurrences) (byDate[occurrence.date] ||= []).push(occurrence);

    let body;
    if (mode === 'agenda') {
      body = data.occurrences.length ? h('div', { class: 'card cal-agenda' }, h('div', { class: 'list' }, data.occurrences.map((occurrence) => h('div', { class: 'list-item clickable', onclick: () => occurrenceDialog(occurrence, tz, refresh) },
        h('div', { style: { minWidth: '110px' } }, h('div', { class: 'strong small' }, fmtDate(occurrence.date, { weekday: 'short' })), h('span', { class: 'time-pill' }, fmtTime(occurrence.startAt, tz))),
        h('div', { class: 'list-main' },
          h('div', { class: 'list-title' }, occurrence.title, h('span', { class: 'badge' }, t(`kind.${occurrence.kind}`)), occurrence.conflicts?.length ? h('span', { class: 'badge badge-danger' }, t('conflict')) : null, occurrence.loggedLessonId ? h('span', { class: 'badge badge-sage' }, t('lessonStatus.held')) : null),
          h('div', { class: 'list-sub' }, `${occurrence.durationMinutes} ${t('minutes')} · ${occurrence.students.join(', ')}`)
        )
      )))) : h('div', { class: 'card' }, empty(t('noEventsWeek')));
    } else {
      body = h('div', { class: 'cal-week' }, Array.from({ length: 7 }, (_, index) => {
        const date = addDays(from, index);
        const items = byDate[date] || [];
        return h('div', { class: `cal-day ${date === today ? 'today' : ''}` },
          h('div', { class: 'cal-day-head' }, h('span', { class: 'cal-day-name' }, t('weekdays')[weekdayOf(date)]), h('span', { class: 'cal-day-num' }, fmtDate(date))),
          items.map((occurrence) => h('div', { class: `cal-slot kind-${occurrence.kind} ${occurrence.conflicts?.length ? 'conflict' : ''} ${occurrence.loggedLessonId ? 'logged' : ''}`, onclick: () => occurrenceDialog(occurrence, tz, refresh) },
            h('div', { class: 'cal-slot-time' }, `${fmtTime(occurrence.startAt, tz)} · ${occurrence.durationMinutes}′`),
            h('div', { class: 'cal-slot-title' }, occurrence.title),
            h('div', { class: 'cal-slot-sub' }, occurrence.kind === 'group' ? `${occurrence.students.length} ${t('students')}` : t(`kind.${occurrence.kind}`))
          )),
          h('button', { class: 'btn btn-xs btn-ghost', type: 'button', style: { width: '100%', marginTop: '4px' }, onclick: () => eventForm({ defaults: { date }, onSaved: refresh }) }, '+')
        );
      }));
    }

    return h('div', null, head, calNav, body);
  };

  function occurrenceDialog(occurrence, tz, refresh) {
    const dialog = modal({
      title: `${occurrence.title} · ${fmtDateTime(occurrence.startAt, tz)}`,
      size: 'modal-sm',
      body: (api_) => h('div', { class: 'stack' },
        h('div', { class: 'chips' },
          h('span', { class: 'badge badge-gold' }, t(`kind.${occurrence.kind}`)),
          h('span', { class: 'badge' }, `${occurrence.durationMinutes} ${t('minutes')}`),
          occurrence.teacher ? h('span', { class: 'badge' }, occurrence.teacher) : null,
          occurrence.rescheduledFrom ? h('span', { class: 'badge badge-warn' }, t('rescheduledFrom', { from: occurrence.rescheduledFrom })) : null
        ),
        occurrence.conflicts?.length ? h('div', { class: 'alert alert-danger' }, t('conflictWith')) : null,
        occurrence.note ? h('div', { class: 'small' }, occurrence.note) : null,
        occurrence.students.length ? h('div', { class: 'small' }, h('strong', null, `${t('students')}: `), occurrence.students.join(', ')) : null,
        occurrence.zoomLink ? h('a', { class: 'small', href: occurrence.zoomLink, target: '_blank', rel: 'noopener', dir: 'ltr' }, occurrence.zoomLink) : null,
        h('div', { class: 'row' },
          occurrence.groupId ? h('a', { class: 'btn btn-sm', href: `#/groups/${occurrence.groupId}`, onclick: () => api_.close() }, t('group')) : null,
          occurrence.loggedLessonId
            ? h('a', { class: 'btn btn-sm', href: `#/lessons/${occurrence.loggedLessonId}`, onclick: () => api_.close() }, t('viewSummary'))
            : h('a', { class: 'btn btn-sm btn-primary', href: `#/lessons?new=1&occurrence=${encodeURIComponent(occurrence.key)}`, onclick: () => api_.close() }, t('logThisLesson')),
          occurrence.studentIds.length === 1 ? h('button', { class: 'btn btn-sm btn-wa', type: 'button', onclick: () => { api_.close(); composeMessage({ kind: 'lesson_reminder', studentId: occurrence.studentIds[0], occurrenceKey: occurrence.key, reference: `${occurrence.key}:${occurrence.studentIds[0]}`, name: occurrence.title, onSent: refresh }); } }, t('sendReminder')) : null,
          occurrence.leadId ? h('a', { class: 'btn btn-sm', href: `#/leads/${occurrence.leadId}`, onclick: () => api_.close() }, t('leadFor')) : null
        ),
        h('div', { class: 'divider' }),
        h('div', { class: 'row' },
          occurrence.eventId
            ? h('button', { class: 'btn btn-sm btn-danger', type: 'button', onclick: async () => {
              if (!(await confirmDialog(t('confirmDelete')))) return;
              await api(`/events/${occurrence.eventId}`, { method: 'DELETE' });
              toast(t('deleted'));
              api_.close();
              refresh();
            } }, t('delete'))
            : [
              h('button', { class: 'btn btn-sm btn-danger', type: 'button', onclick: () => { api_.close(); eventForm({ defaults: { kind: 'cancel', date: occurrence.date, groupId: occurrence.groupId, studentId: occurrence.groupId ? '' : occurrence.studentIds[0] || '', title: occurrence.title }, onSaved: refresh }); } }, t('cancelLesson')),
              h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { api_.close(); eventForm({ defaults: { kind: 'reschedule', date: occurrence.date, originalDate: occurrence.date, originalTime: occurrence.startTime, startTime: occurrence.startTime, durationMinutes: occurrence.durationMinutes, groupId: occurrence.groupId, studentId: occurrence.groupId ? '' : occurrence.studentIds[0] || '', title: occurrence.title, zoomLink: occurrence.zoomLink }, onSaved: refresh }); } }, t('rescheduleLesson'))
            ]
        )
      )
    });
    return dialog;
  }

  async function eventForm({ event = null, defaults = {}, onSaved }) {
    const e = event || { kind: 'trial', startTime: '17:00', durationMinutes: 60, ...defaults };
    const studentsResponse = await api('/students');
    const leadsResponse = await api('/leads');
    modal({
      title: event ? t('edit') : t('addEvent'),
      body: (dialog) => {
        const kindSelect = enumSelect('kind', window.VOCAB.eventKinds, 'kind', e.kind);
        const groupSelect = select('groupId', [['', '—'], ...window.APP.groups.map((group) => [group.id, group.name])], e.groupId || '');
        const studentSelect = select('studentId', [['', '—'], ...studentsResponse.students.filter((student) => student.status !== 'inactive').map((student) => [student.id, student.name])], e.studentId || '');
        const leadSelect = select('leadId', [['', '—'], ...leadsResponse.leads.filter((lead) => !['converted', 'lost'].includes(lead.status)).map((lead) => [lead.id, `${lead.childName || lead.parentName} (${lead.parentName})`])], e.leadId || '');
        const originalDate = field(t('date') + ' (' + t('kind.cancel') + ')', h('input', { name: 'originalDate', type: 'date', value: e.originalDate || '' }));
        const originalTime = field(t('time') + ' (' + t('kind.cancel') + ')', h('input', { name: 'originalTime', type: 'time', value: e.originalTime || '' }));
        const timeFields = [
          field(e.kind === 'reschedule' ? t('newTime') : t('startTime'), h('input', { name: 'startTime', type: 'time', value: e.startTime || '' })),
          field(t('duration'), h('input', { name: 'durationMinutes', type: 'number', min: 10, max: 300, step: 5, value: e.durationMinutes ?? 60 }))
        ];
        const sync = () => {
          const kind = kindSelect.value;
          originalDate.hidden = kind !== 'reschedule';
          originalTime.hidden = kind !== 'reschedule';
          for (const node of timeFields) node.hidden = kind === 'cancel';
        };
        kindSelect.addEventListener('change', sync);
        const form = h('form', { class: 'form' },
          field(t('eventKind'), kindSelect),
          field(e.kind === 'reschedule' ? t('newDate') : t('date'), h('input', { name: 'date', type: 'date', value: e.date || '', required: true })),
          originalDate, originalTime,
          ...timeFields,
          field(t('linkedGroup'), groupSelect),
          field(t('linkedStudent'), studentSelect),
          field(t('linkedLead'), leadSelect),
          field(t('eventTitle'), input('title', e.title || '')),
          field(t('zoomLink'), input('zoomLink', e.zoomLink || '', { dir: 'ltr' }), { full: true }),
          field(t('reason'), textarea('note', e.note || '', { rows: 2 }), { full: true }),
          h('div', { class: 'form-actions' },
            h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, t('cancel')),
            h('button', { class: 'btn btn-primary', type: 'submit' }, t('save'))
          )
        );
        sync();
        form.addEventListener('submit', async (submitEvent) => {
          submitEvent.preventDefault();
          try {
            const values = formValues(form);
            if (event) await api(`/events/${event.id}`, { method: 'PATCH', body: values });
            else await api('/events', { method: 'POST', body: values });
            toast(t('saved'), 'success');
            dialog.close();
            if (onSaved) onSaved();
          } catch (error) {
            form.querySelector('.form-error')?.remove();
            form.prepend(errorBox(error.message));
          }
        });
        return form;
      }
    });
  }

  window.VIEWS.eventForm = eventForm;
})();
