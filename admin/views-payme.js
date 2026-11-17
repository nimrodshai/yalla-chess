// PayMe: the setup card on the overview until the account is connected,
// payment links for parents, the list of links on the payments page, and
// the connection in settings.
(function () {
  'use strict';
  const { h, api, t, card, field, toast, errorBox, fmtDate, fmtMoney, link, empty, todayIso } = window.UI;

  // The key PayMe calls the MPL ("seller_payme_id"): where to find it, and
  // the form that checks it with PayMe before saving it.
  function sellerIdForm(onSaved) {
    const keyInput = h('input', { name: 'sellerId', type: 'text', dir: 'ltr', autocomplete: 'off', spellcheck: 'false', placeholder: 'MPL…', required: true, style: { fontFamily: 'ui-monospace, monospace' } });
    const button = h('button', { class: 'btn btn-primary', type: 'submit' }, t('paymeConnect'));
    const form = h('form', { class: 'row', style: { gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' } },
      h('div', { style: { flex: '1 1 260px' } }, field(t('paymeKeyLabel'), keyInput)),
      button
    );
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      form.parentNode?.querySelector('.form-error')?.remove();
      button.disabled = true;
      button.textContent = t('paymeChecking');
      try {
        await api('/payme', { method: 'PUT', body: { sellerId: keyInput.value.trim() } });
        toast(t('paymeConnected'), 'success');
        if (onSaved) onSaved();
      } catch (error) {
        // The server's reasons are in English; the two that matter here
        // are said in the app's language.
        const message = error.status === 400 ? t('paymeKeyRejected') : error.status === 502 ? t('paymeUnreachable') : error.message;
        form.before(errorBox(message));
      } finally {
        button.disabled = false;
        button.textContent = t('paymeConnect');
      }
    });
    return form;
  }

  const step = (n, title, body) => h('div', { class: 'payme-step' },
    h('div', { class: 'payme-step-n' }, n),
    h('div', { class: 'payme-step-body' }, h('div', { class: 'strong' }, title), body));

  // On the overview, at the top, until PayMe is connected.
  function paymeSetupCard(payme, refresh) {
    if (!payme || payme.ready) return null;
    return h('div', { class: 'card payme-setup' },
      h('div', { class: 'card-head' },
        h('div', null,
          h('div', { class: 'card-title' }, h('span', { class: 'badge badge-warn', style: { marginInlineEnd: '8px' } }, t('setupIncomplete')), t('paymeSetupTitle')),
          h('div', { class: 'card-sub' }, t('paymeSetupSub')))),
      h('div', { class: 'stack' },
        step(1, t('paymeStep1'), h('div', null,
          h('p', { class: 'small' }, t('paymeStep1Body')),
          h('a', { class: 'btn btn-primary btn-sm', href: payme.signupUrl, target: '_blank', rel: 'noopener' }, t('paymeSignup'), ' ↗'))),
        step(2, t('paymeStep2'), h('p', { class: 'small' }, t('paymeStep2Body'))),
        step(3, t('paymeStep3'), h('div', null,
          h('p', { class: 'small' }, t('paymeStep3Body')),
          sellerIdForm(refresh)))
      )
    );
  }

  const STATUS_TONES = { completed: 'sage', 'partial-refund': 'warn', refunded: 'danger', chargeback: 'danger', 'partial-chargeback': 'danger', failed: 'warn', initial: '', expired: '' };
  function saleBadge(sale) {
    const tone = STATUS_TONES[sale.status] ?? '';
    return h('span', { class: `badge ${tone ? `badge-${tone}` : ''}`, title: sale.checkError || '' }, t(`payme.${sale.status}`) || sale.status);
  }

  // The message that goes with a link, in the parent's language.
  function linkMessage(sale, student) {
    const lang = student?.language === 'en' ? 'en' : 'he';
    const name = student?.parentName?.split(/\s+/)[0] || '';
    const amount = fmtMoney(sale.amount, sale.currency);
    return lang === 'en'
      ? `Hi${name ? ` ${name}` : ''}, here is the link to pay for ${sale.studentName}'s chess lessons (${amount}):\n${sale.saleUrl}\nThank you!`
      : `היי${name ? ` ${name}` : ''}, זה הקישור לתשלום עבור שיעורי השחמט של ${sale.studentName} (${amount}):\n${sale.saleUrl}\nתודה!`;
  }

  // What to do with a link once it exists: copy it, send it on WhatsApp,
  // or open it.
  function shareLink(sale, student) {
    const message = linkMessage(sale, student);
    const digits = String(student?.parentPhone || '').replace(/\D/g, '');
    return h('div', { class: 'stack' },
      h('div', { class: 'alert alert-sage' }, t(sale.reused ? 'paymeLinkReused' : 'paymeLinkReady', { amount: fmtMoney(sale.amount, sale.currency) })),
      h('div', { class: 'field' }, h('input', { type: 'text', readonly: true, dir: 'ltr', value: sale.saleUrl, onfocus: (event) => event.target.select() })),
      h('div', { class: 'form-actions' },
        h('a', { class: 'btn', href: sale.saleUrl, target: '_blank', rel: 'noopener' }, t('paymeOpenPage')),
        h('button', { class: 'btn', type: 'button', onclick: async () => {
          try { await navigator.clipboard.writeText(message); toast(t('copied'), 'success'); } catch { toast(sale.saleUrl); }
        } }, t('paymeCopyMessage')),
        digits ? h('a', { class: 'btn btn-wa', href: `https://wa.me/${digits}?text=${encodeURIComponent(message)}`, target: '_blank', rel: 'noopener' }, t('paymeSendWhatsApp')) : null
      ),
      h('p', { class: 'small muted' }, t('paymeLinkNote'))
    );
  }

  // A payment link for a student: what they owe, else their next charge.
  // `student` is a student record or a payments-due row.
  async function paymeLinkDialog({ student, onDone }) {
    const studentId = student.studentId || student.id;
    const owed = student.balance < 0 ? -student.balance : (student.nextChargeAmount ?? '');
    const record = student.parentPhone !== undefined && student.language !== undefined ? student : (await api(`/students/${studentId}`)).student;
    const name = student.name || `${record.firstName} ${record.lastName}`;
    window.UI.modal({
      title: t('paymeLinkFor', { name }),
      size: 'modal-sm',
      onClose: onDone,
      body: (dialog) => {
        const amount = h('input', { name: 'amount', type: 'number', step: '0.01', min: '5', value: owed === '' ? '' : Math.round(owed * 100) / 100, required: true });
        const period = h('input', { name: 'periodLabel', type: 'month', value: todayIso().slice(0, 7) });
        const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, t('paymeCreateLink'));
        const form = h('form', { class: 'form' },
          field(`${t('amount')} (${record.currency || student.currency || 'ILS'})`, amount),
          field(t('periodLabel'), period),
          h('div', { class: 'form-actions' },
            h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, t('cancel')),
            submit)
        );
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          form.querySelector('.form-error')?.remove();
          submit.disabled = true;
          try {
            const { sale, reused } = await api('/payme/sales', { method: 'POST', body: { studentId, amount: amount.value, currency: record.currency, periodLabel: period.value } });
            dialog.content.replaceChildren(shareLink({ ...sale, reused }, record));
          } catch (error) {
            form.prepend(errorBox(error.message));
            submit.disabled = false;
          }
        });
        return form;
      }
    });
  }

  function paymeButton(student, onDone, { size = 'btn-xs' } = {}) {
    if (!window.PAYME?.ready) return null;
    return h('button', { class: `btn ${size}`, type: 'button', onclick: () => paymeLinkDialog({ student, onDone }) }, t('paymeLink'));
  }

  // Every link, newest first, with where PayMe has it.
  function paymeSalesCard(sales, refresh) {
    const check = async (sale, button) => {
      button.disabled = true;
      try {
        const { recorded } = await api(`/payme/sales/${sale.id}/check`, { method: 'POST' });
        toast(recorded ? t('paymeRecorded') : t('paymeChecked'), recorded ? 'success' : '');
        refresh();
      } catch (error) {
        toast(error.message, 'error');
        button.disabled = false;
      }
    };
    const rows = sales.map((sale) => h('tr', null,
      h('td', null, fmtDate(sale.createdAt.slice(0, 10), { year: 'numeric' })),
      h('td', null, link(`#/students/${sale.studentId}`, sale.studentName || sale.studentId), sale.periodLabel ? h('div', { class: 'muted tiny' }, sale.periodLabel) : null),
      h('td', { class: 'num strong' }, fmtMoney(sale.amount, sale.currency)),
      h('td', null, saleBadge(sale), sale.checkError ? h('div', { class: 'tiny', style: { color: 'var(--danger)' } }, sale.checkError) : null),
      h('td', null, sale.invoiceUrl
        ? h('a', { class: 'link', href: sale.invoiceUrl, target: '_blank', rel: 'noopener' }, sale.invoiceNumber || t('receipt'))
        : sale.invoiceNumber || h('span', { class: 'muted' }, '—')),
      h('td', null, h('div', { class: 'row', style: { gap: '4px', justifyContent: 'flex-end' } },
        sale.open ? h('button', { class: 'btn btn-xs', type: 'button', onclick: async () => {
          try { await navigator.clipboard.writeText(sale.saleUrl); toast(t('copied'), 'success'); } catch { toast(sale.saleUrl); }
        } }, t('paymeCopyLink')) : null,
        h('button', { class: 'btn btn-xs btn-ghost', type: 'button', onclick: (event) => check(sale, event.currentTarget) }, t('paymeCheckNow'))
      ))
    ));
    return card(t('paymeLinksTitle'), sales.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', null, h('tr', null, h('th', null, t('date')), h('th', null, t('student')), h('th', { class: 'num' }, t('amount')), h('th', null, t('status')), h('th', null, t('receipt')), h('th', null, ''))),
      h('tbody', null, rows)
    )) : empty(t('paymeNoLinks')), { count: sales.length, sub: t('paymeLinksSub') });
  }

  // Settings: connected or not, and changing the key.
  function paymeSettingsCard(payme, refresh) {
    if (!payme) return null;
    let body;
    if (!payme.ready) {
      body = h('div', { class: 'stack' }, h('p', { class: 'small' }, t('paymeNotConnected')), sellerIdForm(refresh));
    } else {
      const replace = h('div', { hidden: true }, sellerIdForm(refresh));
      body = h('div', { class: 'stack' },
        h('div', { class: 'alert alert-sage' }, h('span', null, t('paymeConnectedAs'), ' ', h('bdi', { dir: 'ltr' }, payme.sellerIdMasked)), payme.environment === 'sandbox' ? h('span', { class: 'badge badge-warn' }, t('paymeSandbox')) : null),
        payme.callbacks ? null : h('p', { class: 'small muted' }, t('paymeNoCallbacks')),
        h('p', { class: 'small' }, t('paymeReceiptsNote')),
        payme.fromEnvironment ? h('p', { class: 'small muted' }, t('paymeFromEnv')) : h('div', { class: 'row', style: { gap: '8px' } },
          h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { replace.hidden = !replace.hidden; } }, t('paymeReplaceKey')),
          h('button', { class: 'btn btn-sm btn-danger', type: 'button', onclick: async () => {
            if (!(await window.UI.confirmDialog(t('paymeDisconnectConfirm')))) return;
            await api('/payme', { method: 'PUT', body: { sellerId: '' } });
            toast(t('saved'));
            refresh();
          } }, t('paymeDisconnect'))),
        replace
      );
    }
    return card(t('paymeTitle'), body, { sub: t('paymeSub') });
  }

  Object.assign(window.UI, { paymeSetupCard, paymeLinkDialog, paymeButton, paymeSalesCard, paymeSettingsCard });
})();
