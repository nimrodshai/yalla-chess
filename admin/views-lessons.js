// Lesson log: list, detail and the summary form (with attendance).
(function () {
  'use strict';
  window.VIEWS = window.VIEWS || {};
  const { h, api, t, card, empty, fmtDate, statusBadge, link, modal, field, input, textarea, select, enumSelect, formValues, errorBox, toast, todayIso, composeMessage, confirmDialog } = window.UI;

  window.VIEWS.lessons = async ({ id, query, refresh }) => {
    if (id) return lessonDetail(id, refresh);
    if (query.new) setTimeout(() => logLesson({ ...query, onSaved: (lesson) => { location.hash = `#/lessons/${lesson.id}`; } }), 0);
    return lessonList(query);
  };

  // Opens a new summary prefilled from a calendar occurrence key, a group or
  // a student, on top of whatever page the teacher is on. Pass the
  // occurrence's length too; the form's 60-minute default is only a guess.
  // A one-off event's key ("e:<id>") says nothing about when or what it is,
  // so pass the occurrence itself as `slot`: its date, time, kind, group and
  // students win over anything read from the key, and the lesson lands in
  // the right month and matches its place in the calendar.
  function logLesson({ occurrence, slot, durationMinutes, suggestedGame, groupId, studentId, onSaved }) {
    const defaults = {};
    if (groupId) defaults.groupId = groupId;
    if (studentId) { defaults.studentIds = [studentId]; defaults.kind = 'private'; }
    if (occurrence) {
      const parts = occurrence.split(':');
      const date = parts.find((part) => /^\d{4}-\d{2}-\d{2}$/.test(part));
      if (date) defaults.date = date;
      const time = parts.slice(-2).join(':');
      if (/^\d{2}:\d{2}$/.test(time)) defaults.startTime = time;
      if (parts[0] === 'g') { defaults.groupId = parts[1]; defaults.kind = 'group'; }
      if (parts[0] === 'p') { defaults.studentIds = [parts[1]]; defaults.kind = 'private'; }
      if (parts[0] === 'e') { defaults.kind = 'makeup'; }
    }
    if (slot) {
      if (slot.date) defaults.date = slot.date;
      if (slot.startTime) defaults.startTime = slot.startTime;
      if (window.VOCAB.lessonKinds.includes(slot.kind)) defaults.kind = slot.kind;
      if (slot.groupId) { defaults.groupId = slot.groupId; delete defaults.studentIds; }
      else if (slot.studentIds?.length) defaults.studentIds = slot.studentIds;
      if (!durationMinutes) durationMinutes = slot.durationMinutes;
    }
    const length = Number(durationMinutes) || window.APP.groups.find((group) => group.id === defaults.groupId)?.schedule?.find((row) => row.startTime === defaults.startTime && defaults.date && row.weekday === window.UI.weekdayOf(defaults.date))?.durationMinutes;
    if (length) defaults.durationMinutes = length;
    return lessonForm({ defaults, suggestedGame, onSaved });
  }

  async function lessonList(query) {
    const state = { q: query.q || '', groupId: query.groupId || '' };
    const listNode = h('div');
    const [studentsResponse, formerResponse] = await Promise.all([api('/students'), api('/students?status=inactive')]);
    const everyone = [...studentsResponse.students, ...formerResponse.students];
    const nameOf = (studentId) => everyone.find((student) => student.id === studentId)?.name || studentId;
    const load = async () => {
      const params = new URLSearchParams();
      if (state.q) params.set('q', state.q);
      if (state.groupId) params.set('groupId', state.groupId);
      const data = await api(`/lessons?${params}`);
      window.UI.clear(listNode).append(data.lessons.length ? h('div', { class: 'list' }, data.lessons.map((lesson) => lessonRow(lesson, nameOf))) : empty(t('noLessons')));
    };
    // User-triggered reloads report failures as a toast; the first load
    // below stays unguarded so the router can show sign-in or an error page.
    const reload = window.UI.guard(load);
    const searchBox = h('input', { type: 'search', value: state.q, placeholder: t('search'), oninput: (event) => { state.q = event.target.value; clearTimeout(searchBox._timer); searchBox._timer = setTimeout(reload, 250); } });
    const groupSelect = select('groupId', [['', t('filterGroup')], ...window.APP.groups.map((group) => [group.id, group.name])], state.groupId);
    groupSelect.addEventListener('change', () => { state.groupId = groupSelect.value; reload(); });
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
        h('div', { class: 'list-sub' }, h('strong', null, lesson.topic || '—')),
        lesson.topics?.length ? h('div', { class: 'chips', style: { marginTop: '4px' } }, lesson.topics.map((topic) => h('span', { class: 'chip' }, topic))) : null,
        window.UI.gameChips(lesson) ? h('div', { style: { marginTop: '4px' } }, window.UI.gameChips(lesson)) : null
      )
    );
  }

  async function lessonDetail(id, refresh) {
    const [data, studentsResponse, formerResponse] = await Promise.all([api(`/lessons?limit=500`), api('/students'), api('/students?status=inactive')]);
    const lesson = data.lessons.find((entry) => entry.id === id);
    if (!lesson) return h('div', { class: 'card' }, empty(t('noLessons')));
    const group = window.APP.groups.find((entry) => entry.id === lesson.groupId);
    const studentsById = Object.fromEntries([...studentsResponse.students, ...formerResponse.students].map((student) => [student.id, student]));
    // Who the lesson was for is its saved roster, not the group as it is now.
    const involved = lesson.studentIds.map((studentId) => studentsById[studentId]).filter(Boolean);
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
          // A teacher edits the lessons they gave; deleting one is the admin's.
          window.APP.isAdmin || lesson.teacher === window.APP.me?.name ? h('button', { class: 'btn btn-primary', type: 'button', onclick: () => lessonForm({ lesson, onSaved: refresh }) }, t('edit')) : null,
          window.APP.isAdmin ? h('button', { class: 'btn btn-danger', type: 'button', onclick: async () => { if (!(await confirmDialog(t('confirmDelete')))) return; await api(`/lessons/${lesson.id}`, { method: 'DELETE' }); toast(t('deleted')); location.hash = '#/lessons'; } }, t('delete')) : null
        )
      )),
      h('div', { class: 'grid grid-2', style: { marginTop: '16px' } },
        card(t('details'), h('dl', { class: 'stack' },
          lesson.topics?.length ? h('div', { class: 'chips' }, lesson.topics.map((topic) => h('span', { class: 'chip' }, topic))) : null,
          block(t('exercises'), lesson.exercises),
          lesson.gamesResolved?.length ? h('div', { class: 'detail' }, h('dt', null, t('gamesFromList')), h('dd', null, window.UI.gameChips(lesson, { withFreeText: false }))) : null,
          block(t('gamesOther'), lesson.games),
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

  async function lessonForm({ lesson = null, defaults = {}, suggestedGame = null, onSaved }) {
    const [studentsResponse, formerResponse, gamesResponse] = await Promise.all([api('/students'), api('/students?status=inactive'), api('/content?kind=game')]);
    // Students who have left are offered only for lessons from before they
    // left (or for an existing lesson), so a late summary can still name them.
    const leftBy = (student, date) => student.status === 'inactive' && (!student.leftAt || !date || student.leftAt < date);
    const allStudents = [...studentsResponse.students, ...formerResponse.students];
    const gameList = gamesResponse.content.slice().sort((a, b) => a.title.localeCompare(b.title));
    const l = lesson || { date: todayIso(window.SETTINGS.businessTimezone), startTime: '', durationMinutes: 60, kind: 'group', groupId: '', studentIds: [], attendance: {}, status: 'held', ...defaults };
    if (l.groupId && !l.startTime) {
      const group = window.APP.groups.find((entry) => entry.id === l.groupId);
      if (group?.schedule?.[0]) { l.startTime = group.schedule[0].startTime; l.durationMinutes = group.schedule[0].durationMinutes; }
    }
    modal({
      title: lesson ? t('editLesson') : t('newLesson'),
      body: (dialog) => {
        const attendanceState = { ...(l.attendance || {}) };

        // Games come from the official list; one that was deleted since
        // stays on the lesson under its remembered name until removed here.
        const pickedGames = (l.gamesResolved || l.gameRefs || []).map((game) => ({ id: game.id, title: game.title, exists: game.exists !== false && gameList.some((item) => item.id === game.id) }));
        const pickedHost = h('div', { class: 'chips' });
        const gameSelect = h('select');
        const renderGames = () => {
          window.UI.clear(pickedHost);
          for (const game of pickedGames) {
            pickedHost.append(h('span', { class: `chip chip-game ${game.exists ? '' : 'removed'}` }, '♞ ', game.title, game.exists ? null : h('span', { class: 'chip-note' }, ` · ${t('gameRemoved')}`),
              h('button', { type: 'button', class: 'chip-x', 'aria-label': t('delete'), onclick: () => { pickedGames.splice(pickedGames.indexOf(game), 1); renderGames(); } }, '×')));
          }
          window.UI.clear(gameSelect);
          gameSelect.append(h('option', { value: '' }, gameList.length ? t('pickGame') : t('noGamesInList')));
          for (const item of gameList) if (!pickedGames.some((game) => game.id === item.id)) gameSelect.append(h('option', { value: item.id }, item.title));
          gameSelect.disabled = !gameList.length;
          const suggested = suggestedGame && gameList.find((item) => item.id === suggestedGame.id);
          if (suggested && !pickedGames.some((game) => game.id === suggested.id)) {
            pickedHost.append(h('button', { type: 'button', class: 'chip chip-game', title: t('addSuggestedGame'), onclick: () => { pickedGames.push({ id: suggested.id, title: suggested.title, exists: true }); renderGames(); } }, `+ ♞ ${suggested.title} · ${t('suggestedGame')}`));
          }
        };
        gameSelect.addEventListener('change', () => {
          const item = gameList.find((entry) => entry.id === gameSelect.value);
          if (item) pickedGames.push({ id: item.id, title: item.title, exists: true });
          renderGames();
        });
        renderGames();
        const gamePicker = h('div', { class: 'game-picker' }, gameSelect, pickedHost);
        const kindSelect = enumSelect('kind', window.VOCAB.lessonKinds, 'kind', l.kind);
        const groupSelect = select('groupId', [['', '—'], ...window.APP.groups.map((group) => [group.id, group.name])], l.groupId || '');
        const studentPicker = h('div', { class: 'attendance-grid' });
        const attendanceGrid = h('div', { class: 'attendance-grid' });
        const selectedStudents = new Set(l.studentIds || []);
        // A group lesson's students start as whoever was in the group on its
        // date; the teacher can tick someone who has moved since, or untick.
        // A saved lesson's list, or one the teacher touched, is left alone.
        let rosterTouched = Boolean(lesson);
        const inGroupOn = (student, groupId, date) => student.groupId === groupId && !leftBy(student, date) && (student.groupJoinedAt || student.joinedAt || '') <= (date || '9999-12-31');
        let students = [];
        const offered = () => { students = allStudents.filter((student) => selectedStudents.has(student.id) || !leftBy(student, form.date.value)); };
        const defaultRoster = () => {
          if (!groupSelect.value || rosterTouched) return;
          selectedStudents.clear();
          for (const student of allStudents) if (inGroupOn(student, groupSelect.value, form.date.value)) selectedStudents.add(student.id);
        };

        const renderStudentPicker = () => {
          window.UI.clear(studentPicker);
          const groupId = groupSelect.value;
          const rank = (student) => (selectedStudents.has(student.id) ? 0 : groupId && student.groupId === groupId ? 1 : 2);
          for (const student of [...students].sort((a, b) => rank(a) - rank(b))) {
            const box = h('input', { type: 'checkbox' });
            box.checked = selectedStudents.has(student.id);
            box.addEventListener('change', () => { rosterTouched = true; if (box.checked) selectedStudents.add(student.id); else selectedStudents.delete(student.id); renderAttendance(); });
            studentPicker.append(h('label', { class: 'attendance-item', style: { cursor: 'pointer' } }, h('span', null, student.name), box));
          }
        };
        const renderAttendance = () => {
          window.UI.clear(attendanceGrid);
          const list = students.filter((student) => selectedStudents.has(student.id));
          if (!list.length) { attendanceGrid.append(h('div', { class: 'muted small' }, t('none'))); return; }
          for (const student of list) {
            const current = attendanceState[student.id] || 'present';
            const seg = h('div', { class: 'seg' }, window.VOCAB.attendance.map((status) => h('button', { type: 'button', class: current === status ? 'active' : '', onclick: (event) => { attendanceState[student.id] = status; for (const sibling of seg.children) sibling.classList.remove('active'); event.currentTarget.classList.add('active'); } }, t(`attendance.${status}`))));
            attendanceGrid.append(h('div', { class: 'attendance-item' }, h('span', { class: 'small strong' }, student.name), seg));
          }
        };
        const groupField = field(t('forGroup'), groupSelect);
        const studentsLabel = h('label', null, t('forStudents'));
        const studentsHint = h('div', { class: 'hint' }, t('groupRosterHint'));
        const studentsField = h('div', { class: 'field full' }, studentsLabel, studentPicker, studentsHint);
        const sync = () => {
          offered();
          const isGroup = Boolean(groupSelect.value);
          studentsLabel.textContent = isGroup ? t('groupRoster') : t('forStudents');
          studentsHint.hidden = !isGroup;
          defaultRoster();
          renderStudentPicker();
          renderAttendance();
        };
        groupSelect.addEventListener('change', () => {
          const group = window.APP.groups.find((entry) => entry.id === groupSelect.value);
          if (group?.schedule?.[0] && !form.startTime.value) { form.startTime.value = group.schedule[0].startTime; form.durationMinutes.value = group.schedule[0].durationMinutes; }
          rosterTouched = false;
          sync();
        });
        kindSelect.addEventListener('change', () => { if (kindSelect.value === 'private' || kindSelect.value === 'trial') { groupSelect.value = ''; } sync(); });

        const form = h('form', { class: 'form' },
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
          field(t('gamesFromList'), gamePicker, { full: true }),
          field(t('gamesOther'), textarea('games', l.games || '', { rows: 1 }), { full: true }),
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
        form.date.addEventListener('change', sync);
        sync();
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const values = formValues(form);
          values.studentIds = Array.from(selectedStudents);
          if (!values.studentIds.length) {
            form.querySelector('.form-error')?.remove();
            form.prepend(errorBox(t('pickLessonStudents')));
            form.scrollIntoView({ block: 'start' });
            return;
          }
          values.gameRefs = pickedGames.map((game) => ({ id: game.id, title: game.title }));
          values.attendance = Object.fromEntries(Object.entries(attendanceState).filter(([id]) => selectedStudents.has(id)));
          // The server picks a new lesson's teacher from the teachers list
          // (the group's, else the default); an edit keeps the lesson's own.
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
  window.VIEWS.logLesson = logLesson;
})();
