// Payments: who owes what, payment history by month, income summary.
(function () {
  'use strict';
  window.VIEWS = window.VIEWS || {};
  const { h, api, t, card, empty, fmtDate, fmtMoney, fmtMonth, statusBadge, link, select, toast, todayIso, composeMessage, paymentDialog, confirmDialog } = window.UI;

  window.VIEWS.payments = async ({ query, refresh }) => {
    const month = /^\d{4}-\d{2}$/.test(query.month || '') ? query.month : todayIso(window.SETTINGS.businessTimezone).slice(0, 7);
    const tab = query.tab === 'history' ? 'history' : 'overview';
    const data = await api(`/payments?month=${month}`);
    const settings = window.SETTINGS;
    const toIls = (amount, currency) => currency === 'USD' ? amount * settings.usdToIls : currency === 'EUR' ? amount * settings.eurToIls : amount;

    const monthPayments = data.payments;
    const byCurrency = {};
    let totalIls = 0;
    for (const payment of monthPayments) { byCurrency[payment.currency] = (byCurrency[payment.currency] || 0) + payment.amount; totalIls += toIls(payment.amount, payment.currency); }
    const overdue = data.overview.filter((entry) => entry.state === 'overdue');
    const dueSoon = data.overview.filter((entry) => entry.state === 'due_soon');
    const ok = data.overview.filter((entry) => entry.state === 'ok');
    const missingReceipts = monthPayments.filter((payment) => !payment.receiptIssued).length;

    const monthInput = h('input', { type: 'month', value: month, onchange: (event) => { location.hash = `#/payments?tab=${tab}&month=${event.target.value}`; } });
    const head = window.UI.pageHead(t('paymentsTitle'), t('paymentsSub'), [monthInput]);

    const stats = h('div', { class: 'stats' },
      window.UI.stat(t('monthIncome', { month: fmtMonth(month) }), fmtMoney(Math.round(totalIls), 'ILS'), { tone: 'sage', sub: Object.entries(byCurrency).map(([currency, amount]) => fmtMoney(amount, currency)).join(' · ') }),
      window.UI.stat(t('paid'), ok.length, { tone: 'sage' }),
      window.UI.stat(t('pay.due_soon'), dueSoon.length, { tone: dueSoon.length ? 'warn' : '' }),
      window.UI.stat(t('pay.overdue'), overdue.length, { tone: overdue.length ? 'danger' : '' }),
      window.UI.stat(t('receipt'), missingReceipts, { tone: missingReceipts ? 'warn' : '', sub: t('receiptsMissing', { n: missingReceipts }) })
    );

    const tabs = h('div', { class: 'tabs' },
      h('a', { class: `tab ${tab === 'overview' ? 'active' : ''}`, href: `#/payments?tab=overview&month=${month}` }, t('overview')),
      h('a', { class: `tab ${tab === 'history' ? 'active' : ''}`, href: `#/payments?tab=history&month=${month}` }, t('history'))
    );

    let body;
    if (tab === 'overview') {
      const row = (entry) => h('tr', null,
        h('td', null, link(`#/students/${entry.studentId}`, h('span', { class: 'strong' }, entry.name)), h('div', { class: 'muted tiny' }, entry.parentName)),
        h('td', null, t(`billing.${entry.billingType}`)),
        h('td', { class: 'num' }, entry.billingType === 'per_lesson' && entry.lessonPrices?.length ? window.UI.lessonPricesText(entry.lessonPrices, entry.currency) : fmtMoney(entry.price, entry.currency)),
        h('td', null, entry.lastPaymentAt ? `${fmtDate(entry.lastPaymentAt, { year: 'numeric' })} · ${fmtMoney(entry.lastPaymentAmount, entry.currency)}` : '—'),
        h('td', null, entry.billingType === 'monthly' ? fmtDate(entry.nextPaymentAt, { year: 'numeric' }) : window.UI.lessonsBalanceText(entry)),
        h('td', null, statusBadge(entry.state, 'pay')),
        h('td', null, h('div', { class: 'row', style: { gap: '4px', justifyContent: 'flex-end' } },
          entry.state !== 'ok' ? h('button', { class: 'btn btn-xs btn-wa', type: 'button', onclick: () => composeMessage({ kind: 'payment_reminder', studentId: entry.studentId, name: entry.parentName || entry.name, onSent: refresh }) }, t('remind')) : null,
          h('button', { class: 'btn btn-xs', type: 'button', onclick: () => paymentDialog({ student: entry, onSaved: refresh }) }, t('markPaid'))
        ))
      );
      const table = (rows) => h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, h('th', null, t('student')), h('th', null, t('billingType')), h('th', { class: 'num' }, t('price')), h('th', null, t('lastPayment')), h('th', null, t('nextPaymentAt')), h('th', null, t('status')), h('th', null, ''))),
        h('tbody', null, rows.map(row))
      ));
      body = h('div', { class: 'stack' },
        h('div', { class: 'alert alert-info' }, t('paymentNote')),
        overdue.length ? card(t('pay.overdue'), table(overdue), { count: overdue.length }) : null,
        dueSoon.length ? card(t('pay.due_soon'), table(dueSoon), { count: dueSoon.length }) : null,
        card(t('pay.ok'), ok.length ? table(ok) : empty(t('none')), { count: ok.length })
      );
    } else {
      body = card(fmtMonth(month), monthPayments.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, h('th', null, t('date')), h('th', null, t('student')), h('th', { class: 'num' }, t('amount')), h('th', null, t('method')), h('th', null, t('periodLabel')), h('th', null, t('receipt')), h('th', null, t('notes')), h('th', null, ''))),
        h('tbody', null, monthPayments.map((payment) => h('tr', null,
          h('td', null, fmtDate(payment.paidAt, { year: 'numeric' })),
          h('td', null, link(`#/students/${payment.studentId}`, payment.studentName || payment.studentId)),
          h('td', { class: 'num strong' }, fmtMoney(payment.amount, payment.currency), payment.currency !== 'ILS' ? h('div', { class: 'muted tiny' }, t('inIls', { amount: Math.round(toIls(payment.amount, payment.currency)) })) : null),
          h('td', null, t(`method.${payment.method}`)),
          h('td', null, payment.periodLabel, payment.lessonsCount ? ` · ${payment.lessonsCount} ${t('lessons')}` : ''),
          h('td', null, payment.receiptIssued ? h('span', { class: 'badge badge-sage' }, payment.receiptNumber || '✓') : h('span', { class: 'badge badge-warn' }, '—')),
          h('td', { class: 'small muted' }, payment.notes),
          h('td', null, h('div', { class: 'row', style: { gap: '4px', justifyContent: 'flex-end' } },
            h('button', { class: 'btn btn-xs', type: 'button', onclick: () => paymentDialog({ student: { id: payment.studentId, name: payment.studentName, price: payment.amount, currency: payment.currency }, payment, onSaved: refresh }) }, t('edit')),
            h('button', { class: 'btn btn-xs btn-danger', type: 'button', onclick: async () => { if (!(await confirmDialog(t('confirmDelete')))) return; await api(`/payments/${payment.id}`, { method: 'DELETE' }); toast(t('deleted')); refresh(); } }, t('delete'))
          ))
        )))
      )) : empty(t('noPayments')), { count: monthPayments.length, sub: t('allInIls') });
    }

    return h('div', null, head, stats, tabs, body);
  };
})();
