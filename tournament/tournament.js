// The tournament landing page. It reads the public facts of the next
// tournament (or of /tournament/<id>) and takes sign-ups on a short form: a
// phone and the children's names. Anyone may send one; the school reads it in
// the admin app and registers the children. Results and the way in on the day
// stay in the portal.
(function () {
  'use strict';

  const LANG_KEY = 'yallaChessLanguage';
  const PORTAL = '/?register=tournament';
  const PIECES = ['pawn', 'knight', 'queen'];

  const COPY = {
    he: {
      langToggle: 'English',
      signIn: 'התחברות',
      badge: { open: 'טורניר', closed: 'ההרשמה נסגרה', active: 'הטורניר התחיל', finished: 'הטורניר הסתיים' },
      lead: 'טורניר שחמט אונליין לילדים, משחקים ב\u2011Chess.com.',
      online: 'אונליין ב-Chess.com',
      register: 'להרשמה',
      registerClosed: 'ההרשמה נסגרה',
      goToTournament: 'כניסה לטורניר',
      seeResults: 'לתוצאות',
      readRules: 'לכללי הטורניר',
      howItWorks: 'איך זה עובד',
      spots: (n) => (n === 0 ? 'כל המקומות נתפסו' : n === 1 ? 'נשאר מקום אחד בלבד' : `נשארו ${n} מקומות`),
      closes: (date) => `ההרשמה נסגרת ב-${date}`,
      divisionsTitle: (n) => ({ 2: 'שתי קטגוריות', 3: 'שלוש קטגוריות', 4: 'ארבע קטגוריות', 5: 'חמש קטגוריות' })[n] || `${n} קטגוריות`,
      divisionsSub: 'כל אחד משחק מול שחקנים ברמה שלו.',
      levels: { pawn: 'מתחילים', knight: 'בינוניים', queen: 'מתקדמים' },
      howTitle: 'איך זה עובד',
      steps: [
        ['ממלאים טופס', 'מספר טלפון ושמות הילדים שמשתתפים.'],
        ['מקבלים אישור', 'ניצור איתכם קשר כדי לאשר את ההרשמה.'],
        ['משחקים ב-Chess.com', 'לפני הטורניר נשלח לכם את הקישור להצטרפות.']
      ],
      detailsTitle: 'הפרטים',
      date: 'תאריך',
      time: 'שעת התחלה',
      localTime: (clock, israel) => `${clock} לפי השעון שלכם (${israel} בישראל)`,
      localShort: 'לפי השעון שלכם',
      where: 'איפה',
      whereValue: 'Chess.com (אונליין)',
      timeControl: 'קצב משחק',
      timeControlValue: (minutes, increment) => `${minutes} דקות לכל שחקן${increment ? `, ועוד ${increment} שניות על כל מסע` : ''}`,
      rounds: 'סיבובים',
      closesAt: 'ההרשמה נסגרת',
      spotsLeft: 'מקומות פנויים',
      rulesTitle: 'כללי הטורניר',
      fairPlayTitle: 'משחק הוגן',
      fairPlay: 'הטורניר שייך לילדים. כל ילד משחק את המשחקים שלו בעצמו, בלי עזרה מהורים, מאחים או מכל אחד אחר, ובלי מנועי שחמט או אפליקציות שמציעות מסעים. ההורים מוזמנים לעודד מהצד, אחרי כל ניצחון ואחרי כל הפסד.',
      ctaTitle: 'מוכנים לשחק?',
      ctaSub: 'ההרשמה לוקחת דקה.',
      form: {
        title: 'הרשמה לטורניר',
        sub: 'השאירו מספר טלפון ואת שמות הילדים שמשתתפים. ניצור איתכם קשר כדי לאשר את ההרשמה.',
        phone: 'טלפון של ההורה',
        phoneHint: '050-123-4567',
        children: 'שמות הילדים המשתתפים',
        childHint: 'שם מלא',
        addChild: '+ ילד נוסף',
        removeChild: 'הסרה',
        submit: 'שליחה',
        sending: 'שולחים…',
        close: 'סגירה',
        doneTitle: 'קיבלנו, תודה!',
        doneBody: 'נחזור אליכם בקרוב כדי לאשר את ההרשמה.',
        errors: {
          phone: 'מספר הטלפון לא נראה תקין.',
          children: 'צריך לכתוב שם של לפחות ילד אחד.',
          too_many: 'אפשר לרשום עד 6 ילדים בטופס אחד.',
          closed: 'ההרשמה כבר נסגרה.',
          full: 'כל המקומות כבר נתפסו.',
          rate_limited: 'נשלחו כמה טפסים ברצף. נסו שוב בעוד שעה.',
          other: 'משהו השתבש. נסו שוב בעוד רגע.'
        }
      },
      home: 'חזרה לאתר',
      noneTitle: 'אין כרגע טורניר פתוח',
      noneLead: 'הטורניר הבא יפורסם כאן בקרוב. בינתיים, ממשיכים להתאמן!',
      errorLead: 'לא הצלחנו לטעון את פרטי הטורניר. נסו שוב בעוד רגע.'
    },
    en: {
      langToggle: 'עברית',
      signIn: 'Sign in',
      badge: { open: 'Tournament', closed: 'Registration closed', active: 'Happening now', finished: 'Finished' },
      lead: 'An online chess tournament for kids, played on Chess.com.',
      online: 'Online on Chess.com',
      register: 'Register now',
      registerClosed: 'Registration closed',
      goToTournament: 'Go to the tournament',
      seeResults: 'See the results',
      readRules: 'Read the rules',
      howItWorks: 'How it works',
      spots: (n) => (n === 0 ? 'All spots are taken' : n === 1 ? 'Only one spot left' : `Only ${n} spots left`),
      closes: (date) => `Registration closes ${date}`,
      divisionsTitle: (n) => `${({ 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five' })[n] || n} divisions`,
      divisionsSub: 'Everyone plays against players at their own level.',
      levels: { pawn: 'Beginners', knight: 'Intermediate', queen: 'Advanced' },
      howTitle: 'How it works',
      steps: [
        ['Fill in the form', 'A phone number and the names of the children playing.'],
        ['Get confirmed', "We'll get in touch to confirm the registration."],
        ['Play on Chess.com', "Before the tournament we'll send you the link to join."]
      ],
      detailsTitle: 'The details',
      date: 'Date',
      time: 'Start time',
      localTime: (clock, israel) => `${clock} your time (${israel} in Israel)`,
      localShort: 'your time',
      where: 'Where',
      whereValue: 'Chess.com (online)',
      timeControl: 'Time control',
      timeControlValue: (minutes, increment) => `${minutes} minutes each${increment ? `, plus ${increment} seconds a move` : ''}`,
      rounds: 'Rounds',
      closesAt: 'Registration closes',
      spotsLeft: 'Spots left',
      rulesTitle: 'Rules',
      fairPlayTitle: 'Fair play',
      fairPlay: 'The tournament belongs to the kids. Every child plays their own games, without help from parents, siblings or anyone else, and without chess engines or apps that suggest moves. Parents are welcome to cheer from the side, after every win and every loss.',
      ctaTitle: 'Ready to play?',
      ctaSub: 'Registering takes a minute.',
      form: {
        title: 'Register for the tournament',
        sub: "Leave a phone number and the names of the children who are playing. We'll get in touch to confirm.",
        phone: "Parent's phone",
        phoneHint: '+1 202 555 0188',
        children: 'Names of the children playing',
        childHint: 'Full name',
        addChild: '+ Another child',
        removeChild: 'Remove',
        submit: 'Send',
        sending: 'Sending…',
        close: 'Close',
        doneTitle: 'Got it, thank you!',
        doneBody: "We'll be in touch soon to confirm the registration.",
        errors: {
          phone: "That phone number doesn't look right.",
          children: "Please write at least one child's name.",
          too_many: 'You can register up to 6 children in one form.',
          closed: 'Registration has already closed.',
          full: 'All the spots are taken.',
          rate_limited: 'Several forms were sent in a row. Please try again in an hour.',
          other: 'Something went wrong. Please try again in a moment.'
        }
      },
      home: 'Back to Yalla-Chess',
      noneTitle: 'No tournament open right now',
      noneLead: 'The next tournament will be announced here soon. Until then, keep practising!',
      errorLead: "We couldn't load the tournament. Please try again in a moment."
    }
  };

  const state = { lang: document.documentElement.lang === 'he' ? 'he' : 'en', data: null, failed: false };
  const $ = (id) => document.getElementById(id);
  const t = () => COPY[state.lang];
  const locale = () => (state.lang === 'he' ? 'he-IL' : 'en-US');

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = value;
      else node.setAttribute(key, value);
    }
    for (const child of children.flat()) {
      if (child !== null && child !== undefined && child !== false) node.append(child);
    }
    return node;
  }

  // Dates and times are shown in the visitor's own time zone: 19:00 in Israel
  // is 12:00 in New York. zone asks for another one, such as the school's.
  function format(iso, options, zone) {
    try {
      return new Intl.DateTimeFormat(locale(), { ...(zone ? { timeZone: zone } : {}), ...options }).format(new Date(iso));
    } catch (error) {
      return new Intl.DateTimeFormat(locale(), options).format(new Date(iso));
    }
  }

  const clockOf = (iso, zone) => format(iso, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, zone);

  // "Winter Open 2026" sets the year in gold under the name. A name without a
  // year gets the day of the tournament there instead.
  function splitTitle(name, startsAt) {
    const match = /^(.*\S)\s+(\d{4})$/.exec(name);
    if (match) return [match[1], match[2]];
    return [name, format(startsAt, { day: 'numeric', month: 'long' })];
  }

  // Hebrew "ב-Chess.com" must not break after the hyphen.
  const keepPrefix = (value) => String(value).replace(/(^|[\s(])([בלמהוכש])-(?=[A-Za-z0-9])/g, '$1$2\u2011');

  function setButton(node, label, href) {
    node.textContent = label;
    if (href) {
      node.href = href;
      node.removeAttribute('aria-disabled');
      node.removeAttribute('tabindex');
    } else {
      node.removeAttribute('href');
      node.setAttribute('aria-disabled', 'true');
      node.setAttribute('tabindex', '-1');
    }
  }

  function renderChrome() {
    const copy = t();
    document.documentElement.lang = state.lang;
    document.documentElement.dir = state.lang === 'he' ? 'rtl' : 'ltr';
    $('tpLang').textContent = copy.langToggle;
    $('tpLang').lang = state.lang === 'he' ? 'en' : 'he';
    $('tpSignIn').textContent = copy.signIn;
    $('tpFormClose').setAttribute('aria-label', copy.form.close);
    $('tpFooterHome').textContent = copy.home;
    $('tpYear').textContent = String(new Date().getFullYear());
    $('tpHowTitle').textContent = copy.howTitle;
    $('tpSteps').replaceChildren(...copy.steps.map(([title, body]) => el('li', {}, el('strong', {}, title), el('span', {}, body))));
  }

  function renderEmpty() {
    const copy = t();
    document.title = 'Yalla-Chess';
    $('tpBadge').hidden = true;
    $('tpTitle').textContent = copy.noneTitle;
    $('tpTitleGold').textContent = '';
    $('tpLead').textContent = state.failed ? copy.errorLead : copy.noneLead;
    $('tpFacts').replaceChildren();
    $('tpNote').hidden = true;
    setButton($('tpRegister'), copy.home, '/');
    $('tpMore').hidden = true;
    for (const id of ['divisions', 'how', 'details', 'rules']) $(id).hidden = true;
    $('tpRegister2').closest('.tp-section').hidden = true;
  }

  function renderTournament(tour) {
    const copy = t();
    const name = (state.lang === 'en' && tour.nameEn) || tour.name || tour.nameEn;
    const [title, gold] = splitTitle(name, tour.startsAt);
    document.title = `${name} | Yalla-Chess`;

    const badge = $('tpBadge');
    badge.hidden = false;
    badge.textContent = tour.registrationOpen ? copy.badge.open : (copy.badge[tour.status] || copy.badge.closed);
    badge.classList.toggle('is-quiet', !tour.registrationOpen);
    $('tpTitle').textContent = title;
    $('tpTitleGold').textContent = gold;
    $('tpLead').textContent = copy.lead;

    const abroad = clockOf(tour.startsAt) !== clockOf(tour.startsAt, state.data.timezone);
    const facts = [
      `${format(tour.startsAt, { weekday: 'short', day: 'numeric', month: 'short' })} · ${clockOf(tour.startsAt)}${abroad ? ` (${copy.localShort})` : ''}`,
      copy.online
    ];
    $('tpFacts').replaceChildren(...facts.flatMap((fact, index) => [
      index ? el('span', { class: 'tp-dot', 'aria-hidden': 'true' }, '•') : null,
      el('bdi', {}, fact)
    ]).filter(Boolean));

    // The button follows the tournament: the form, then the way in, then the
    // results, which live in the portal.
    const full = tour.spotsLeft === 0;
    if (tour.registrationOpen && !full) setButton($('tpRegister'), copy.register, '#register');
    else if (tour.status === 'finished') setButton($('tpRegister'), copy.seeResults, PORTAL);
    else if (tour.status === 'active') setButton($('tpRegister'), copy.goToTournament, PORTAL);
    else setButton($('tpRegister'), copy.registerClosed, '');

    const rules = (state.lang === 'en' ? tour.rulesEn || tour.rules : tour.rules || tour.rulesEn) || '';
    const more = $('tpMore');
    more.hidden = false;
    more.textContent = copy.readRules;
    more.href = '#rules';

    const note = $('tpNote');
    const closesSoon = tour.registrationOpen && tour.closesAt;
    if (tour.registrationOpen && tour.spotsLeft !== null && tour.spotsLeft <= 20) {
      note.textContent = copy.spots(tour.spotsLeft);
      note.hidden = false;
    } else if (closesSoon) {
      note.textContent = copy.closes(format(tour.closesAt, { day: 'numeric', month: 'long' }));
      note.hidden = false;
    } else {
      note.hidden = true;
    }

    // The tournament's own divisions, as the school set them in the admin
    // app, easiest first: a pawn, then up to a queen. With none set, the three
    // usual levels; with one, there is nothing to choose between.
    const names = (tour.divisions || []).map((division) => (state.lang === 'en' && division.nameEn) || division.name).filter(Boolean);
    const levels = names.length ? names : PIECES.map((piece) => copy.levels[piece]);
    $('divisions').hidden = levels.length < 2;
    $('tpDivisionsTitle').textContent = copy.divisionsTitle(levels.length);
    $('tpDivisionsSub').textContent = copy.divisionsSub;
    $('tpDivisions').replaceChildren(...levels.map((name, index) => {
      const piece = PIECES[Math.round(index * (PIECES.length - 1) / Math.max(levels.length - 1, 1))];
      return el('article', { class: 'tp-card tp-division' },
        el('img', { src: `/tournament/art/piece-${piece}.jpg`, alt: '', width: 440, height: 440, loading: 'lazy' }),
        el('h3', {}, name));
    }));

    $('how').hidden = false;

    const rows = [[copy.date, format(tour.startsAt, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })]];
    rows.push([copy.time, abroad ? copy.localTime(clockOf(tour.startsAt), clockOf(tour.startsAt, state.data.timezone)) : clockOf(tour.startsAt)]);
    rows.push([copy.where, copy.whereValue]);
    const control = /^(\d+)\s*\+\s*(\d+)$/.exec(tour.timeControl || '');
    if (tour.timeControl) rows.push([copy.timeControl, control ? `${tour.timeControl} · ${copy.timeControlValue(control[1], Number(control[2]))}` : tour.timeControl]);
    if (tour.rounds) rows.push([copy.rounds, String(tour.rounds)]);
    if (tour.closesAt && tour.registrationOpen) rows.push([copy.closesAt, format(tour.closesAt, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })]);
    if (tour.spotsLeft !== null && tour.registrationOpen) rows.push([copy.spotsLeft, String(tour.spotsLeft)]);
    $('details').hidden = false;
    $('tpDetailsTitle').textContent = copy.detailsTitle;
    $('tpDetails').replaceChildren(...rows.map(([term, value]) => el('div', {}, el('dt', {}, term), el('dd', {}, el('bdi', {}, value)))));

    // The school's rules for this tournament, then the same fair-play rule
    // for every tournament: the child plays, nobody plays for them.
    $('rules').hidden = false;
    $('tpRulesTitle').textContent = copy.rulesTitle;
    $('tpRules').replaceChildren(...[
      rules ? el('p', { class: 'tp-rules-text' }, keepPrefix(rules)) : null,
      el('div', { class: 'tp-fair' },
        el('h3', {}, copy.fairPlayTitle),
        el('p', {}, keepPrefix(copy.fairPlay)))
    ].filter(Boolean));

    const cta = $('tpRegister2').closest('.tp-section');
    cta.hidden = !(tour.registrationOpen && !full);
    $('tpCtaTitle').textContent = copy.ctaTitle;
    $('tpCtaSub').textContent = copy.ctaSub;
    setButton($('tpRegister2'), copy.register, '#register');
  }

  function render() {
    renderChrome();
    const tour = state.data?.tournament;
    if (tour) renderTournament(tour);
    else renderEmpty();
  }

  function show() {
    const main = $('tpMain');
    main.classList.add('ready');
    main.removeAttribute('aria-busy');
  }

  // ------------------------------------------------------------ the form

  const MAX_CHILDREN = 6;
  const form = { open: false, busy: false, done: false, phone: '', children: [''], error: '' };

  function childRow(index) {
    const f = t().form;
    const field = el('input', {
      type: 'text', class: 'tp-input', id: `tpChild${index}`, autocomplete: 'off', maxlength: 60,
      placeholder: f.childHint, 'aria-label': `${f.children} ${index + 1}`
    });
    field.value = form.children[index];
    field.addEventListener('input', () => { form.children[index] = field.value; });
    const remove = index ? el('button', { type: 'button', class: 'tp-remove', 'aria-label': `${f.removeChild} ${index + 1}`, title: f.removeChild }, '×') : null;
    remove?.addEventListener('click', () => {
      form.children.splice(index, 1);
      renderForm();
      $(`tpChild${Math.min(index, form.children.length - 1)}`)?.focus();
    });
    return el('div', { class: 'tp-child' }, field, remove);
  }

  function renderForm() {
    const f = t().form;
    const body = $('tpFormBody');
    $('tpFormTitle').textContent = form.done ? f.doneTitle : f.title;
    if (form.done) {
      const close = el('button', { type: 'button', class: 'tp-btn tp-btn-gold tp-btn-wide' }, f.close);
      close.addEventListener('click', closeForm);
      body.replaceChildren(el('p', { class: 'tp-form-sub' }, f.doneBody), close);
      close.focus();
      return;
    }
    const phone = el('input', {
      type: 'tel', class: 'tp-input', id: 'tpPhone', name: 'phone', dir: 'ltr', inputmode: 'tel', autocomplete: 'tel',
      required: 'required', maxlength: 30, placeholder: f.phoneHint
    });
    phone.value = form.phone;
    phone.addEventListener('input', () => { form.phone = phone.value; });
    const add = form.children.length < MAX_CHILDREN ? el('button', { type: 'button', class: 'tp-add' }, f.addChild) : null;
    add?.addEventListener('click', () => {
      form.children.push('');
      renderForm();
      $(`tpChild${form.children.length - 1}`)?.focus();
    });
    const submit = el('button', { type: 'submit', class: 'tp-btn tp-btn-gold tp-btn-wide', 'aria-busy': form.busy ? 'true' : null }, form.busy ? f.sending : f.submit);
    submit.disabled = form.busy;
    body.replaceChildren(...[
      el('p', { class: 'tp-form-sub' }, f.sub),
      el('label', { class: 'tp-label', for: 'tpPhone' }, f.phone), phone,
      el('p', { class: 'tp-label', id: 'tpChildrenLabel' }, f.children),
      el('div', { class: 'tp-children', role: 'group', 'aria-labelledby': 'tpChildrenLabel' }, form.children.map((_, index) => childRow(index))),
      add,
      // Not for people: a bot that fills every field fills this one too.
      el('input', { type: 'text', name: 'website', class: 'tp-trap', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true' }),
      form.error ? el('p', { class: 'tp-error', role: 'alert' }, form.error) : null,
      submit
    ].filter(Boolean));
  }

  function openForm(event) {
    const tour = state.data?.tournament;
    if (!tour?.registrationOpen) return;
    event?.preventDefault();
    if (form.done) Object.assign(form, { done: false, phone: '', children: [''], error: '' });
    renderForm();
    const dialog = $('tpForm');
    if (!dialog.open) dialog.showModal();
    $('tpPhone')?.focus();
  }

  function closeForm() {
    const dialog = $('tpForm');
    if (dialog.open) dialog.close();
  }

  async function sendForm(event) {
    event.preventDefault();
    if (form.busy) return;
    const f = t().form;
    const children = form.children.map((name) => name.trim()).filter(Boolean);
    form.error = !form.phone.trim() ? f.errors.phone : !children.length ? f.errors.children : '';
    if (form.error) { renderForm(); return; }
    form.busy = true;
    renderForm();
    try {
      const response = await fetch(`/api/public/tournament/${encodeURIComponent(state.data.tournament.id)}/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ phone: form.phone, children, website: $('tpFormBody').querySelector('.tp-trap')?.value || '' })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.ok) throw new Error(body.error || 'other');
      form.done = true;
      form.error = '';
    } catch (error) {
      form.error = f.errors[error.message] || f.errors.other;
    } finally {
      form.busy = false;
      renderForm();
    }
  }

  $('tpFormClose').addEventListener('click', closeForm);
  $('tpForm').addEventListener('click', (event) => { if (event.target === $('tpForm')) closeForm(); });
  $('tpFormBody').addEventListener('submit', sendForm);
  for (const id of ['tpRegister', 'tpRegister2']) {
    $(id).addEventListener('click', (event) => { if ($(id).getAttribute('href') === '#register') openForm(event); });
  }

  $('tpLang').addEventListener('click', () => {
    state.lang = state.lang === 'he' ? 'en' : 'he';
    try { localStorage.setItem(LANG_KEY, state.lang); } catch (error) {}
    render();
    if ($('tpForm').open) renderForm();
  });

  async function load() {
    const id = (/^\/tournament\/(trn_[\w-]+)\/?$/.exec(window.location.pathname) || [])[1] || '';
    try {
      const response = await fetch(`/api/public/tournament${id ? `?id=${encodeURIComponent(id)}` : ''}`, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(String(response.status));
      state.data = await response.json();
    } catch (error) {
      state.failed = true;
      state.data = null;
    }
    render();
    show();
    if (window.location.hash === '#register') openForm();
  }

  renderChrome();
  load();
})();
