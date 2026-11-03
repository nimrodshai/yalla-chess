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
        ? h('div', { class: 'teacher-grid' }, teachers.map((teacher) => teacherCard(teacher, refresh)),
          h('button', { class: 'teacher-add', type: 'button', onclick: add }, h('span', { class: 'teacher-add-plus' }, '+'), t('newTeacher')))
        : h('div', { class: 'card teacher-empty' },
          h('div', { class: 'teacher-empty-icon' }, '🎓'),
          h('p', null, t('noTeachers')),
          h('button', { class: 'btn btn-primary', type: 'button', onclick: add }, `+ ${t('newTeacher')}`))
    );
  };

  function teacherCard(teacher, refresh) {
    const groups = window.APP.groups.filter((group) => group.profile.teacher === teacher.name);
    const isSignature = window.SETTINGS.teacherName === teacher.name;
    const remove = async () => {
      if (!(await confirmDialog(t('confirmDeleteTeacher', { name: teacher.name, groups: teacher.groupCount, students: teacher.studentCount })))) return;
      await api(`/teachers/${teacher.id}`, { method: 'DELETE' });
      toast(t('teacherRemoved'));
      refresh();
    };
    const contact = [
      teacher.phone ? h('a', { class: 'teacher-contact', href: `https://wa.me/${teacher.phone.replace(/\D/g, '')}`, target: '_blank', rel: 'noopener' }, h('span', { 'aria-hidden': 'true' }, '💬'), h('span', { dir: 'ltr' }, fmtPhone(teacher.phone))) : null,
      teacher.email ? h('a', { class: 'teacher-contact', href: `mailto:${teacher.email}` }, h('span', { 'aria-hidden': 'true' }, '✉️'), h('span', { dir: 'ltr' }, teacher.email)) : null
    ].filter(Boolean);
    return h('div', { class: 'card teacher-card' },
      h('div', { class: 'teacher-head' },
        h('span', { class: 'avatar ink teacher-avatar' }, initials(teacher.name)),
        h('div', { class: 'teacher-id' },
          h('div', { class: 'teacher-name' }, teacher.name),
          isSignature ? h('span', { class: 'badge badge-gold' }, t('signatureTeacher')) : null
        ),
        h('div', { class: 'teacher-actions' },
          h('button', { class: 'btn btn-xs btn-ghost', type: 'button', onclick: () => teacherForm(teacher, refresh) }, t('edit')),
          h('button', { class: 'btn btn-xs btn-ghost teacher-delete', type: 'button', onclick: remove }, t('delete'))
        )
      ),
      h('div', { class: 'teacher-stats' },
        h('div', { class: 'teacher-stat' }, h('span', { class: 'teacher-stat-value' }, teacher.groupCount), h('span', { class: 'teacher-stat-label' }, t('teacherGroups'))),
        h('div', { class: 'teacher-stat' }, h('span', { class: 'teacher-stat-value' }, teacher.studentCount), h('span', { class: 'teacher-stat-label' }, t('teacherStudents')))
      ),
      groups.length
        ? h('div', { class: 'chips' }, groups.map((group) => h('a', { class: 'chip teacher-group', href: `#/groups/${group.id}` }, group.name)))
        : h('div', { class: 'muted small' }, t('teacherNoGroups')),
      h('div', { class: 'teacher-foot' },
        contact.length ? contact : h('button', { class: 'teacher-contact teacher-contact-empty', type: 'button', onclick: () => teacherForm(teacher, refresh) }, `+ ${t('addContact')}`),
        teacher.notes ? h('p', { class: 'teacher-notes' }, teacher.notes) : null
      )
    );
  }

  function teacherForm(teacher, refresh) {
    modal({
      title: teacher ? `${t('editTeacher')}: ${teacher.name}` : t('newTeacher'),
      body: (dialog) => {
        const form = h('form', { class: 'form' },
          field(t('name'), input('name', teacher?.name || '', { required: true, maxlength: 120 })),
          field(t('phone'), phoneInput('phone', teacher?.phone || ''), { hint: t('teacherPhoneHint') }),
          field(t('email'), input('email', teacher?.email || '', { type: 'email', dir: 'ltr' })),
          field(t('notes'), textarea('notes', teacher?.notes || '', { rows: 3 }), { full: true }),
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
