// Reports: monthly KPIs with month-over-month deltas, income and expense
// breakdowns, six-month trend, outstanding payments and the expense ledger.
(function () {
  'use strict';
  window.VIEWS = window.VIEWS || {};
  const { h, api, t, card, empty, fmtDate, fmtMoney, fmtMonth, statusBadge, link, modal, field, input, select, enumSelect, formValues, errorBox, toast, todayIso, confirmDialog } = window.UI;

  window.VIEWS.reports = async ({ query, refresh }) => {
    const month = /^\d{4}-\d{2}$/.test(query.month || '') ? query.month : todayIso(window.SETTINGS.businessTimezone).slice(0, 7);
    const [report, expensesResponse] = await Promise.all([api(`/reports?month=${month}`), api(`/expenses?month=${month}`)]);
    const current = report.current;
    const previous = report.previous;

    const monthInput = h('input', { type: 'month', value: month, onchange: (event) => { location.hash = `#/reports?month=${event.target.value}`; } });
    const head = window.UI.pageHead(t('reportsTitle'), t('reportsSub'), [monthInput, h('button', { class: 'btn', type: 'button', onclick: () => window.print() }, '🖨')]);

    const delta = (now, before, { money = false, invert = false } = {}) => {
      if (now === null || before === null || before === undefined) return null;
      const diff = now - before;
      if (!diff) return h('span', { class: 'delta' }, '= ');
      const good = invert ? diff < 0 : diff > 0;
      return h('span', { class: `delta ${good ? 'up' : 'down'}` }, `${diff > 0 ? '+' : ''}${money ? fmtMoney(Math.round(diff), 'ILS') : Math.round(diff * 10) / 10} ${t('vsPrev')}`);
    };
    const kpi = (label, value, before, options = {}) => window.UI.stat(label, value, { tone: options.tone, sub: delta(options.raw ?? value, before, options) });

    const stats = h('div', { class: 'stats' },
      kpi(t('kpiActive'), current.activeStudents, previous.activeStudents),
      kpi(t('kpiIncome'), fmtMoney(current.income.total, 'ILS'), previous.income.total, { raw: current.income.total, money: true, tone: 'sage' }),
      kpi(t('kpiExpenses'), fmtMoney(current.expenses.total, 'ILS'), previous.expenses.total, { raw: current.expenses.total, money: true, invert: true }),
      kpi(t('kpiProfit'), fmtMoney(current.profit, 'ILS'), previous.profit, { raw: current.profit, money: true, tone: current.profit < 0 ? 'danger' : 'sage' }),
      kpi(t('kpiNew'), current.newStudents, previous.newStudents, { tone: 'gold' }),
      kpi(t('kpiLeft'), current.leftStudents, previous.leftStudents, { invert: true, tone: current.leftStudents ? 'danger' : '' }),
      kpi(t('kpiLeads'), current.newLeads, previous.newLeads),
      kpi(t('kpiLessons'), current.lessonsHeld, previous.lessonsHeld),
      window.UI.stat(t('kpiTrialRate'), current.trialConversionRate === null ? '—' : `${current.trialConversionRate}%`, { sub: `${current.trialConversions}/${current.trials} ${t('trials')}` }),
      window.UI.stat(t('kpiCac'), current.acquisitionCost === null ? '—' : fmtMoney(current.acquisitionCost, 'ILS'), { sub: t('expense.advertising') }),
      window.UI.stat(t('kpiArpu'), current.revenuePerStudent === null ? '—' : fmtMoney(current.revenuePerStudent, 'ILS'))
    );

    const incomeCard = card(t('incomeBreakdown'), h('dl', { class: 'kv' },
      h('dt', null, t('fromPrivate')), h('dd', null, fmtMoney(current.income.private, 'ILS')),
      h('dt', null, t('fromGroups')), h('dd', null, fmtMoney(current.income.group, 'ILS')),
      h('dt', null, t('total')), h('dd', null, fmtMoney(current.income.total, 'ILS')),
      ...Object.entries(current.income.byCurrency).flatMap(([currency, amount]) => [h('dt', { class: 'tiny' }, `${t('byCurrency')}: ${currency}`), h('dd', { class: 'tiny' }, fmtMoney(amount, currency))])
    ), { sub: t('allInIls') });

    const expenseCard = card(t('expensesBreakdown'), Object.keys(current.expenses.byCategory).length ? h('dl', { class: 'kv' },
      ...Object.entries(current.expenses.byCategory).flatMap(([category, amount]) => [h('dt', null, t(`expense.${category}`)), h('dd', null, fmtMoney(amount, 'ILS'))]),
      h('dt', null, t('total')), h('dd', null, fmtMoney(current.expenses.total, 'ILS'))
    ) : empty(t('noExpenses')));

    const groupsCard = card(t('groupsBreakdown'), h('dl', { class: 'kv' }, current.groups.flatMap((group) => [h('dt', null, link(`#/groups/${group.id}`, group.name)), h('dd', null, `${group.students}/${group.seatsTotal}`)])), { count: `${current.privateStudents} ${t('lessonType.private')} · ${current.groupStudents} ${t('lessonType.group')}` });

    const max = Math.max(1, ...report.trend.map((entry) => Math.max(entry.income, entry.expenses)));
    const trendCard = card(t('trend'), h('div', null,
      h('div', { class: 'bars' }, report.trend.map((entry) => h('div', { class: 'bar-col' },
        h('div', { class: 'bar-value' }, fmtMoney(Math.round(entry.profit), 'ILS')),
        h('div', { class: 'bar-stack' },
          h('div', { class: 'bar', style: { height: `${(entry.income / max) * 100}%` }, title: `${t('income')}: ${fmtMoney(entry.income, 'ILS')}` }),
          h('div', { class: 'bar expense', style: { height: `${(entry.expenses / max) * 100}%` }, title: `${t('expenses')}: ${fmtMoney(entry.expenses, 'ILS')}` })
        ),
        h('div', { class: 'bar-label' }, fmtMonth(entry.month).split(' ')[0])
      ))),
      h('div', { class: 'row small muted', style: { marginTop: '8px', gap: '14px' } },
        h('span', null, h('span', { style: { display: 'inline-block', width: '10px', height: '10px', background: 'var(--gold)', borderRadius: '3px', marginInlineEnd: '4px' } }), t('income')),
        h('span', null, h('span', { style: { display: 'inline-block', width: '10px', height: '10px', background: 'var(--danger)', opacity: .7, borderRadius: '3px', marginInlineEnd: '4px' } }), t('expenses')),
        h('span', null, `↑ ${t('profit')}`)
      ),
      h('div', { class: 'table-wrap', style: { marginTop: '10px' } }, h('table', { class: 'table small' },
        h('thead', null, h('tr', null, h('th', null, t('month')), h('th', { class: 'num' }, t('income')), h('th', { class: 'num' }, t('expenses')), h('th', { class: 'num' }, t('profit')), h('th', { class: 'num' }, t('kpiActive')), h('th', { class: 'num' }, t('kpiNew')), h('th', { class: 'num' }, t('kpiLeft')))),
        h('tbody', null, report.trend.map((entry) => h('tr', null, h('td', null, fmtMonth(entry.month)), h('td', { class: 'num' }, fmtMoney(entry.income, 'ILS')), h('td', { class: 'num' }, fmtMoney(entry.expenses, 'ILS')), h('td', { class: 'num strong' }, fmtMoney(entry.profit, 'ILS')), h('td', { class: 'num' }, entry.activeStudents), h('td', { class: 'num' }, entry.newStudents), h('td', { class: 'num' }, entry.leftStudents))))
      ))
    ));

    const outstandingCard = card(t('outstanding'), report.outstanding.length ? h('div', { class: 'list' }, report.outstanding.map((entry) => h('div', { class: 'list-item' },
      h('div', { class: 'list-main' }, link(`#/students/${entry.studentId}`, h('span', { class: 'strong' }, entry.name)), h('div', { class: 'list-sub' }, entry.billingType === 'monthly' ? fmtDate(entry.nextPaymentAt) : t('lessonsLeft', { n: entry.lessonsRemaining ?? 0 }))),
      h('span', { class: 'strong' }, fmtMoney(entry.price, entry.currency)),
      statusBadge(entry.state, 'pay')
    ))) : empty(t('none')), { count: report.outstanding.length, actions: [h('a', { class: 'btn btn-sm', href: '#/payments' }, t('navPayments'))] });

    const ledger = card(`${t('expenses')} · ${fmtMonth(month)}`, expensesResponse.expenses.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', null, h('tr', null, h('th', null, t('date')), h('th', null, t('category')), h('th', null, t('description')), h('th', { class: 'num' }, t('amount')), h('th', null, ''))),
      h('tbody', null, expensesResponse.expenses.map((expense) => h('tr', null,
        h('td', null, fmtDate(expense.date)),
        h('td', null, t(`expense.${expense.category}`)),
        h('td', null, expense.description),
        h('td', { class: 'num strong' }, fmtMoney(expense.amount, expense.currency)),
        h('td', null, h('div', { class: 'row', style: { gap: '4px', justifyContent: 'flex-end' } },
          h('button', { class: 'btn btn-xs', type: 'button', onclick: () => expenseForm({ expense, onSaved: refresh }) }, t('edit')),
          h('button', { class: 'btn btn-xs btn-danger', type: 'button', onclick: async () => { if (!(await confirmDialog(t('confirmDelete')))) return; await api(`/expenses/${expense.id}`, { method: 'DELETE' }); toast(t('deleted')); refresh(); } }, t('delete'))
        ))
      )))
    )) : empty(t('noExpenses')), { count: expensesResponse.expenses.length, actions: [h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => expenseForm({ defaults: { date: `${month}-01` <= todayIso() ? (todayIso().slice(0, 7) === month ? todayIso() : `${month}-01`) : `${month}-01` }, onSaved: refresh }) }, `+ ${t('addExpense')}`)] });

    return h('div', null,
      head,
      stats,
      h('div', { class: 'grid grid-3' }, incomeCard, expenseCard, groupsCard),
      h('div', { class: 'grid grid-2', style: { marginTop: '16px' } },
        h('div', { class: 'stack' }, trendCard),
        h('div', { class: 'stack' }, outstandingCard, ledger)
      )
    );
  };

  function expenseForm({ expense = null, defaults = {}, onSaved }) {
    const e = expense || { category: 'advertising', currency: 'ILS', date: todayIso(), ...defaults };
    modal({
      title: expense ? t('editExpense') : t('addExpense'),
      size: 'modal-sm',
      body: (dialog) => {
        const form = h('form', { class: 'form' },
          field(t('date'), h('input', { name: 'date', type: 'date', value: e.date, required: true })),
          field(t('category'), enumSelect('category', window.VOCAB.expenseCategories, 'expense', e.category)),
          field(t('amount'), h('input', { name: 'amount', type: 'number', step: '0.01', min: 0, value: e.amount ?? '', required: true })),
          field(t('currency'), select('currency', window.VOCAB.currencies, e.currency)),
          field(t('description'), input('description', e.description || ''), { full: true }),
          h('div', { class: 'form-actions' },
            h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, t('cancel')),
            h('button', { class: 'btn btn-primary', type: 'submit' }, t('save'))
          )
        );
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          try {
            if (expense) await api(`/expenses/${expense.id}`, { method: 'PATCH', body: formValues(form) });
            else await api('/expenses', { method: 'POST', body: formValues(form) });
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
})();
