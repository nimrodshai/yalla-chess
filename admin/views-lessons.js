// Lesson log: list, detail and the summary form (with attendance).
(function () {
  'use strict';
  window.VIEWS = window.VIEWS || {};
  const { h, api, t, card, empty, fmtDate, statusBadge, link, modal, field, input, textarea, select, enumSelect, formValues, errorBox, toast, todayIso, composeMessage, confirmDialog } = window.UI;

  window.VIEWS.lessons = async ({ id, query, refresh }) => {
    if (id) return lessonDetail(id, refresh);
    if (query.new) {
      const defaults = {};
      if (query.groupId) defaults.groupId = query.groupId;
      if (query.studentId) { defaults.studentIds = [query.studentId]; defaults.kind = 'private'; }
      if (query.occurrence) {
        const parts = query.occurrence.split(':');
        const date = parts.find((part) => /^\d{4}-\d{2}-\d{2}$/.test(part));
        if (date) defaults.date = date;
        const time = parts[parts.length - 1];
        if (/^\d{2}:\d{2}$/.test(time)) defaults.startTime = time;
        if (parts[0] === 'g') { defaults.groupId = parts[1]; defaults.kind = 'group'; }
        if (parts[0] === 'p') { defaults.studentIds = [parts[1]]; defaults.kind = 'private'; }
        if (parts[0] === 'e') { defaults.kind = 'makeup'; }
      }
      setTimeout(() => lessonForm({ defaults, onSaved: (lesson) => { location.hash = `#/lessons/${lesson.id}`; } }), 0);
    }
    return lessonList(query);
  };

  async function lessonList(query) {
    const state = { q: query.q || '', groupId: query.groupId || '' };
    const listNode = h('div');
    const studentsResponse = await api('/students');
    const nameOf = (studentId) => studentsResponse.students.find((student) => student.id === studentId)?.name || studentId;
    const load = async () => {
      const params = new URLSearchParams();
      if (state.q) params.set('q', state.q);
      if (state.groupId) params.set('groupId', state.groupId);
      const data = await api(`/lessons?${params}`);
      window.UI.clear(listNode).append(data.lessons.length ? h('div', { class: 'list' }, data.lessons.map((lesson) => lessonRow(lesson, nameOf))) : empty(t('noLessons')));
    };
    const searchBox = h('input', { type: 'search', value: state.q, placeholder: t('search'), oninput: (event) => { state.q = event.target.value; clearTimeout(searchBox._timer); searchBox._timer = setTimeout(load, 250); } });
    const groupSelect = select('groupId', [['', t('filterGroup')], ...window.APP.groups.map((group) => [group.id, group.name])], state.groupId);
    groupSelect.addEventListener('change', () => { state.groupId = groupSelect.value; load(); });
    await load();
    return h('div', null,
      window.UI.pageHead(t('lessonsTitle'), t('lessonsSub'), [h('button', { class: 'btn btn-primary', type: 'button', onclick: () => lessonForm({ onSaved: (lesson) => { location.hash = `#/lessons/${lesson.id}`; } }) }, `+ ${t('newLesson')}`)]),
      h('div', { class: 'filters' }, searchBox, groupSelect),
      h('div', { class: 'card' }, listNode)
    );
  }

  function lessonRow(lesson, nameOf) {
    const group = window.APP.groups.find((entry) => entry.id === lesson.groupId);
    const who = group ? group.name : lesson.studentIds.map(nameOf).join(', ');
    return h('div', { class: 'list-item clickable', onclick: () => { location.hash = `#/lessons/${lesson.id}`; } },
      h('div', { style: { minWidth: '90px' } }, h('div', { class: 'strong small' }, fmtDate(lesson.date, { year: 'numeric' })), h('div', { class: 'muted tiny' }, lesson.startTime)),
      h('div', { class: 'list-main' },
        h('div', { class: 'list-title' }, who, h('span', { class: 'badge' }, t(`kind.${lesson.kind}`)), lesson.status === 'cancelled' ? statusBadge('cancelled', 'lessonStatus') : null),
        h('div', { class: 'list-sub' }, h('strong', null, lesson.topic || '—'), lesson.games ? ` · ${lesson.games}` : ''),
        lesson.topics?.length ? h('div', { class: 'chips', style: { marginTop: '4px' } }, lesson.topics.map((topic) => h('span', { class: 'chip' }, topic))) : null
      )
    );
  }

  async function lessonDetail(id, refresh) {
    const [data, studentsResponse] = await Promise.all([api(`/lessons?limit=500`), api('/students')]);
    const lesson = data.lessons.find((entry) => entry.id === id);
    if (!lesson) return h('div', { class: 'card' }, empty(t('noLessons')));
    const group = window.APP.groups.find((entry) => entry.id === lesson.groupId);
    const studentsById = Object.fromEntries(studentsResponse.students.map((student) => [student.id, student]));
    const involved = group ? studentsResponse.students.filter((student) => student.groupId === group.id) : lesson.studentIds.map((studentId) => studentsById[studentId]).filter(Boolean);
    const attendanceList = Array.from(new Set([...involved.map((student) => student.id), ...Object.keys(lesson.attendance || {})]));

    const block = (label, value) => value ? h('div', { class: 'detail' }, h('dt', null, label), h('dd', { class: 'pre' }, value)) : null;
    return h('div', null,
      h('div', { class: 'breadcrumb' }, link('#/lessons', t('navLessons')), '›', fmtDate(lesson.date, { year: 'numeric' })),
      h('div', { class: 'card' }, h('div', { class: 'row-between' },
        h('div', null,
          h('div', { class: 'profile-name' }, lesson.topic || t('lesson')),
          h('div', { class: 'profile-meta' },
            h('span', { class: 'badge badge-gold' }, group ? link(`#/groups/${group.id}`, group.name) : involved.map((student) => link(`#/students/${student.id}`, student.name)).flatMap((node, index) => index ? [', ', node] : [node])),
            h('span', { class: 'badge' }, `${fmtDate(lesson.date, { weekday: 'long', year: 'numeric' })} ${lesson.startTime}`),
            h('span', { class: 'badge' }, t(`kind.${lesson.kind}`)),
            lesson.durationMinutes ? h('span', { class: 'badge' }, `${lesson.durationMinutes} ${t('minutes')}`) : null,
            lesson.status === 'cancelled' ? statusBadge('cancelled', 'lessonStatus') : null
          )
        ),
        h('div', { class: 'row' },
          involved.length ? h('button', { class: 'btn btn-wa', type: 'button', onclick: () => sendToParents(lesson, involved, 'lesson_summary', refresh) }, t('sendSummary')) : null,
          involved.length && lesson.homework ? h('button', { class: 'btn', type: 'button', onclick: () => sendToParents(lesson, involved, 'homework', refresh) }, t('sendHomework')) : null,
          h('button', { class: 'btn btn-primary', type: 'button', onclick: () => lessonForm({ lesson, onSaved: refresh }) }, t('edit')),
          h('button', { class: 'btn btn-danger', type: 'button', onclick: async () => { if (!(await confirmDialog(t('confirmDelete')))) return; await api(`/lessons/${lesson.id}`, { method: 'DELETE' }); toast(t('deleted')); location.hash = '#/lessons'; } }, t('delete'))
        )
      )),
      h('div', { class: 'grid grid-2', style: { marginTop: '16px' } },
        card(t('details'), h('dl', { class: 'stack' },
          lesson.topics?.length ? h('div', { class: 'chips' }, lesson.topics.map((topic) => h('span', { class: 'chip' }, topic))) : null,
          block(t('exercises'), lesson.exercises),
          block(t('games'), lesson.games),
          block(t('successes'), lesson.successes),
          block(t('difficultiesField'), lesson.difficulties),
          block(t('homework'), lesson.homework),
          block(t('nextStepsField'), lesson.nextSteps),
          block(t('notes'), lesson.notes),
          block(t('rawSummary'), lesson.rawSummary)
        )),
        card(t('attendance'), attendanceList.length ? h('div', { class: 'list' }, attendanceList.map((studentId) => {
          const student = studentsById[studentId];
          const status = lesson.attendance?.[studentId] || 'present';
          return h('div', { class: 'list-item' },
            h('div', { class: 'list-main' }, student ? link(`#/students/${student.id}`, student.name) : studentId),
            statusBadge(status, 'attendance')
          );
        })) : empty(t('none')))
      )
    );
  }

  // Sends the same template to each parent, one WhatsApp window at a time.
  function sendToParents(lesson, students, kind, refresh) {
    const queue = students.filter((student) => student.parentPhone && lesson.attendance?.[student.id] !== 'absent');
    if (!queue.length) { toast(t('noPhone'), 'error'); return; }
    const next = () => {
      const student = queue.shift();
      if (!student) { refresh(); return; }
      composeMessage({ kind, studentId: student.id, lessonId: lesson.id, reference: `${lesson.id}:${kind}:${student.id}`, name: student.parentName || student.name, onSent: next });
    };
    next();
  }

  async function lessonForm({ lesson = null, defaults = {}, onSaved }) {
    const studentsResponse = await api('/students');
    const students = studentsResponse.students.filter((student) => student.status !== 'inactive' || lesson);
    const l = lesson || { date: todayIso(window.SETTINGS.businessTimezone), startTime: '', durationMinutes: 60, kind: 'group', groupId: '', studentIds: [], attendance: {}, status: 'held', ...defaults };
    if (l.groupId && !l.startTime) {
      const group = window.APP.groups.find((entry) => entry.id === l.groupId);
      if (group?.schedule?.[0]) { l.startTime = group.schedule[0].startTime; l.durationMinutes = group.schedule[0].durationMinutes; }
    }
    modal({
      title: lesson ? t('editLesson') : t('newLesson'),
      size: 'modal-lg',
      body: (dialog) => {
        const attendanceState = { ...(l.attendance || {}) };
        const kindSelect = enumSelect('kind', window.VOCAB.lessonKinds, 'kind', l.kind);
        const groupSelect = select('groupId', [['', '—'], ...window.APP.groups.map((group) => [group.id, group.name])], l.groupId || '');
        const studentPicker = h('div', { class: 'attendance-grid' });
        const attendanceGrid = h('div', { class: 'attendance-grid' });
        const selectedStudents = new Set(l.studentIds || []);

        const renderStudentPicker = () => {
          window.UI.clear(studentPicker);
          for (const student of students) {
            const box = h('input', { type: 'checkbox' });
            box.checked = selectedStudents.has(student.id);
            box.addEventListener('change', () => { if (box.checked) selectedStudents.add(student.id); else selectedStudents.delete(student.id); renderAttendance(); });
            studentPicker.append(h('label', { class: 'attendance-item', style: { cursor: 'pointer' } }, h('span', null, student.name), box));
          }
        };
        const renderAttendance = () => {
          window.UI.clear(attendanceGrid);
          const groupId = groupSelect.value;
          const list = groupId ? students.filter((student) => student.groupId === groupId) : students.filter((student) => selectedStudents.has(student.id));
          if (!list.length) { attendanceGrid.append(h('div', { class: 'muted small' }, t('none'))); return; }
          for (const student of list) {
            const current = attendanceState[student.id] || 'present';
            const seg = h('div', { class: 'seg' }, window.VOCAB.attendance.map((status) => h('button', { type: 'button', class: current === status ? 'active' : '', onclick: (event) => { attendanceState[student.id] = status; for (const sibling of seg.children) sibling.classList.remove('active'); event.currentTarget.classList.add('active'); } }, t(`attendance.${status}`))));
            attendanceGrid.append(h('div', { class: 'attendance-item' }, h('span', { class: 'small strong' }, student.name), seg));
          }
        };
        const groupField = field(t('forGroup'), groupSelect);
        const studentsField = field(t('forStudents'), studentPicker, { full: true });
        const sync = () => {
          const isGroup = Boolean(groupSelect.value);
          studentsField.hidden = isGroup;
          renderAttendance();
        };
        groupSelect.addEventListener('change', () => {
          const group = window.APP.groups.find((entry) => entry.id === groupSelect.value);
          if (group?.schedule?.[0] && !form.startTime.value) { form.startTime.value = group.schedule[0].startTime; form.durationMinutes.value = group.schedule[0].durationMinutes; }
          sync();
        });
        kindSelect.addEventListener('change', () => { if (kindSelect.value === 'private' || kindSelect.value === 'trial') { groupSelect.value = ''; } sync(); });

        const form = h('form', { class: 'form form-3' },
          field(t('rawSummary'), textarea('rawSummary', l.rawSummary || '', { rows: 2 }), { full: true, hint: t('rawSummaryHint') }),
          field(t('lessonKind'), kindSelect),
          groupField,
          field(t('lessonStatus'), select('status', [['held', t('lessonStatus.held')], ['cancelled', t('lessonStatus.cancelled')]], l.status)),
          field(t('date'), h('input', { name: 'date', type: 'date', value: l.date || '', required: true })),
          field(t('time'), h('input', { name: 'startTime', type: 'time', value: l.startTime || '' })),
          field(t('duration'), h('input', { name: 'durationMinutes', type: 'number', min: 10, max: 300, step: 5, value: l.durationMinutes ?? 60 })),
          studentsField,
          field(t('topic'), input('topic', l.topic || '', { required: true }), { full: true }),
          field(t('topicsTags'), input('topics', (l.topics || []).join(', ')), { full: true }),
          field(t('exercises'), textarea('exercises', l.exercises || '', { rows: 2 })),
          field(t('games'), textarea('games', l.games || '', { rows: 2 })),
          field(t('homework'), textarea('homework', l.homework || '', { rows: 2 })),
          field(t('successes'), textarea('successes', l.successes || '', { rows: 2 })),
          field(t('difficultiesField'), textarea('difficulties', l.difficulties || '', { rows: 2 })),
          field(t('nextStepsField'), textarea('nextSteps', l.nextSteps || '', { rows: 2 })),
          field(t('notes'), textarea('notes', l.notes || '', { rows: 2 }), { full: true }),
          field(t('attendance'), attendanceGrid, { full: true }),
          h('div', { class: 'form-actions' },
            h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, t('cancel')),
            h('button', { class: 'btn btn-primary', type: 'submit' }, t('save'))
          )
        );
        renderStudentPicker();
        sync();
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const values = formValues(form);
          values.studentIds = groupSelect.value ? [] : Array.from(selectedStudents);
          values.attendance = attendanceState;
          values.teacher = window.SETTINGS.teacherName;
          try {
            const response = lesson ? await api(`/lessons/${lesson.id}`, { method: 'PATCH', body: values }) : await api('/lessons', { method: 'POST', body: values });
            toast(t('saved'), 'success');
            dialog.close();
            if (onSaved) onSaved(response.lesson);
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

  window.VIEWS.lessonForm = lessonForm;
})();
