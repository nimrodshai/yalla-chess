// Groups: cards with seats and level, group page with profile, members,
// waitlist, lessons and topics, plus the matching tool.
(function () {
  'use strict';
  window.VIEWS = window.VIEWS || {};
  const { h, api, t, card, empty, fmtDate, statusBadge, link, modal, field, input, textarea, select, enumSelect, teacherSelect, formValues, errorBox, toast, scheduleText, scheduleEditor, weekdayPicker, initials, confirmDialog } = window.UI;

  window.VIEWS.groups = async ({ id, query, refresh }) => {
    if (id === 'match') return matchTool(query);
    if (id) return groupDetail(id, refresh);
    return groupList(refresh);
  };

  function groupList(refresh) {
    const groups = window.APP.groups;
    const totalStudents = groups.reduce((sum, group) => sum + group.studentCount, 0);
    const totalFree = groups.filter((group) => group.profile.status !== 'closed').reduce((sum, group) => sum + group.seatsFree, 0);
    return h('div', null,
      window.UI.pageHead(t('groupsTitle'), t('groupsSub', { n: groups.length, students: totalStudents, free: totalFree }), [
        h('a', { class: 'btn', href: '#/groups/match' }, `🔍 ${t('findGroup')}`),
        h('a', { class: 'btn', href: '/', target: '_blank', rel: 'noopener' }, t('openPortal')),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => newGroupForm(refresh) }, `+ ${t('newGroup')}`)
      ]),
      h('div', { class: 'grid grid-3 grid-even' }, groups.map(groupCard))
    );
  }

  function groupCard(group) {
    const profile = group.profile;
    const fill = Math.min(100, Math.round((group.studentCount / group.seatsTotal) * 100));
    return h('a', { class: 'card', href: `#/groups/${group.id}`, style: { display: 'block' } },
      h('div', { class: 'row-between' },
        h('div', { class: 'card-title' }, group.name),
        statusBadge(profile.status, 'groupStatus')
      ),
      h('div', { class: 'muted small', style: { marginTop: '4px' } }, scheduleText(group.schedule) || '—'),
      h('div', { class: 'chips', style: { marginTop: '10px' } },
        profile.level ? h('span', { class: 'chip' }, t(`level.${profile.level}`)) : null,
        profile.minAge || profile.maxAge ? h('span', { class: 'chip' }, `${t('age')} ${profile.minAge ?? '?'}–${profile.maxAge ?? '?'}`) : null,
        profile.ratingMin !== null || profile.ratingMax !== null ? h('span', { class: 'chip' }, `♟ ${profile.ratingMin ?? 0}–${profile.ratingMax ?? '∞'}`) : null,
        h('span', { class: 'chip' }, t(`lang.${profile.language}`))
      ),
      h('div', { style: { marginTop: '12px' } },
        h('div', { class: 'row-between small' }, h('span', { class: 'strong' }, `${group.studentCount}/${group.seatsTotal} ${t('students')}`), h('span', { class: group.seatsFree ? 'badge badge-gold' : 'badge badge-danger' }, group.seatsFree ? `${group.seatsFree} ${t('seatsFree')}` : t('full'))),
        h('div', { style: { height: '6px', background: 'var(--cream)', borderRadius: '4px', marginTop: '6px', overflow: 'hidden' } }, h('div', { style: { width: `${fill}%`, height: '100%', background: fill >= 100 ? 'var(--danger)' : 'var(--gold)' } }))
      ),
      h('div', { class: 'muted small', style: { marginTop: '8px' } }, group.students.map((student) => student.name).join(', ') || t('none')),
      group.lastLessonTopic ? h('div', { class: 'muted tiny', style: { marginTop: '6px' } }, `${t('lastTime', { date: fmtDate(group.lastLessonAt), topic: group.lastLessonTopic })}`) : null
    );
  }

  // ----------------------------------------------------------- detail
  async function groupDetail(id, refresh) {
    const group = window.APP.groups.find((entry) => entry.id === id);
    if (!group) return h('div', { class: 'card' }, empty(t('none')));
    const [lessonsResponse, studentsResponse] = await Promise.all([api(`/lessons?groupId=${id}&limit=100`), api('/students')]);
    const profile = group.profile;
    const unassigned = studentsResponse.students.filter((student) => student.groupId !== id && student.status !== 'inactive');

    const head = h('div', { class: 'card' }, h('div', { class: 'row-between' },
      h('div', null,
        h('div', { class: 'profile-name' }, group.name, group.nameEn !== group.name ? h('span', { class: 'muted', style: { fontSize: '15px', marginInlineStart: '8px' } }, group.nameEn) : null),
        h('div', { class: 'profile-meta' },
          statusBadge(profile.status, 'groupStatus'),
          h('span', { class: 'badge' }, scheduleText(group.schedule) || '—'),
          h('span', { class: 'badge' }, group.timezone),
          h('span', { class: group.seatsFree ? 'badge badge-gold' : 'badge badge-danger' }, `${group.studentCount}/${group.seatsTotal} · ${group.seatsFree ? `${group.seatsFree} ${t('seatsFree')}` : t('full')}`),
          group.zoomLink ? h('a', { class: 'badge badge-info', href: group.zoomLink, target: '_blank', rel: 'noopener' }, 'Zoom') : null
        )
      ),
      h('div', { class: 'row' },
        h('a', { class: 'btn', href: `#/lessons?new=1&groupId=${group.id}` }, `+ ${t('logLesson')}`),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => profileForm(group, refresh) }, t('editProfile'))
      )
    ));

    const detail = (label, value) => value ? h('div', { class: 'detail' }, h('dt', null, label), h('dd', null, value)) : null;
    const profileCard = card(t('groupProfile'), h('dl', { class: 'detail-grid' },
      detail(t('level'), profile.level ? t(`level.${profile.level}`) : ''),
      detail(t('ageRange'), profile.minAge || profile.maxAge ? `${profile.minAge ?? '?'}–${profile.maxAge ?? '?'}` : ''),
      detail(t('ratingRange'), profile.ratingMin !== null || profile.ratingMax !== null ? `${profile.ratingMin ?? 0}–${profile.ratingMax ?? '∞'}` : ''),
      detail(t('language'), t(`lang.${profile.language}`)),
      detail(t('teacher'), profile.teacher),
      detail(t('price'), profile.price !== null ? window.UI.fmtMoney(profile.price, profile.currency) : ''),
      detail(t('description'), profile.description)
    ));

    const members = card(t('members'), group.students.length ? h('div', { class: 'list' }, group.students.map((student) => h('div', { class: 'list-item' },
      h('span', { class: 'avatar' }, initials(student.name)),
      h('div', { class: 'list-main' },
        h('div', { class: 'list-title' }, link(`#/students/${student.id}`, student.name), statusBadge(student.status), student.userPhone ? h('span', { class: 'badge badge-sage' }, t('portalLinked')) : null),
        h('div', { class: 'list-sub' }, [student.age ? `${t('age')} ${student.age}` : '', t(`level.${student.level}`), student.chesscomRating ? `♟ ${student.chesscomRating}` : ''].filter(Boolean).join(' · '))
      ),
      h('div', { class: 'list-side' },
        h('button', { class: 'btn btn-xs', type: 'button', onclick: () => moveDialog(student, group, refresh) }, t('moveToGroup')),
        h('button', { class: 'btn btn-xs btn-danger', type: 'button', onclick: async () => {
          if (!(await confirmDialog(t('removeFromGroup') + '?', { okLabel: t('removeFromGroup') }))) return;
          await api(`/students/${student.id}`, { method: 'PATCH', body: { groupId: '' } });
          toast(t('saved'), 'success');
          refresh();
        } }, t('removeFromGroup'))
      )
    ))) : empty(t('noMembersYet')), { count: `${group.studentCount}/${group.seatsTotal}`, actions: [h('button', { class: 'btn btn-sm', type: 'button', onclick: () => addDialog(group, unassigned, refresh) }, `+ ${t('addStudentToGroup')}`)] });

    const waitlist = group.waitlist.length ? card(t('waitlistFor'), h('div', { class: 'list' }, group.waitlist.map((student) => h('div', { class: 'list-item' },
      h('div', { class: 'list-main' }, link(`#/students/${student.id}`, student.name)),
      h('button', { class: 'btn btn-xs', type: 'button', onclick: async () => { await api(`/students/${student.id}`, { method: 'PATCH', body: { status: 'active', groupId: group.id } }); toast(t('saved'), 'success'); refresh(); } }, t('status.active'))
    ))), { count: group.waitlist.length }) : null;

    const topics = card(t('groupTopics'), group.topicsLearned.length ? h('div', { class: 'chips' }, group.topicsLearned.map((topic) => h('span', { class: 'chip' }, topic))) : empty(t('noTopics')), { count: group.topicsLearned.length });

    const lessons = card(t('groupLessons'), lessonsResponse.lessons.length ? h('div', { class: 'list' }, lessonsResponse.lessons.map((lesson) => h('div', { class: 'list-item clickable', onclick: () => { location.hash = `#/lessons/${lesson.id}`; } },
      h('div', { class: 'list-main' },
        h('div', { class: 'list-title' }, fmtDate(lesson.date, { year: 'numeric' }), h('span', { class: 'strong' }, lesson.topic || '—'), lesson.status === 'cancelled' ? statusBadge('cancelled', 'lessonStatus') : null),
        lesson.nextSteps ? h('div', { class: 'list-sub' }, `${t('nextSteps')}: ${lesson.nextSteps}`) : null,
        window.UI.gameChips(lesson) ? h('div', { style: { marginTop: '4px' } }, window.UI.gameChips(lesson)) : null,
        lesson.attendance && Object.keys(lesson.attendance).length ? h('div', { class: 'chips', style: { marginTop: '4px' } }, Object.entries(lesson.attendance).map(([studentId, status]) => {
          const student = studentsResponse.students.find((entry) => entry.id === studentId);
          return h('span', { class: `chip ${status === 'absent' ? 'badge-danger' : ''}` }, `${student ? student.name : studentId}: ${t(`attendance.${status}`)}`);
        })) : null
      )
    ))) : empty(t('noLessonsYet')), { count: lessonsResponse.lessons.length, sub: group.nextSteps ? `${t('nextSteps')}: ${group.nextSteps}` : '' });

    return h('div', null,
      h('div', { class: 'breadcrumb' }, link('#/groups', t('navGroups')), '›', group.name),
      head,
      // Short summary cards share a row and stretch to the same height; the
      // two lists below grow independently but start on the same line.
      h('div', { class: 'grid grid-2', style: { marginTop: '16px' } }, profileCard, topics),
      h('div', { class: 'grid grid-2', style: { marginTop: '16px' } },
        h('div', { class: 'stack' }, members, waitlist),
        h('div', { class: 'stack' }, lessons)
      )
    );
  }

  function profileForm(group, refresh) {
    const profile = group.profile;
    modal({
      title: `${t('editProfile')}: ${group.name}`,
      body: (dialog) => {
        const form = h('form', { class: 'form form-3' },
          field(t('groupStatus'), enumSelect('status', window.VOCAB.groupStatuses, 'groupStatus', profile.status)),
          field(t('language'), enumSelect('language', window.VOCAB.languages, 'lang', profile.language)),
          field(t('level'), enumSelect('level', window.VOCAB.levels, 'level', profile.level, { blank: '—' })),
          field(t('minAge'), h('input', { name: 'minAge', type: 'number', min: 3, max: 99, value: profile.minAge ?? '' })),
          field(t('maxAge'), h('input', { name: 'maxAge', type: 'number', min: 3, max: 99, value: profile.maxAge ?? '' })),
          field(t('ratingMin'), h('input', { name: 'ratingMin', type: 'number', min: 0, max: 4000, value: profile.ratingMin ?? '' })),
          field(t('ratingMax'), h('input', { name: 'ratingMax', type: 'number', min: 0, max: 4000, value: profile.ratingMax ?? '' })),
          field(t('teacher'), teacherSelect('teacher', profile.teacher || ''), { hint: h('a', { class: 'link', href: '#/teachers', onclick: () => dialog.close() }, t('manageTeachers')) }),
          field(t('price'), h('input', { name: 'price', type: 'number', step: '0.01', min: 0, value: profile.price ?? '' })),
          field(t('currency'), select('currency', window.VOCAB.currencies, profile.currency)),
          field(t('description'), textarea('description', profile.description || '', { rows: 3 }), { full: true }),
          h('div', { class: 'form-actions' },
            h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, t('cancel')),
            h('button', { class: 'btn btn-primary', type: 'submit' }, t('save'))
          )
        );
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          try {
            await api(`/groups/${group.id}/profile`, { method: 'PATCH', body: formValues(form) });
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

  // The group itself (name, hours) lives in the portal's table, so it is
  // created through the portal API; the profile is then saved here.
  function newGroupForm(refresh) {
    const settings = window.SETTINGS || {};
    modal({
      title: t('newGroup'),
      body: (dialog) => {
        const schedule = scheduleEditor([{ weekday: 0, startTime: '17:00', durationMinutes: 60 }]);
        let createdId = '';
        const form = h('form', { class: 'form form-3' },
          field(t('groupNameHe'), input('nameHe', '', { required: true })),
          field(t('groupNameEn'), input('nameEn', '')),
          field(t('zoomLink'), input('zoomLink', '')),
          field(t('groupSchedule'), schedule, { full: true }),
          field(t('groupStatus'), enumSelect('status', window.VOCAB.groupStatuses, 'groupStatus', 'forming')),
          field(t('language'), enumSelect('language', window.VOCAB.languages, 'lang', 'he')),
          field(t('level'), enumSelect('level', window.VOCAB.levels, 'level', '', { blank: '—' })),
          field(t('minAge'), h('input', { name: 'minAge', type: 'number', min: 3, max: 99 })),
          field(t('maxAge'), h('input', { name: 'maxAge', type: 'number', min: 3, max: 99 })),
          field(t('teacher'), teacherSelect('teacher', window.APP.teachers.length === 1 ? window.APP.teachers[0].name : '')),
          h('div', { class: 'form-actions' },
            h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, t('cancel')),
            h('button', { class: 'btn btn-primary', type: 'submit' }, t('save'))
          )
        );
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const values = formValues(form);
          // The schedule rows' own inputs are read by the editor, not sent as profile fields.
          const { nameHe, nameEn, zoomLink, weekday, startTime, durationMinutes, ...profile } = values;
          const submit = form.querySelector('[type=submit]');
          form.querySelector('.form-error')?.remove();
          // Without rows (or with a blank time) the portal quietly falls back to Monday 17:00.
          const rows = schedule.read();
          if (!rows.length || rows.some((row) => !row.startTime)) {
            form.prepend(errorBox(t('scheduleRequired')));
            return;
          }
          submit.disabled = true;
          try {
            // Once the group exists, a retry updates it with the current form instead of creating it again.
            const group = { title: { he: nameHe, en: nameEn || nameHe }, zoomLink, schedule: { timezone: settings.businessTimezone || 'Asia/Jerusalem', rows } };
            if (createdId) await api(`/groups/${createdId}`, { root: '/api', method: 'PATCH', body: group });
            else createdId = (await api('/groups', { root: '/api', method: 'POST', body: group })).group.id;
            await api(`/groups/${createdId}/profile`, { method: 'PATCH', body: profile });
            toast(t('groupCreated'), 'success');
            dialog.close();
            location.hash = `#/groups/${createdId}`;
          } catch (error) {
            submit.disabled = false;
            form.querySelector('.form-error')?.remove();
            form.prepend(errorBox(error.message));
          }
        });
        return form;
      }
    });
  }

  function addDialog(group, candidates, refresh) {
    modal({
      title: `${t('addStudentToGroup')}: ${group.name}`,
      size: 'modal-sm',
      body: (dialog) => {
        if (!candidates.length) return empty(t('noStudents'));
        const picker = select('studentId', candidates.map((student) => [student.id, `${student.name}${student.groupName ? ` (${student.groupName})` : ''} · ${t(`status.${student.status}`)}`]));
        return h('div', { class: 'stack' },
          field(t('pickStudent'), picker),
          h('div', { class: 'form-actions' },
            h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, t('cancel')),
            h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
              const student = candidates.find((entry) => entry.id === picker.value);
              const body = { groupId: group.id };
              if (student.status === 'waitlist') body.status = 'active';
              if (student.lessonType === 'private') body.lessonType = 'both';
              await api(`/students/${picker.value}`, { method: 'PATCH', body });
              toast(t('saved'), 'success');
              dialog.close();
              refresh();
            } }, t('add'))
          )
        );
      }
    });
  }

  function moveDialog(student, fromGroup, refresh) {
    modal({
      title: `${t('moveToGroup')}: ${student.name}`,
      size: 'modal-sm',
      body: (dialog) => {
        const options = window.APP.groups.filter((group) => group.id !== fromGroup.id).map((group) => [group.id, `${group.name} (${group.studentCount}/${group.seatsTotal})`]);
        const picker = select('groupId', [['', t('noGroup')], ...options]);
        return h('div', { class: 'stack' },
          field(t('pickGroup'), picker),
          h('div', { class: 'form-actions' },
            h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, t('cancel')),
            h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
              await api(`/students/${student.id}`, { method: 'PATCH', body: { groupId: picker.value } });
              toast(t('saved'), 'success');
              dialog.close();
              refresh();
            } }, t('save'))
          )
        );
      }
    });
  }

  // ----------------------------------------------------------- matching
  async function matchTool(query) {
    const results = h('div');
    const suggestions = h('div');
    const days = weekdayPicker([]);
    const form = h('form', { class: 'form form-3' },
      field(t('age'), h('input', { name: 'age', type: 'number', min: 3, max: 99, value: query.age || '' })),
      field(t('rating'), h('input', { name: 'rating', type: 'number', min: 0, max: 4000, value: query.rating || '' })),
      field(t('level'), enumSelect('level', window.VOCAB.levels, 'level', query.level || '', { blank: '—' })),
      field(t('language'), enumSelect('language', window.VOCAB.languages, 'lang', query.language || 'he')),
      field(t('availability'), days, { full: true }),
      h('div', { class: 'form-actions' }, h('button', { class: 'btn btn-primary', type: 'submit' }, t('runMatch')))
    );
    const run = async () => {
      const values = formValues(form);
      values.availability = days.read();
      if (query.studentId) values.excludeStudentId = query.studentId;
      const data = await api('/groups/match', { method: 'POST', body: values });
      window.UI.clear(results).append(renderMatches(data.matches));
      window.UI.clear(suggestions).append(renderSuggestions(data.suggestions));
    };
    // User-triggered reloads report failures as a toast; the first load
    // below stays unguarded so the router can show sign-in or an error page.
    const rerun = window.UI.guard(run);
    form.addEventListener('submit', (event) => { event.preventDefault(); rerun(); });
    await run();
    return h('div', null,
      h('div', { class: 'breadcrumb' }, link('#/groups', t('navGroups')), '›', t('matchTitle')),
      window.UI.pageHead(t('matchTitle'), t('matchSub')),
      h('div', { class: 'grid grid-2' },
        h('div', { class: 'stack' }, card(null, form), card(t('matchResults'), results)),
        card(t('newGroupCandidates'), suggestions, { sub: t('candidatesSub') })
      )
    );
  }

  function renderMatches(matches) {
    if (!matches.length) return empty(t('noMatch'));
    return h('div', { class: 'list' }, matches.map((match) => h('div', { class: 'list-item', style: { alignItems: 'flex-start' } },
      h('div', { class: 'match-score' }, match.score),
      h('div', { class: 'list-main' },
        h('div', { class: 'list-title' }, link(`#/groups/${match.groupId}`, match.name), match.recommended ? h('span', { class: 'badge badge-sage' }, t('recommended')) : null, h('span', { class: match.seatsFree ? 'badge badge-gold' : 'badge badge-danger' }, match.seatsFree ? `${match.seatsFree} ${t('seatsFree')}` : t('full'))),
        h('div', { class: 'list-sub' }, scheduleText(match.schedule)),
        h('div', { class: 'chips', style: { marginTop: '6px' } },
          match.reasons.map((reason) => h('span', { class: 'chip', style: { borderColor: 'rgba(122,143,110,0.5)' } }, `✓ ${t(`reason.${reason}`)}`)),
          match.problems.map((problem) => h('span', { class: 'chip', style: { borderColor: 'rgba(180,68,58,0.5)', color: 'var(--danger)' } }, `✕ ${t(`problem.${problem}`)}`))
        )
      )
    )));
  }

  function renderSuggestions(buckets) {
    if (!buckets.length) return empty(t('none'));
    return h('div', { class: 'list' }, buckets.map((bucket) => h('div', { class: 'list-item', style: { alignItems: 'flex-start' } },
      h('div', { class: 'list-main' },
        h('div', { class: 'list-title' }, `${t(`lang.${bucket.language}`)} · ${t('age')} ${bucket.ageBand} · ${bucket.levelBand === 'any' ? t('all') : t(`level.${bucket.levelBand}`)}`, h('span', { class: `badge ${bucket.ready ? 'badge-sage' : 'badge-warn'}` }, bucket.ready ? t('readyToOpen') : t('almostReady'))),
        h('div', { class: 'list-sub' }, bucket.members.map((member) => member.type === 'student' ? link(`#/students/${member.id}`, member.name) : link(`#/leads/${member.id}`, member.name)).flatMap((node, index) => index ? [', ', node] : [node]))
      ),
      h('span', { class: 'match-score' }, bucket.members.length)
    )));
  }
})();
