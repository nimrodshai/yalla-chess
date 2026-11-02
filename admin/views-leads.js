// Prospects: pipeline board, list, detail with matching groups, trial
// scheduling, follow-up messages and conversion into a student.
(function () {
  'use strict';
  window.VIEWS = window.VIEWS || {};
  const { h, api, t, card, empty, fmtDate, fmtDateTime, fmtMoney, statusBadge, link, modal, field, input, textarea, select, enumSelect, formValues, errorBox, toast, todayIso, composeMessage, confirmDialog, scheduleText } = window.UI;

  window.VIEWS.leads = async ({ id, query, refresh }) => {
    if (id) return leadDetail(id, refresh);
    if (query.new) setTimeout(() => leadForm({ onSaved: (lead) => { location.hash = `#/leads/${lead.id}`; } }), 0);
    return leadBoard(query, refresh);
  };

  const today = () => todayIso(window.SETTINGS.businessTimezone);

  function needsFollowup(lead) {
    if (['converted', 'lost'].includes(lead.status)) return false;
    if (lead.nextFollowupAt && lead.nextFollowupAt <= today()) return true;
    if (lead.status === 'new') return true;
    if (lead.status === 'trial_done' && !lead.nextFollowupAt) return true;
    return false;
  }

  async function leadBoard(query, refresh) {
    const mode = query.mode === 'list' ? 'list' : 'pipeline';
    const data = await api('/leads');
    const leads = data.leads;
    const open = leads.filter((lead) => !['converted', 'lost'].includes(lead.status));
    const head = window.UI.pageHead(t('leadsTitle'), t('leadsSub'), [
      h('div', { class: 'seg' },
        h('a', { class: `btn btn-ghost btn-sm ${mode === 'pipeline' ? 'active' : ''}`, href: '#/leads' }, t('pipeline')),
        h('a', { class: `btn btn-ghost btn-sm ${mode === 'list' ? 'active' : ''}`, href: '#/leads?mode=list' }, t('listView'))
      ),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => leadForm({ onSaved: (lead) => { location.hash = `#/leads/${lead.id}`; } }) }, `+ ${t('newLead')}`)
    ]);

    const stats = h('div', { class: 'stats' },
      window.UI.stat(t('statLeads'), open.length),
      window.UI.stat(t('needsFollowup'), open.filter(needsFollowup).length, { tone: 'warn' }),
      window.UI.stat(t('lead.trial_scheduled'), leads.filter((lead) => lead.status === 'trial_scheduled').length, { tone: 'gold' }),
      window.UI.stat(t('lead.waiting_group'), leads.filter((lead) => lead.status === 'waiting_group').length),
      window.UI.stat(t('lead.converted'), leads.filter((lead) => lead.status === 'converted').length, { tone: 'sage' })
    );

    const cardNode = (lead) => h('div', { class: `pipe-card ${needsFollowup(lead) ? 'overdue' : ''}`, onclick: () => { location.hash = `#/leads/${lead.id}`; } },
      h('div', { class: 'pipe-card-title' }, lead.childName || lead.parentName),
      h('div', { class: 'pipe-card-sub' }, [lead.parentName, lead.childAge ? `${t('age')} ${lead.childAge}` : '', lead.level ? t(`level.${lead.level}`) : '', t(`lang.${lead.language}`)].filter(Boolean).join(' · ')),
      h('div', { class: 'pipe-card-sub' }, [lead.trialAt && lead.status === 'trial_scheduled' ? `${t('trialAt')}: ${fmtDateTime(lead.trialAt, window.SETTINGS.businessTimezone)}` : '', lead.nextFollowupAt ? `${t('nextFollowupAt')} ${fmtDate(lead.nextFollowupAt)}` : '', lead.source ? t(`source.${lead.source}`) : ''].filter(Boolean).join(' · '))
    );

    let body;
    if (mode === 'pipeline') {
      body = h('div', { class: 'pipeline' }, window.VOCAB.leadStatuses.map((status) => {
        const column = leads.filter((lead) => lead.status === status);
        return h('div', { class: 'pipe-col' },
          h('div', { class: 'pipe-head' }, h('span', null, t(`lead.${status}`)), h('span', { class: 'badge' }, column.length)),
          column.length ? column.map(cardNode) : h('div', { class: 'muted tiny', style: { padding: '6px' } }, '—')
        );
      }));
    } else {
      body = h('div', { class: 'card' }, leads.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, h('th', null, t('childName')), h('th', null, t('parent')), h('th', null, t('age')), h('th', null, t('level')), h('th', null, t('preference')), h('th', null, t('source')), h('th', null, t('status')), h('th', null, t('nextFollowupAt')))),
        h('tbody', null, leads.map((lead) => h('tr', { class: 'clickable', onclick: () => { location.hash = `#/leads/${lead.id}`; } },
          h('td', { class: 'strong' }, lead.childName || '—'),
          h('td', null, lead.parentName, h('div', { class: 'muted tiny', dir: 'ltr' }, lead.parentPhone)),
          h('td', null, lead.childAge ?? ''),
          h('td', null, lead.level ? t(`level.${lead.level}`) : ''),
          h('td', null, t(`pref.${lead.preference}`)),
          h('td', null, t(`source.${lead.source || 'other'}`)),
          h('td', null, statusBadge(lead.status, 'lead')),
          h('td', null, lead.nextFollowupAt ? fmtDate(lead.nextFollowupAt) : '')
        )))
      )) : empty(t('noLeads')));
    }
    return h('div', null, head, stats, body);
  }

  async function leadDetail(id, refresh) {
    const data = await api(`/leads/${id}`);
    const lead = data.lead;
    const tz = window.SETTINGS.businessTimezone;
    const name = lead.childName || lead.parentName;
    const detail = (label, value) => value ? h('div', { class: 'detail' }, h('dt', null, label), h('dd', null, value)) : null;
    const setStatus = async (status, extra = {}) => { await api(`/leads/${lead.id}`, { method: 'PATCH', body: { status, ...extra } }); toast(t('saved'), 'success'); refresh(); };

    const head = h('div', { class: 'card' }, h('div', { class: 'row-between' },
      h('div', { class: 'profile-head' },
        h('span', { class: 'avatar ink' }, window.UI.initials(name)),
        h('div', null,
          h('div', { class: 'profile-name' }, name),
          h('div', { class: 'profile-meta' },
            statusBadge(lead.status, 'lead'),
            needsFollowup(lead) ? h('span', { class: 'badge badge-danger' }, t('needsFollowup')) : null,
            lead.childAge ? h('span', { class: 'badge' }, `${t('age')} ${lead.childAge}`) : null,
            lead.level ? h('span', { class: 'badge' }, t(`level.${lead.level}`)) : null,
            h('span', { class: 'badge' }, t(`lang.${lead.language}`)),
            h('span', { class: 'badge' }, t(`pref.${lead.preference}`)),
            lead.source ? h('span', { class: 'badge badge-gold' }, t(`source.${lead.source}`)) : null
          )
        )
      ),
      h('div', { class: 'row' },
        lead.status !== 'converted' ? h('button', { class: 'btn btn-wa', type: 'button', onclick: () => composeMessage({ kind: lead.status === 'trial_scheduled' ? 'trial_invite' : 'followup', leadId: lead.id, name: lead.parentName, onSent: refresh }) }, t('whatsapp')) : null,
        lead.status !== 'converted' ? h('button', { class: 'btn', type: 'button', onclick: () => trialDialog(lead, refresh) }, t('scheduleTrial')) : null,
        lead.status !== 'converted' ? h('button', { class: 'btn btn-gold', type: 'button', onclick: async () => {
          if (!(await confirmDialog(t('convertConfirm', { name }), { danger: false, okLabel: t('convert') }))) return;
          const response = await api(`/leads/${lead.id}/convert`, { method: 'POST', body: {} });
          toast(t('converted'), 'success');
          location.hash = `#/students/${response.student.id}`;
        } }, t('convert')) : h('a', { class: 'btn btn-gold', href: `#/students/${lead.convertedStudentId}` }, t('openStudent')),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => leadForm({ lead, onSaved: refresh }) }, t('edit'))
      )
    ));

    const quickStatus = h('div', { class: 'row', style: { marginTop: '12px' } },
      h('span', { class: 'small muted' }, `${t('status')}:`),
      window.VOCAB.leadStatuses.filter((status) => status !== 'converted').map((status) => h('button', { class: `btn btn-xs ${lead.status === status ? 'btn-primary' : ''}`, type: 'button', onclick: () => setStatus(status, status === 'contacted' ? { lastContactAt: today() } : {}) }, t(`lead.${status}`)))
    );

    const details = card(t('details'), h('dl', { class: 'detail-grid' },
      detail(t('parentName'), lead.parentName),
      detail(t('whatsapp'), lead.parentPhone ? h('a', { href: `https://wa.me/${lead.parentPhone.replace(/\D/g, '')}`, target: '_blank', rel: 'noopener', dir: 'ltr' }, lead.parentPhone) : ''),
      detail(t('email'), lead.parentEmail),
      detail(t('country'), lead.country),
      detail(t('timezone'), lead.timezone),
      detail(t('rating'), lead.chesscomRating),
      detail(t('availability'), lead.availability),
      detail(t('priceQuoted'), lead.priceQuoted !== null ? fmtMoney(lead.priceQuoted, lead.currency) : ''),
      detail(t('trialAt'), lead.trialAt ? fmtDateTime(lead.trialAt, tz) : ''),
      detail(t('trialResult'), lead.trialResult),
      detail(t('lastContactAt'), fmtDate(lead.lastContactAt, { year: 'numeric' })),
      detail(t('nextFollowupAt'), fmtDate(lead.nextFollowupAt, { year: 'numeric' })),
      detail(t('date'), fmtDate(lead.createdAt.slice(0, 10), { year: 'numeric' })),
      lead.notes ? h('div', { class: 'detail', style: { gridColumn: '1 / -1' } }, h('dt', null, t('notes')), h('dd', { class: 'pre' }, lead.notes)) : null
    ));

    const matches = card(t('suggestedGroups'), data.matches.length ? h('div', { class: 'list' }, data.matches.slice(0, 5).map((match) => h('div', { class: 'list-item' },
      h('div', { class: 'match-score' }, match.score),
      h('div', { class: 'list-main' },
        h('div', { class: 'list-title' }, link(`#/groups/${match.groupId}`, match.name), match.recommended ? h('span', { class: 'badge badge-sage' }, t('recommended')) : null, h('span', { class: match.seatsFree ? 'badge badge-gold' : 'badge badge-danger' }, match.seatsFree ? `${match.seatsFree} ${t('seatsFree')}` : t('full'))),
        h('div', { class: 'list-sub' }, scheduleText(match.schedule)),
        h('div', { class: 'chips', style: { marginTop: '4px' } }, match.reasons.map((reason) => h('span', { class: 'chip' }, `✓ ${t(`reason.${reason}`)}`)), match.problems.map((problem) => h('span', { class: 'chip', style: { color: 'var(--danger)' } }, `✕ ${t(`problem.${problem}`)}`)))
      )
    ))) : empty(t('noMatch')));

    const messages = card(t('messageHistory'), data.messages.length ? h('div', { class: 'list' }, data.messages.map((message) => h('div', { class: 'list-item' },
      h('div', { class: 'list-main' },
        h('div', { class: 'list-title' }, t(`msg.${message.kind}`), h('span', { class: 'muted small' }, fmtDateTime(message.createdAt, tz))),
        h('div', { class: 'list-sub', style: { whiteSpace: 'pre-wrap' } }, message.body.slice(0, 220))
      )
    ))) : empty(t('noMessagesYet')), { count: data.messages.length });

    return h('div', null,
      h('div', { class: 'breadcrumb' }, link('#/leads', t('navLeads')), '›', name),
      head,
      quickStatus,
      h('div', { class: 'grid grid-2', style: { marginTop: '16px' } },
        h('div', { class: 'stack' }, details, messages),
        h('div', { class: 'stack' }, matches,
          h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn btn-danger btn-sm', type: 'button', onclick: async () => { if (!(await confirmDialog(t('confirmDelete')))) return; await api(`/leads/${lead.id}`, { method: 'DELETE' }); toast(t('deleted')); location.hash = '#/leads'; } }, t('delete')))
        )
      )
    );
  }

  function trialDialog(lead, refresh) {
    modal({
      title: `${t('scheduleTrial')}: ${lead.childName || lead.parentName}`,
      size: 'modal-sm',
      body: (dialog) => {
        const tz = window.SETTINGS.businessTimezone;
        const existingDate = lead.trialAt ? new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(lead.trialAt)) : today();
        const form = h('form', { class: 'form' },
          field(t('date'), h('input', { name: 'date', type: 'date', value: existingDate, required: true })),
          field(t('time'), h('input', { name: 'time', type: 'time', value: lead.trialAt ? window.UI.fmtTime(lead.trialAt, tz) : '17:00', required: true })),
          field(t('duration'), h('input', { name: 'durationMinutes', type: 'number', min: 15, max: 120, step: 5, value: 40 })),
          field(t('zoomLink'), input('zoomLink', window.SETTINGS.defaultZoomLink || '', { dir: 'ltr' })),
          h('div', { class: 'form-actions' },
            h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, t('cancel')),
            h('button', { class: 'btn btn-primary', type: 'submit' }, t('save'))
          )
        );
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const values = formValues(form);
          try {
            // The event is what shows on the calendar; the lead stores the
            // instant so messages can show it in the parent's zone.
            const response = await api('/events', { method: 'POST', body: { kind: 'trial', date: values.date, startTime: values.time, durationMinutes: values.durationMinutes, leadId: lead.id, title: `${t('kind.trial')}: ${lead.childName || lead.parentName}`, zoomLink: values.zoomLink } });
            const occurrence = (await api(`/calendar?from=${values.date}&to=${values.date}`)).occurrences.find((item) => item.eventId === response.event.id);
            await api(`/leads/${lead.id}`, { method: 'PATCH', body: { status: 'trial_scheduled', trialAt: occurrence ? occurrence.startAt : `${values.date}T${values.time}:00`, lastContactAt: today() } });
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

  function leadForm({ lead = null, onSaved }) {
    const l = lead || { status: 'new', language: 'he', preference: 'either', currency: window.SETTINGS.defaultCurrency || 'ILS', source: 'website', timezone: window.SETTINGS.businessTimezone };
    modal({
      title: lead ? t('editLead') : t('newLead'),
      body: (dialog) => {
        const form = h('form', { class: 'form form-3' },
          field(t('parentName'), input('parentName', l.parentName || '', { required: !l.childName })),
          field(t('parentPhone'), input('parentPhone', l.parentPhone || '', { dir: 'ltr', placeholder: '+972…' })),
          field(t('parentEmail'), input('parentEmail', l.parentEmail || '', { type: 'email', dir: 'ltr' })),
          field(t('childName'), input('childName', l.childName || '')),
          field(t('childAge'), h('input', { name: 'childAge', type: 'number', min: 3, max: 99, value: l.childAge ?? '' })),
          field(t('level'), enumSelect('level', window.VOCAB.levels, 'level', l.level || '', { blank: '—' })),
          field(t('rating'), h('input', { name: 'chesscomRating', type: 'number', min: 0, max: 4000, value: l.chesscomRating ?? '' })),
          field(t('language'), enumSelect('language', window.VOCAB.languages, 'lang', l.language)),
          field(t('country'), input('country', l.country || '')),
          field(t('timezone'), input('timezone', l.timezone || '', { dir: 'ltr' }), { hint: t('timezoneHint') }),
          field(t('availability'), input('availability', l.availability || '')),
          field(t('preference'), enumSelect('preference', window.VOCAB.leadPreferences, 'pref', l.preference)),
          field(t('priceQuoted'), h('input', { name: 'priceQuoted', type: 'number', step: '0.01', min: 0, value: l.priceQuoted ?? '' })),
          field(t('currency'), select('currency', window.VOCAB.currencies, l.currency)),
          field(t('source'), enumSelect('source', window.VOCAB.leadSources, 'source', l.source)),
          field(t('status'), enumSelect('status', window.VOCAB.leadStatuses, 'lead', l.status)),
          field(t('nextFollowupAt'), h('input', { name: 'nextFollowupAt', type: 'date', value: l.nextFollowupAt || '' })),
          field(t('lastContactAt'), h('input', { name: 'lastContactAt', type: 'date', value: l.lastContactAt || '' })),
          field(t('trialResult'), textarea('trialResult', l.trialResult || '', { rows: 2 }), { full: true }),
          field(t('notes'), textarea('notes', l.notes || '', { rows: 3 }), { full: true }),
          h('div', { class: 'form-actions' },
            h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, t('cancel')),
            h('button', { class: 'btn btn-primary', type: 'submit' }, t('save'))
          )
        );
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          try {
            const response = lead ? await api(`/leads/${lead.id}`, { method: 'PATCH', body: formValues(form) }) : await api('/leads', { method: 'POST', body: formValues(form) });
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
