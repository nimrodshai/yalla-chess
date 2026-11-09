// Settings: defaults, reminder timing and the message templates in both
// languages. Fields save themselves; there is no save button.
(function () {
  'use strict';
  window.VIEWS = window.VIEWS || {};
  const { h, api, t, card, field, input, textarea, checkbox, confirmDialog, toast, link, fmtDate } = window.UI;

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
            // A dotted name (defaultPrices.ILS.group) reads the nested value.
            const current = (versions.get(element) || 0) === version;
            const kept = element.name.split('.').reduce((value, key) => (value && typeof value === 'object' ? value[key] : undefined), saved);
            if (current && kept !== undefined && typeof kept !== 'object' && document.activeElement !== element) element.value = kept;
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

    // What counts as close when a group is suggested for a prospect.
    const matchingStatus = h('span', { class: 'autosave-status', 'aria-live': 'polite' });
    const matchingForm = h('form', { class: 'form' },
      field(t('matchAgeYears'), h('input', { name: 'matchAgeYears', type: 'number', min: 0, max: 20, value: settings.matchAgeYears }), { hint: t('matchAgeYearsHint') }),
      field(t('matchLevelSteps'), h('input', { name: 'matchLevelSteps', type: 'number', min: 0, max: window.VOCAB.levels.length - 1, value: settings.matchLevelSteps }), { hint: t('matchLevelStepsHint') }),
      field(t('matchRatingPoints'), h('input', { name: 'matchRatingPoints', type: 'number', min: 0, max: 3000, step: 10, value: settings.matchRatingPoints }), { hint: t('matchRatingPointsHint') })
    );
    autosave(matchingForm, matchingStatus, (element) => ({ [element.name]: element.value }));

    // What a new student's prices start at, in each currency.
    const pricesStatus = h('span', { class: 'autosave-status', 'aria-live': 'polite' });
    const sign = { ILS: '₪', USD: '$' };
    const pricesForm = h('form', { class: 'form' },
      ['ILS', 'USD'].flatMap((currency) => ['group', 'private'].map((kind) => field(
        `${t(`defaultPrice.${kind}`)} (${sign[currency]})`,
        h('input', { name: `defaultPrices.${currency}.${kind}`, type: 'number', min: 0, step: '0.01', inputmode: 'decimal', value: settings.defaultPrices?.[currency]?.[kind] ?? '' })
      )))
    );
    autosave(pricesForm, pricesStatus, (element) => {
      const [, currency, kind] = element.name.split('.');
      return { defaultPrices: { [currency]: { [kind]: element.value } } };
    });

    // Automatic WhatsApp reminders: off, trial or on, the quiet hours and
    // the reply a parent gets when they write to the reminders number. What
    // is set up in Twilio comes from the server, never the values.
    const autoStatus = h('span', { class: 'autosave-status', 'aria-live': 'polite' });
    const auto = settings.autoMessages || {};
    const { whatsApp } = await api('/settings');
    const ready = (ok) => h('span', { class: `badge ${ok ? 'badge-sage' : 'badge-warn'}` }, t(ok ? 'autoReady' : 'autoMissing'));
    const autoForm = h('form', { class: 'form' },
      field(t('autoMode'), window.UI.select('autoMessages.mode', ['off', 'trial', 'on'].map((mode) => [mode, t(`autoMode.${mode}`)]), auto.mode), { full: true, hint: t('autoModeHint') }),
      h('div', { class: 'field full' }, checkbox('autoMessages.newStudents', auto.newStudents, t('autoNewStudents'))),
      field(t('autoQuietStart'), h('input', { name: 'autoMessages.quietStart', type: 'time', value: auto.quietStart })),
      field(t('autoQuietEnd'), h('input', { name: 'autoMessages.quietEnd', type: 'time', value: auto.quietEnd })),
      field(`${t('autoReply')} · ${t('hebrew')}`, textarea('autoMessages.autoReply.he', auto.autoReply?.he || '', { rows: 3, dir: 'rtl' }), { full: true, hint: t('autoReplyHint') }),
      field(`${t('autoReply')} · ${t('english')}`, textarea('autoMessages.autoReply.en', auto.autoReply?.en || '', { rows: 3, dir: 'ltr' }), { full: true })
    );
    autosave(autoForm, autoStatus, (element) => {
      // autoMessages.autoReply.he → { autoMessages: { autoReply: { he: value } } }
      const keys = element.name.split('.');
      return keys.reduceRight((value, key) => ({ [key]: value }), element.type === 'checkbox' ? element.checked : element.value);
    });

    // Which students get automatic messages, who asked to stop, and the
    // switch for everyone at once.
    const roster = await api('/auto-messages');
    const everyone = (enabled) => async () => {
      if (!(await confirmDialog(t(enabled ? 'autoAllOnConfirm' : 'autoAllOffConfirm'), { danger: !enabled, okLabel: t(enabled ? 'autoAllOn' : 'autoAllOff') }))) return;
      const result = await api('/auto-messages', { method: 'POST', body: { enabled } });
      window.SETTINGS = result.settings;
      toast(t('autoAllDone', { count: result.changed }), 'success');
      refresh();
    };
    const optedOut = roster.off.filter((student) => student.optedOutAt);
    const otherOff = roster.off.filter((student) => !student.optedOutAt);
    const offRow = (student) => h('div', { class: 'list-item' },
      h('div', { class: 'list-main' },
        h('div', { class: 'list-title' }, link(`#/students/${student.id}`, student.name),
          student.optedOutAt ? h('span', { class: 'badge badge-warn' }, t('autoOptedOutOn', { date: fmtDate(student.optedOutAt.slice(0, 10), { year: 'numeric' }) }))
            : student.remindersOff ? h('span', { class: 'badge' }, t('autoRemindersWereOff')) : null),
        student.parentName ? h('div', { class: 'list-sub' }, student.parentName) : null
      )
    );
    const autoRoster = h('div', { class: 'stack', style: { marginTop: '16px' } },
      h('div', { class: 'row', style: { justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' } },
        h('div', { class: 'strong' }, t('autoRosterCount', { on: roster.on, off: roster.off.length })),
        h('div', { class: 'row', style: { gap: '8px' } },
          h('button', { class: 'btn btn-sm', type: 'button', onclick: everyone(true) }, t('autoAllOn')),
          h('button', { class: 'btn btn-sm', type: 'button', onclick: everyone(false) }, t('autoAllOff'))
        )
      ),
      h('div', { class: 'card-sub' }, t('autoOptedOutTitle', { count: optedOut.length })),
      optedOut.length ? h('div', { class: 'list' }, optedOut.map(offRow)) : h('p', { class: 'small muted' }, t('autoNoOptOuts')),
      otherOff.length ? h('details', null,
        h('summary', { class: 'small' }, t('autoOtherOff', { count: otherOff.length })),
        h('div', { class: 'list' }, otherOff.map(offRow))
      ) : null
    );
    const autoSetup = whatsApp && h('div', { class: 'list', style: { marginTop: '12px' } },
      h('div', { class: 'list-item' }, h('div', { class: 'list-title' }, t('autoSender'), ready(whatsApp.sender))),
      h('div', { class: 'list-item' }, h('div', { class: 'list-title' }, t('autoWebhooks'), ready(whatsApp.webhooks))),
      ['lesson_reminder', 'payment_reminder'].flatMap((kind) => ['he', 'en'].map((lang) => h('div', { class: 'list-item' },
        h('div', { class: 'list-title' }, `${t(`msg.${kind}`)} · ${t(lang === 'he' ? 'hebrew' : 'english')}`, ready(whatsApp.templates?.[kind]?.[lang]))
      )))
    );

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
        card(t('matchingTitle'), matchingForm, { sub: t('matchingSub'), actions: [matchingStatus] }),
        card(t('defaultPricesTitle'), pricesForm, { sub: t('defaultPricesSub'), actions: [pricesStatus] }),
        card(t('autoTitle'), h('div', null, autoForm, autoRoster, autoSetup), { sub: t('autoSub'), actions: [autoStatus] }),
        card(t('templates'), templatesForm, { sub: t('templatesSub'), actions: [templatesStatus] }),
        card(t('portalAccounts'), h('p', { class: 'small' }, t('portalAccountsNote'))),
        card(t('integrations'), h('p', { class: 'small' }, t('integrationsNote')))
      )
    );
  };
})();
