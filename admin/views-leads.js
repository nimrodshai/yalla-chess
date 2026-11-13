// Leads: people interested in lessons. A lead is either still interested or
// becomes a student; one that goes nowhere is deleted. No stages to track.
(function () {
  'use strict';
  window.VIEWS = window.VIEWS || {};
  const { h, api, t, card, empty, fmtDate, link, modal, field, input, textarea, enumSelect, formValues, errorBox, toast, composeMessage, confirmDialog, scheduleText, availabilityEditor, availabilityText } = window.UI;

  window.VIEWS.leads = async ({ id, query, refresh }) => {
    if (id) return leadDetail(id, refresh);
    if (query.new) setTimeout(() => leadForm({ onSaved: (lead) => { location.hash = `#/leads/${lead.id}`; } }), 0);
    return leadList(refresh);
  };

  const leadName = (lead) => lead.childName || lead.parentName || lead.parentPhone;

  async function convert(lead) {
    if (!(await confirmDialog(t('convertConfirm', { name: leadName(lead) }), { danger: false, okLabel: t('convert') }))) return;
    const response = await api(`/leads/${lead.id}/convert`, { method: 'POST', body: {} });
    toast(t('converted'), 'success');
    location.hash = `#/students/${response.student.id}`;
  }

  async function remove(lead, after) {
    if (!(await confirmDialog(t('confirmDeleteLead', { name: leadName(lead) })))) return;
    await api(`/leads/${lead.id}`, { method: 'DELETE' });
    toast(t('deleted'));
    after();
  }

  // The group the server suggests for this prospect, or why there is none.
  function suggestionCell(suggestion) {
    const group = suggestion?.group;
    if (!group) return h('span', { class: 'muted small' }, t(`suggestion.${suggestion?.reason || 'none_fits'}`));
    const name = window.I18N.lang === 'he' ? group.name : group.nameEn || group.name;
    return h('div', null,
      h('a', { class: 'link strong', href: `#/groups/${group.id}`, onclick: (event) => event.stopPropagation() }, name),
      h('div', { class: 'muted tiny' }, t('seatsFreeCount', { n: group.seatsFree }))
    );
  }

  async function leadList(refresh) {
    const leads = (await api('/leads')).leads.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const addLead = () => leadForm({ onSaved: (lead) => { location.hash = `#/leads/${lead.id}`; } });
    // Returns the handler's promise so a failure surfaces as a toast.
    const stop = (fn) => (event) => { event.stopPropagation(); return fn(); };
    return h('div', null,
      window.UI.pageHead(t('leadsTitle'), t('leadsCount', { n: leads.length }), [
        h('button', { class: 'btn btn-primary', type: 'button', onclick: addLead }, `+ ${t('newLead')}`)
      ]),
      h('div', { class: 'card' }, leads.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, h('th', null, t('childName')), h('th', null, t('parent')), h('th', null, t('age')), h('th', null, t('preference')), h('th', null, t('suggestedGroup')), h('th', null, t('date')), h('th', null, ''))),
        h('tbody', null, leads.map((lead) => h('tr', { class: 'clickable', onclick: () => { location.hash = `#/leads/${lead.id}`; } },
          h('td', { class: 'strong' }, lead.childName || '—'),
          h('td', null, lead.parentName, h('div', { class: 'muted tiny', dir: 'ltr' }, lead.parentPhone)),
          h('td', null, lead.childAge ?? ''),
          h('td', null, t(`pref.${lead.preference}`)),
          h('td', null, suggestionCell(lead.suggestedGroup)),
          h('td', { class: 'muted small' }, fmtDate(lead.createdAt.slice(0, 10))),
          h('td', null, h('div', { class: 'row', style: { gap: '6px', justifyContent: 'flex-end' } },
            lead.parentPhone ? h('button', { class: 'btn btn-xs btn-wa', type: 'button', onclick: stop(() => composeMessage({ kind: 'followup', leadId: lead.id, name: lead.parentName, onSent: refresh })) }, t('whatsapp')) : null,
            h('button', { class: 'btn btn-xs btn-gold', type: 'button', onclick: stop(() => convert(lead)) }, t('convert'))
          ))
        )))
      )) : h('div', { class: 'empty' }, t('noLeads'), h('div', { style: { marginTop: '10px' } }, h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: addLead }, `+ ${t('newLead')}`))))
    );
  }

  async function leadDetail(id, refresh) {
    const data = await api(`/leads/${id}`);
    const lead = data.lead;
    // A converted lead lives on as a student.
    if (lead.status === 'converted' && lead.convertedStudentId) {
      location.replace(`#/students/${lead.convertedStudentId}`);
      return h('div');
    }
    const name = leadName(lead);
    const detail = (label, value) => value ? h('div', { class: 'detail' }, h('dt', null, label), h('dd', null, value)) : null;

    const head = h('div', { class: 'card' }, h('div', { class: 'row-between' },
      h('div', { class: 'profile-head' },
        h('span', { class: 'avatar ink' }, window.UI.initials(name)),
        h('div', null,
          h('div', { class: 'profile-name' }, name),
          h('div', { class: 'profile-meta' },
            h('span', { class: 'badge badge-gold' }, t('leadBadge')),
            lead.childAge ? h('span', { class: 'badge' }, `${t('age')} ${lead.childAge}`) : null,
            lead.level ? h('span', { class: 'badge' }, t(`level.${lead.level}`)) : null,
            lead.chesscomRating ? h('span', { class: 'badge badge-gold' }, `Chess.com ${lead.chesscomRating}`) : null,
            lead.lichessRating ? h('span', { class: 'badge badge-gold' }, `Lichess ${lead.lichessRating}`) : null,
            h('span', { class: 'badge' }, t(`lang.${lead.language}`)),
            h('span', { class: 'badge' }, t(`pref.${lead.preference}`))
          )
        )
      ),
      h('div', { class: 'row' },
        lead.parentPhone ? h('button', { class: 'btn btn-wa', type: 'button', onclick: () => composeMessage({ kind: 'followup', leadId: lead.id, name: lead.parentName, onSent: refresh }) }, t('whatsapp')) : null,
        h('button', { class: 'btn', type: 'button', onclick: () => leadForm({ lead, onSaved: refresh }) }, t('edit')),
        h('button', { class: 'btn btn-gold', type: 'button', onclick: () => convert(lead) }, t('convert'))
      )
    ));

    const details = card(t('details'), h('dl', { class: 'detail-grid' },
      detail(t('parentName'), lead.parentName),
      detail(t('whatsapp'), lead.parentPhone ? h('a', { href: `https://wa.me/${lead.parentPhone.replace(/\D/g, '')}`, target: '_blank', rel: 'noopener', dir: 'ltr' }, lead.parentPhone) : ''),
      detail(t('email'), lead.parentEmail),
      detail(t('country'), [window.VIEWS.countryName(lead.country), lead.region].filter(Boolean).join(' · ')),
      detail(t('timezone'), lead.timezone),
      detail(t('whenFree'), availabilityText(lead.availability)),
      detail(t('date'), fmtDate(lead.createdAt.slice(0, 10), { year: 'numeric' })),
      detail(t('source'), window.VIEWS.sourceLabel(lead)),
      lead.notes ? h('div', { class: 'detail', style: { gridColumn: '1 / -1' } }, h('dt', null, t('notes')), h('dd', { class: 'pre' }, lead.notes)) : null
    ));

    // Where this child could go: groups that fit, the ones with room first.
    // A group that meets when the family said they cannot is left out, even
    // when it is only part of the lesson that falls outside their hours.
    const clashes = (match) => match.problems.includes('availability') || match.problems.includes('availability_partial');
    const openings = data.matches.filter((match) => match.seatsFree && !clashes(match)).slice(0, 5);
    const ruledOut = data.matches.filter((match) => match.seatsFree && clashes(match)).length;
    const matches = card(t('groupsWithRoom'), openings.length ? h('div', { class: 'list' }, openings.map((match) => h('div', { class: 'list-item' },
      h('div', { class: 'list-main' },
        h('div', { class: 'list-title' }, link(`#/groups/${match.groupId}`, match.name)),
        h('div', { class: 'list-sub' }, scheduleText(match.schedule)),
        // A family in another zone reads the hour in their own.
        match.localSchedule?.length ? h('div', { class: 'list-sub' }, `${t('familyTime')}: ${scheduleText(match.localSchedule)}`) : null
      ),
      h('span', { class: 'badge badge-gold' }, t('seatsFreeCount', { n: match.seatsFree }))
    ))) : empty(t('noMatch')), { sub: ruledOut ? t('ruledOutByAvailability', { n: ruledOut }) : '' });

    return h('div', null,
      h('div', { class: 'breadcrumb' }, link('#/leads', t('navLeads')), '›', name),
      head,
      h('div', { class: 'grid grid-2', style: { marginTop: '16px' } },
        h('div', { class: 'stack' }, details,
          h('div', { class: 'row' }, h('button', { class: 'btn btn-danger btn-sm', type: 'button', onclick: () => remove(lead, () => { location.hash = '#/leads'; }) }, t('deleteLead')))
        ),
        h('div', { class: 'stack' }, matches)
      )
    );
  }

  // A new lead being typed in is kept in this browser as it is typed, so the
  // dialog can be closed to look something up and opened again where it was
  // left. Saving or Cancel drops it, and it is forgotten after two hours.
  const DRAFT_KEY = 'yallaChessLeadDraft';
  const DRAFT_TTL_MS = 2 * 60 * 60 * 1000;
  const readDraft = () => {
    try {
      const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
      if (draft && Date.now() - draft.savedAt < DRAFT_TTL_MS) return draft;
      localStorage.removeItem(DRAFT_KEY);
    } catch (error) { /* ignore */ }
    return null;
  };
  const writeDraft = (values) => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ values, savedAt: Date.now() })); } catch (error) { /* ignore */ }
  };
  const dropDraft = () => {
    try { localStorage.removeItem(DRAFT_KEY); } catch (error) { /* ignore */ }
  };

  function leadForm({ lead = null, onSaved }) {
    const draft = lead ? null : readDraft();
    const l = lead || { language: 'he', preference: 'either', ...(draft?.values || {}) };
    modal({
      title: lead ? t('editLead') : t('newLead'),
      body: (dialog) => {
        const availability = availabilityEditor(l.availability || []);
        const form = h('form', { class: 'form' },
          field(t('parentFirstName'), input('parentFirstName', l.parentFirstName || '', { required: !l.childName })),
          field(t('parentLastName'), input('parentLastName', l.parentLastName || '')),
          field(t('parentPhone'), input('parentPhone', l.parentPhone || '', { dir: 'ltr', placeholder: '050-1234567', inputmode: 'tel' })),
          field(t('parentEmail'), input('parentEmail', l.parentEmail || '', { type: 'email', dir: 'ltr' })),
          field(t('childName'), input('childName', l.childName || '')),
          field(t('childAge'), h('input', { name: 'childAge', type: 'number', min: 3, max: 99, value: l.childAge ?? '' })),
          field(t('sex'), enumSelect('childSex', window.VOCAB.sexes, 'sex', l.childSex || '', { blank: '—' })),
          field(t('level'), enumSelect('level', window.VOCAB.levels, 'level', l.level || '', { blank: '—' })),
          field(t('rating'), h('input', { name: 'chesscomRating', type: 'number', min: 0, max: 4000, value: l.chesscomRating ?? '', inputmode: 'numeric' })),
          field(t('lichessRating'), h('input', { name: 'lichessRating', type: 'number', min: 0, max: 4000, value: l.lichessRating ?? '', inputmode: 'numeric' })),
          field(t('language'), enumSelect('language', window.VOCAB.languages, 'lang', l.language)),
          field(t('preference'), enumSelect('preference', window.VOCAB.leadPreferences, 'pref', l.preference)),
          ...window.VIEWS.countryFields(l),
          field(t('timezone'), window.UI.timezoneSelect('timezone', l.timezone || '', { blank: '—' })),
          field(t('whenFree'), availability, { full: true, hint: t('availabilityHint') }),
          ...window.VIEWS.sourceFields(l),
          field(t('notes'), textarea('notes', l.notes || '', { rows: 3 }), { full: true }),
          h('div', { class: 'form-actions' },
            h('button', { class: 'btn', type: 'button', onclick: () => { if (!lead) dropDraft(); dialog.close(); } }, t('cancel')),
            h('button', { class: 'btn btn-primary', type: 'submit' }, t('save'))
          )
        );
        // The availability rows' own inputs are read by the editor, not sent
        // as lead fields.
        const leadValues = () => {
          const { weekday, startTime, endTime, ...values } = formValues(form);
          return { ...values, availability: availability.read() };
        };
        if (!lead) {
          const keepDraft = () => { if (form.isConnected) writeDraft(leadValues()); };
          form.addEventListener('input', keepDraft);
          form.addEventListener('change', keepDraft);
        }
        if (draft) form.prepend(h('div', { class: 'row-between draft-note', style: { gridColumn: '1 / -1' } },
          h('span', null, t('draftRestored')),
          h('button', { class: 'btn btn-xs btn-ghost', type: 'button', onclick: () => {
            dropDraft();
            dialog.close();
            leadForm({ lead, onSaved });
          } }, t('draftStartOver'))
        ));
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          try {
            const body = leadValues();
            const response = lead ? await api(`/leads/${lead.id}`, { method: 'PATCH', body }) : await api('/leads', { method: 'POST', body });
            if (!lead) dropDraft();
            toast(t('saved'), 'success');
            dialog.close();
            if (onSaved) onSaved(response.lead);
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
