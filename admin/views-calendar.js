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
    // The grid places lessons by their date in the business zone. Zones span
    // UTC-12 to UTC+14, so a stored date can be two days off that, plus a day
    // for a lesson running past midnight into Sunday.
    const MARGIN_DAYS = 3;
    const data = await api(`/calendar?from=${addDays(from, -MARGIN_DAYS)}&to=${addDays(to, MARGIN_DAYS)}`);
    const occurrences = data.occurrences.filter((occurrence) => occurrence.date >= from && occurrence.date <= to);
    const nav = (target) => `#/calendar?from=${target}${mode === 'agenda' ? '&mode=agenda' : ''}`;

    // Cancelling, rescheduling and adding events is the admin's; a teacher
    // sees their own lessons and logs them.
    const head = window.UI.pageHead(t('calendarTitle'), t('calendarSub', { tz }), [
      h('div', { class: 'seg' },
        h('a', { class: `btn btn-ghost btn-sm ${mode === 'week' ? 'active' : ''}`, href: `#/calendar?from=${from}` }, t('weekView')),
        h('a', { class: `btn btn-ghost btn-sm ${mode === 'agenda' ? 'active' : ''}`, href: `#/calendar?from=${from}&mode=agenda` }, t('agenda'))
      ),
      window.APP.isAdmin ? h('button', { class: 'btn btn-primary', type: 'button', onclick: () => eventForm({ defaults: { date: today }, onSaved: refresh }) }, `+ ${t('addEvent')}`) : null
    ].filter(Boolean));

    const calNav = h('div', { class: 'cal-nav', style: { marginBottom: '14px' } },
      h('a', { class: 'btn btn-sm', href: nav(addDays(from, -7)) }, `‹ ${t('prevWeek')}`),
      h('a', { class: 'btn btn-sm', href: nav(addDays(today, -weekdayOf(today))) }, t('today')),
      h('a', { class: 'btn btn-sm', href: nav(addDays(from, 7)) }, `${t('nextWeek')} ›`),
      h('span', { class: 'cal-range' }, `${fmtDate(from)} – ${fmtDate(to, { year: 'numeric' })}`)
    );


    let body;
    if (mode === 'agenda') {
      body = occurrences.length ? h('div', { class: 'card cal-agenda' }, h('div', { class: 'list' }, occurrences.map((occurrence) => h('div', { class: 'list-item clickable', onclick: () => occurrenceDialog(occurrence, tz, refresh) },
        h('div', { style: { minWidth: '110px' } }, h('div', { class: 'strong small' }, fmtDate(occurrence.date, { weekday: 'short' })), h('span', { class: 'time-pill' }, fmtTime(occurrence.startAt, tz))),
        h('div', { class: 'list-main' },
          h('div', { class: 'list-title' }, occurrence.title, h('span', { class: 'badge' }, t(`kind.${occurrence.kind}`)), occurrence.conflicts?.length ? h('span', { class: 'badge badge-danger' }, t('conflict')) : null, occurrence.loggedLessonId ? h('span', { class: 'badge badge-sage' }, t('lessonStatus.held')) : null),
          h('div', { class: 'list-sub' }, `${occurrence.durationMinutes} ${t('minutes')} · ${occurrence.students.join(', ')}`)
        )
      )))) : h('div', { class: 'card' }, empty(t('noEventsWeek')));
    } else {
      body = weekGrid({ from, today, tz, occurrences: data.occurrences, refresh });
    }

    return h('div', null, head, calNav, body);
  };

  // Week view as a time grid: an hour rail on the side, one column per day,
  // each occurrence placed by its start and length. Overlapping occurrences
  // share the column side by side; a click on empty space adds an event there.
  const HOUR_PX = 64; // keep in sync with --hour in admin.css
  const minutesOf = (isoInstant, tz) => {
    const [hours, minutes] = fmtTime(isoInstant, tz).split(':').map(Number);
    return hours * 60 + minutes;
  };

  const daysBetween = (fromIso, toIso) => Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);

  // Split each occurrence into per-day pieces in wall-clock time, so one running
  // past midnight also fills the start of the next day. The end comes from the
  // real end instant (a spring-forward night skips an hour); on a fall-back
  // night the repeated hour can't be drawn, so the slot is never drawn shorter
  // than the lesson itself.
  function segmentsByDate(occurrences, tz) {
    const byDate = {};
    for (const occurrence of occurrences) {
      const startDate = todayIso(tz, new Date(occurrence.startAt));
      const start = minutesOf(occurrence.startAt, tz);
      const duration = occurrence.durationMinutes || 60;
      const endAt = new Date(Date.parse(occurrence.startAt) + duration * 60_000).toISOString();
      const end = Math.max(start + duration, daysBetween(startDate, todayIso(tz, new Date(endAt))) * 1440 + minutesOf(endAt, tz));
      for (let dayOffset = 0; dayOffset * 1440 < end; dayOffset += 1) {
        const date = addDays(startDate, dayOffset);
        (byDate[date] ||= []).push({ occurrence, start: Math.max(0, start - dayOffset * 1440), end: Math.min(1440, end - dayOffset * 1440), continued: dayOffset > 0 });
      }
    }
    return byDate;
  }

  function layoutDay(segments) {
    const placed = segments.map((segment) => ({ ...segment })).sort((a, b) => a.start - b.start || b.end - a.end);
    let cluster = [];
    let clusterEnd = -1;
    const closeCluster = () => {
      const lanes = Math.max(1, ...cluster.map((item) => item.lane + 1));
      for (const item of cluster) item.lanes = lanes;
      cluster = [];
    };
    for (const item of placed) {
      if (item.start >= clusterEnd) closeCluster();
      const laneEnds = [];
      for (const other of cluster) laneEnds[other.lane] = Math.max(laneEnds[other.lane] ?? -1, other.end);
      let lane = 0;
      while (laneEnds[lane] !== undefined && laneEnds[lane] > item.start) lane += 1;
      item.lane = lane;
      cluster.push(item);
      clusterEnd = Math.max(clusterEnd, item.end);
    }
    closeCluster();
    return placed;
  }

  function weekGrid({ from, today, tz, occurrences, refresh }) {
    const days = Array.from({ length: 7 }, (_, index) => addDays(from, index));
    const byDate = segmentsByDate(occurrences, tz);
    const laidOut = Object.fromEntries(days.map((date) => [date, layoutDay(byDate[date] || [])]));
    const all = Object.values(laidOut).flat();
    const firstHour = Math.min(8, ...all.map((item) => Math.floor(item.start / 60)));
    const lastHour = Math.min(24, Math.max(21, ...all.map((item) => Math.ceil(item.end / 60))));
    const height = (lastHour - firstHour) * HOUR_PX;
    const y = (minutes) => ((minutes - firstHour * 60) / 60) * HOUR_PX;
    const pad = (value) => String(value).padStart(2, '0');
    const nowMinutes = minutesOf(new Date().toISOString(), tz);

    const addAt = (event, date) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const minutes = Math.max(0, Math.min(24 * 60 - 15, firstHour * 60 + Math.floor(((event.clientY - rect.top) / HOUR_PX) * 4) * 15));
      eventForm({ defaults: { date, startTime: `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}` }, onSaved: refresh });
    };

    return h('div', { class: 'cal-grid-wrap' },
      h('div', { class: 'cal-grid' },
        h('div', { class: 'cal-corner' }),
        days.map((date) => h('div', { class: `cal-day-head ${date === today ? 'today' : ''}` },
          h('span', { class: 'cal-day-name' }, t('weekdays')[weekdayOf(date)]),
          h('span', { class: 'cal-day-num' }, fmtDate(date))
        )),
        h('div', { class: 'cal-hours', style: { height: `${height}px` } },
          Array.from({ length: lastHour - firstHour }, (_, index) => h('div', { class: 'cal-hour', style: { top: `${index * HOUR_PX}px` } }, `${pad(firstHour + index)}:00`))
        ),
        days.map((date) => h('div', {
          class: `cal-col ${date === today ? 'today' : ''}`,
          style: { height: `${height}px` },
          title: window.APP.isAdmin ? t('addEvent') : null,
          onclick: window.APP.isAdmin ? (event) => addAt(event, date) : null
        },
          date === today && nowMinutes >= firstHour * 60 && nowMinutes <= lastHour * 60 ? h('div', { class: 'cal-now', style: { top: `${y(nowMinutes)}px` } }) : null,
          laidOut[date].map(({ occurrence, start, end, continued, lane, lanes }) => {
            const slotHeight = Math.max(22, y(end) - y(start) - 2);
            return h('div', {
              class: `cal-slot kind-${occurrence.kind} ${occurrence.conflicts?.length ? 'conflict' : ''} ${occurrence.loggedLessonId ? 'logged' : ''} ${slotHeight < 44 ? 'short' : ''} ${lanes >= 3 ? 'narrow' : ''}`,
              style: { top: `${y(start) + 1}px`, height: `${slotHeight}px`, insetInlineStart: `calc(${(lane / lanes) * 100}% + 2px)`, width: `calc(${100 / lanes}% - 4px)` },
              title: `${fmtTime(occurrence.startAt, tz)} · ${occurrence.durationMinutes}′ · ${occurrence.title}`,
              onclick: (event) => { event.stopPropagation(); occurrenceDialog(occurrence, tz, refresh); }
            },
              h('div', { class: 'cal-slot-time' }, `${continued ? '↳ ' : ''}${fmtTime(occurrence.startAt, tz)} · ${occurrence.durationMinutes}′`),
              h('div', { class: 'cal-slot-title' }, occurrence.title),
              slotHeight >= 60 ? h('div', { class: 'cal-slot-sub' }, occurrence.kind === 'group' ? `${occurrence.students.length} ${t('students')}` : t(`kind.${occurrence.kind}`)) : null
            );
          })
        ))
      )
    );
  }

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
        window.UI.suggestedGame(occurrence),
        occurrence.students.length ? h('div', { class: 'small' }, h('strong', null, `${t('students')}: `), occurrence.students.join(', ')) : null,
        occurrence.zoomLink ? h('a', { class: 'small', href: occurrence.zoomLink, target: '_blank', rel: 'noopener', dir: 'ltr' }, occurrence.zoomLink) : null,
        h('div', { class: 'row' },
          occurrence.groupId ? h('a', { class: 'btn btn-sm', href: `#/groups/${occurrence.groupId}`, onclick: () => api_.close() }, t('group')) : null,
          occurrence.loggedLessonId
            ? h('a', { class: 'btn btn-sm', href: `#/lessons/${occurrence.loggedLessonId}`, onclick: () => api_.close() }, t('viewSummary'))
            : h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => { api_.close(); window.VIEWS.logLesson({ occurrence: occurrence.key, slot: occurrence, durationMinutes: occurrence.durationMinutes, suggestedGame: occurrence.suggestedGame, onSaved: refresh }); } }, t('logThisLesson')),
          occurrence.studentIds.length === 1 ? h('button', { class: 'btn btn-sm btn-wa', type: 'button', onclick: () => { api_.close(); composeMessage({ kind: 'lesson_reminder', studentId: occurrence.studentIds[0], occurrenceKey: occurrence.key, reference: `${occurrence.key}:${occurrence.studentIds[0]}`, name: occurrence.title, onSent: refresh }); } }, t('sendReminder')) : null,
          occurrence.leadId && window.APP.isAdmin ? h('a', { class: 'btn btn-sm', href: `#/leads/${occurrence.leadId}`, onclick: () => api_.close() }, t('leadFor')) : null
        ),
        window.APP.isAdmin && h('div', { class: 'divider' }),
        window.APP.isAdmin && h('div', { class: 'row' },
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
              h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { api_.close(); eventForm({ defaults: { kind: 'reschedule', date: occurrence.date, originalDate: occurrence.date, originalTime: occurrence.startTime, startTime: occurrence.startTime, durationMinutes: occurrence.durationMinutes, groupId: occurrence.groupId, studentId: occurrence.groupId ? '' : occurrence.studentIds[0] || '', title: occurrence.title, zoomLink: '' }, onSaved: refresh }); } }, t('rescheduleLesson'))
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
