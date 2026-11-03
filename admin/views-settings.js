// Settings: defaults, reminder timing and the message templates in both
// languages. Fields save themselves; there is no save button.
(function () {
  'use strict';
  window.VIEWS = window.VIEWS || {};
  const { h, api, t, card, field, input, textarea } = window.UI;

  // One queue for every settings save the app makes, across re-renders and
  // visits to this page, so an older save can never land after a newer one.
  let saveQueue = Promise.resolve();
  // Text still waiting out its typing pause is saved the moment the page is
  // left, ahead of anything typed on the next visit.
  const flushers = new Set();
  const flushAll = () => { for (const flush of [...flushers]) flush(); };
  window.addEventListener('hashchange', flushAll);
  window.addEventListener('pagehide', flushAll);

  window.VIEWS.settings = async ({ refresh }) => {
    const settings = window.SETTINGS;

    // Every field saves on its own as soon as it changes; text waits for a
    // pause in typing. The card shows whether the last save went through.
    const status = h('span', { class: 'autosave-status', 'aria-live': 'polite' });
    const templatesStatus = h('span', { class: 'autosave-status', 'aria-live': 'polite' });
    // Saves go out one at a time, in the order the edits were made, so a
    // slow reply can never land after a newer one. A field's server value is
    // written back only if nothing newer was typed into it meanwhile, and a
    // failed field keeps its error showing until that field saves.
    const autosave = (form, statusNode, bodyFor) => {
      const timers = new Map();
      const versions = new Map();
      const failures = new Map();
      let pending = 0;
      const show = () => {
        if (pending) { statusNode.textContent = t('autosaving'); statusNode.dataset.state = 'saving'; }
        else if (failures.size) { statusNode.textContent = [...failures.values()][0]; statusNode.dataset.state = 'error'; }
        else { statusNode.textContent = t('autosaved'); statusNode.dataset.state = 'saved'; }
      };
      const save = (element) => {
        clearTimeout(timers.get(element));
        timers.delete(element);
        const version = versions.get(element) || 0;
        const body = bodyFor(element);
        pending += 1;
        show();
        saveQueue = saveQueue.then(async () => {
          try {
            const { settings: saved } = await api('/settings', { method: 'PUT', body });
            window.SETTINGS = saved;
            failures.delete(element);
            element.classList.remove('invalid');
            // Show what the server kept (an empty number falls back to its
            // default), unless the field has been edited since this save.
            const current = (versions.get(element) || 0) === version;
            if (current && element.name in saved && document.activeElement !== element) element.value = saved[element.name];
          } catch (error) {
            if ((versions.get(element) || 0) === version) {
              failures.set(element, error.message);
              element.classList.add('invalid');
            }
          } finally {
            pending -= 1;
            show();
          }
        });
      };
      const edited = (element) => versions.set(element, (versions.get(element) || 0) + 1);
      const flush = () => {
        for (const element of [...timers.keys()]) save(element);
        if (!form.isConnected) flushers.delete(flush);
      };
      flushers.add(flush);
      form.addEventListener('submit', (event) => event.preventDefault());
      form.addEventListener('change', (event) => {
        const element = event.target;
        if (!element.name) return;
        if (element.tagName === 'SELECT') edited(element);
        save(element);
      });
      form.addEventListener('input', (event) => {
        const element = event.target;
        if (!element.name || element.tagName === 'SELECT') return;
        edited(element);
        clearTimeout(timers.get(element));
        timers.set(element, setTimeout(() => save(element), 800));
      });
    };

    const generalForm = h('form', { class: 'form' },
      field(t('teacherName'), input('teacherName', settings.teacherName || '')),
      field(t('businessTimezone'), window.UI.timezoneSelect('businessTimezone', settings.businessTimezone || 'Asia/Jerusalem')),
      field(t('reminderLeadHoursSetting'), h('input', { name: 'reminderLeadHours', type: 'number', min: 0, max: 72, value: settings.reminderLeadHours })),
      field(t('paymentReminderDays'), h('input', { name: 'paymentReminderDays', type: 'number', min: 0, max: 60, value: settings.paymentReminderDays })),
      field(t('maxGroupSize'), h('input', { name: 'maxGroupSize', type: 'number', min: 1, max: 30, value: settings.maxGroupSize }))
    );
    autosave(generalForm, status, (element) => ({ [element.name]: element.value }));

    const templatesForm = h('form', { class: 'stack' },
      window.VOCAB.messageKinds.map((kind) => h('div', { class: 'card', style: { padding: '14px 16px' } },
        h('div', { class: 'card-title', style: { marginBottom: '8px' } }, t(`msg.${kind}`)),
        h('div', { class: 'form' },
          field(t('hebrew'), textarea(`${kind}.he`, settings.templates?.[kind]?.he || '', { rows: 4, dir: 'rtl' })),
          field(t('english'), textarea(`${kind}.en`, settings.templates?.[kind]?.en || '', { rows: 4, dir: 'ltr' }))
        )
      ))
    );
    autosave(templatesForm, templatesStatus, (element) => {
      const [kind, lang] = element.name.split('.');
      return { templates: { [kind]: { [lang]: element.value } } };
    });

    return h('div', null,
      window.UI.pageHead(t('settingsTitle'), t('settingsSub')),
      h('div', { class: 'stack' },
        card(t('general'), generalForm, { actions: [status] }),
        card(t('templates'), templatesForm, { sub: t('templatesSub'), actions: [templatesStatus] }),
        card(t('portalAccounts'), h('p', { class: 'small' }, t('portalAccountsNote'))),
        card(t('integrations'), h('p', { class: 'small' }, t('integrationsNote')))
      )
    );
  };
})();
