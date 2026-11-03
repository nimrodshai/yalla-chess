// Teachers: the list groups and students pick their teacher from.
(function () {
  'use strict';
  window.VIEWS = window.VIEWS || {};
  const { h, api, t, initials, modal, field, input, phoneInput, fmtPhone, textarea, formValues, errorBox, toast, confirmDialog } = window.UI;

  window.VIEWS.teachers = async ({ refresh }) => {
    const teachers = window.APP.teachers;
    const add = () => teacherForm(null, refresh);
    return h('div', null,
      window.UI.pageHead(t('teachersTitle'), t('teachersSub'), [
        h('button', { class: 'btn btn-primary', type: 'button', onclick: add }, `+ ${t('newTeacher')}`)
      ]),
      teachers.length
        ? h('div', { class: 'card' }, h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
          h('thead', null, h('tr', null, h('th', null, t('name')), h('th', { class: 'center' }, t('phone')), h('th', { class: 'center' }, t('email')), h('th', { class: 'center' }, t('teacherGroups')), h('th', { class: 'center' }, t('teacherStudents')), h('th', null))),
          h('tbody', null, teachers.map((teacher) => teacherRow(teacher, refresh)))
        )))
        : h('div', { class: 'card teacher-empty' },
          h('div', { class: 'teacher-empty-icon' }, '🎓'),
          h('p', null, t('noTeachers')),
          h('button', { class: 'btn btn-primary', type: 'button', onclick: add }, `+ ${t('newTeacher')}`))
    );
  };

  // Clicking a row edits the teacher; links and buttons inside it do their own thing.
  function teacherRow(teacher, refresh) {
    const groups = window.APP.groups.filter((group) => group.profile.teacher === teacher.name);
    const edit = () => teacherForm(teacher, refresh);
    const stop = (event) => event.stopPropagation();
    const remove = async (event) => {
      event.stopPropagation();
      if (!(await confirmDialog(t('confirmDeleteTeacher', { name: teacher.name, groups: teacher.groupCount, students: teacher.studentCount })))) return;
      await api(`/teachers/${teacher.id}`, { method: 'DELETE' });
      toast(t('teacherRemoved'));
      refresh();
    };
    return h('tr', { class: 'clickable', onclick: edit },
      h('td', null,
        h('div', { class: 'row', style: { gap: '8px', flexWrap: 'nowrap' } },
          h('span', { class: 'avatar ink', style: { width: '30px', height: '30px', fontSize: '12px', borderRadius: '9px', flexShrink: 0 } }, initials(teacher.name)),
          h('span', { class: 'strong' }, teacher.name)
        ),
        teacher.notes ? h('div', { class: 'muted tiny teacher-notes' }, teacher.notes) : null
      ),
      h('td', { class: 'center' }, teacher.phone ? h('a', { class: 'link', href: `https://wa.me/${teacher.phone.replace(/\D/g, '')}`, target: '_blank', rel: 'noopener', dir: 'ltr', onclick: stop }, fmtPhone(teacher.phone)) : h('span', { class: 'muted' }, '—')),
      h('td', { class: 'center' }, teacher.email ? h('a', { class: 'link', href: `mailto:${teacher.email}`, dir: 'ltr', onclick: stop }, teacher.email) : h('span', { class: 'muted' }, '—')),
      h('td', { class: 'center teacher-groups' }, groups.length
        ? h('div', { class: 'chips' }, groups.map((group) => h('a', { class: 'chip teacher-group', href: `#/groups/${group.id}`, onclick: stop }, group.name)))
        : h('span', { class: 'muted small' }, t('teacherNoGroups'))),
      h('td', { class: 'center num-center' }, teacher.studentCount),
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
})();
