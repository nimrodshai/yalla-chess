// Lesson content: games uploaded as PGN files, played through on a board,
// and puzzles (a position plus a solution).
(function () {
  'use strict';
  window.VIEWS = window.VIEWS || {};
  const { h, api, t, card, empty, fmtDate, link, modal, field, input, textarea, enumSelect, checkbox, formValues, errorBox, toast, board, confirmDialog } = window.UI;

  window.VIEWS.content = async ({ id, query, refresh }) => {
    if (id) return contentDetail(id, refresh);
    const tab = query.tab === 'puzzles' ? 'puzzles' : 'games';
    if (query.new) setTimeout(() => puzzleForm({ onSaved: refresh }), 0);
    return contentList(tab, query, refresh);
  };

  async function contentList(tab, query, refresh) {
    const state = { q: query.q || '', tag: query.tag || '' };
    const listNode = h('div');
    const countNode = h('span');
    const tagBar = h('div', { class: 'tag-filter' });
    // A redraw replaces every row, so one that follows a tag save waits while
    // a tag box is open (being typed in, or kept after a failed save) and
    // runs when the last box closes. A search or a filter the user picked
    // redraws at once. Only the newest request may draw.
    let sequence = 0;
    let deferred = false;
    const openDraft = () => listNode.querySelector('.tag-input');
    const load = async ({ force = false } = {}) => {
      const mine = ++sequence;
      const params = new URLSearchParams({ kind: tab === 'games' ? 'game' : 'exercise' });
      if (state.q) params.set('q', state.q);
      if (tab === 'games' && state.tag) params.set('tag', state.tag);
      const data = await api(`/content?${params}`);
      if (mine !== sequence) return;
      // A tag that was just removed from its last game stops filtering.
      if (state.tag && !data.tags.some((entry) => entry.name.toLowerCase() === state.tag.toLowerCase())) { state.tag = ''; return load({ force }); }
      if (!force && openDraft()) { deferred = true; return; }
      deferred = false;
      const filterBy = (name) => { state.tag = state.tag.toLowerCase() === name.toLowerCase() ? '' : name; refreshList(); };
      const draftClosed = () => { if (deferred && !openDraft()) reload(); };
      window.UI.clear(listNode).append(tab === 'games' ? gamesList(data.content, { allTags: data.tags, activeTag: state.tag, filterBy, reload, draftClosed }) : puzzlesGrid(data.content));
      countNode.textContent = tab === 'games' ? t('gamesCount', { n: data.content.length }) : '';
      if (tab === 'games') renderTagBar(tagBar, data.tags, state.tag, filterBy);
    };
    const guardedLoad = window.UI.guard(load);
    const reload = () => guardedLoad({ force: false });
    const refreshList = () => guardedLoad({ force: true });
    const searchBox = h('input', { type: 'search', value: state.q, placeholder: t('search'), oninput: (event) => { state.q = event.target.value; clearTimeout(searchBox._timer); searchBox._timer = setTimeout(refreshList, 250); } });
    await load();

    const tabs = h('div', { class: 'tabs' },
      h('a', { class: `tab ${tab === 'games' ? 'active' : ''}`, href: '#/content?tab=games' }, t('tabGames')),
      h('a', { class: `tab ${tab === 'puzzles' ? 'active' : ''}`, href: '#/content?tab=puzzles' }, t('tabPuzzles'))
    );

    // Teachers use the library; adding to it and changing it is the admin's.
    const admin = window.APP.isAdmin;
    const actions = !admin ? []
      : tab === 'games'
      ? [uploadControl(refresh, true)]
      : [h('button', { class: 'btn btn-primary', type: 'button', onclick: () => puzzleForm({ onSaved: refresh }) }, `+ ${t('newPuzzle')}`)];

    return h('div', null,
      window.UI.pageHead(t('contentTitle'), t('contentSub'), actions),
      tabs,
      tab === 'games' && admin ? h('div', { class: 'upload-box', style: { marginBottom: '14px' } }, h('div', { class: 'small muted', style: { flex: 1 } }, t('uploadHint')), uploadControl(refresh)) : null,
      h('div', { class: 'filters' }, searchBox, h('span', { class: 'muted small' }, countNode)),
      tab === 'games' ? tagBar : null,
      h('div', { class: 'card' }, listNode)
    );
  }

  // A file input behind a button. Files are read in the browser and sent as
  // text, so the server never deals with multipart uploads.
  function uploadControl(refresh, primary = false) {
    const fileInput = h('input', { type: 'file', accept: '.pgn,text/plain', multiple: true, style: { display: 'none' } });
    const button = h('button', { class: `btn ${primary ? 'btn-primary' : ''}`, type: 'button', onclick: () => fileInput.click() }, `⬆ ${t('uploadPgn')}`);
    fileInput.addEventListener('change', async () => {
      const files = Array.from(fileInput.files || []);
      if (!files.length) return;
      button.disabled = true;
      button.textContent = t('uploading');
      try {
        for (const file of files) {
          const pgn = await file.text();
          const response = await api('/content/import-pgn', { method: 'POST', body: { fileName: file.name, pgn } });
          toast(t('importedGames', { n: response.imported, file: file.name }), 'success');
        }
        refresh();
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        button.disabled = false;
        button.textContent = `⬆ ${t('uploadPgn')}`;
        fileInput.value = '';
      }
    });
    return h('span', null, fileInput, button);
  }

  // The tags in use, as a row of filters above the list. One is picked at a
  // time; picking it again shows every game.
  function renderTagBar(node, tags, activeTag, filterBy) {
    window.UI.clear(node);
    if (!tags.length) { node.hidden = true; return; }
    node.hidden = false;
    node.append(h('span', { class: 'tag-filter-label' }, t('filterByTag')));
    for (const tag of tags) {
      const active = tag.name.toLowerCase() === activeTag.toLowerCase();
      node.append(h('button', { class: `tag tag-filter-item ${active ? 'active' : ''}`, type: 'button', 'aria-pressed': String(active), onclick: () => filterBy(tag.name) }, tag.name, h('span', { class: 'tag-count' }, String(tag.count))));
    }
  }

  function gamesList(items, { allTags, activeTag, filterBy, reload, draftClosed }) {
    if (!items.length) return empty(activeTag ? t('noGamesWithTag', { tag: activeTag }) : t('noGames'));
    const admin = window.APP.isAdmin;
    // One shared list of suggestions for every "add tag" box on the page.
    const suggestions = h('datalist', { id: 'game-tag-suggestions' }, allTags.map((tag) => h('option', { value: tag.name })));
    // Edits to one game run one after another, each applied to the tags as
    // the last save left them, so a quick add and remove cannot undo each
    // other. Resolves to whether the save went through.
    const pending = new Map();
    const changed = new Set();
    const saveTags = (item, change) => {
      const run = (pending.get(item.id) || Promise.resolve()).then(async () => {
        try {
          const response = await api(`/content/${item.id}`, { method: 'PATCH', body: { tags: change(item.tags || []) } });
          item.tags = response.item.tags;
          changed.add(item.id);
          return true;
        } catch (error) {
          toast(error.message, 'error');
          return false;
        }
      });
      pending.set(item.id, run);
      // The list redraws once the last queued edit is done, and only if one
      // went through: a failed save keeps what was typed on screen.
      run.then(() => {
        if (pending.get(item.id) !== run) return;
        pending.delete(item.id);
        if (changed.delete(item.id)) reload();
      });
      return run;
    };
    return h('div', { class: 'list' }, suggestions, items.map((item) => h('div', { class: 'list-item clickable game-row', onclick: () => { location.hash = `#/content/${item.id}`; } },
      h('span', { class: 'avatar' }, '♞'),
      h('div', { class: 'list-main' },
        h('div', { class: 'list-title' }, item.white || item.black ? `${item.white || '?'} – ${item.black || '?'}` : item.title, item.result ? h('span', { class: 'badge badge-gold', dir: 'ltr' }, item.result) : null),
        h('div', { class: 'list-sub' }, [item.event, item.gameDate && !item.gameDate.includes('?') ? item.gameDate : (item.gameDate || '').slice(0, 4).replace(/\?+/, ''), item.topic, item.movesCount ? `${Math.ceil(item.movesCount / 2)} ${t('gameMoves')}` : '', item.sourceFile ? `${t('sourceFile')} ${item.sourceFile}` : ''].filter(Boolean).join(' · ')),
        gameTags(item, { admin, activeTag, filterBy, saveTags, draftClosed })
      ),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: (event) => { event.stopPropagation(); openViewer(item); } }, `♟ ${t('openBoard')}`)
    )));
  }

  // A game's tags under its line. A tag filters the list by it; the admin can
  // take one off with its × or add one with "+ tag", which opens a small box
  // that suggests the tags already in use.
  function gameTags(item, { admin, activeTag, filterBy, saveTags, draftClosed }) {
    const tags = item.tags || [];
    const node = h('div', { class: 'game-tags', onclick: (event) => event.stopPropagation() });
    const same = (a, b) => a.toLowerCase() === b.toLowerCase();
    for (const tag of tags) {
      const active = tag.toLowerCase() === activeTag.toLowerCase();
      node.append(h('span', { class: `tag ${active ? 'active' : ''}` },
        h('button', { class: 'tag-name', type: 'button', title: t('filterByThisTag'), onclick: () => filterBy(tag) }, tag),
        admin ? h('button', { class: 'tag-x', type: 'button', title: t('removeTag'), 'aria-label': `${t('removeTag')}: ${tag}`, onclick: async (event) => { const button = event.currentTarget; button.disabled = true; if (!(await saveTags(item, (current) => current.filter((entry) => entry !== tag)))) button.disabled = false; } }, '×') : null
      ));
    }
    if (!admin) return tags.length ? node : null;

    const addButton = h('button', { class: 'tag tag-add', type: 'button' }, `+ ${t('addTag')}`);
    addButton.addEventListener('click', () => {
      const box = h('input', { class: 'tag-input', type: 'text', list: 'game-tag-suggestions', placeholder: t('tagPlaceholder'), maxlength: 120, 'aria-label': t('addTag') });
      let busy = false;
      const finish = async (save) => {
        if (busy) return;
        // Commas add several at once: "Carlsen, sacrifice".
        const added = save ? box.value.split(',').map((entry) => entry.trim()).filter(Boolean) : [];
        const close = () => { box.replaceWith(addButton); draftClosed(); };
        if (!added.length) { close(); return; }
        busy = true;
        box.disabled = true;
        const saved = await saveTags(item, (current) => [...current, ...added.filter((entry, index) => !current.some((tag) => same(tag, entry)) && added.findIndex((other) => same(other, entry)) === index)]);
        // A failed save leaves what was typed in the box to try again.
        if (saved) { box.value = ''; close(); }
        else if (box.isConnected) { busy = false; box.disabled = false; box.focus(); }
      };
      box.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') { event.preventDefault(); finish(true); }
        else if (event.key === 'Escape') { event.preventDefault(); finish(false); }
      });
      box.addEventListener('blur', () => finish(true));
      addButton.replaceWith(box);
      box.focus();
    });
    node.append(addButton);
    return node;
  }

  function puzzlesGrid(items) {
    if (!items.length) return empty(t('noPuzzles'));
    return h('div', { class: 'grid grid-3' }, items.map((item) => h('a', { class: 'card', href: `#/content/${item.id}`, style: { display: 'block' } },
      h('div', { class: 'row-between' },
        h('div', { class: 'card-title' }, item.title),
        h('span', { class: `badge ${item.verified ? 'badge-sage' : 'badge-warn'}` }, item.verified ? '✓' : '?')
      ),
      item.topic || item.level ? h('div', { class: 'muted small' }, [item.topic, item.level ? t(`level.${item.level}`) : ''].filter(Boolean).join(' · ')) : null,
      item.fen ? h('div', { style: { marginTop: '10px', maxWidth: '200px' } }, board(item.fen)) : h('div', { class: 'muted small', style: { marginTop: '8px' } }, item.body.slice(0, 160))
    )));
  }

  // ----------------------------------------------------------- viewer
  function gameViewer(item) {
    const { headers, moves } = window.CHESS.parsePgn(item.pgn || '');
    // A game that starts from a position (puzzle or study) carries a FEN tag.
    const { positions, error } = window.CHESS.replay(moves, headers.FEN || item.fen || undefined);
    let index = 0;
    let shown = null; // index currently on the board, to animate from
    const boardHost = h('div', { class: 'viewer-board' });
    const movesHost = h('div', { class: 'viewer-moves' });
    const status = h('div', { class: 'viewer-meta' });

    const render = () => {
      const position = positions[index];
      window.UI.clear(boardHost).append(board(position.fen, { highlights: [position.from, position.to].filter(Boolean), caption: false }));
      // One step forwards or back glides the piece; a jump redraws at once.
      if (shown !== null && Math.abs(shown - index) === 1) {
        window.UI.animateBoard(boardHost.querySelector('.board'), positions[shown].fen, position.fen);
      }
      shown = index;
      for (const node of movesHost.querySelectorAll('.viewer-move')) node.classList.toggle('active', Number(node.dataset.index) === index);
      const active = movesHost.querySelector('.viewer-move.active');
      if (active) active.scrollIntoView({ block: 'nearest' });
      status.textContent = index === 0 ? t('gameStart') : `${label(index)} ${position.san}`;
    };
    const go = (next) => { index = Math.max(0, Math.min(positions.length - 1, next)); render(); };
    // Move numbers come from the position before the move, so a game that
    // starts with Black to move (a study with a FEN tag) is numbered right.
    const before = (i) => { const parts = positions[i - 1].fen.split(' '); return { turn: parts[1], number: Number(parts[5]) || 1 }; };
    const label = (i) => { const { turn, number } = before(i); return `${number}${turn === 'b' ? '...' : '.'}`; };

    for (let i = 1; i < positions.length; i += 1) {
      const { turn } = before(i);
      if (turn === 'w' || i === 1) movesHost.append(h('span', { class: 'viewer-num' }, label(i)));
      movesHost.append(h('span', { class: 'viewer-move', dataset: { index: i }, onclick: () => go(i) }, positions[i].san), ' ');
    }
    if (headers.Result) movesHost.append(h('span', { class: 'viewer-num strong' }, headers.Result));

    const controls = h('div', { class: 'viewer-controls' },
      h('button', { class: 'btn', type: 'button', title: t('gameStart'), onclick: () => go(0) }, '⏮'),
      h('button', { class: 'btn', type: 'button', title: t('prevMove'), onclick: () => go(index - 1) }, '◀'),
      h('button', { class: 'btn', type: 'button', title: t('nextMove'), onclick: () => go(index + 1) }, '▶'),
      h('button', { class: 'btn', type: 'button', title: t('gameEnd'), onclick: () => go(positions.length - 1) }, '⏭'),
      h('button', { class: 'btn viewer-fullscreen', type: 'button', title: t('fullscreen'), 'aria-label': t('fullscreen'), onclick: () => toggleFullscreen() }, '⛶')
    );
    // Full screen shows the board, the controls and the move status on their
    // own. Browsers without the Fullscreen API on elements (iPhone Safari)
    // get the same layout fixed over the whole window instead.
    const stage = h('div', { class: 'viewer-stage' });
    const isFullscreen = () => document.fullscreenElement === stage || stage.classList.contains('is-fullscreen');
    const syncFullscreen = () => {
      const on = isFullscreen();
      stage.classList.toggle('fullscreen-on', on);
      const button = controls.querySelector('.viewer-fullscreen');
      button.title = t(on ? 'exitFullscreen' : 'fullscreen');
      button.setAttribute('aria-label', button.title);
      // The board's size changes, so redraw without animating.
      shown = null; render();
    };
    // The fallback moves the stage to <body> while it is on: the modal's
    // blurred backdrop would otherwise pin a fixed element to itself.
    const placeholder = document.createComment('viewer-stage');
    const toggleFullscreen = () => {
      if (document.fullscreenElement === stage) document.exitFullscreen();
      else if (stage.classList.contains('is-fullscreen')) {
        stage.classList.remove('is-fullscreen');
        placeholder.replaceWith(stage);
        syncFullscreen();
      } else if (stage.requestFullscreen && document.fullscreenEnabled) stage.requestFullscreen().catch(fillWindow);
      else fillWindow();
    };
    // Also used when the browser refuses real full screen (an embedding
    // page's permissions, for one).
    const fillWindow = () => {
      stage.replaceWith(placeholder);
      document.body.append(stage);
      stage.classList.add('is-fullscreen');
      syncFullscreen();
    };
    stage.addEventListener('fullscreenchange', syncFullscreen);
    const onKey = (event) => {
      if (!document.body.contains(node) && !document.body.contains(placeholder)) { node.dispose(); return; }
      if (event.target instanceof Element && event.target.closest('input, textarea, select')) return;
      if (event.key === 'ArrowRight') { go(index + 1); event.preventDefault(); }
      else if (event.key === 'ArrowLeft') { go(index - 1); event.preventDefault(); }
      else if (event.key === 'Home') go(0);
      else if (event.key === 'End') go(positions.length - 1);
      else if (event.key === 'f' || event.key === 'F') toggleFullscreen();
    };
    // Escape leaves the window-filling fallback before it can close the modal.
    const onEscape = (event) => {
      if (event.key !== 'Escape' || !stage.classList.contains('is-fullscreen')) return;
      event.stopImmediatePropagation(); event.preventDefault(); toggleFullscreen();
    };
    render();

    stage.append(boardHost, controls, h('div', { class: 'viewer-meta', style: { textAlign: 'center', marginTop: '6px' } }, status, h('div', { class: 'tiny' }, t('useArrows'))));
    const node = h('div', { class: 'viewer' },
      stage,
      h('div', null,
        h('div', { class: 'viewer-meta' }, [headers.White && `${t('gamePlayers')}: ${headers.White} – ${headers.Black || '?'}`, headers.Event && `${t('gameEvent')}: ${headers.Event}`, headers.Date && !headers.Date.includes('?') && headers.Date, headers.Result && `${t('gameResult')}: ${headers.Result}`].filter(Boolean).join(' · ')),
        error ? h('div', { class: 'alert alert-warn', style: { marginBottom: '8px' } }, t('replayError', { move: error })) : null,
        movesHost
      )
    );
    node.dispose = () => {
      if (stage.classList.contains('is-fullscreen')) toggleFullscreen();
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('keydown', onEscape, true);
      if (document.fullscreenElement === stage) document.exitFullscreen().catch(() => {});
    };
    document.addEventListener('keydown', onKey);
    window.addEventListener('keydown', onEscape, true);
    return node;
  }

  function openViewer(item) {
    let viewer = null;
    modal({ title: item.title, size: 'modal-lg', onClose: () => viewer?.dispose(), body: () => { viewer = gameViewer(item); return viewer; } });
  }

  // ----------------------------------------------------------- detail
  async function contentDetail(id, refresh) {
    const data = await api('/content');
    const item = data.content.find((entry) => entry.id === id);
    if (!item) return h('div', { class: 'card' }, empty(t('noContent')));
    const isGame = item.kind === 'game';
    const usedIn = isGame ? (await api(`/lessons?gameId=${encodeURIComponent(item.id)}&limit=500`)).lessons : [];
    const groupName = (groupId) => window.APP.groups.find((group) => group.id === groupId)?.name || '';
    const usageCard = isGame ? card(t('usedInLessons'), usedIn.length
      ? h('div', { class: 'list' }, usedIn.map((lesson) => h('a', { class: 'list-item clickable', href: `#/lessons/${lesson.id}` },
        h('div', { class: 'list-main' },
          h('div', { class: 'list-title' }, fmtDate(lesson.date, { year: 'numeric' }), h('span', null, groupName(lesson.groupId) || t('lessonType.private'))),
          h('div', { class: 'list-sub' }, lesson.topic)
        ))))
      : empty(t('notUsedYet')), { count: usedIn.length }) : null;
    const block = (label, value) => value ? h('div', { class: 'detail' }, h('dt', null, label), h('dd', { class: 'pre' }, value)) : null;
    const viewer = isGame && item.pgn ? gameViewer(item) : null;
    if (viewer) window.addEventListener('hashchange', () => viewer.dispose(), { once: true });

    return h('div', null,
      h('div', { class: 'breadcrumb' }, link(`#/content?tab=${isGame ? 'games' : 'puzzles'}`, t('navContent')), '›', item.title),
      h('div', { class: 'card' }, h('div', { class: 'row-between' },
        h('div', null,
          h('div', { class: 'profile-name' }, item.title),
          h('div', { class: 'profile-meta' },
            h('span', { class: 'badge badge-gold' }, t(`content.${item.kind}`)),
            item.topic ? h('span', { class: 'badge' }, item.topic) : null,
            item.level ? h('span', { class: 'badge' }, t(`level.${item.level}`)) : null,
            item.result ? h('span', { class: 'badge', dir: 'ltr' }, item.result) : null,
            item.sourceFile ? h('span', { class: 'badge' }, `${t('sourceFile')} ${item.sourceFile}`) : null,
            !isGame ? h('span', { class: `badge ${item.verified ? 'badge-sage' : 'badge-warn'}` }, item.verified ? t('verified') : t('notVerified')) : null
          )
        ),
        window.APP.isAdmin && h('div', { class: 'row' },
          h('button', { class: 'btn btn-primary', type: 'button', onclick: () => (isGame ? gameForm({ item, onSaved: refresh }) : puzzleForm({ item, onSaved: refresh })) }, t('edit')),
          h('button', { class: 'btn btn-danger', type: 'button', onclick: async () => { if (!(await confirmDialog(t('confirmDelete')))) return; await api(`/content/${item.id}`, { method: 'DELETE' }); toast(t('deleted')); location.hash = `#/content?tab=${isGame ? 'games' : 'puzzles'}`; } }, t('delete'))
        )
      )),
      viewer ? h('div', { class: 'card', style: { marginTop: '16px' } }, viewer) : null,
      usageCard ? h('div', { style: { marginTop: '16px' } }, usageCard) : null,
      !isGame ? h('div', { class: 'grid grid-2', style: { marginTop: '16px' } },
        card(t('body'), h('dl', { class: 'stack' }, block(t('body'), item.body), block(t('solution'), item.solution), item.tags?.length ? h('div', { class: 'chips' }, item.tags.map((tag) => h('span', { class: 'chip' }, tag))) : null, h('div', { class: 'muted tiny' }, fmtDate(item.updatedAt.slice(0, 10), { year: 'numeric' })))),
        item.fen ? card(t('fen'), h('div', { class: 'stack' }, board(item.fen), h('code', { class: 'tiny muted', dir: 'ltr', style: { wordBreak: 'break-all' } }, item.fen))) : null
      ) : (item.body ? h('div', { class: 'card', style: { marginTop: '16px' } }, h('div', { class: 'pre' }, item.body)) : null)
    );
  }

  // ----------------------------------------------------------- forms
  function puzzleForm({ item = null, onSaved }) {
    const c = item || { kind: 'exercise', tags: [] };
    modal({
      title: item ? t('editPuzzle') : t('newPuzzle'),
      body: (dialog) => {
        const fenInput = input('fen', c.fen || '', { dir: 'ltr', placeholder: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' });
        const preview = h('div', { style: { maxWidth: '240px' } }, c.fen ? board(c.fen) : null);
        fenInput.addEventListener('input', () => { window.UI.clear(preview); if (fenInput.value.trim()) preview.append(board(fenInput.value)); });
        const form = h('form', { class: 'form' },
          field(t('title'), input('title', c.title || '', { required: true }), { full: true }),
          field(t('topic'), input('topic', c.topic || '')),
          field(t('level'), enumSelect('level', window.VOCAB.levels, 'level', c.level || '', { blank: '—' })),
          field(t('fen'), h('div', { class: 'stack' }, fenInput, preview), { full: true }),
          field(t('body'), textarea('body', c.body || '', { rows: 3 }), { full: true }),
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
            const values = { ...formValues(form), kind: 'exercise' };
            if (item) await api(`/content/${item.id}`, { method: 'PATCH', body: values });
            else await api('/content', { method: 'POST', body: values });
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

  function gameForm({ item, onSaved }) {
    modal({
      title: t('editGame'),
      body: (dialog) => {
        const form = h('form', { class: 'form' },
          field(t('title'), input('title', item.title || '', { required: true }), { full: true }),
          field('White', input('white', item.white || '', { dir: 'ltr' })),
          field('Black', input('black', item.black || '', { dir: 'ltr' })),
          field(t('gameEvent'), input('event', item.event || '')),
          field(t('topic'), input('topic', item.topic || '')),
          field(t('level'), enumSelect('level', window.VOCAB.levels, 'level', item.level || '', { blank: '—' })),
          field(t('tags'), input('tags', (item.tags || []).join(', '))),
          field(t('body'), textarea('body', item.body || '', { rows: 3 }), { full: true }),
          field(t('pgn'), textarea('pgn', item.pgn || '', { rows: 6, dir: 'ltr' }), { full: true }),
          h('div', { class: 'form-actions' },
            h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, t('cancel')),
            h('button', { class: 'btn btn-primary', type: 'submit' }, t('save'))
          )
        );
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          try {
            await api(`/content/${item.id}`, { method: 'PATCH', body: formValues(form) });
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
