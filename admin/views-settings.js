// Settings: defaults, exchange rates, reminder timing and the message
// templates in both languages.
(function () {
  'use strict';
  window.VIEWS = window.VIEWS || {};
  const { h, api, t, card, field, input, textarea, select, formValues, errorBox, toast } = window.UI;

  window.VIEWS.settings = async ({ refresh }) => {
    const settings = window.SETTINGS;

    const generalForm = h('form', { class: 'form form-3' },
      field(t('teacherName'), input('teacherName', settings.teacherName || '')),
      field(t('businessTimezone'), input('businessTimezone', settings.businessTimezone || '', { dir: 'ltr' }), { hint: t('timezoneHint') }),
      field(t('defaultZoomLink'), input('defaultZoomLink', settings.defaultZoomLink || '', { dir: 'ltr' })),
      field(t('reminderLeadHoursSetting'), h('input', { name: 'reminderLeadHours', type: 'number', min: 0, max: 72, value: settings.reminderLeadHours })),
      field(t('paymentReminderDays'), h('input', { name: 'paymentReminderDays', type: 'number', min: 0, max: 60, value: settings.paymentReminderDays })),
      field(t('maxGroupSize'), h('input', { name: 'maxGroupSize', type: 'number', min: 1, max: 30, value: settings.maxGroupSize })),
      field(t('defaultCurrency'), select('defaultCurrency', window.VOCAB.currencies, settings.defaultCurrency)),
      field(t('defaultGroupPrice'), h('input', { name: 'defaultGroupPrice', type: 'number', step: '0.01', min: 0, value: settings.defaultGroupPrice })),
      field(t('defaultPrivatePrice'), h('input', { name: 'defaultPrivatePrice', type: 'number', step: '0.01', min: 0, value: settings.defaultPrivatePrice })),
      field(t('usdToIls'), h('input', { name: 'usdToIls', type: 'number', step: '0.01', min: 0.01, value: settings.usdToIls })),
      field(t('eurToIls'), h('input', { name: 'eurToIls', type: 'number', step: '0.01', min: 0.01, value: settings.eurToIls })),
      h('div', { class: 'form-actions' }, h('button', { class: 'btn btn-primary', type: 'submit' }, t('save')))
    );
    generalForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await api('/settings', { method: 'PUT', body: formValues(generalForm) });
        toast(t('saved'), 'success');
        refresh();
      } catch (error) {
        generalForm.querySelector('.form-error')?.remove();
        generalForm.prepend(errorBox(error.message));
      }
    });

    const templatesForm = h('form', { class: 'stack' },
      window.VOCAB.messageKinds.map((kind) => h('div', { class: 'card', style: { padding: '14px 16px' } },
        h('div', { class: 'card-title', style: { marginBottom: '8px' } }, t(`msg.${kind}`)),
        h('div', { class: 'form' },
          field(t('hebrew'), textarea(`${kind}.he`, settings.templates?.[kind]?.he || '', { rows: 4, dir: 'rtl' })),
          field(t('english'), textarea(`${kind}.en`, settings.templates?.[kind]?.en || '', { rows: 4, dir: 'ltr' }))
        )
      )),
      h('div', { class: 'form-actions' }, h('button', { class: 'btn btn-primary', type: 'submit' }, t('save')))
    );
    templatesForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const templates = {};
      for (const element of templatesForm.elements) {
        if (!element.name) continue;
        const [kind, lang] = element.name.split('.');
        (templates[kind] ||= {})[lang] = element.value;
      }
      try {
        await api('/settings', { method: 'PUT', body: { templates } });
        toast(t('saved'), 'success');
        refresh();
      } catch (error) {
        templatesForm.prepend(errorBox(error.message));
      }
    });

    return h('div', null,
      window.UI.pageHead(t('settingsTitle'), t('settingsSub')),
      h('div', { class: 'stack' },
        card(t('general'), generalForm),
        card(t('templates'), templatesForm, { sub: t('templatesSub') }),
        card(t('portalAccounts'), h('p', { class: 'small' }, t('portalAccountsNote'))),
        card(t('integrations'), h('p', { class: 'small' }, t('integrationsNote')))
      )
    );
  };
})();
