// The tournaments area of the member portal: a parent picks which of their
// children to register, pays, and later finds the Chess.com link and the
// results. It stays out of sight until the school opens a tournament.
(function () {
  'use strict';

  const COPY = {
    he: {
      title: 'טורנירים',
      subtitle: 'נרשמים כאן, משחקים ב-Chess.com',
      upcoming: 'טורנירים קרובים',
      past: 'טורנירים קודמים',
      status: { open: 'ההרשמה פתוחה', closed: 'ההרשמה נסגרה', active: 'הטורניר התחיל', finished: 'הסתיים' },
      rounds: (n) => `${n} סיבובים`,
      spots: (n) => (n === 1 ? 'נשאר מקום אחד' : `נשארו ${n} מקומות`),
      full: 'אין יותר מקומות',
      startsIn: (text) => `מתחיל בעוד ${text}`,
      startingNow: 'מתחיל עכשיו',
      days: (n) => (n === 1 ? 'יום' : n === 2 ? 'יומיים' : `${n} ימים`),
      hours: (n) => (n === 1 ? 'שעה' : n === 2 ? 'שעתיים' : `${n} שעות`),
      minutes: (n) => (n === 1 ? 'דקה' : `${n} דקות`),
      and: ', ',
      yourTime: 'לפי השעון שלכם',
      pickAll: 'בחירת כל הילדים',
      username: (name) => `שם המשתמש של ${name} ב-Chess.com`,
      usernameHint: 'צריך אותו כדי לשחק בטורניר',
      division: 'קטגוריה',
      divisionLater: 'הקטגוריה תיקבע בקרוב',
      registered: 'רשום לטורניר',
      pending: 'ממתין לתשלום',
      paying: 'התשלום בבדיקה',
      notRegistered: 'לא נרשם',
      join: 'כניסה לטורניר ב-Chess.com',
      joinSoon: 'הקישור לטורניר יופיע כאן בקרוב',
      pay: 'לתשלום',
      cancel: 'ביטול הרשמה',
      cancelAsk: (name) => `לבטל את ההרשמה של ${name}?`,
      register: (total) => `הרשמה ותשלום · ${total}`,
      registerNoPay: (total) => `הרשמה · ${total}`,
      pickChild: 'בחרו מי משתתף',
      working: 'רגע…',
      awaitingPay: 'המקום שמור. דולב יעדכן אתכם איך משלמים.',
      paymentFailed: 'המקום נשמר, אבל עמוד התשלום לא נפתח. נסו שוב בעוד רגע.',
      cancelled: 'ההרשמה בוטלה.',
      details: 'פרטים ומשתתפים',
      rules: 'כללים',
      participants: 'משתתפים',
      noParticipants: 'עדיין אין משתתפים מאושרים',
      general: 'כל המשתתפים',
      results: 'תוצאות',
      resultsSoon: 'התוצאות יפורסמו בקרוב',
      rank: 'מקום',
      player: 'שחקן',
      points: 'נקודות',
      wins: 'ניצחונות',
      draws: 'תיקו',
      losses: 'הפסדים',
      games: 'משחקים',
      place: (n) => `מקום ${n}`,
      score: (n) => `${n} נקודות`,
      errors: {
        closed: 'ההרשמה לטורניר הזה נסגרה.',
        full: 'אין מספיק מקומות פנויים בטורניר.',
        already: 'הילד כבר רשום לטורניר.',
        username: 'כתבו שם משתמש תקין ב-Chess.com: אותיות באנגלית, מספרים, מקף או קו תחתון.',
        mixed_currency: 'ילדים שגרים במדינות שונות נרשמים בנפרד.',
        busy: 'התשלום כבר בדרך, רגע אחד.',
        paid: 'כדי לבטל הרשמה ששולמה דברו עם דולב.',
        generic: 'משהו השתבש. נסו שוב בעוד רגע.'
      }
    },
    en: {
      title: 'Tournaments',
      subtitle: 'Register here, play on Chess.com',
      upcoming: 'Upcoming tournaments',
      past: 'Past tournaments',
      status: { open: 'Registration open', closed: 'Registration closed', active: 'In progress', finished: 'Finished' },
      rounds: (n) => `${n} rounds`,
      spots: (n) => (n === 1 ? '1 spot left' : `${n} spots left`),
      full: 'No spots left',
      startsIn: (text) => `Starts in ${text}`,
      startingNow: 'Starting now',
      days: (n) => (n === 1 ? '1 day' : `${n} days`),
      hours: (n) => (n === 1 ? '1 hour' : `${n} hours`),
      minutes: (n) => (n === 1 ? '1 minute' : `${n} minutes`),
      and: ' and ',
      yourTime: 'your local time',
      pickAll: 'Select all children',
      username: (name) => `${name}'s Chess.com username`,
      usernameHint: 'Needed to play in the tournament',
      division: 'Division',
      divisionLater: 'Division to be announced',
      registered: 'Registered',
      pending: 'Waiting for payment',
      paying: 'Checking the payment',
      notRegistered: 'Not registered',
      join: 'Join on Chess.com',
      joinSoon: 'The tournament link will appear here soon',
      pay: 'Pay now',
      cancel: 'Cancel registration',
      cancelAsk: (name) => `Cancel ${name}'s registration?`,
      register: (total) => `Register and pay · ${total}`,
      registerNoPay: (total) => `Register · ${total}`,
      pickChild: 'Choose who is playing',
      working: 'One moment…',
      awaitingPay: 'The spot is saved. Dolev will let you know how to pay.',
      paymentFailed: 'The spot is saved, but the payment page did not open. Please try again in a moment.',
      cancelled: 'The registration was cancelled.',
      details: 'Details and players',
      rules: 'Rules',
      participants: 'Players',
      noParticipants: 'No confirmed players yet',
      general: 'All players',
      results: 'Results',
      resultsSoon: 'Results will be published soon',
      rank: 'Place',
      player: 'Player',
      points: 'Points',
      wins: 'Wins',
      draws: 'Draws',
      losses: 'Losses',
      games: 'Games',
      place: (n) => `Place ${n}`,
      score: (n) => `${n} points`,
      errors: {
        closed: 'Registration for this tournament has closed.',
        full: 'There are not enough spots left in this tournament.',
        already: 'This child is already registered.',
        username: 'Enter a valid Chess.com username: English letters, numbers, a hyphen or an underscore.',
        mixed_currency: 'Children living in different countries register separately.',
        busy: 'The payment is on its way, one moment.',
        paid: 'To cancel a paid registration, please talk to Dolev.',
        generic: 'Something went wrong. Please try again in a moment.'
      }
    }
  };

  const state = {
    signedIn: false,
    lang: 'he',
    data: null,
    clockOffset: 0,
    picked: {},
    usernames: {},
    notes: {},
    busy: '',
    open: {}
  };
  let root = null;
  // Set when a parent arrives from the landing page's Register button: the
  // first time the tournaments are drawn, the page scrolls to them.
  let wantScroll = false;
  let pollTimer = null;
  let clockTimer = null;

  const copy = () => COPY[state.lang === 'en' ? 'en' : 'he'];
  const locale = () => (state.lang === 'en' ? 'en-US' : 'he-IL');
  const nowMs = () => Date.now() + state.clockOffset;

  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else if (key === 'checked' || key === 'disabled' || key === 'value') node[key] = value;
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child);
    }
    return node;
  }

  const localized = (record, key) => (state.lang === 'en' ? (record[`${key}En`] || record[key]) : (record[key] || record[`${key}En`]));

  function money(amount, currency) {
    return new Intl.NumberFormat(locale(), { style: 'currency', currency, maximumFractionDigits: amount % 1 ? 2 : 0 }).format(amount);
  }

  function dateText(iso) {
    return new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
  }

  function countdownText(iso) {
    const t = copy();
    const minutes = Math.floor((Date.parse(iso) - nowMs()) / 60000);
    if (minutes <= 0) return t.startingNow;
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    const rest = minutes % 60;
    const parts = days ? [t.days(days), hours ? t.hours(hours) : ''] : hours ? [t.hours(hours), rest ? t.minutes(rest) : ''] : [t.minutes(rest)];
    return t.startsIn(parts.filter(Boolean).join(t.and));
  }

  const isUpcoming = (tournament) => tournament.status !== 'finished';

  // ------------------------------------------------------------- the API

  async function request(path, body) {
    const response = await fetch(`/api/tournaments${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      headers: body === undefined ? { Accept: 'application/json' } : { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw Object.assign(new Error(data.error || 'generic'), { status: response.status });
    return data;
  }

  function accept(data) {
    state.data = data;
    state.clockOffset = Number.isFinite(Date.parse(data.serverTime)) ? Date.parse(data.serverTime) - Date.now() : 0;
    schedulePoll();
  }

  async function load() {
    try {
      accept(await request(''));
      render();
    } catch (error) {
      // The rest of the portal keeps working; this area just stays hidden.
      if (error.status === 401) state.data = null;
    }
  }

  // After a payment the portal waits for PayMe's confirmation. Nothing is
  // redrawn while a parent is in the middle of choosing.
  function schedulePoll() {
    clearTimeout(pollTimer);
    const waiting = state.data?.tournaments.some((tournament) => tournament.entries.some((entry) => entry.paying));
    if (!waiting || !state.signedIn) return;
    pollTimer = setTimeout(async () => {
      const choosing = Object.values(state.picked).some((set) => set.size) || root?.contains(document.activeElement);
      if (choosing || state.busy) { schedulePoll(); return; }
      await load();
    }, 10000);
  }

  async function act(tournamentId, path, body, onDone) {
    if (state.busy) return;
    state.busy = tournamentId;
    state.notes[tournamentId] = null;
    render();
    try {
      const data = await request(`/${tournamentId}/${path}`, body);
      accept(data);
      state.picked[tournamentId] = new Set();
      if (data.payUrl) {
        window.location.assign(data.payUrl);
        return;
      }
      state.notes[tournamentId] = onDone(data);
    } catch (error) {
      const t = copy();
      state.notes[tournamentId] = { tone: 'error', text: t.errors[error.message] || t.errors.generic };
    }
    state.busy = '';
    render();
  }

  function register(tournament) {
    const t = copy();
    const ids = [...picked(tournament.id)];
    const usernames = {};
    for (const id of ids) if (state.usernames[id]) usernames[id] = state.usernames[id];
    act(tournament.id, 'register', { studentIds: ids, usernames }, (data) => (
      data.paymentFailed ? { tone: 'error', text: t.paymentFailed } : null
    ));
  }

  function pay(tournament) {
    const t = copy();
    act(tournament.id, 'pay', {}, (data) => (
      data.paymentFailed ? { tone: 'error', text: t.paymentFailed } : null
    ));
  }

  function cancel(tournament, entry) {
    const t = copy();
    if (!window.confirm(t.cancelAsk(entry.firstName))) return;
    act(tournament.id, 'cancel', { studentId: entry.studentId }, () => ({ tone: 'ok', text: t.cancelled }));
  }

  // ------------------------------------------------------------ the page

  function picked(id) {
    if (!state.picked[id]) state.picked[id] = new Set();
    return state.picked[id];
  }

  const divisionName = (tournament, id) => {
    const division = tournament.divisions.find((entry) => entry.id === id);
    return division ? localized(division, 'name') : '';
  };

  const needsUsername = (entry) => !state.data.children.find((child) => child.id === entry.studentId)?.chesscomUsername;

  function pill(text, tone) {
    return el('span', { class: `pt-pill pt-pill-${tone}` }, text);
  }

  function entryRow(tournament, entry) {
    const t = copy();
    const canPick = entry.status === 'none' && tournament.registrationOpen && tournament.spotsLeft !== 0;
    const division = divisionName(tournament, entry.divisionId);
    const divisionLine = tournament.divisions.length ? (division ? `${t.division}: ${division}` : t.divisionLater) : '';
    const set = picked(tournament.id);
    const main = el('div', { class: 'pt-entry-main' },
      el('span', { class: 'pt-entry-name' }, entry.firstName),
      divisionLine ? el('span', { class: 'pt-entry-sub' }, divisionLine) : null
    );

    const side = [];
    if (canPick) side.push(el('span', { class: 'pt-entry-fee' }, money(entry.fee.amount, entry.fee.currency)));
    if (entry.status === 'confirmed') side.push(pill(t.registered, 'ok'));
    if (entry.status === 'pending') side.push(pill(entry.paying ? t.paying : t.pending, 'warn'));
    if (entry.status === 'none' && !canPick) side.push(pill(t.notRegistered, 'mute'));

    const row = canPick
      ? el('label', { class: `pt-entry pt-entry-pick${set.has(entry.studentId) ? ' is-picked' : ''}` },
        el('input', {
          type: 'checkbox',
          checked: set.has(entry.studentId),
          onchange: (event) => {
            if (event.target.checked) set.add(entry.studentId); else set.delete(entry.studentId);
            render();
          }
        }),
        main,
        el('span', { class: 'pt-entry-side' }, side))
      : el('div', { class: 'pt-entry' }, main, el('span', { class: 'pt-entry-side' }, side));

    const extras = [];
    if (canPick && set.has(entry.studentId) && needsUsername(entry)) {
      const id = `pt-user-${tournament.id}-${entry.studentId}`;
      extras.push(el('div', { class: 'pt-username' },
        el('label', { for: id }, t.username(entry.firstName)),
        el('input', {
          id, type: 'text', dir: 'ltr', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', maxlength: '30',
          value: state.usernames[entry.studentId] || '',
          oninput: (event) => { state.usernames[entry.studentId] = event.target.value.trim(); syncSubmit(tournament); }
        }),
        el('span', { class: 'pt-hint' }, t.usernameHint)));
    }
    if (entry.status === 'confirmed' && tournament.status !== 'finished') {
      extras.push(entry.joinUrl
        ? el('a', { class: 'pt-btn pt-btn-gold', href: entry.joinUrl, target: '_blank', rel: 'noopener' }, t.join)
        : el('p', { class: 'pt-hint' }, t.joinSoon));
    }
    if (entry.status === 'pending') {
      extras.push(el('div', { class: 'pt-entry-actions' },
        el('button', { class: 'pt-btn pt-btn-quiet', type: 'button', disabled: Boolean(state.busy), onclick: () => cancel(tournament, entry) }, t.cancel)));
    }
    return el('li', { class: 'pt-entry-wrap' }, row, extras);
  }

  function selection(tournament) {
    const set = picked(tournament.id);
    const entries = tournament.entries.filter((entry) => set.has(entry.studentId));
    const currency = entries[0]?.fee.currency || tournament.entries[0]?.fee.currency || 'ILS';
    const total = entries.reduce((sum, entry) => sum + entry.fee.amount, 0);
    const ready = entries.length > 0 && entries.every((entry) => !needsUsername(entry) || /^[A-Za-z0-9_-]{3,30}$/.test(state.usernames[entry.studentId] || ''));
    return { entries, total, currency, ready };
  }

  function syncSubmit(tournament) {
    const button = root?.querySelector(`[data-submit="${tournament.id}"]`);
    if (button) button.disabled = !selection(tournament).ready || Boolean(state.busy);
  }

  // One payment covers every child still waiting, so there is one button.
  function payBar(tournament) {
    const t = copy();
    const pending = tournament.entries.filter((entry) => entry.status === 'pending');
    if (!pending.length) return null;
    if (!state.data.paymeReady) return el('p', { class: 'pt-note pt-note-ok', role: 'status' }, t.awaitingPay);
    const fresh = pending.filter((entry) => !entry.paying);
    const due = fresh.length ? fresh : pending;
    const total = due.reduce((sum, entry) => sum + entry.fee.amount, 0);
    return el('button', {
      class: 'pt-btn pt-btn-gold pt-pay',
      type: 'button',
      disabled: Boolean(state.busy),
      onclick: () => pay(tournament)
    }, state.busy === tournament.id ? t.working : `${t.pay} · ${money(total, due[0].fee.currency)}`);
  }

  function registerBar(tournament) {
    const t = copy();
    const pickable = tournament.entries.filter((entry) => entry.status === 'none');
    if (!pickable.length || !tournament.registrationOpen || tournament.spotsLeft === 0) return null;
    const set = picked(tournament.id);
    const { entries, total, currency, ready } = selection(tournament);
    const allPicked = pickable.every((entry) => set.has(entry.studentId));
    const label = !entries.length
      ? t.pickChild
      : state.busy === tournament.id
        ? t.working
        : (state.data.paymeReady && total > 0 ? t.register : t.registerNoPay)(money(total, currency));
    return el('div', { class: 'pt-bar' },
      pickable.length > 1 ? el('label', { class: 'pt-all' },
        el('input', {
          type: 'checkbox',
          checked: allPicked,
          onchange: (event) => {
            for (const entry of pickable) {
              if (event.target.checked) set.add(entry.studentId); else set.delete(entry.studentId);
            }
            render();
          }
        }),
        t.pickAll) : el('span'),
      el('button', {
        class: 'pt-btn pt-btn-primary',
        type: 'button',
        'data-submit': tournament.id,
        disabled: !ready || Boolean(state.busy),
        onclick: () => register(tournament)
      }, label));
  }

  // Rows grouped by division, in the order the school set them.
  function byDivision(tournament, rows) {
    const t = copy();
    const groups = tournament.divisions.map((division) => ({ title: localized(division, 'name'), rows: rows.filter((row) => row.divisionId === division.id) }));
    const rest = rows.filter((row) => !tournament.divisions.some((division) => division.id === row.divisionId));
    if (rest.length) groups.push({ title: tournament.divisions.length ? t.divisionLater : t.general, rows: rest });
    return groups.filter((group) => group.rows.length);
  }

  function detailsBlock(tournament) {
    const t = copy();
    const rules = localized(tournament, 'rules');
    const groups = byDivision(tournament, tournament.participants);
    return el('details', {
      class: 'pt-details',
      open: state.open[tournament.id] ? true : null,
      ontoggle: (event) => { state.open[tournament.id] = event.target.open; }
    },
    el('summary', null, t.details),
    rules ? el('div', { class: 'pt-section' }, el('h4', null, t.rules), el('p', { class: 'pt-rules' }, rules)) : null,
    el('div', { class: 'pt-section' },
      el('h4', null, `${t.participants} (${tournament.participants.length})`),
      groups.length
        ? groups.map((group) => el('div', { class: 'pt-names' },
          groups.length > 1 || tournament.divisions.length ? el('div', { class: 'pt-names-title' }, group.title) : null,
          el('ul', null, group.rows.map((row) => el('li', { class: row.mine ? 'is-mine' : null }, row.name)))))
        : el('p', { class: 'pt-hint' }, t.noParticipants)));
  }

  function metaLine(tournament) {
    const t = copy();
    const items = [tournament.timeControl, tournament.rounds ? t.rounds(tournament.rounds) : ''];
    if (tournament.registrationOpen && tournament.spotsLeft !== null) items.push(tournament.spotsLeft ? t.spots(tournament.spotsLeft) : t.full);
    return items.filter(Boolean).map((item) => el('span', null, item));
  }

  function upcomingCard(tournament) {
    const t = copy();
    const note = state.notes[tournament.id];
    return el('article', { class: 'pt-card' },
      el('header', { class: 'pt-card-head' },
        el('div', { class: 'pt-card-top' },
          pill(t.status[tournament.status] || '', tournament.registrationOpen ? 'ok' : 'mute'),
          el('span', { class: 'pt-countdown', 'data-countdown': tournament.startsAt }, countdownText(tournament.startsAt))),
        el('h3', { class: 'pt-card-title' }, localized(tournament, 'name')),
        el('p', { class: 'pt-when' }, dateText(tournament.startsAt), el('span', { class: 'pt-hint' }, ` · ${t.yourTime}`)),
        el('div', { class: 'pt-meta' }, metaLine(tournament))),
      el('ul', { class: 'pt-entries' }, tournament.entries.map((entry) => entryRow(tournament, entry))),
      note ? el('p', { class: `pt-note pt-note-${note.tone}`, role: 'status' }, note.text) : null,
      payBar(tournament),
      registerBar(tournament),
      detailsBlock(tournament));
  }

  function standingsTable(tournament, group) {
    const t = copy();
    return el('div', { class: 'pt-table-wrap' },
      el('table', { class: 'pt-table' },
        el('thead', null, el('tr', null,
          el('th', null, t.rank), el('th', null, t.player), el('th', null, t.points), el('th', null, t.wins), el('th', null, t.draws), el('th', null, t.losses), el('th', null, t.games))),
        el('tbody', null, group.rows.map((row) => el('tr', { class: row.mine ? 'is-mine' : null },
          el('td', null, row.rank ?? '–'),
          el('td', null, row.name),
          el('td', null, row.score ?? '–'),
          el('td', null, row.wins ?? '–'),
          el('td', null, row.draws ?? '–'),
          el('td', null, row.losses ?? '–'),
          el('td', null, row.gamesUrl ? el('a', { href: row.gamesUrl, target: '_blank', rel: 'noopener' }, '↗') : '–'))))));
  }

  function pastCard(tournament) {
    const t = copy();
    const mine = tournament.entries.filter((entry) => entry.result);
    const groups = byDivision(tournament, tournament.standings);
    return el('article', { class: 'pt-card pt-card-past' },
      el('header', { class: 'pt-card-head' },
        el('h3', { class: 'pt-card-title' }, localized(tournament, 'name')),
        el('p', { class: 'pt-when' }, dateText(tournament.startsAt))),
      mine.length ? el('ul', { class: 'pt-trophies' }, mine.map((entry) => el('li', null,
        el('strong', null, entry.firstName),
        entry.result.rank ? el('span', null, t.place(entry.result.rank)) : null,
        entry.result.score !== null ? el('span', null, t.score(entry.result.score)) : null))) : null,
      tournament.resultsPublished
        ? el('details', { class: 'pt-details' }, el('summary', null, t.results),
          groups.map((group) => el('div', { class: 'pt-section' }, tournament.divisions.length ? el('h4', null, group.title) : null, standingsTable(tournament, group))))
        : el('p', { class: 'pt-hint' }, t.resultsSoon));
  }

  function render() {
    root = root || document.getElementById('portalTournaments');
    if (!root) return;
    const tournaments = state.signedIn ? (state.data?.tournaments || []) : [];
    const focused = document.activeElement && root.contains(document.activeElement) ? document.activeElement.id : '';
    root.replaceChildren();
    root.hidden = !tournaments.length;
    if (!tournaments.length) return;
    const t = copy();
    const upcoming = tournaments.filter(isUpcoming).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    const past = tournaments.filter((tournament) => !isUpcoming(tournament));
    root.append(...[
      el('div', { class: 'pt-head' },
        el('h2', { class: 'pt-title' }, t.title),
        el('p', { class: 'pt-subtitle' }, t.subtitle)),
      upcoming.length ? el('div', { class: 'pt-list' }, upcoming.map(upcomingCard)) : null,
      past.length ? el('h3', { class: 'pt-group-title' }, t.past) : null,
      past.length ? el('div', { class: 'pt-list' }, past.map(pastCard)) : null
    ].filter(Boolean));
    if (focused) document.getElementById(focused)?.focus();
    if (wantScroll) {
      wantScroll = false;
      requestAnimationFrame(() => root.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  }

  function tickCountdowns() {
    if (!root) return;
    for (const node of root.querySelectorAll('[data-countdown]')) node.textContent = countdownText(node.dataset.countdown);
  }

  // Called by the portal whenever it redraws.
  function sync({ signedIn, lang }) {
    const langChanged = lang !== state.lang;
    state.lang = lang;
    if (signedIn !== state.signedIn) {
      state.signedIn = signedIn;
      if (signedIn) {
        load();
        clockTimer = setInterval(tickCountdowns, 30000);
      } else {
        clearInterval(clockTimer);
        clearTimeout(pollTimer);
        Object.assign(state, { data: null, picked: {}, usernames: {}, notes: {}, busy: '', open: {} });
        render();
      }
    } else if (langChanged) {
      render();
    }
  }

  // Back from the payment page, including through the browser's back button.
  window.addEventListener('pageshow', (event) => {
    if (event.persisted && state.signedIn) {
      state.busy = '';
      load();
    }
  });

  function reveal() {
    wantScroll = true;
    if (state.data && root && !root.hidden) render();
  }

  window.PortalTournaments = { sync, reveal };
})();
