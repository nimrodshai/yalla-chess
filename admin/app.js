// Shell: authentication check, hash routing, navigation, global search and
// the language toggle. Views live in views-*.js and register themselves on
// window.VIEWS.
(function () {
  'use strict';

  const { h, clear, api, toast, t } = window.UI;
  const main = document.getElementById('main');
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');

  window.VOCAB = {
    studentStatuses: ['trial', 'active', 'waitlist', 'inactive'],
    levels: ['beginner', 'novice', 'intermediate', 'advanced', 'competitive'],
    lessonTypes: ['group', 'private', 'both'],
    billingTypes: ['monthly', 'package', 'per_lesson'],
    currencies: ['ILS', 'USD', 'EUR'],
    languages: ['he', 'en', 'ru', 'fr', 'es', 'other'],
    lessonKinds: ['group', 'private', 'trial', 'makeup'],
    attendance: ['present', 'absent', 'late'],
    leadStatuses: ['new', 'contacted', 'trial_scheduled', 'trial_done', 'waiting_group', 'converted', 'lost'],
    leadSources: ['facebook', 'instagram', 'website', 'referral', 'other'],
    leadPreferences: ['group', 'private', 'either'],
    contentKinds: ['plan', 'exercise', 'game', 'homework', 'curriculum'],
    expenseCategories: ['advertising', 'teacher', 'operations', 'software', 'other'],
    eventKinds: ['cancel', 'reschedule', 'makeup', 'trial', 'private', 'other'],
    groupStatuses: ['active', 'forming', 'full', 'closed'],
    messageKinds: ['lesson_reminder', 'payment_reminder', 'lesson_summary', 'homework', 'progress', 'trial_invite', 'followup', 'schedule_change', 'new_group', 'review_request', 'tournament', 'custom'],
    paymentMethods: ['bit', 'paybox', 'bank', 'paypal', 'credit', 'cash', 'other']
  };
  window.SETTINGS = {};
  window.APP = { user: null, groups: [], teachers: [] };

  // ----------------------------------------------------------- language
  function applyStaticText() {
    document.documentElement.setAttribute('lang', window.I18N.lang);
    document.documentElement.setAttribute('dir', window.I18N.lang === 'he' ? 'rtl' : 'ltr');
    document.title = window.I18N.lang === 'he' ? 'ניהול | Yalla-Chess' : 'Management | Yalla-Chess';
    for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
    for (const node of document.querySelectorAll('[data-i18n-placeholder]')) node.placeholder = t(node.dataset.i18nPlaceholder);
    document.getElementById('langToggle').textContent = window.I18N.lang === 'he' ? 'EN' : 'עב';
  }

  document.getElementById('langToggle').addEventListener('click', () => {
    window.I18N.lang = window.I18N.lang === 'he' ? 'en' : 'he';
    try { localStorage.setItem('yallaChessLanguage', window.I18N.lang); } catch (error) { /* ignore */ }
    applyStaticText();
    render();
  });

  // ----------------------------------------------------------- sidebar
  const toggleSidebar = (open) => {
    sidebar.classList.toggle('open', open);
    backdrop.classList.toggle('open', open);
  };
  document.getElementById('menuToggle').addEventListener('click', () => toggleSidebar(!sidebar.classList.contains('open')));
  backdrop.addEventListener('click', () => toggleSidebar(false));
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') toggleSidebar(false); });
  sidebar.addEventListener('click', (event) => { if (event.target.closest('a')) toggleSidebar(false); });

  // ----------------------------------------------------------- search
  const searchInput = document.getElementById('globalSearch');
  const searchResults = document.getElementById('globalSearchResults');
  let searchTimer = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = searchInput.value.trim();
    if (q.length < 2) { searchResults.hidden = true; return; }
    searchTimer = setTimeout(async () => {
      try {
        const [students, leads] = await Promise.all([
          api(`/students?q=${encodeURIComponent(q)}`),
          api(`/leads?q=${encodeURIComponent(q)}`)
        ]);
        clear(searchResults);
        const rows = [
          ...students.students.slice(0, 6).map((student) => ({ hash: `#/students/${student.id}`, title: student.name, sub: `${t('student')} · ${student.parentName || ''} ${student.parentPhone || ''}` })),
          ...leads.leads.slice(0, 4).map((lead) => ({ hash: `#/leads/${lead.id}`, title: lead.childName || lead.parentName, sub: `${t('leadFor')} · ${lead.parentName} ${lead.parentPhone || ''}` }))
        ];
        if (!rows.length) rows.push({ hash: '', title: t('noStudents'), sub: '' });
        for (const row of rows) {
          searchResults.append(h('div', { class: 'search-result', onclick: () => { if (row.hash) { location.hash = row.hash; } searchResults.hidden = true; searchInput.value = ''; } },
            h('span', null, row.title), h('small', null, row.sub)));
        }
        searchResults.hidden = false;
      } catch (error) {
        searchResults.hidden = true;
        toast(error.message || t('errorGeneric'), 'error');
      }
    }, 250);
  });
  document.addEventListener('click', (event) => { if (!event.target.closest('.topbar-search')) searchResults.hidden = true; });
  searchInput.addEventListener('keydown', (event) => { if (event.key === 'Escape') searchResults.hidden = true; });

  // ----------------------------------------------------------- routing
  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, '') || 'dashboard';
    const [pathPart, queryPart] = raw.split('?');
    const segments = pathPart.split('/').filter(Boolean);
    const query = Object.fromEntries(new URLSearchParams(queryPart || ''));
    return { route: segments[0] || 'dashboard', id: segments[1] || '', sub: segments[2] || '', query };
  }

  let renderToken = 0;
  async function render() {
    const token = ++renderToken;
    const { route, id, sub, query } = parseHash();
    for (const node of sidebar.querySelectorAll('.nav-item')) node.classList.toggle('active', node.dataset.route === route);
    const view = window.VIEWS[route] || window.VIEWS.dashboard;
    clear(main).append(h('div', { class: 'loading' }, t('loading')));
    try {
      // Settings, groups and teachers are cheap and most views need them.
      const [settingsResponse, groupsResponse, teachersResponse] = await Promise.all([api('/settings'), api('/groups'), api('/teachers')]);
      window.SETTINGS = settingsResponse.settings;
      window.VOCAB = settingsResponse.vocabulary || window.VOCAB;
      window.APP.groups = groupsResponse.groups;
      window.APP.teachers = teachersResponse.teachers;
      if (token !== renderToken) return;
      const content = await view({ id, sub, query, refresh: render });
      if (token !== renderToken) return;
      clear(main).append(content);
      // A board view owns the viewport: the page stays put, columns scroll.
      main.classList.toggle('main--board', Boolean(content.classList && content.classList.contains('board-page')));
      window.scrollTo({ top: 0 });
    } catch (error) {
      if (token !== renderToken) return;
      if (error.status === 401) {
        clear(main).append(h('div', { class: 'card' }, h('p', null, t('signInFirst')), h('p', { style: { marginTop: '12px' } }, h('a', { class: 'btn btn-primary', href: '/' }, t('goSignIn')))));
        return;
      }
      if (error.status === 403) {
        clear(main).append(h('div', { class: 'card' }, h('p', null, t('notTeacher')), h('p', { style: { marginTop: '12px' } }, h('a', { class: 'btn', href: '/' }, t('toPortal')))));
        return;
      }
      clear(main).append(h('div', { class: 'card' }, h('div', { class: 'alert alert-danger' }, error.message || t('errorGeneric'))));
    }
  }

  window.addEventListener('hashchange', render);

  async function boot() {
    applyStaticText();
    try {
      const response = await fetch('/api/me', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      const data = await response.json();
      if (!response.ok || !data.ok) throw Object.assign(new Error(t('signInFirst')), { status: 401 });
      window.APP.user = data.user;
      document.getElementById('topbarUser').textContent = [data.user.firstName, data.user.lastName].filter(Boolean).join(' ') || data.user.phone || data.user.username;
      if (!data.user.canManageUsers) throw Object.assign(new Error(t('notTeacher')), { status: 403 });
    } catch (error) {
      if (error.status === 403) {
        clear(main).append(h('div', { class: 'card' }, h('p', null, t('notTeacher')), h('p', { style: { marginTop: '12px' } }, h('a', { class: 'btn', href: '/' }, t('toPortal')))));
      } else {
        clear(main).append(h('div', { class: 'card' }, h('p', null, t('signInFirst')), h('p', { style: { marginTop: '12px' } }, h('a', { class: 'btn btn-primary', href: '/' }, t('goSignIn')))));
      }
      return;
    }
    render();
  }

  window.APP.render = render;
  window.APP.navigate = (hash) => { if (location.hash === hash) render(); else location.hash = hash; };
  boot();
})();
