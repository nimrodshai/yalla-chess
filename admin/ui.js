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
        else if (key.startsWith('on') && typeof value === 'function') element.addEventListener(key.slice(2).toLowerCase(), guarded(value));
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

  // Every handler attached through h() reports a thrown error or a rejected
  // promise as a toast, so a failed quick action (network, 404, validation)
  // is never silent.
  function guarded(handler) {
    return (event) => {
      try {
        const result = handler(event);
        // Hand back the settled promise so callers that await it still wait.
        if (result && typeof result.catch === 'function') return result.catch(reportError);
        return result;
      } catch (error) {
        reportError(error);
        return undefined;
      }
    };
  }

  function reportError(error) {
    toast((error && error.message) || t('errorGeneric'), 'error');
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
    // `root` reaches the portal's own API (e.g. creating a group) instead of /api/business.
    let response;
    try {
      response = await fetch(`${options.root ?? '/api/business'}${path}`, init);
    } catch (cause) {
      // The server could not be reached at all: offline, or it is down.
      throw new Error(t('errorNetwork'));
    }
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
    // A value no longer offered (an old record in EUR or Russian) stays
    // selectable so saving the form does not silently change it.
    if (value && !options.some((option) => String(Array.isArray(option) ? option[0] : option) === String(value))) {
      node.append(h('option', { value, selected: true }, value));
    }
    return node;
  }

  function enumSelect(name, values, prefix, value, { blank = '' } = {}) {
    const options = [...values, ...(value && !values.includes(value) ? [value] : [])].map((entry) => [entry, t(`${prefix}.${entry}`)]);
    if (blank !== '') options.unshift(['', blank]);
    return select(name, options, value);
  }

  // A dropdown of the teachers list. A name that is no longer on the list
  // stays selectable so saving the form does not silently clear it.
  function teacherSelect(name, value = '') {
    const names = window.APP.teachers.map((teacher) => teacher.name);
    const options = [['', '—'], ...names.map((entry) => [entry, entry])];
    if (value && !names.includes(value)) options.push([value, t('teacherNotListed', { name: value })]);
    return select(name, options, value);
  }

  // Countries for phone fields, matching the portal's sign-in picker. The
  // example sets the digit grouping and how long a national number may be.
  const PHONE_COUNTRIES = [
    ['IL', '🇮🇱', '+972', '50 123 4567', 8, 9],
    ['US', '🇺🇸', '+1', '555 123 4567', 10, 10],
    ['GB', '🇬🇧', '+44', '7400 123456', 9, 10],
    ['FR', '🇫🇷', '+33', '6 12 34 56 78', 9, 9],
    ['DE', '🇩🇪', '+49', '1512 3456789', 7, 11],
    ['ES', '🇪🇸', '+34', '612 34 56 78', 9, 9],
    ['IT', '🇮🇹', '+39', '312 345 6789', 6, 11, true],
    ['NL', '🇳🇱', '+31', '6 12345678', 9, 9],
    ['BE', '🇧🇪', '+32', '470 12 34 56', 8, 9],
    ['CH', '🇨🇭', '+41', '76 123 45 67', 9, 9],
    ['AT', '🇦🇹', '+43', '664 1234567', 7, 13],
    ['PT', '🇵🇹', '+351', '912 345 678', 9, 9],
    ['IE', '🇮🇪', '+353', '85 123 4567', 7, 9],
    ['DK', '🇩🇰', '+45', '20 12 34 56', 8, 8],
    ['SE', '🇸🇪', '+46', '70 123 45 67', 7, 9],
    ['NO', '🇳🇴', '+47', '400 12 345', 8, 8],
    ['FI', '🇫🇮', '+358', '40 123 4567', 6, 10],
    ['PL', '🇵🇱', '+48', '512 345 678', 9, 9],
    ['GR', '🇬🇷', '+30', '691 234 5678', 10, 10],
    ['AU', '🇦🇺', '+61', '412 345 678', 9, 9],
    ['NZ', '🇳🇿', '+64', '21 123 4567', 8, 10],
    ['ZA', '🇿🇦', '+27', '82 123 4567', 9, 9],
    ['AE', '🇦🇪', '+971', '50 123 4567', 8, 9],
    ['IN', '🇮🇳', '+91', '98765 43210', 10, 10],
    ['SG', '🇸🇬', '+65', '8123 4567', 8, 8],
    ['HK', '🇭🇰', '+852', '5123 4567', 8, 8],
    ['JP', '🇯🇵', '+81', '90 1234 5678', 9, 10],
    ['KR', '🇰🇷', '+82', '10 1234 5678', 8, 10],
    ['BR', '🇧🇷', '+55', '11 91234 5678', 10, 11],
    ['AR', '🇦🇷', '+54', '9 11 2345 6789', 10, 11],
    ['MX', '🇲🇽', '+52', '55 1234 5678', 10, 10],
    // Any other country: the whole international number, dial code included.
    ['XX', '🌐', '+', '+7 912 345 6789', 8, 15]
  ].map(([code, flag, dial, example, min, max, keepZero = false]) => ({ code, flag, dial, example, min, max, keepZero, groups: example.split(' ').map((part) => part.length) }));

  const OTHER_COUNTRY = PHONE_COUNTRIES.find((country) => country.code === 'XX');

  // The listed country whose dial code starts an international number,
  // longest first; null for a dial code the list does not have.
  function phoneCountryOf(e164) {
    return PHONE_COUNTRIES.filter((country) => country !== OTHER_COUNTRY)
      .sort((a, b) => b.dial.length - a.dial.length)
      .find((country) => e164.startsWith(country.dial)) || null;
  }

  function groupDigits(digits, groups) {
    const parts = [];
    let rest = digits;
    for (const size of groups) {
      if (!rest) break;
      parts.push(rest.slice(0, size));
      rest = rest.slice(size);
    }
    if (rest) parts[parts.length - 1] += rest;
    return parts.join(' ');
  }

  // "+972501234567" → "+972 50 123 4567", for showing a stored number.
  function fmtPhone(value) {
    const raw = String(value || '');
    const country = raw.startsWith('+') ? phoneCountryOf(raw) : null;
    if (!country) return raw;
    return `${country.dial} ${groupDigits(raw.slice(country.dial.length), country.groups)}`;
  }

  // A country code picker and a national number, submitted as one E.164
  // value under `name` (for example +972501234567) so it can later be used
  // to sign in. A pasted international number picks its country itself; one
  // from a country not on the list (stored or pasted) moves to "other" and
  // is kept whole, never re-prefixed with the selected country's code.
  function phoneInput(name, value = '', { required = false } = {}) {
    const stored = String(value || '');
    const known = stored.startsWith('+') ? (phoneCountryOf(stored) || OTHER_COUNTRY) : null;
    const countrySelect = h('select', { class: 'phone-country', 'aria-label': t('phoneCountry'), autocomplete: 'tel-country-code' },
      PHONE_COUNTRIES.map((country) => h('option', { value: country.code }, country === OTHER_COUNTRY ? `${country.flag} ${t('phoneOtherCountry')}` : `${country.flag} ${country.dial}`)));
    countrySelect.value = (known || PHONE_COUNTRIES[0]).code;
    const number = h('input', { type: 'tel', inputmode: 'tel', autocomplete: 'tel-national', dir: 'ltr', required, spellcheck: 'false' });
    const hidden = h('input', { type: 'hidden', name });
    const country = () => PHONE_COUNTRIES.find((entry) => entry.code === countrySelect.value);
    let previous = country();
    const national = () => {
      const digits = number.value.replace(/\D/g, '');
      if (country() === OTHER_COUNTRY) return digits.replace(/^00/, '');
      return country().keepZero ? digits : digits.replace(/^0+/, '');
    };
    const sync = () => {
      const digits = national();
      const { min, max, dial, example } = country();
      hidden.value = digits ? `${dial}${digits}` : '';
      const outOfRange = digits.length < min || digits.length > max || (country() === OTHER_COUNTRY && digits.startsWith('0'));
      number.setCustomValidity(digits && outOfRange ? t('phoneInvalid', { example: country() === OTHER_COUNTRY ? example : `${dial} ${example}` }) : '');
      number.classList.toggle('invalid', Boolean(number.validationMessage) && number.dataset.touched === 'true');
    };
    const reformat = () => {
      const raw = number.value.trim();
      if (/^(\+|00)/.test(raw)) {
        const e164 = `+${raw.replace(/\D/g, '').replace(/^00/, '')}`;
        const pasted = phoneCountryOf(e164) || OTHER_COUNTRY;
        countrySelect.value = pasted.code;
        previous = pasted;
        number.value = e164.slice(pasted.dial.length);
      }
      const digits = national();
      if (digits) number.value = country() === OTHER_COUNTRY ? `+${digits}` : groupDigits(digits, country().groups);
      number.placeholder = country().example;
      sync();
    };
    number.value = known && known !== OTHER_COUNTRY ? stored.slice(known.dial.length) : stored;
    number.addEventListener('input', () => { if (/^(\+|00)/.test(number.value.trim())) reformat(); else sync(); });
    number.addEventListener('blur', () => { number.dataset.touched = 'true'; reformat(); });
    number.addEventListener('invalid', () => { number.dataset.touched = 'true'; number.classList.add('invalid'); });
    // Switching country keeps the number the same person's: into "other" the
    // old dial code is written out, out of it a matching dial code is dropped.
    // A full number whose code is not the chosen country's stays on "other"
    // rather than having its digits read as that country's national number;
    // to use another country, clear the number first.
    countrySelect.addEventListener('change', () => {
      const digits = number.value.replace(/\D/g, '');
      if (country() === OTHER_COUNTRY && previous !== OTHER_COUNTRY && digits) number.value = `${previous.dial}${previous.keepZero ? digits : digits.replace(/^0+/, '')}`;
      else if (previous === OTHER_COUNTRY && digits) {
        const dialDigits = country().dial.slice(1);
        if (!digits.startsWith(dialDigits)) {
          countrySelect.value = OTHER_COUNTRY.code;
          number.focus();
          return;
        }
        number.value = digits.slice(dialDigits.length);
      }
      previous = country();
      reformat();
      number.focus();
    });
    reformat();
    return h('div', { class: 'phone-input', dir: 'ltr' }, countrySelect, number, hidden);
  }

  // The time zones the client works with, in the client's order, with the
  // client's own names for them.
  const TIMEZONES = [
    ['Asia/Jerusalem', 'ישראל', 'Israel'],
    ['Europe/Berlin', 'גרמניה', 'Germany'],
    ['America/St_Johns', 'קנדה – ניופאונדלנד', 'Canada – Newfoundland'],
    ['America/Halifax', 'קנדה – אטלנטי', 'Canada – Atlantic'],
    ['America/Toronto', 'קנדה – מזרחי', 'Canada – Eastern'],
    ['America/Winnipeg', 'קנדה – מניטובה', 'Canada – Manitoba'],
    ['America/Regina', 'קנדה – ססקצ\'ואן', 'Canada – Saskatchewan'],
    ['America/Edmonton', 'קנדה – אלברטה', 'Canada – Alberta'],
    ['America/Vancouver', 'קנדה – מערבי', 'Canada – Pacific'],
    ['America/Whitehorse', 'קנדה – יוקון', 'Canada – Yukon'],
    ['America/New_York', 'ארה״ב – מזרחי', 'USA – Eastern'],
    ['America/Chicago', 'ארה״ב – מרכזי', 'USA – Central'],
    ['America/Denver', 'ארה״ב – הררי', 'USA – Mountain'],
    ['America/Phoenix', 'ארה״ב – אריזונה', 'USA – Arizona'],
    ['America/Los_Angeles', 'ארה״ב – מערבי', 'USA – Pacific'],
    ['America/Anchorage', 'ארה״ב – אלסקה', 'USA – Alaska'],
    ['Pacific/Honolulu', 'ארה״ב – הוואי', 'USA – Hawaii'],
    ['America/Adak', 'ארה״ב – האיים האלאוטיים', 'USA – Aleutian Islands'],
    ['America/Puerto_Rico', 'ארה״ב – פוארטו ריקו', 'USA – Puerto Rico'],
    ['Pacific/Pago_Pago', 'ארה״ב – סמואה האמריקאית', 'USA – American Samoa'],
    ['Pacific/Guam', 'ארה״ב – גואם', 'USA – Guam'],
    ['America/Argentina/Buenos_Aires', 'ארגנטינה – בואנוס איירס', 'Argentina – Buenos Aires'],
    ['America/Lima', 'פרו – לימה וארקיפה', 'Peru – Lima and Arequipa']
  ];

  // "GMT-5" today, so daylight saving shows as it is right now.
  function zoneOffset(zone) {
    try {
      const offset = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' }).formatToParts(new Date()).find((entry) => entry.type === 'timeZoneName')?.value || '';
      return offset.replace(/^GMT$/, 'GMT+0');
    } catch {
      return '';
    }
  }

  // A dropdown of the client's time zones. A stored zone missing from the
  // list stays selectable so saving the form does not silently change it.
  function timezoneSelect(name, value = '', { blank = '' } = {}) {
    const he = window.I18N.locale.startsWith('he');
    const option = (zone, label) => h('option', { value: zone, selected: zone === value }, `${label} (${zoneOffset(zone)})`);
    const node = h('select', { name, dir: 'auto' });
    if (blank !== '') node.append(h('option', { value: '', selected: !value }, blank));
    for (const [zone, nameHe, nameEn] of TIMEZONES) node.append(option(zone, he ? nameHe : nameEn));
    if (value && !TIMEZONES.some(([zone]) => zone === value)) node.append(option(value, value));
    return node;
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

  // Forms put the error at their top, which in a long form is out of view
  // of the save button, so bring it into view once it is placed.
  function errorBox(message) {
    const box = h('div', { class: 'form-error', role: 'alert' }, message);
    requestAnimationFrame(() => { if (box.isConnected) box.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); });
    return box;
  }

  // Weekday + time + duration rows, used for private schedules.
  // Lesson length limits follow what the server keeps: private lessons
  // 15-240 minutes, group lessons 30-180.
  function scheduleEditor(rows = [], { minMinutes = 15, maxMinutes = 240 } = {}) {
    const container = h('div', { class: 'schedule-rows' });
    const addRow = (row = { weekday: 0, startTime: '17:00', durationMinutes: 60 }) => {
      const node = h('div', { class: 'schedule-row' },
        select('weekday', t('weekdays').map((name, index) => [index, name]), row.weekday),
        h('input', { name: 'startTime', type: 'time', value: row.startTime || '17:00' }),
        h('input', { name: 'durationMinutes', type: 'number', min: minMinutes, max: maxMinutes, step: 5, value: row.durationMinutes || 60 }),
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

  function currencySymbol(currency) {
    return currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '₪';
  }

  function fmtMoney(amount, currency = 'ILS') {
    if (amount === null || amount === undefined || amount === '') return '';
    const symbol = currencySymbol(currency);
    // LRM keeps "₪250" in that order inside right-to-left text.
    return `\u200e${symbol}${Number(amount).toLocaleString('en-US', { maximumFractionDigits: 2 })}\u200e`;
  }

  // Where a student's account stands: what they owe, their credit, or
  // settled.
  function balanceText(entry, currency = entry.currency) {
    if (entry.balance === null || entry.balance === undefined || entry.balance === 0) return t('balanceSettled');
    return entry.balance < 0
      ? t('balanceOwes', { amount: fmtMoney(-entry.balance, currency) })
      : t('balanceCredit', { amount: fmtMoney(entry.balance, currency) });
  }

  // The balance with when it matters: how late what is owed is, else when
  // the next monthly charge comes.
  function standingText(entry, currency = entry.currency) {
    const parts = [balanceText(entry, currency)];
    if (entry.balance < 0 && entry.daysUntilDue !== null && entry.daysUntilDue !== undefined) {
      parts.push(entry.daysUntilDue < 0 ? t('daysLate', { days: -entry.daysUntilDue }) : t('dueToday'));
    } else if (entry.nextPaymentAt && entry.nextChargeAmount !== null && entry.nextChargeAmount !== undefined) {
      parts.push(t('nextChargeOn', { date: fmtDate(entry.nextPaymentAt), amount: fmtMoney(entry.nextChargeAmount, currency) }));
    }
    if (entry.unpricedLessons) parts.push(t('unpricedLessons', { n: entry.unpricedLessons }));
    return parts.join(' · ');
  }

  // One price from a student's list: "Private · 60 min · ₪70 a lesson".
  function priceText(item, currency = 'ILS') {
    const amount = fmtMoney(item.amount, currency);
    return [
      t(`priceKind.${item.kind}`),
      item.durationMinutes ? `${item.durationMinutes} ${t('minutes')}` : '',
      item.model === 'monthly' ? t('priceMonthly', { amount }) : item.model === 'package' ? t('pricePackage', { amount, n: item.packageSize }) : t('pricePerLesson', { amount }),
      item.model === 'monthly' && item.lessonAmount !== null && item.lessonAmount !== undefined ? t('priceSingleLesson', { amount: fmtMoney(item.lessonAmount, currency) }) : ''
    ].filter(Boolean).join(' · ');
  }

  function pricesText(prices = [], currency = 'ILS') {
    return prices.length ? prices.map((item) => priceText(item, currency)).join(' / ') : t('noPrices');
  }

  // A student's price list as editable boxes. The kind of lesson decides
  // how a new price is billed: group is a monthly fee, with a single-lesson
  // price for a month the student has only part of; private is per lesson,
  // by length. A price set up otherwise before (a package, a price for any
  // lesson) keeps its billing and says so in its box. Boxes keep their
  // price's id so the server knows an edit from a new price. The inputs
  // have no name, so formValues leaves them out; read() returns the list.
  const DEFAULT_MODEL = { group: 'monthly', private: 'per_lesson' };
  function priceEditor(prices = [], { onChange, currency = 'ILS' } = {}) {
    const container = h('div', { class: 'price-rows' });
    const changed = () => { if (onChange) onChange(); };
    // Amounts show the student's currency, and follow it when it changes.
    let symbol = currencySymbol(currency);
    const money = (input) => h('div', { class: 'money' }, h('span', { class: 'money-symbol' }, symbol), input);
    const addRow = (item = { kind: 'private', model: 'per_lesson', durationMinutes: 60, amount: null }) => {
      const kinds = ['group', 'private', ...(item.kind === 'any' ? ['any'] : [])];
      const kind = h('select', { 'aria-label': t('priceKindLabel') }, kinds.map((value) => h('option', { value }, t(`priceKind.${value}`))));
      kind.value = item.kind;
      let model = item.model || DEFAULT_MODEL[item.kind] || 'per_lesson';
      const minutes = h('input', { type: 'number', min: 15, max: 240, step: 5, inputmode: 'numeric', value: item.durationMinutes ?? '', placeholder: t('priceAnyLength'), 'aria-label': t('duration') });
      const amount = h('input', { type: 'number', min: 0, step: '0.01', inputmode: 'decimal', value: item.amount ?? '', placeholder: t('amount'), 'aria-label': t('amount') });
      const single = h('input', { type: 'number', min: 0, step: '0.01', inputmode: 'decimal', value: item.lessonAmount ?? '', 'aria-label': t('singleLessonPrice') });
      const singleLine = h('label', { class: 'price-extra' }, h('span', { class: 'strong' }, `${window.I18N.lang === 'he' ? '↲' : '↳'} ${t('singleLessonPrice')}`), money(single), h('span', { class: 'muted' }, t('singleLessonHint')));
      const size = h('input', { type: 'number', min: 1, max: 200, inputmode: 'numeric', value: item.packageSize ?? '', 'aria-label': t('packageLessons') });
      const modelNote = h('span', { class: 'strong' });
      const otherLine = h('label', { class: 'price-extra' }, modelNote, h('span', { class: 'price-size' }, size, h('span', null, t('packageLessons'))));
      const node = h('div', { class: 'price-row' }, kind, minutes, money(amount),
        h('button', { class: 'btn btn-xs btn-ghost', type: 'button', 'aria-label': t('delete'), onclick: () => { node.remove(); changed(); } }, '✕'),
        singleLine, otherLine);
      // A field that does not apply keeps its column, so amounts line up.
      const sync = () => {
        minutes.classList.toggle('off', model === 'monthly');
        singleLine.hidden = model !== 'monthly';
        otherLine.hidden = model === DEFAULT_MODEL[kind.value];
        modelNote.textContent = `${t('priceBilledAs')}: ${t(`priceModel.${model}`)}`;
        size.parentNode.hidden = model !== 'package';
      };
      kind.addEventListener('change', () => { model = DEFAULT_MODEL[kind.value] || model; sync(); });
      node.addEventListener('change', changed);
      sync();
      node.read = () => ({
        id: item.id || '',
        kind: kind.value,
        model,
        durationMinutes: model === 'monthly' || minutes.value === '' ? null : Number(minutes.value),
        packageSize: model === 'package' && size.value !== '' ? Number(size.value) : null,
        amount: amount.value === '' ? null : Number(amount.value),
        lessonAmount: model === 'monthly' && single.value !== '' ? Number(single.value) : null
      });
      container.append(node);
    };
    for (const item of prices) addRow(item);
    const head = h('div', { class: 'price-row price-head', 'aria-hidden': 'true' },
      ...[t('priceKindLabel'), t('duration'), t('amount')].map((label) => h('span', null, label)), h('span'));
    const wrapper = h('div', { class: 'stack' }, head, container, h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { addRow(); changed(); } }, `+ ${t('addPrice')}`));
    const syncHead = () => { head.hidden = !container.children.length; };
    new MutationObserver(syncHead).observe(container, { childList: true });
    syncHead();
    wrapper.read = () => Array.from(container.children).map((node) => node.read());
    wrapper.add = (item) => { addRow(item); changed(); };
    wrapper.clear = () => { container.replaceChildren(); };
    wrapper.setCurrency = (code) => {
      symbol = currencySymbol(code);
      for (const node of wrapper.querySelectorAll('.money-symbol')) node.textContent = symbol;
    };
    return wrapper;
  }

  function fmtMonth(label) {
    if (!label) return '';
    const [year, month] = label.split('-').map(Number);
    return new Intl.DateTimeFormat(locale(), { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(Date.UTC(year, month - 1, 1)));
  }

  function todayIso(timeZone, at = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
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

  // A student's or prospect's ratings, on whichever sites they have one.
  function ratingsText(record) {
    return [record.chesscomRating ? `Chess.com ${record.chesscomRating}` : '', record.lichessRating ? `Lichess ${record.lichessRating}` : ''].filter(Boolean).join(' · ');
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
  // An 8x8 CSS grid with a fixed 1:1 aspect ratio per square, inside a dark
  // frame that carries the coordinates. Pieces are
  // images under /admin/pieces (wK.png ... bP.png); the Unicode glyph is the
  // fallback if an image is missing. Images are cached for a day, so bump
  // PIECE_VERSION whenever the set is redrawn.
  const PIECE_VERSION = 3;
  const PIECES = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙', k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
  function pieceImage(piece) {
    const color = piece === piece.toUpperCase() ? 'w' : 'b';
    const img = h('img', { src: `/admin/pieces/${color}${piece.toUpperCase()}.png?v=${PIECE_VERSION}`, alt: PIECES[piece], draggable: false });
    img.addEventListener('error', () => { img.replaceWith(h('span', { class: `glyph ${color}` }, PIECES[piece])); }, { once: true });
    return img;
  }
  function board(fen, { highlights = [], caption = true, coords = true } = {}) {
    const placement = String(fen || '').trim().split(/\s+/)[0] || '';
    const ranks = placement.split('/');
    if (ranks.length !== 8) return h('div', { class: 'muted small' }, 'FEN?');
    const node = h('div', { class: 'board' });
    ranks.forEach((rank, rankIndex) => {
      let file = 0;
      for (const char of rank) {
        if (/\d/.test(char)) {
          for (let i = 0; i < Number(char); i += 1) { node.append(square(rankIndex, file, '', highlights)); file += 1; }
        } else {
          node.append(square(rankIndex, file, char, highlights));
          file += 1;
        }
      }
    });
    const sideToMove = String(fen || '').trim().split(/\s+/)[1];
    const frame = h('div', { class: 'board-frame' },
      coords ? h('div', { class: 'ranks' }, ...[8, 7, 6, 5, 4, 3, 2, 1].map((rank) => h('span', null, String(rank)))) : null,
      node,
      coords ? h('div', { class: 'files' }, ...[...'abcdefgh'].map((file) => h('span', null, file))) : null
    );
    return h('div', { class: 'board-wrap' }, frame, caption && sideToMove ? h('div', { class: 'board-caption' }, sideToMove === 'b' ? t('blackToMove') : t('whiteToMove')) : null);
  }
  function square(rankIndex, file, piece, highlights) {
    const light = (rankIndex + file) % 2 === 0;
    const squareName = 'abcdefgh'[file] + (8 - rankIndex);
    return h('div', { class: `sq ${light ? 'light' : 'dark'} ${highlights.includes(squareName) ? 'hl' : ''}`, dataset: { square: squareName } },
      piece ? pieceImage(piece) : null
    );
  }

  // Animates the change between two positions on a freshly rendered board.
  // Pieces that left one square and arrived on another glide between them
  // (both king and rook when castling; pawn to queen on promotion); a
  // captured piece fades out, and one that reappears when stepping back
  // fades in. Floating copies sit on the board itself because each square
  // clips its own content.
  function placementArray(fen) {
    const out = [];
    for (const char of String(fen || '').trim().split(/\s+/)[0] || '') {
      if (char === '/') continue;
      if (/\d/.test(char)) for (let i = 0; i < Number(char); i += 1) out.push('');
      else out.push(char);
    }
    return out.length === 64 ? out : null;
  }
  const squareName = (index) => 'abcdefgh'[index % 8] + (8 - Math.floor(index / 8));
  const sameColor = (a, b) => (a === a.toUpperCase()) === (b === b.toUpperCase());

  function animateBoard(boardNode, previousFen, nextFen, { duration = 260 } = {}) {
    if (!boardNode || !previousFen || previousFen === nextFen) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const before = placementArray(previousFen);
    const after = placementArray(nextFen);
    if (!before || !after) return;

    const vacated = [];
    const arrived = [];
    for (let i = 0; i < 64; i += 1) {
      if (before[i] && before[i] !== after[i]) vacated.push(i);
      if (after[i] && after[i] !== before[i]) arrived.push(i);
    }
    const used = new Set();
    const pairs = [];
    const distance = (a, b) => Math.abs((a % 8) - (b % 8)) + Math.abs(Math.floor(a / 8) - Math.floor(b / 8));
    const take = (target, accept) => {
      const options = vacated.filter((v) => !used.has(v) && accept(before[v])).sort((x, y) => distance(x, target) - distance(y, target));
      if (!options.length) return false;
      used.add(options[0]);
      pairs.push([options[0], target]);
      return true;
    };
    const unmatched = [];
    for (const a of arrived) if (!take(a, (piece) => piece === after[a])) unmatched.push(a);
    // Promotion forwards (pawn becomes a piece) or backwards (piece becomes a pawn).
    const appearing = unmatched.filter((a) => !take(a, (piece) => sameColor(piece, after[a]) && (piece.toUpperCase() === 'P') !== (after[a].toUpperCase() === 'P')));
    const disappearing = vacated.filter((v) => !used.has(v));
    if (!pairs.length && !appearing.length && !disappearing.length) return;

    const squareNode = (index) => boardNode.querySelector(`[data-square="${squareName(index)}"]`);
    const pieceNode = (index) => squareNode(index)?.querySelector('img, .glyph');
    const floating = (index, content, z) => {
      const cell = squareNode(index);
      const node = h('div', { class: 'float', style: { left: `${cell.offsetLeft}px`, top: `${cell.offsetTop}px`, width: `${cell.offsetWidth}px`, height: `${cell.offsetHeight}px`, zIndex: String(z) } }, content);
      boardNode.append(node);
      return node;
    };
    const cleanups = [];
    const easing = 'cubic-bezier(.2,.7,.3,1)';

    for (const v of disappearing) {
      const ghost = floating(v, pieceImage(before[v]), 2);
      void getComputedStyle(ghost).opacity;
      ghost.style.transition = `opacity ${duration}ms ease-out`;
      requestAnimationFrame(() => { ghost.style.opacity = '0'; });
      cleanups.push(() => ghost.remove());
    }
    for (const [from, to] of pairs) {
      const real = pieceNode(to);
      if (!real) continue;
      const start = squareNode(from);
      const end = squareNode(to);
      const mover = floating(from, real.cloneNode(true), 4);
      real.style.visibility = 'hidden';
      void getComputedStyle(mover).transform;
      mover.style.transition = `transform ${duration}ms ${easing}`;
      // Two frames so the start position is painted before moving.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        mover.style.transform = `translate(${end.offsetLeft - start.offsetLeft}px, ${end.offsetTop - start.offsetTop}px)`;
      }));
      cleanups.push(() => { mover.remove(); real.style.visibility = ''; });
    }
    for (const a of appearing) {
      const real = pieceNode(a);
      if (!real) continue;
      real.style.opacity = '0';
      // Flush styles so the browser has seen opacity 0 before it changes;
      // a freshly inserted node otherwise skips the transition.
      void getComputedStyle(real).opacity;
      real.style.transition = `opacity ${duration}ms ease-in`;
      requestAnimationFrame(() => { real.style.opacity = '1'; });
      cleanups.push(() => { real.style.transition = ''; real.style.opacity = ''; });
    }
    setTimeout(() => cleanups.forEach((fn) => fn()), duration + 60);
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
        const langSelect = select('lang', [['', t('langAuto')], ['he', t('hebrew')], ['en', t('english')]], state.lang);
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
  // What a new payment most likely is: what the student owes, else the
  // next monthly charge.
  function suggestedAmount(student) {
    if (student.balance < 0) return -student.balance;
    return student.nextChargeAmount ?? null;
  }

  function paymentDialog({ student, payment = null, onSaved }) {
    const isEdit = Boolean(payment);
    modal({
      title: isEdit ? t('edit') : t('paymentFor', { name: student.name || `${student.firstName} ${student.lastName}` }),
      size: 'modal-sm',
      body: (dialog) => {
        const form = h('form', { class: 'form' },
          field(t('amount'), h('input', { name: 'amount', type: 'number', step: '0.01', min: 0, value: payment?.amount ?? suggestedAmount(student) ?? '', required: true })),
          field(t('currency'), select('currency', window.VOCAB.currencies, payment?.currency || student.currency || 'ILS')),
          field(t('paidAt'), h('input', { name: 'paidAt', type: 'date', value: payment?.paidAt || todayIso() })),
          field(t('method'), enumSelect('method', window.VOCAB.paymentMethods, 'method', payment?.method || 'bit')),
          field(t('periodLabel'), h('input', { name: 'periodLabel', type: 'month', value: payment?.periodLabel || todayIso().slice(0, 7) })),
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
          // A student record carries `id`; a payments-due row carries `studentId`.
          const values = { ...formValues(form), studentId: student.id || student.studentId };
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

  // Games a lesson used, resolved by the server against the games list:
  // a link to the game while it exists, its remembered name otherwise.
  // The game the calendar suggests for a lesson not logged yet: one none of
  // its students has seen, else the one the fewest have.
  function suggestedGame(occurrence) {
    const game = occurrence.suggestedGame;
    if (!game) return null;
    return h('div', { class: 'list-sub' }, `♞ ${t('suggestedGame')}: `,
      h('a', { class: 'link', href: `#/content/${game.id}`, onclick: (event) => event.stopPropagation() }, game.title),
      game.seenBy ? h('span', { class: 'muted' }, ` · ${t('suggestedGameSeen', { n: game.seenBy, of: game.of })}`) : null);
  }

  // The next lesson on a student's or a group's page: when it is (and in
  // the family's own zone when that differs), the game suggested for it,
  // and a button to log it with that game offered.
  function nextLesson(occurrence, { timezone = '', onSaved } = {}) {
    if (!occurrence) return null;
    const tz = window.SETTINGS.businessTimezone;
    return h('div', { class: 'alert alert-info next-lesson' },
      h('div', { class: 'list-main' },
        h('div', null, t('nextLessonIn', { when: fmtDateTime(occurrence.startAt, tz) }),
          timezone && timezone !== tz ? h('span', { class: 'small' }, ` (${t('inParentTime', { time: fmtDateTime(occurrence.startAt, timezone) })})`) : null),
        suggestedGame(occurrence)),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => window.VIEWS.logLesson({ occurrence: occurrence.key, slot: occurrence, durationMinutes: occurrence.durationMinutes, suggestedGame: occurrence.suggestedGame, onSaved }) }, t('logThisLesson')));
  }

  function gameChips(lesson, { withFreeText = true } = {}) {
    const resolved = lesson.gamesResolved || [];
    const chips = resolved.map((game) => game.exists
      ? h('a', { class: 'chip chip-game', href: `#/content/${game.id}`, onclick: (event) => event.stopPropagation(), title: t('openBoard') }, '♞ ', game.title)
      : h('span', { class: 'chip chip-game removed', title: t('gameRemovedHint') }, '♞ ', game.title, h('span', { class: 'chip-note' }, ` · ${t('gameRemoved')}`)));
    if (withFreeText && lesson.games) chips.push(h('span', { class: 'chip' }, lesson.games));
    return chips.length ? h('div', { class: 'chips' }, chips) : null;
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

  // Cards in balanced columns. Pass them in order of importance: each goes
  // to whichever column is shorter at that point, so the first two sit side
  // by side at the top and no column runs far past the other. Laid out again
  // when the page's width or a card's height changes; one column on narrow
  // screens (the same breakpoint as .grid-2), in the same order.
  const narrowScreen = window.matchMedia('(max-width: 760px)');
  function masonry(cards, { columns = 2, gap = 16 } = {}) {
    const items = cards.filter(Boolean);
    const root = h('div', { class: 'masonry' });
    let plan = '';
    let attached = false;
    const place = (assignment, count) => {
      const key = `${count}:${assignment.join(',')}`;
      if (key === plan) return;
      plan = key;
      const cols = Array.from({ length: count }, () => h('div', { class: 'masonry-col' }));
      items.forEach((card, index) => cols[assignment[index]].append(card));
      clear(root).append(...cols);
    };
    const layout = () => {
      if (!root.isConnected) {
        // The page was replaced: stop watching its cards.
        if (attached) observer.disconnect();
        return;
      }
      attached = true;
      const count = narrowScreen.matches ? 1 : columns;
      // Heights depend on the column width, so measure with the cards
      // already in columns of the final width.
      if (!plan.startsWith(`${count}:`)) place(items.map((_, index) => index % count), count);
      if (count === 1) return;
      const heights = Array(count).fill(0);
      const assignment = items.map((card) => {
        const target = heights.indexOf(Math.min(...heights));
        heights[target] += card.offsetHeight + gap;
        return target;
      });
      place(assignment, count);
    };
    place(items.map(() => 0), 1);
    const observer = new ResizeObserver(layout);
    observer.observe(root);
    for (const card of items) observer.observe(card);
    return root;
  }

  // Where a logged message stands. One sent by hand is just sent; one the
  // server sent follows Twilio's delivery reports, and a failed one says why.
  const MESSAGE_STATUS_TONES = { sent: 'sage', delivered: 'sage', read: 'sage', sending: 'gold', queued: 'gold', trial: 'info', failed: 'danger' };
  function messageStatusBadge(message) {
    const status = message.createdBy === 'auto' ? message.status : (message.status === 'sent' ? 'sent' : 'notSent');
    const label = status === 'sent' || status === 'notSent' ? t(status) : t(`msgStatus.${status}`);
    return h('span', { class: 'row', style: { gap: '4px', display: 'inline-flex' } },
      message.createdBy === 'auto' ? h('span', { class: 'badge badge-ink' }, t('msgAuto')) : null,
      h('span', { class: `badge ${MESSAGE_STATUS_TONES[status] ? `badge-${MESSAGE_STATUS_TONES[status]}` : ''}`, title: message.error || '' }, label)
    );
  }

  window.UI = {
    messageStatusBadge,
    h, append, clear, api, toast, modal, confirmDialog, field, input, phoneInput, fmtPhone, timezoneSelect, textarea, select, enumSelect, teacherSelect, checkbox, formValues, errorBox,
    scheduleEditor, weekdayPicker, fmtDate, fmtDateLong, fmtDateTime, fmtTime, fmtMoney, fmtMonth, balanceText, standingText, priceText, pricesText, priceEditor, todayIso, addDays, weekdayOf,
    initials, scheduleText, ratingsText, statusBadge, board, animateBoard, gameChips, suggestedGame, nextLesson, composeMessage, paymentDialog, pageHead, card, stat, empty, link, masonry, t, guard: guarded
  };
})();
