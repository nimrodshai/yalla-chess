// Shared helpers for the management app: DOM building, API calls, modals,
// toasts, forms, formatting, a FEN board and the message composer that
// several views reuse.
(function () {
  'use strict';

  const t = (key, values) => window.I18N.t(key, values);

  // ------------------------------------------------------------- DOM
  function h(tag, attrs, ...children) {
    const element = document.createElement(tag);
    if (attrs && typeof attrs === 'object' && !(attrs instanceof Node) && !Array.isArray(attrs)) {
      for (const [key, value] of Object.entries(attrs)) {
        if (value === null || value === undefined || value === false) continue;
        if (key === 'class') element.className = value;
        else if (key === 'style' && typeof value === 'object') Object.assign(element.style, value);
        else if (key.startsWith('on') && typeof value === 'function') element.addEventListener(key.slice(2).toLowerCase(), value);
        else if (key === 'dataset') Object.assign(element.dataset, value);
        else if (key === 'html') element.innerHTML = value;
        else if (key in element && key !== 'list' && key !== 'form' && typeof value !== 'object') element[key] = value;
        else element.setAttribute(key, value === true ? '' : value);
      }
    } else if (attrs !== undefined && attrs !== null) {
      children.unshift(attrs);
    }
    append(element, children);
    return element;
  }

  function append(element, children) {
    for (const child of children.flat(Infinity)) {
      if (child === null || child === undefined || child === false) continue;
      element.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
  }

  function clear(element) {
    while (element.firstChild) element.removeChild(element.firstChild);
    return element;
  }

  // ------------------------------------------------------------- API
  async function api(path, options = {}) {
    const init = {
      method: options.method || 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    };
    if (options.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
    const response = await fetch(`/api/business${path}`, init);
    let data = {};
    try { data = await response.json(); } catch (error) { data = {}; }
    if (response.status === 401) {
      const error = new Error(t('signInFirst'));
      error.status = 401;
      throw error;
    }
    if (!response.ok || data.ok === false) {
      const error = new Error(data.error || t('errorGeneric'));
      error.status = response.status;
      throw error;
    }
    return data;
  }

  // ------------------------------------------------------------- toast
  function toast(message, tone = '') {
    const root = document.getElementById('toastRoot');
    const node = h('div', { class: `toast ${tone}` }, message);
    root.append(node);
    setTimeout(() => node.remove(), 3200);
  }

  // ------------------------------------------------------------- modal
  function modal({ title, body, size = '', onClose }) {
    const root = document.getElementById('modalRoot');
    const content = h('div', { class: 'modal-body' });
    const close = () => {
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
      if (onClose) onClose();
    };
    const onKey = (event) => { if (event.key === 'Escape') close(); };
    const backdrop = h('div', { class: 'modal-backdrop', onclick: (event) => { if (event.target === backdrop) close(); } },
      h('div', { class: `modal ${size}`, role: 'dialog', 'aria-modal': 'true' },
        h('div', { class: 'modal-head' },
          h('div', { class: 'modal-title' }, title),
          h('button', { class: 'modal-close', type: 'button', onclick: close, 'aria-label': t('close') }, '×')
        ),
        content
      )
    );
    document.addEventListener('keydown', onKey);
    root.append(backdrop);
    const api = { close, content, setTitle: (text) => { backdrop.querySelector('.modal-title').textContent = text; } };
    if (typeof body === 'function') append(content, [body(api)]);
    else append(content, [body]);
    return api;
  }

  function confirmDialog(message, { danger = true, okLabel } = {}) {
    return new Promise((resolve) => {
      const dialog = modal({
        title: okLabel || t('delete'),
        size: 'modal-sm',
        onClose: () => resolve(false),
        body: (api) => h('div', { class: 'stack' },
          h('p', null, message),
          h('div', { class: 'form-actions' },
            h('button', { class: 'btn', type: 'button', onclick: () => api.close() }, t('cancel')),
            h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'button', onclick: () => { resolve(true); dialog.close(); } }, okLabel || t('delete'))
          )
        )
      });
    });
  }

  // ------------------------------------------------------------- forms
  function field(label, control, { full = false, hint = '' } = {}) {
    return h('div', { class: `field ${full ? 'full' : ''}` }, label ? h('label', null, label) : null, control, hint ? h('div', { class: 'hint' }, hint) : null);
  }

  function input(name, value = '', attrs = {}) {
    return h('input', { name, value: value ?? '', type: 'text', ...attrs });
  }

  function textarea(name, value = '', attrs = {}) {
    const node = h('textarea', { name, ...attrs });
    node.value = value ?? '';
    return node;
  }

  function select(name, options, value = '', attrs = {}) {
    const node = h('select', { name, ...attrs });
    for (const option of options) {
      const [optionValue, label] = Array.isArray(option) ? option : [option, option];
      node.append(h('option', { value: optionValue, selected: String(optionValue) === String(value ?? '') }, label));
    }
    return node;
  }

  function enumSelect(name, values, prefix, value, { blank = '' } = {}) {
    const options = values.map((entry) => [entry, t(`${prefix}.${entry}`)]);
    if (blank !== '') options.unshift(['', blank]);
    return select(name, options, value);
  }

  function checkbox(name, checked, label) {
    const box = h('input', { type: 'checkbox', name });
    box.checked = Boolean(checked);
    return h('div', { class: 'field field-check' }, box, h('label', null, label));
  }

  function formValues(form) {
    const values = {};
    for (const element of form.elements) {
      if (!element.name) continue;
      if (element.type === 'checkbox') values[element.name] = element.checked;
      else if (element.type === 'number') values[element.name] = element.value === '' ? null : Number(element.value);
      else values[element.name] = element.value;
    }
    return values;
  }

  function errorBox(message) {
    return h('div', { class: 'form-error' }, message);
  }

  // Weekday + time + duration rows, used for private schedules.
  function scheduleEditor(rows = []) {
    const container = h('div', { class: 'schedule-rows' });
    const addRow = (row = { weekday: 0, startTime: '17:00', durationMinutes: 60 }) => {
      const node = h('div', { class: 'schedule-row' },
        select('weekday', t('weekdays').map((name, index) => [index, name]), row.weekday),
        h('input', { name: 'startTime', type: 'time', value: row.startTime || '17:00' }),
        h('input', { name: 'durationMinutes', type: 'number', min: 15, max: 240, step: 5, value: row.durationMinutes || 60 }),
        h('button', { class: 'btn btn-xs btn-ghost', type: 'button', onclick: () => node.remove() }, '✕')
      );
      container.append(node);
    };
    for (const row of rows) addRow(row);
    const wrapper = h('div', { class: 'stack' }, container, h('button', { class: 'btn btn-sm', type: 'button', onclick: () => addRow() }, `+ ${t('addRow')}`));
    wrapper.read = () => Array.from(container.children).map((node) => ({
      weekday: Number(node.querySelector('[name=weekday]').value),
      startTime: node.querySelector('[name=startTime]').value,
      durationMinutes: Number(node.querySelector('[name=durationMinutes]').value) || 60
    }));
    return wrapper;
  }

  function weekdayPicker(selected = []) {
    const state = new Set(selected);
    const wrapper = h('div', { class: 'weekday-picker' });
    t('weekdaysShort').forEach((label, index) => {
      const button = h('button', { type: 'button', class: state.has(index) ? 'active' : '', onclick: () => { if (state.has(index)) state.delete(index); else state.add(index); button.classList.toggle('active'); } }, label);
      wrapper.append(button);
    });
    wrapper.read = () => Array.from(state).sort();
    return wrapper;
  }

  // ------------------------------------------------------------- formatting
  function locale() { return window.I18N.locale; }

  function fmtDate(iso, options = {}) {
    if (!iso) return '';
    const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    if (!parts) return iso;
    const date = new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])));
    return new Intl.DateTimeFormat(locale(), { timeZone: 'UTC', day: 'numeric', month: 'short', ...options }).format(date);
  }

  function fmtDateLong(iso) {
    return fmtDate(iso, { weekday: 'long', day: 'numeric', month: 'long' });
  }

  function fmtDateTime(isoInstant, timeZone) {
    if (!isoInstant) return '';
    const date = new Date(isoInstant);
    if (Number.isNaN(date.getTime())) return isoInstant;
    return new Intl.DateTimeFormat(locale(), { timeZone: timeZone || undefined, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
  }

  function fmtTime(isoInstant, timeZone) {
    if (!isoInstant) return '';
    const date = new Date(isoInstant);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('en-GB', { timeZone: timeZone || undefined, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
  }

  function fmtMoney(amount, currency = 'ILS') {
    if (amount === null || amount === undefined || amount === '') return '';
    const symbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '₪';
    // LRM keeps "₪250" in that order inside right-to-left text.
    return `\u200e${symbol}${Number(amount).toLocaleString('en-US', { maximumFractionDigits: 2 })}\u200e`;
  }

  function fmtMonth(label) {
    if (!label) return '';
    const [year, month] = label.split('-').map(Number);
    return new Intl.DateTimeFormat(locale(), { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(Date.UTC(year, month - 1, 1)));
  }

  function todayIso(timeZone) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const get = (type) => parts.find((part) => part.type === type).value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  }

  function addDays(iso, days) {
    const [year, month, day] = iso.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day + days));
    return date.toISOString().slice(0, 10);
  }

  function weekdayOf(iso) {
    const [year, month, day] = iso.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  }

  function initials(name) {
    return String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?';
  }

  function scheduleText(rows = []) {
    return rows.map((row) => `${t('weekdays')[row.weekday]} ${row.startTime}`).join(' · ');
  }

  function statusBadge(status, prefix = 'status') {
    const tone = {
      active: 'badge-sage', trial: 'badge-info', waitlist: 'badge-warn', inactive: '',
      ok: 'badge-sage', due_soon: 'badge-warn', overdue: 'badge-danger',
      new: 'badge-info', contacted: 'badge-gold', trial_scheduled: 'badge-info', trial_done: 'badge-warn', waiting_group: 'badge-warn', converted: 'badge-sage', lost: '',
      held: 'badge-sage', cancelled: 'badge-danger', forming: 'badge-warn', full: 'badge-gold', closed: ''
    }[status] || '';
    return h('span', { class: `badge ${tone}` }, t(`${prefix}.${status}`));
  }

  // ------------------------------------------------------------- FEN board
  const PIECES = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙', k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
  function board(fen) {
    const placement = String(fen || '').trim().split(/\s+/)[0] || '';
    const ranks = placement.split('/');
    if (ranks.length !== 8) return h('div', { class: 'muted small' }, 'FEN?');
    const node = h('div', { class: 'board' });
    ranks.forEach((rank, rankIndex) => {
      let file = 0;
      for (const char of rank) {
        if (/\d/.test(char)) {
          for (let i = 0; i < Number(char); i += 1) { node.append(square(rankIndex, file, '')); file += 1; }
        } else {
          node.append(square(rankIndex, file, char));
          file += 1;
        }
      }
    });
    const sideToMove = String(fen || '').trim().split(/\s+/)[1];
    return h('div', { class: 'board-wrap' }, node, sideToMove ? h('div', { class: 'board-caption' }, sideToMove === 'b' ? t('blackToMove') : t('whiteToMove')) : null);
  }
  function square(rankIndex, file, piece) {
    const light = (rankIndex + file) % 2 === 0;
    const color = piece && piece === piece.toUpperCase() ? 'w' : 'b';
    return h('div', { class: `sq ${light ? 'light' : 'dark'} ${piece ? color : ''}` }, PIECES[piece] || '');
  }

  // ------------------------------------------------------------- composer
  // Opens the WhatsApp composer for a student or prospect. The server fills
  // the template; the teacher can edit before opening WhatsApp. Opening
  // WhatsApp logs the message as sent (status: sent), which is also how a
  // lesson reminder is marked done.
  async function composeMessage({ kind = 'custom', studentId = '', leadId = '', occurrenceKey = '', lessonId = '', reference = '', values = {}, name = '' , onSent }) {
    const state = { kind, lang: '', values: { ...values } };
    let current = null;
    const dialog = modal({
      title: t('composeTitle', { name }),
      body: (dialog) => {
        const kindSelect = enumSelect('kind', window.VOCAB.messageKinds, 'msg', state.kind);
        const langSelect = select('lang', [['', '—'], ['he', t('hebrew')], ['en', t('english')]], state.lang);
        const notes = textarea('notes', state.values.notes || '', { rows: 2 });
        const preview = h('textarea', { class: 'msg-preview', rows: 7 });
        const recipientLine = h('div', { class: 'small muted' });
        const openButton = h('button', { class: 'btn btn-wa', type: 'button' }, t('openWhatsapp'));
        const copyButton = h('button', { class: 'btn', type: 'button' }, t('copy'));
        const sentButton = h('button', { class: 'btn', type: 'button' }, t('markSent'));

        const refresh = async () => {
          try {
            const response = await api_(path(), body());
            current = response.message;
            preview.value = current.body;
            recipientLine.textContent = current.recipientPhone ? `${t('recipient')}: ${current.recipientName || ''} ${current.recipientPhone}` : t('noPhone');
            openButton.disabled = !current.recipientPhone;
          } catch (error) {
            preview.value = error.message;
          }
        };
        const path = () => '/messages/compose';
        const body = () => ({ kind: kindSelect.value, lang: langSelect.value, studentId, leadId, occurrenceKey, lessonId, values: { ...state.values, notes: notes.value } });
        const api_ = (p, b) => api(p, { method: 'POST', body: b });

        kindSelect.addEventListener('change', refresh);
        langSelect.addEventListener('change', refresh);
        notes.addEventListener('input', () => { clearTimeout(notes._timer); notes._timer = setTimeout(refresh, 350); });

        const log = async (status) => {
          if (!current) return;
          try {
            await api('/messages', { method: 'POST', body: { kind: kindSelect.value, channel: 'whatsapp', recipientPhone: current.recipientPhone, studentId, leadId, reference: reference || occurrenceKey, body: preview.value, status } });
            toast(status === 'sent' ? t('sent') : t('saved'), 'success');
            if (onSent) onSent();
          } catch (error) {
            toast(error.message, 'error');
          }
        };

        openButton.addEventListener('click', async () => {
          if (!current || !current.recipientPhone) return;
          const digits = current.recipientPhone.replace(/\D/g, '');
          window.open(`https://wa.me/${digits}?text=${encodeURIComponent(preview.value)}`, '_blank', 'noopener');
          await log('sent');
          dialog.close();
        });
        copyButton.addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(preview.value); toast(t('copied'), 'success'); } catch (error) { toast(t('errorGeneric'), 'error'); }
        });
        sentButton.addEventListener('click', async () => { await log('sent'); dialog.close(); });

        refresh();
        return h('div', { class: 'stack' },
          h('div', { class: 'form' },
            field(t('messageKind'), kindSelect),
            field(t('messageLang'), langSelect),
            field(t('freeText'), notes, { full: true })
          ),
          field(t('preview'), preview, { full: true }),
          recipientLine,
          h('div', { class: 'small muted' }, t('logAsSent')),
          h('div', { class: 'form-actions' }, copyButton, sentButton, openButton)
        );
      }
    });
    return dialog;
  }

  // ------------------------------------------------------------- payment modal
  function paymentDialog({ student, payment = null, onSaved }) {
    const isEdit = Boolean(payment);
    modal({
      title: isEdit ? t('edit') : t('paymentFor', { name: student.name || `${student.firstName} ${student.lastName}` }),
      size: 'modal-sm',
      body: (dialog) => {
        const form = h('form', { class: 'form' },
          field(t('amount'), h('input', { name: 'amount', type: 'number', step: '0.01', min: 0, value: payment?.amount ?? student.price ?? '', required: true })),
          field(t('currency'), select('currency', window.VOCAB.currencies, payment?.currency || student.currency || 'ILS')),
          field(t('paidAt'), h('input', { name: 'paidAt', type: 'date', value: payment?.paidAt || todayIso() })),
          field(t('method'), enumSelect('method', window.VOCAB.paymentMethods, 'method', payment?.method || 'bit')),
          field(t('periodLabel'), h('input', { name: 'periodLabel', type: 'month', value: payment?.periodLabel || todayIso().slice(0, 7) })),
          field(t('lessonsCount'), h('input', { name: 'lessonsCount', type: 'number', min: 0, value: payment?.lessonsCount ?? (student.billingType === 'package' ? student.packageSize || '' : '') })),
          checkbox('receiptIssued', payment?.receiptIssued, t('receiptIssued')),
          field(t('receiptNumber'), input('receiptNumber', payment?.receiptNumber || '')),
          field(t('notes'), textarea('notes', payment?.notes || '', { rows: 2 }), { full: true }),
          h('div', { class: 'form-actions' },
            h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, t('cancel')),
            h('button', { class: 'btn btn-primary', type: 'submit' }, t('save'))
          )
        );
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const values = { ...formValues(form), studentId: student.id };
          try {
            if (isEdit) await api(`/payments/${payment.id}`, { method: 'PATCH', body: values });
            else await api('/payments', { method: 'POST', body: values });
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

  function pageHead(title, sub, actions = []) {
    return h('div', { class: 'page-head' },
      h('div', null, h('h1', { class: 'page-title' }, title), sub ? h('div', { class: 'page-sub' }, sub) : null),
      actions.length ? h('div', { class: 'page-actions' }, actions) : null
    );
  }

  function card(title, body, { count, sub, actions } = {}) {
    return h('div', { class: 'card' },
      title ? h('div', { class: 'card-head' },
        h('div', null, h('div', { class: 'card-title' }, title, count !== undefined ? h('span', { class: 'count' }, count) : null), sub ? h('div', { class: 'card-sub' }, sub) : null),
        actions ? h('div', { class: 'row' }, actions) : null
      ) : null,
      body
    );
  }

  function stat(label, value, { sub, tone } = {}) {
    return h('div', { class: `stat ${tone ? `tone-${tone}` : ''}` }, h('div', { class: 'stat-label' }, label), h('div', { class: 'stat-value' }, value), sub ? h('div', { class: 'stat-sub' }, sub) : null);
  }

  function empty(message) {
    return h('div', { class: 'empty' }, message);
  }

  function link(hash, ...children) {
    return h('a', { href: hash, class: 'link' }, ...children);
  }

  window.UI = {
    h, append, clear, api, toast, modal, confirmDialog, field, input, textarea, select, enumSelect, checkbox, formValues, errorBox,
    scheduleEditor, weekdayPicker, fmtDate, fmtDateLong, fmtDateTime, fmtTime, fmtMoney, fmtMonth, todayIso, addDays, weekdayOf,
    initials, scheduleText, statusBadge, board, composeMessage, paymentDialog, pageHead, card, stat, empty, link, t
  };
})();
