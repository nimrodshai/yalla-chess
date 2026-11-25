// Tournaments: the list, and each tournament's page with who registered, who
// paid, the divisions and the results. A teacher sees who plays and enters
// results; money and the tournament's settings are the admin's.
(function () {
  'use strict';
  window.VIEWS = window.VIEWS || {};
  const { h, api, t, card, empty, field, input, textarea, select, formValues, errorBox, toast, confirmDialog, modal, link, fmtDateTime, fmtMoney, stat } = window.UI;

  const STATUSES = ['draft', 'open', 'closed', 'active', 'finished'];
  const STATUS_TONES = { draft: '', open: 'badge-sage', closed: 'badge-warn', active: 'badge-gold', finished: 'badge-info' };
  const REG_TONES = { pending: 'badge-warn', confirmed: 'badge-sage', cancelled: '' };
  const SIGNUP_TONES = { new: 'badge-gold', handled: 'badge-sage', dismissed: '' };
  const DEFAULT_DIVISIONS = [{ name: 'מתחילים', nameEn: 'Beginners' }, { name: 'בינוניים', nameEn: 'Intermediate' }, { name: 'מתקדמים', nameEn: 'Advanced' }];

  const statusBadge = (status) => h('span', { class: `badge ${STATUS_TONES[status] || ''}` }, t(`tourStatus.${status}`));
  const regBadge = (status) => h('span', { class: `badge ${REG_TONES[status] || ''}` }, t(`tourRegOne.${status}`));
  const whenText = (tournament) => fmtDateTime(tournament.startsAt, window.SETTINGS.businessTimezone);
  const incomeText = (income) => Object.entries(income || {}).map(([currency, amount]) => fmtMoney(amount, currency)).join(' · ') || fmtMoney(0, 'ILS');

  // ------------------------------------------------------------- the list
  window.VIEWS.tournaments = async ({ id, refresh }) => {
    if (id === 'entries' && window.APP.isAdmin) return entriesPage();
    if (id) return detailPage(id, refresh);
    const { tournaments } = await api('/tournaments');
    const admin = window.APP.isAdmin;
    const add = () => tournamentForm(null, (saved) => window.APP.navigate(`#/tournaments/${saved.id}`));
    const rows = tournaments.map((tournament) => h('tr', { class: 'clickable', onclick: () => { location.hash = `#/tournaments/${tournament.id}`; } },
      h('td', null, h('a', { class: 'strong', href: `#/tournaments/${tournament.id}` }, tournament.name)),
      h('td', { class: 'small' }, whenText(tournament)),
      h('td', null, statusBadge(tournament.status)),
      h('td', { class: 'num' }, tournament.capacity ? `${tournament.counts.confirmed + tournament.counts.pending} / ${tournament.capacity}` : tournament.counts.confirmed + tournament.counts.pending),
      h('td', { class: 'num' }, tournament.counts.pending),
      admin ? h('td', { class: 'num' }, incomeText(tournament.income)) : null
    ));
    return h('div', null,
      window.UI.pageHead(t('tourTitle'), t('tourSub'), admin ? [h('button', { class: 'btn btn-primary', type: 'button', onclick: add }, `+ ${t('tourNew')}`)] : []),
      tournaments.length
        ? h('div', { class: 'card' }, h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
          h('thead', null, h('tr', null,
            h('th', null, t('name')), h('th', null, t('tourWhen')), h('th', null, t('status')),
            h('th', { class: 'num' }, t('tourRegistered')), h('th', { class: 'num' }, t('tourReg.pending')),
            admin ? h('th', { class: 'num' }, t('tourIncome')) : null)),
          h('tbody', null, rows))))
        : h('div', { class: 'card' }, empty(t('tourEmpty')))
    );
  };

  // ------------------------------------------------------------ all entries
  // Every child across the tournaments in one list, for the admin: who to
  // invite on Chess.com, who to call back, who still owes. A sign-up the school
  // has handled is already a registration, so by default it is left out.
  async function entriesPage() {
    const { tournaments, entries, timezone } = await api('/tournament-entries');
    const state = { tournamentId: '', show: 'current', q: '' };
    const names = new Map(tournaments.map((tournament) => [tournament.id, tournament.name]));
    const english = () => document.documentElement.lang === 'en';
    const isCurrent = (entry) => entry.source === 'signup' ? entry.status === 'new' : entry.status !== 'cancelled';
    const statusText = (entry) => entry.source === 'signup'
      ? t(`tourSignupStatus.${entry.status}`)
      : t(`tourRegOne.${entry.status}`) + (entry.paid && entry.status === 'confirmed' ? ` · ${t('tourEntriesPaid')}` : '');
    const tone = (entry) => entry.source === 'signup' ? SIGNUP_TONES[entry.status] : REG_TONES[entry.status];
    const divisionText = (entry) => (english() && entry.divisionEn) || entry.division;

    const visible = () => {
      const q = state.q.trim().toLowerCase();
      const digits = q.replace(/\D/g, '');
      return entries.filter((entry) =>
        (!state.tournamentId || entry.tournamentId === state.tournamentId)
        && (state.show === 'all' || isCurrent(entry))
        && (!q || entry.childName.toLowerCase().includes(q) || entry.parentName.toLowerCase().includes(q)
          || (digits.length >= 3 && entry.phone.replace(/\D/g, '').includes(digits))));
    };

    const statsNode = h('div', { class: 'stats' });
    const listNode = h('div');
    const draw = () => {
      const rows = visible();
      window.UI.clear(statsNode).append(
        stat(t('tourEntriesKids'), rows.length),
        stat(t('tourReg.confirmed'), rows.filter((entry) => entry.source === 'registration' && entry.status === 'confirmed').length, { tone: 'sage' }),
        stat(t('tourReg.pending'), rows.filter((entry) => entry.source === 'registration' && entry.status === 'pending').length),
        stat(t('tourEntriesFromForm'), rows.filter((entry) => entry.source === 'signup' && entry.status === 'new').length, { tone: 'gold' }));
      window.UI.clear(listNode).append(rows.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null,
          h('th', null, t('tourEntriesChild')), h('th', null, t('tourEntriesParent')), h('th', null, t('phone')),
          state.tournamentId ? null : h('th', null, t('tourEntriesTournament')),
          h('th', null, t('tourDivision')), h('th', null, t('tourEntriesSource')), h('th', null, t('status')), h('th', null, t('tourWhen')))),
        h('tbody', null, rows.map((entry) => h('tr', { class: isCurrent(entry) ? '' : 'tour-row-off' },
          h('td', { class: 'strong' }, entry.studentId ? link(`#/students/${entry.studentId}`, entry.childName) : entry.childName),
          h('td', null, entry.parentName),
          h('td', { dir: 'ltr' }, entry.phone ? h('a', { href: `tel:${entry.phone}` }, entry.phone) : ''),
          state.tournamentId ? null : h('td', null, link(`#/tournaments/${entry.tournamentId}`, names.get(entry.tournamentId) || '')),
          h('td', null, divisionText(entry)),
          h('td', { class: 'small' }, t(`tourEntriesSource.${entry.source}`)),
          h('td', null, h('span', { class: `badge ${tone(entry) || ''}` }, statusText(entry))),
          h('td', { class: 'small' }, fmtDateTime(entry.createdAt, timezone))
        )))))
        : empty(t('tourEntriesEmpty')));
    };

    // A CSV with a byte-order mark, so Excel reads the Hebrew names.
    const download = () => {
      const cell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
      const head = [t('tourEntriesChild'), t('tourEntriesParent'), t('phone'), t('tourEntriesTournament'), t('tourDivision'), t('tourEntriesSource'), t('status'), t('tourWhen')];
      const lines = visible().map((entry) => [entry.childName, entry.parentName, entry.phone, names.get(entry.tournamentId) || '', divisionText(entry),
        t(`tourEntriesSource.${entry.source}`), statusText(entry), fmtDateTime(entry.createdAt, timezone)]);
      const csv = '﻿' + [head, ...lines].map((line) => line.map(cell).join(',')).join('\r\n');
      const anchor = h('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), download: 'tournament-entries.csv' });
      document.body.append(anchor);
      anchor.click();
      setTimeout(() => { URL.revokeObjectURL(anchor.href); anchor.remove(); }, 1000);
    };

    const searchBox = h('input', { type: 'search', placeholder: t('search'), 'aria-label': t('search'), oninput: (event) => { state.q = event.target.value; draw(); } });
    const tournamentSelect = select('tournamentId', [['', t('tourEntriesAll')], ...tournaments.map((tournament) => [tournament.id, `${tournament.name} · ${whenText(tournament)}`])], '', { 'aria-label': t('tourEntriesTournament') });
    tournamentSelect.addEventListener('change', () => { state.tournamentId = tournamentSelect.value; draw(); });
    const showSelect = select('show', ['current', 'all'].map((key) => [key, t(`tourEntriesShow.${key}`)]), state.show, { 'aria-label': t('status') });
    showSelect.addEventListener('change', () => { state.show = showSelect.value; draw(); });
    draw();
    return h('div', null,
      h('div', { style: { marginBottom: '8px' } }, link('#/tournaments', `‹ ${t('tourTitle')}`)),
      window.UI.pageHead(t('tourEntries'), t('tourEntriesSub'), [h('button', { class: 'btn', type: 'button', onclick: download }, t('tourEntriesExport'))]),
      h('div', { class: 'filters' }, searchBox, tournamentSelect, showSelect),
      statsNode,
      h('div', { class: 'card' }, listNode)
    );
  }

  // ------------------------------------------------------------- the form
  function divisionEditor(divisions) {
    const list = h('div', { class: 'tour-divisions' });
    const number = (key, value, label, max) => h('input', { type: 'number', min: 0, max, value: value ?? '', 'data-key': key, placeholder: label, 'aria-label': label, inputmode: 'numeric' });
    const addRow = (division = {}) => {
      const row = h('div', { class: 'tour-division', 'data-id': division.id || '' },
        h('div', { class: 'tour-division-names' },
          h('input', { type: 'text', value: division.name || '', 'data-key': 'name', placeholder: t('tourDivisionName'), 'aria-label': t('tourDivisionName'), maxlength: 80 }),
          h('input', { type: 'text', value: division.nameEn || '', 'data-key': 'nameEn', placeholder: t('tourNameEn'), 'aria-label': t('tourNameEn'), maxlength: 80, dir: 'ltr' }),
          h('button', { class: 'btn btn-xs btn-ghost', type: 'button', onclick: () => row.remove() }, t('delete'))),
        h('div', { class: 'tour-division-ranges' },
          number('minAge', division.minAge, t('tourMinAge'), 120),
          number('maxAge', division.maxAge, t('tourMaxAge'), 120),
          number('minRating', division.minRating, t('tourMinRating'), 4000),
          number('maxRating', division.maxRating, t('tourMaxRating'), 4000)),
        h('input', { type: 'url', value: division.chesscomUrl || '', 'data-key': 'chesscomUrl', placeholder: t('tourDivisionUrl'), 'aria-label': t('tourDivisionUrl'), dir: 'ltr' })
      );
      list.append(row);
    };
    divisions.forEach(addRow);
    const node = h('div', { class: 'field full' },
      h('label', null, t('tourDivisions')),
      h('div', { class: 'hint' }, t('tourDivisionsHint')),
      list,
      h('button', { class: 'btn btn-sm', type: 'button', style: { justifySelf: 'start' }, onclick: () => addRow() }, `+ ${t('tourAddDivision')}`));
    const read = () => [...list.querySelectorAll('.tour-division')].map((row) => {
      const entry = { id: row.dataset.id };
      for (const control of row.querySelectorAll('[data-key]')) entry[control.dataset.key] = control.value.trim();
      return entry;
    }).filter((entry) => entry.name);
    return { node, read };
  }

  function tournamentForm(detail, onSaved) {
    const tournament = detail?.tournament || null;
    modal({
      title: tournament ? t('tourEdit') : t('tourNew'),
      body: (dialog) => {
        // A new tournament starts with the three levels the landing page shows.
        const divisions = divisionEditor(detail?.divisions || DEFAULT_DIVISIONS);
        const pair = (...children) => h('div', { class: 'tour-pair' }, children);
        const form = h('form', { class: 'form' },
          field(t('tourName'), input('name', tournament?.name || '', { required: true, maxlength: 120, placeholder: 'YALLA CHESS CUP #1' })),
          field(t('tourNameEn'), input('nameEn', tournament?.nameEn || '', { maxlength: 120, dir: 'ltr' })),
          pair(
            field(t('date'), input('startDate', tournament?.startDate || '', { type: 'date', required: true })),
            field(t('tourTime'), input('startTime', tournament?.startTime || '18:00', { type: 'time', required: true }))),
          h('div', { class: 'hint' }, t('tourTimeHint')),
          pair(
            field(t('tourTimeControl'), input('timeControl', tournament?.timeControl || '10+5', { dir: 'ltr', maxlength: 20 })),
            field(t('tourRounds'), h('input', { name: 'rounds', type: 'number', min: 1, max: 30, value: tournament?.rounds ?? 4 }))),
          pair(
            field(t('tourFeeIls'), h('input', { name: 'feeIls', type: 'number', min: 0, step: 'any', value: tournament?.feeIls ?? 20, required: true })),
            field(t('tourFeeUsd'), h('input', { name: 'feeUsd', type: 'number', min: 0, step: 'any', value: tournament?.feeUsd ?? 10, required: true }))),
          field(t('tourCapacity'), h('input', { name: 'capacity', type: 'number', min: 1, value: tournament?.capacity ?? '' }), { hint: t('tourCapacityHint') }),
          pair(
            field(t('tourCloseDate'), input('closeDate', tournament?.closeDate || '', { type: 'date' }), { hint: t('tourCloseHint') }),
            field(t('tourTime'), input('closeTime', tournament?.closeTime || '', { type: 'time' }))),
          field(t('tourLink'), input('chesscomUrl', tournament?.chesscomUrl || '', { type: 'url', dir: 'ltr', placeholder: 'https://www.chess.com/…' }), { hint: t('tourLinkHint') }),
          divisions.node,
          field(t('tourRules'), textarea('rules', tournament?.rules || '', { rows: 3 })),
          field(t('tourRulesEn'), textarea('rulesEn', tournament?.rulesEn || '', { rows: 3, dir: 'ltr' })),
          h('div', { class: 'form-actions' },
            h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, t('cancel')),
            h('button', { class: 'btn btn-primary', type: 'submit' }, t('save')))
        );
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          form.querySelector('.form-error')?.remove();
          try {
            const body = { ...formValues(form), divisions: divisions.read() };
            const saved = tournament
              ? await api(`/tournaments/${tournament.id}`, { method: 'PATCH', body })
              : await api('/tournaments', { method: 'POST', body });
            toast(t('saved'), 'success');
            dialog.close();
            onSaved(saved.tournament);
          } catch (error) {
            form.prepend(errorBox(error.message));
          }
        });
        return form;
      }
    });
  }

  // ------------------------------------------------------------- the page
  async function detailPage(id, refresh) {
    const detail = await api(`/tournaments/${id}`);
    const { tournament } = detail;
    const admin = window.APP.isAdmin;
    const run = async (work, message) => {
      try {
        await work();
        if (message) toast(message, 'success');
        refresh();
      } catch (error) {
        toast(error.message, 'error');
      }
    };

    const statusControl = select('status', STATUSES.map((status) => [status, t(`tourStatus.${status}`)]), tournament.status, {
      'aria-label': t('status'),
      onchange: (event) => run(() => api(`/tournaments/${id}`, { method: 'PATCH', body: { status: event.target.value } }), t('saved'))
    });
    const remove = async () => {
      if (!(await confirmDialog(t('tourDeleteConfirm', { name: tournament.name })))) return;
      try {
        await api(`/tournaments/${id}`, { method: 'DELETE' });
        toast(t('saved'));
        window.APP.navigate('#/tournaments');
      } catch (error) {
        toast(error.message, 'error');
      }
    };

    const sub = [whenText(tournament), tournament.timeControl, tournament.rounds ? t('tourRoundsCount', { n: tournament.rounds }) : ''].filter(Boolean).join(' · ');
    const head = window.UI.pageHead(tournament.name, sub, admin ? [
      statusControl,
      h('button', { class: 'btn', type: 'button', onclick: () => tournamentForm(detail, refresh) }, t('edit')),
      h('button', { class: 'btn btn-danger', type: 'button', onclick: remove }, t('delete'))
    ] : [statusBadge(tournament.status)]);

    const stats = h('div', { class: 'stats' },
      stat(t('tourReg.confirmed'), tournament.counts.confirmed, { tone: 'sage' }),
      stat(t('tourReg.pending'), tournament.counts.pending),
      stat(t('tourReg.cancelled'), tournament.counts.cancelled),
      tournament.spotsLeft !== null ? stat(t('tourSpotsLeft'), tournament.spotsLeft) : null,
      admin && tournament.newSignups ? stat(t('tourNewSignups'), tournament.newSignups, { tone: 'gold' }) : null,
      admin ? stat(t('tourIncome'), incomeText(tournament.income)) : null
    );

    const paymeNotice = admin && !detail.paymeReady && tournament.status === 'open'
      ? h('div', { class: 'alert alert-warn', style: { marginBottom: '16px' } }, t('tourPaymeWaiting'))
      : null;
    const noLink = admin && tournament.status !== 'draft' && !tournament.chesscomUrl && !detail.divisions.length
      ? h('div', { class: 'alert alert-warn', style: { marginBottom: '16px' } }, t('tourNoLink'))
      : null;

    return h('div', null,
      h('div', { style: { marginBottom: '8px' } }, link('#/tournaments', `‹ ${t('tourTitle')}`)),
      head, stats, paymeNotice, noLink,
      admin ? signupsCard(detail, run) : null,
      registrationsCard(detail, run),
      resultsCard(detail, run)
    );
  }

  function paymentCell(row) {
    if (row.status === 'cancelled') return h('span', { class: 'muted' }, '—');
    const amount = fmtMoney(row.feeAmount, row.currency);
    if (row.paidAt) {
      const method = row.paymentMethod === 'waived' ? t('tourMethod.waived') : `${amount} · ${t(`tourMethod.${row.paymentMethod}`)}`;
      return h('div', null, h('span', { class: 'small' }, method), row.invoiceUrl ? h('div', null, h('a', { class: 'link tiny', href: row.invoiceUrl, target: '_blank', rel: 'noopener' }, t('receipt'))) : null);
    }
    return h('span', { class: 'small strong' }, amount);
  }

  function settleDialog(tournamentId, row, methods, run) {
    modal({
      title: t('tourSettleTitle', { name: row.studentName }),
      size: 'modal-sm',
      body: (dialog) => {
        const method = select('paymentMethod', methods.map((value) => [value, t(`tourMethod.${value}`)]), 'bit');
        const form = h('form', { class: 'form' },
          field(t('tourSettleMethod'), method),
          h('div', { class: 'form-actions' },
            h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, t('cancel')),
            h('button', { class: 'btn btn-primary', type: 'submit' }, t('tourConfirmSeat'))));
        form.addEventListener('submit', (event) => {
          event.preventDefault();
          dialog.close();
          run(() => api(`/tournaments/${tournamentId}/registrations/${row.id}`, { method: 'PATCH', body: { settled: true, paymentMethod: method.value } }), t('saved'));
        });
        return form;
      }
    });
  }

  function addStudentsDialog(detail, run) {
    const { tournament, candidates, paymentMethods } = detail;
    modal({
      title: t('tourAddStudents'),
      size: 'modal-sm',
      body: (dialog) => {
        const picked = new Set();
        const list = h('div', { class: 'tour-pick-list' });
        const search = h('input', { type: 'search', placeholder: t('searchStudentName'), 'aria-label': t('searchStudentName') });
        const paint = () => {
          const q = search.value.trim().toLowerCase();
          list.replaceChildren(...candidates.filter((student) => !q || student.name.toLowerCase().includes(q)).map((student) => {
            const box = h('input', { type: 'checkbox', onchange: (event) => { if (event.target.checked) picked.add(student.id); else picked.delete(student.id); } });
            box.checked = picked.has(student.id);
            return h('label', { class: 'tour-pick' }, box, h('span', null, student.name),
              h('span', { class: 'muted tiny' }, [student.age ? t('tourAgeShort', { n: student.age }) : '', student.rating ? `Chess.com ${student.rating}` : ''].filter(Boolean).join(' · ')));
          }));
          if (!list.children.length) list.append(empty(t('noStudents')));
        };
        search.addEventListener('input', paint);
        paint();
        const settled = h('input', { type: 'checkbox', name: 'settled' });
        const method = select('paymentMethod', paymentMethods.map((value) => [value, t(`tourMethod.${value}`)]), 'waived');
        const form = h('form', { class: 'form' },
          search, list,
          h('div', { class: 'field field-check' }, settled, h('label', null, t('tourAddSettled'))),
          field(t('tourSettleMethod'), method),
          h('div', { class: 'form-actions' },
            h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, t('cancel')),
            h('button', { class: 'btn btn-primary', type: 'submit' }, t('tourAdd'))));
        form.addEventListener('submit', (event) => {
          event.preventDefault();
          if (!picked.size) return;
          dialog.close();
          run(() => api(`/tournaments/${tournament.id}/registrations`, { method: 'POST', body: { studentIds: [...picked], settled: settled.checked, paymentMethod: method.value } }), t('saved'));
        });
        return form;
      }
    });
  }

  // The landing page's form: a phone and children's names from anyone. The
  // school registers the children itself and then marks the sign-up handled.
  function signupsCard(detail, run) {
    const { tournament, signups } = detail;
    const order = { new: 0, handled: 1, dismissed: 2 };
    const sorted = [...signups].sort((a, b) => (order[a.status] - order[b.status]) || b.createdAt.localeCompare(a.createdAt));
    const setStatus = (row, status) => run(() => api(`/tournaments/${tournament.id}/signups/${row.id}`, { method: 'PATCH', body: { status } }), t('saved'));
    const rows = sorted.map((row) => h('tr', { class: row.status === 'new' ? '' : 'tour-row-off' },
      h('td', { class: 'small' }, fmtDateTime(row.createdAt, window.SETTINGS.businessTimezone)),
      h('td', { dir: 'ltr' }, h('a', { href: `tel:${row.phone}` }, row.phone)),
      h('td', null, row.children.join(', ')),
      h('td', { class: 'small' }, row.family.length
        ? row.family.map((student, index) => [index ? ', ' : '', link(`#/students/${student.id}`, student.name), student.registered ? ` (${t('tourSignupRegistered')})` : ''])
        : h('span', { class: 'muted' }, t('tourSignupNewFamily'))),
      h('td', null, h('span', { class: `badge ${SIGNUP_TONES[row.status] || ''}` }, t(`tourSignupStatus.${row.status}`))),
      h('td', null, h('div', { class: 'row', style: { gap: '4px', justifyContent: 'flex-end', flexWrap: 'nowrap' } },
        row.status === 'new'
          ? [h('button', { class: 'btn btn-xs', type: 'button', onclick: () => setStatus(row, 'handled') }, t('tourSignupDone')),
            h('button', { class: 'btn btn-xs btn-ghost', type: 'button', onclick: () => setStatus(row, 'dismissed') }, t('tourSignupDismiss'))]
          : h('button', { class: 'btn btn-xs btn-ghost', type: 'button', onclick: () => setStatus(row, 'new') }, t('tourRestore'))))
    ));
    return card(t('tourSignups'), signups.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', null, h('tr', null,
        h('th', null, t('tourWhen')), h('th', null, t('phone')), h('th', null, t('tourSignupChildren')),
        h('th', null, t('tourSignupFamily')), h('th', null, t('status')), h('th', null, ''))),
      h('tbody', null, rows))) : empty(t('tourNoSignups')), { count: signups.filter((row) => row.status === 'new').length, sub: t('tourSignupsSub') });
  }

  function registrationsCard(detail, run) {
    const { tournament, divisions, registrations, paymentMethods } = detail;
    const admin = window.APP.isAdmin;
    const divisionOptions = [['', t('unassigned')], ...divisions.map((division) => [division.id, division.name])];
    const divisionName = (id) => divisions.find((division) => division.id === id)?.name || t('unassigned');
    const patch = (row, body, message) => run(() => api(`/tournaments/${tournament.id}/registrations/${row.id}`, { method: 'PATCH', body }), message);

    const rows = registrations.map((row) => h('tr', { class: row.status === 'cancelled' ? 'tour-row-off' : '' },
      h('td', null, link(`#/students/${row.studentId}`, row.studentName),
        admin && row.parentPhone ? h('div', { class: 'muted tiny', dir: 'ltr' }, row.parentPhone) : null),
      h('td', { class: 'num' }, row.age ?? '—'),
      h('td', { class: 'num' }, row.rating ?? '—'),
      h('td', { class: 'small', dir: 'ltr' }, row.chesscomUsername || h('span', { class: 'badge badge-warn' }, t('tourNoUsername'))),
      divisions.length ? h('td', null, admin && row.status !== 'cancelled'
        ? select('divisionId', divisionOptions, row.divisionId, { 'aria-label': t('tourDivision'), onchange: (event) => patch(row, { divisionId: event.target.value }, t('saved')) })
        : divisionName(row.divisionId)) : null,
      h('td', null, regBadge(row.status)),
      admin ? h('td', null, paymentCell(row)) : null,
      admin ? h('td', null, h('div', { class: 'row', style: { gap: '4px', justifyContent: 'flex-end', flexWrap: 'nowrap' } },
        row.status === 'pending' ? h('button', { class: 'btn btn-xs', type: 'button', onclick: () => settleDialog(tournament.id, row, paymentMethods, run) }, t('tourMarkPaid')) : null,
        row.status === 'cancelled'
          ? h('button', { class: 'btn btn-xs btn-ghost', type: 'button', onclick: () => patch(row, { status: row.paidAt ? 'confirmed' : 'pending' }, t('saved')) }, t('tourRestore'))
          : h('button', { class: 'btn btn-xs btn-ghost', type: 'button', onclick: async () => {
            if (await confirmDialog(row.paidAt ? t('tourCancelPaidConfirm', { name: row.studentName }) : t('tourCancelConfirm', { name: row.studentName }))) patch(row, { status: 'cancelled' }, t('saved'));
          } }, t('cancel'))
      )) : null
    ));

    const unplaced = registrations.some((row) => row.status !== 'cancelled' && !row.divisionId && row.suggestedDivisionId);
    const actions = admin ? [
      divisions.length && unplaced ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => run(() => api(`/tournaments/${tournament.id}/assign`, { method: 'POST', body: {} }), t('saved')) }, t('tourAutoAssign')) : null,
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => addStudentsDialog(detail, run) }, `+ ${t('tourAddStudents')}`)
    ].filter(Boolean) : [];

    return card(t('tourRegistrations'), registrations.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', null, h('tr', null,
        h('th', null, t('student')), h('th', { class: 'num' }, t('age')), h('th', { class: 'num' }, t('rating')), h('th', null, 'Chess.com'),
        divisions.length ? h('th', null, t('tourDivision')) : null,
        h('th', null, t('status')),
        admin ? h('th', null, t('tourPayment')) : null,
        admin ? h('th', null, '') : null)),
      h('tbody', null, rows))) : empty(t('tourNoRegistrations')), { count: registrations.filter((row) => row.status !== 'cancelled').length, actions });
  }

  function resultsCard(detail, run) {
    const { tournament, registrations, results, divisions } = detail;
    const players = registrations.filter((row) => row.status === 'confirmed');
    const admin = window.APP.isAdmin;
    const published = Boolean(tournament.resultsPublishedAt);
    const resultOf = (id) => results.find((result) => result.studentId === id) || {};
    const cell = (key, value, attrs = {}) => h('td', null, h('input', { class: 'tour-result-input', type: 'number', min: 0, value: value ?? '', 'data-key': key, 'aria-label': t(`tourResult.${key}`), ...attrs }));

    const order = [...players].sort((a, b) => (resultOf(a.studentId).rank ?? 9999) - (resultOf(b.studentId).rank ?? 9999));
    const rows = order.map((row) => {
      const result = resultOf(row.studentId);
      return h('tr', { 'data-student': row.studentId },
        cell('rank', result.rank, { min: 1 }),
        h('td', { class: 'strong' }, row.studentName, divisions.length ? h('div', { class: 'muted tiny' }, divisions.find((division) => division.id === row.divisionId)?.name || t('unassigned')) : null),
        cell('score', result.score, { step: 0.5 }),
        cell('wins', result.wins),
        cell('draws', result.draws),
        cell('losses', result.losses),
        h('td', null, h('input', { class: 'tour-result-link', type: 'url', value: result.gamesUrl || '', 'data-key': 'gamesUrl', dir: 'ltr', placeholder: 'https://www.chess.com/…', 'aria-label': t('tourResult.gamesUrl') }))
      );
    });
    const body = h('tbody', null, rows);
    const collect = () => [...body.querySelectorAll('tr')].map((row) => {
      const entry = { studentId: row.dataset.student };
      for (const control of row.querySelectorAll('[data-key]')) entry[control.dataset.key] = control.value.trim();
      return entry;
    });
    const save = () => api(`/tournaments/${tournament.id}/results`, { method: 'PUT', body: { results: collect() } });
    const actions = players.length ? [
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => run(save, t('saved')) }, t('tourSaveResults')),
      admin ? h('button', { class: `btn btn-sm ${published ? '' : 'btn-primary'}`, type: 'button', onclick: async () => {
        if (published) { run(() => api(`/tournaments/${tournament.id}/publish`, { method: 'POST', body: { published: false } }), t('saved')); return; }
        if (await confirmDialog(t('tourPublishConfirm'), { danger: false, okLabel: t('tourPublish') })) {
          run(async () => { await save(); await api(`/tournaments/${tournament.id}/publish`, { method: 'POST', body: {} }); }, t('tourPublished'));
        }
      } }, published ? t('tourUnpublish') : t('tourPublish')) : null
    ].filter(Boolean) : [];

    return card(t('tourResults'), players.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table tour-results' },
      h('thead', null, h('tr', null,
        h('th', null, t('tourResult.rank')), h('th', null, t('student')), h('th', null, t('tourResult.score')),
        h('th', null, t('tourResult.wins')), h('th', null, t('tourResult.draws')), h('th', null, t('tourResult.losses')), h('th', null, t('tourResult.gamesUrl')))),
      body)) : empty(t('tourNoPlayers')), { sub: published ? t('tourResultsLive') : t('tourResultsHidden'), actions });
  }
})();
