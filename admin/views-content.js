// Content library: lesson plans, exercises (with a FEN board), famous
// games, homework and curricula. Items can be checked against what a group
// has already learned.
(function () {
  'use strict';
  window.VIEWS = window.VIEWS || {};
  const { h, api, t, card, empty, fmtDate, link, modal, field, input, textarea, select, enumSelect, checkbox, formValues, errorBox, toast, board, confirmDialog } = window.UI;

  window.VIEWS.content = async ({ id, query, refresh }) => {
    if (id) return contentDetail(id, refresh);
    if (query.new) setTimeout(() => contentForm({ onSaved: refresh }), 0);
    return contentList(query, refresh);
  };

  async function contentList(query, refresh) {
    const state = { q: query.q || '', kind: query.kind || '', groupId: query.groupId || '' };
    const listNode = h('div', { class: 'grid grid-3' });
    const load = async () => {
      const params = new URLSearchParams();
      if (state.q) params.set('q', state.q);
      if (state.kind) params.set('kind', state.kind);
      const data = await api(`/content?${params}`);
      const group = state.groupId ? window.APP.groups.find((entry) => entry.id === state.groupId) : null;
      window.UI.clear(listNode);
      if (!data.content.length) { listNode.append(empty(t('noContent'))); return; }
      for (const item of data.content) listNode.append(contentCard(item, group));
    };
    const searchBox = h('input', { type: 'search', value: state.q, placeholder: t('search'), oninput: (event) => { state.q = event.target.value; clearTimeout(searchBox._timer); searchBox._timer = setTimeout(load, 250); } });
    const kindSelect = enumSelect('kind', window.VOCAB.contentKinds, 'content', state.kind, { blank: t('all') });
    kindSelect.addEventListener('change', () => { state.kind = kindSelect.value; load(); });
    const groupSelect = select('groupId', [['', t('suggestForGroup') + '…'], ...window.APP.groups.map((group) => [group.id, group.name])], state.groupId);
    groupSelect.addEventListener('change', () => { state.groupId = groupSelect.value; load(); });
    await load();
    return h('div', null,
      window.UI.pageHead(t('contentTitle'), t('contentSub'), [h('button', { class: 'btn btn-primary', type: 'button', onclick: () => contentForm({ onSaved: refresh }) }, `+ ${t('newContent')}`)]),
      h('div', { class: 'filters' }, searchBox, kindSelect, groupSelect),
      listNode
    );
  }

  function learnedByGroup(item, group) {
    if (!group) return null;
    const learned = group.topicsLearned.map((topic) => topic.toLowerCase());
    const needle = [item.topic, ...(item.tags || [])].filter(Boolean).map((value) => value.toLowerCase());
    return needle.some((value) => learned.some((topic) => topic.includes(value) || value.includes(topic)));
  }

  function contentCard(item, group) {
    const learned = learnedByGroup(item, group);
    return h('a', { class: 'card', href: `#/content/${item.id}`, style: { display: 'block' } },
      h('div', { class: 'row-between' },
        h('span', { class: 'badge badge-gold' }, t(`content.${item.kind}`)),
        h('span', { class: 'row', style: { gap: '4px' } },
          item.level ? h('span', { class: 'badge' }, t(`level.${item.level}`)) : null,
          item.kind === 'exercise' ? h('span', { class: `badge ${item.verified ? 'badge-sage' : 'badge-warn'}` }, item.verified ? '✓' : '?') : null
        )
      ),
      h('div', { class: 'card-title', style: { marginTop: '8px' } }, item.title),
      item.topic ? h('div', { class: 'muted small' }, item.topic) : null,
      item.fen ? h('div', { style: { marginTop: '10px', maxWidth: '180px' } }, board(item.fen)) : h('div', { class: 'muted small', style: { marginTop: '8px', whiteSpace: 'pre-wrap', maxHeight: '72px', overflow: 'hidden' } }, item.body.slice(0, 160)),
      group ? h('div', { style: { marginTop: '8px' } }, h('span', { class: `badge ${learned ? 'badge-sage' : 'badge-info'}` }, `${group.name}: ${learned ? t('alreadyLearned') : t('notLearnedYet')}`)) : null,
      item.tags?.length ? h('div', { class: 'chips', style: { marginTop: '8px' } }, item.tags.map((tag) => h('span', { class: 'chip' }, tag))) : null
    );
  }

  async function contentDetail(id, refresh) {
    const data = await api('/content');
    const item = data.content.find((entry) => entry.id === id);
    if (!item) return h('div', { class: 'card' }, empty(t('noContent')));
    const block = (label, value, pre = true) => value ? h('div', { class: 'detail' }, h('dt', null, label), h('dd', { class: pre ? 'pre' : '', dir: pre && /^[\d.\s]*[a-zA-Z]/.test(value) ? 'ltr' : undefined }, value)) : null;
    return h('div', null,
      h('div', { class: 'breadcrumb' }, link('#/content', t('navContent')), '›', item.title),
      h('div', { class: 'card' }, h('div', { class: 'row-between' },
        h('div', null,
          h('div', { class: 'profile-name' }, item.title),
          h('div', { class: 'profile-meta' },
            h('span', { class: 'badge badge-gold' }, t(`content.${item.kind}`)),
            item.topic ? h('span', { class: 'badge' }, item.topic) : null,
            item.level ? h('span', { class: 'badge' }, t(`level.${item.level}`)) : null,
            item.ageMin || item.ageMax ? h('span', { class: 'badge' }, `${t('age')} ${item.ageMin ?? '?'}–${item.ageMax ?? '?'}`) : null,
            item.durationMinutes ? h('span', { class: 'badge' }, `${item.durationMinutes} ${t('minutes')}`) : null,
            item.kind === 'exercise' ? h('span', { class: `badge ${item.verified ? 'badge-sage' : 'badge-warn'}` }, item.verified ? t('verified') : t('notVerified')) : null
          )
        ),
        h('div', { class: 'row' },
          h('button', { class: 'btn btn-primary', type: 'button', onclick: () => contentForm({ item, onSaved: refresh }) }, t('edit')),
          h('button', { class: 'btn btn-danger', type: 'button', onclick: async () => { if (!(await confirmDialog(t('confirmDelete')))) return; await api(`/content/${item.id}`, { method: 'DELETE' }); toast(t('deleted')); location.hash = '#/content'; } }, t('delete'))
        )
      )),
      h('div', { class: 'grid grid-2', style: { marginTop: '16px' } },
        card(t('body'), h('dl', { class: 'stack' },
          block(t('body'), item.body),
          block(t('solution'), item.solution),
          block(t('pgn'), item.pgn),
          item.tags?.length ? h('div', { class: 'chips' }, item.tags.map((tag) => h('span', { class: 'chip' }, tag))) : null,
          h('div', { class: 'muted tiny' }, fmtDate(item.updatedAt.slice(0, 10), { year: 'numeric' }))
        )),
        item.fen ? card(t('fen'), h('div', { class: 'stack' }, board(item.fen), h('code', { class: 'tiny muted', dir: 'ltr', style: { wordBreak: 'break-all' } }, item.fen))) : null
      )
    );
  }

  function contentForm({ item = null, onSaved }) {
    const c = item || { kind: 'plan', tags: [] };
    modal({
      title: item ? t('editContent') : t('newContent'),
      size: 'modal-lg',
      body: (dialog) => {
        const fenInput = input('fen', c.fen || '', { dir: 'ltr', placeholder: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' });
        const preview = h('div', { style: { maxWidth: '240px' } }, c.fen ? board(c.fen) : null);
        fenInput.addEventListener('input', () => { window.UI.clear(preview); if (fenInput.value.trim()) preview.append(board(fenInput.value)); });
        const form = h('form', { class: 'form form-3' },
          field(t('title'), input('title', c.title || '', { required: true }), { full: true }),
          field(t('kind'), enumSelect('kind', window.VOCAB.contentKinds, 'content', c.kind)),
          field(t('topic'), input('topic', c.topic || '')),
          field(t('level'), enumSelect('level', window.VOCAB.levels, 'level', c.level || '', { blank: '—' })),
          field(t('ageMin'), h('input', { name: 'ageMin', type: 'number', min: 3, max: 99, value: c.ageMin ?? '' })),
          field(t('ageMax'), h('input', { name: 'ageMax', type: 'number', min: 3, max: 99, value: c.ageMax ?? '' })),
          field(t('duration'), h('input', { name: 'durationMinutes', type: 'number', min: 5, max: 300, value: c.durationMinutes ?? '' })),
          field(t('body'), textarea('body', c.body || '', { rows: 6 }), { full: true }),
          field(t('fen'), h('div', { class: 'stack' }, fenInput, preview), { full: true }),
          field(t('pgn'), textarea('pgn', c.pgn || '', { rows: 3, dir: 'ltr' }), { full: true }),
          field(t('solution'), textarea('solution', c.solution || '', { rows: 2 }), { full: true }),
          field(t('tags'), input('tags', (c.tags || []).join(', ')), { full: true }),
          h('div', { class: 'field full' }, checkbox('verified', c.verified, t('verified')), h('div', { class: 'hint' }, t('verifiedHint'))),
          h('div', { class: 'form-actions' },
            h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, t('cancel')),
            h('button', { class: 'btn btn-primary', type: 'submit' }, t('save'))
          )
        );
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          try {
            if (item) await api(`/content/${item.id}`, { method: 'PATCH', body: formValues(form) });
            else await api('/content', { method: 'POST', body: formValues(form) });
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
