(() => {
  'use strict';
  const STORAGE = 'relay_stories_v1';
  const ME = 'relay_me_v2';
  const ACTIVE = 'relay_active_story_v2';
  const DRAFT = 'relay_draft_';
  const MAX_CHAR = 1200;
  const MAX_FILE = 3 * 1024 * 1024;
  const MAX_LINK = 12000;
  const $ = (id) => document.getElementById(id);
  const textSize = (s) => Array.from(s || '').length;
  const short = (s, max) => Array.from(s || '').slice(0, max).join('');
  const letters = (s) => Array.from(s || '')[0] || '?';
  const now = () => new Date().toISOString();
  const uid = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'relay_' + Date.now().toString(36) + Math.random().toString(36).slice(2));
  let stories = load();
  let currentId = null;
  let shareUrl = '';
  let shareMode = 'normal';
  let toastTimeout;

  function element(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function announce(msg) {
    clearTimeout(toastTimeout);
    $('toast').textContent = msg;
    $('toast').classList.add('show');
    toastTimeout = setTimeout(() => $('toast').classList.remove('show'), 3700);
  }
  function dateSafe(s) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? now() : d.toISOString();
  }
  function normalize(input) {
    if (!input || typeof input !== 'object' || typeof input.title !== 'string' || !input.title.trim() || !Array.isArray(input.scenes)) throw Error('올바른 작품 데이터가 아니에요.');
    if (input.scenes.length > 2000) throw Error('장면이 너무 많아요.');
    const scenes = input.scenes.map((raw) => {
      if (!raw || typeof raw.text !== 'string' || !raw.text.trim() || textSize(raw.text) > MAX_CHAR) throw Error('장면 내용이 올바르지 않아요.');
      return {
        id: typeof raw.id === 'string' && raw.id.length <= 100 ? raw.id : uid(),
        text: raw.text.trim(), author: short(String(raw.author || '익명').trim(), 24), createdAt: dateSafe(raw.createdAt)
      };
    });
    const fromAuthors = Array.isArray(input.authors) ? input.authors : [];
    const extracted = scenes.map((s) => s.author);
    const authors = [...new Set([...fromAuthors, ...extracted].filter((v) => typeof v === 'string').map((v) => v.trim()).filter(Boolean))].slice(0, 2).map((v) => short(v, 24));
    if (!authors.length) authors.push('첫 번째 작가');
    if (authors.length === 1) authors.push(authors[0] === '두 번째 작가' ? '상대방' : '두 번째 작가');
    const rawId = typeof input.id === 'string' ? input.id : '';
    return {
      id: /^[a-zA-Z0-9_-]{4,100}$/.test(rawId) ? rawId : uid(),
      title: short(input.title.trim(), 60),
      authors, scenes,
      status: input.status === 'finished' ? 'finished' : 'writing',
      createdAt: dateSafe(input.createdAt), updatedAt: dateSafe(input.updatedAt)
    };
  }
  function load() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE) || '[]');
      return Array.isArray(data) ? data.slice(0, 300).flatMap((s) => { try { return [normalize(s)]; } catch (_) { return []; } }) : [];
    } catch (_) { return []; }
  }
  function persist() {
    try { localStorage.setItem(STORAGE, JSON.stringify(stories)); return true; }
    catch (_) { announce('저장 공간이 부족해요. 메뉴에서 백업 파일을 저장해 주세요.'); return false; }
  }
  function current() { return stories.find((s) => s.id === currentId) || null; }
  function nextWriter(story) { return story.authors[story.scenes.length % 2]; }
  function me() { return localStorage.getItem(ME) || ''; }
  function putMe(name) { localStorage.setItem(ME, name); }
  function reveal(view) {
    ['welcomeView', 'storyView', 'libraryView'].forEach((id) => $(id).classList.toggle('hidden', id !== view));
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  function openModal(id) {
    $(id).classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    const close = $(id).querySelector('.dialog-close');
    if (close) close.focus();
  }
  function closeModal(id) {
    $(id).classList.add('hidden');
    if (!document.querySelector('.overlay:not(.hidden)')) document.body.style.overflow = '';
  }
  function welcome() {
    currentId = null;
    $('createForm').reset();
    $('createForm').elements.me.value = me();
    $('openLibraryWelcome').classList.toggle('hidden', !stories.length);
    reveal('welcomeView');
  }
  function library() {
    currentId = null;
    const cards = $('storyCards');
    cards.replaceChildren();
    const ordered = [...stories].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    ordered.forEach((story) => {
      const button = element('button', 'library-card');
      button.type = 'button';
      button.append(element('span', 'library-icon', '📖'));
      const info = element('div');
      info.append(element('strong', '', story.title));
      const count = story.scenes.length;
      info.append(element('small', '', story.authors.join(' & ') + ' · ' + count + '개의 장면' + (story.status === 'finished' ? ' · 완결' : '')));
      button.append(info, element('span', 'library-arrow', '→'));
      button.addEventListener('click', () => openStory(story.id));
      cards.append(button);
    });
    reveal('libraryView');
  }
  function home() {
    if (currentId) library();
    else if (stories.length) library();
    else welcome();
  }
  function createStory(event) {
    event.preventDefault();
    const form = $('createForm');
    const title = form.elements.title.value.trim();
    const authorA = form.elements.me.value.trim();
    const authorB = form.elements.partner.value.trim();
    if (!title || !authorA || !authorB) return announce('제목과 두 사람 이름을 모두 입력해 주세요.');
    if (authorA === authorB) return announce('두 사람의 이름은 다르게 적어 주세요.');
    const story = normalize({ id: uid(), title, authors: [authorA, authorB], scenes: [], status: 'writing', createdAt: now(), updatedAt: now() });
    stories.unshift(story);
    if (!persist()) { stories.shift(); return; }
    putMe(authorA);
    openStory(story.id);
    announce('우리 소설이 만들어졌어! 첫 번째 장면을 써 봐 ♡');
  }
  function openStory(id) {
    const story = stories.find((s) => s.id === id);
    if (!story) return announce('작품을 찾지 못했어요.');
    currentId = id;
    try { localStorage.setItem(ACTIVE, id); } catch (_) { /* nonessential */ }
    if (!story.authors.includes(me())) putMe(nextWriter(story));
    $('chapterInput').value = localStorage.getItem(DRAFT + story.id) || '';
    renderStory();
    reveal('storyView');
  }
  function renderStory() {
    const story = current(); if (!story) return;
    const next = nextWriter(story);
    const mine = me() === next;
    const finished = story.status === 'finished';
    $('storyTitle').textContent = story.title;
    $('avatarA').textContent = letters(story.authors[0]);
    $('avatarB').textContent = letters(story.authors[1]);
    $('pairNames').textContent = story.authors.join('  &  ');
    $('identityBtn').textContent = '이 기기 작가: ' + (me() || '선택하기') + ' · 바꾸기';
    $('storyCount').textContent = story.scenes.length + '개의 장면이 이어졌어요';
    $('storyStatus').textContent = finished ? '♡ 완결된 이야기' : '✦ 이어 쓰는 중';
    $('storyStatus').classList.toggle('done', finished);
    $('turnName').textContent = finished ? '완결된 이야기' : (mine ? next + ' (나)' : next + ' (상대)');
    $('turnBadge').textContent = (story.scenes.length + 1) + '번째 차례';
    const list = $('chapterList'); list.replaceChildren();
    $('noChapters').classList.toggle('hidden', story.scenes.length > 0);
    story.scenes.forEach((scene, index) => {
      const card = element('article', 'chapter-card ' + (scene.author === me() ? 'mine' : 'theirs'));
      const head = element('div', 'chapter-heading');
      const author = element('div', 'chapter-author');
      author.append(element('span', 'author-dot', letters(scene.author)), element('span', '', scene.author));
      head.append(author, element('span', 'chapter-number', 'CHAPTER ' + String(index + 1).padStart(2, '0')));
      card.append(head, element('p', 'chapter-text', scene.text));
      list.append(card);
    });
    $('notMyTurn').classList.toggle('hidden', finished || mine);
    $('nudgeBtn').classList.toggle('hidden', finished || mine || !story.scenes.length);
    $('chapterInput').classList.toggle('hidden', finished || !mine);
    $('chapterInput').disabled = finished || !mine;
    document.querySelector('.editor-footer').classList.toggle('hidden', finished || !mine);
    $('finishedBox').classList.toggle('hidden', !finished);
    $('submitChapterBtn').textContent = finished ? '완성된 이야기 공유하기 ↗' : (mine ? '글 저장하고 상대에게 보내기 →' : '상대에게 최신 이야기 보내기 ↗');
    $('form-hint').textContent = finished
      ? '우리 둘의 이야기를 저장하거나 링크로 남겨 보세요.'
      : (mine ? '글을 저장한 뒤 공유 화면에서 상대에게 최신 원고를 보내 주세요.' : '상대가 새 장면을 쓰면, 받은 최신 링크를 열어 주세요.');
    $('toggleFinishedBtn').textContent = finished ? '다시 이어 쓰기' : '소설 완결하기';
    updateCount();
  }
  function updateCount() {
    const n = textSize($('chapterInput').value);
    $('counter').textContent = n.toLocaleString('ko-KR') + ' / ' + MAX_CHAR.toLocaleString('ko-KR') + '자';
    $('saveIndicator').textContent = n ? '임시 저장됐어요 ✓' : '임시 저장돼요 ✓';
  }
  function submitChapter() {
    const story = current(); if (!story) return;
    if (story.status === 'finished' || nextWriter(story) !== me()) return openShare();
    const content = $('chapterInput').value.trim();
    if (!content) { $('chapterInput').focus(); return announce('한 문장만이라도 적어 볼까? ✍️'); }
    if (textSize(content) > MAX_CHAR) return announce('1,200자까지만 쓸 수 있어요.');
    const originalTime = story.updatedAt;
    story.scenes.push({ id: uid(), author: me(), text: content, createdAt: now() });
    story.updatedAt = now();
    if (!persist()) { story.scenes.pop(); story.updatedAt = originalTime; return; }
    localStorage.removeItem(DRAFT + story.id);
    $('chapterInput').value = '';
    renderStory();
    announce('장면 저장 완료! 이제 다음 사람에게 넘겨 봐 💌');
    openShare();
  }
  function chooseIdentity() {
    const story = current(); if (!story) return;
    const other = story.authors.find((n) => n !== me()) || story.authors[0];
    if (!confirm('이 기기를 사용하는 작가를 "' + other + '"(으)로 바꿀까요?')) return;
    putMe(other);
    renderStory();
    announce('이 기기 작가를 ' + other + '(으)로 변경했어요.');
  }
  function finishToggle() {
    const story = current(); if (!story) return;
    if (story.status !== 'finished' && !story.scenes.length) return announce('장면을 하나 이상 쓴 후 완결할 수 있어요.');
    const finishing = story.status !== 'finished';
    if (!confirm(finishing ? '우리 소설을 완결할까요? 언제든 다시 이어 쓸 수 있어요.' : '다시 이어 쓰기를 시작할까요?')) return;
    story.status = finishing ? 'finished' : 'writing';
    story.updatedAt = now();
    persist(); renderStory();
    announce(finishing ? '완결 축하해! 우리 이야기가 완성됐어 ♡' : '다시 이어 쓸 수 있어요!');
  }
  function filename(story, ext) {
    return (story.title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim().slice(0, 45) || 'relay') + ext;
  }
  function download(name, value, mime) {
    const url = URL.createObjectURL(new Blob([value], { type: mime }));
    const a = element('a'); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 12000);
  }
  function backup() {
    const story = current(); if (!story) return;
    download(filename(story, '.json'), JSON.stringify({ app: 'relay', version: 2, story }, null, 2), 'application/json;charset=utf-8');
    announce('작품 백업 파일을 저장했어요.');
  }
  function exportMarkdown() {
    const story = current(); if (!story) return;
    const lines = ['# ' + story.title, '', story.authors.join(' & '), ''];
    story.scenes.forEach((scene, i) => lines.push('## ' + (i + 1) + '번째 장면 · ' + scene.author, '', scene.text, ''));
    download(filename(story, '.md'), lines.join('\n'), 'text/markdown;charset=utf-8');
    announce('전체 원고를 저장했어요.');
  }
  function importStory(input, fromLink) {
    const incoming = normalize(input);
    const index = stories.findIndex((s) => s.id === incoming.id);
    let target = incoming;
    if (index >= 0) {
      const local = stories[index];
      if (local.scenes.length > incoming.scenes.length) {
        openStory(local.id);
        announce('이 기기에 더 최신 원고가 있어 기존 내용을 유지했어요.');
        return;
      }
      const same = JSON.stringify(local.scenes) === JSON.stringify(incoming.scenes);
      const prefixMatches = local.scenes.every((scene, i) => incoming.scenes[i]?.id === scene.id && incoming.scenes[i]?.text === scene.text);
      if (!same && !prefixMatches) {
        target = { ...incoming, id: uid(), title: incoming.title + ' (다른 버전)' };
        stories.unshift(target);
        announce('글이 서로 달라 다른 버전으로 보관했어요.');
      } else {
        stories[index] = incoming;
      }
    } else stories.unshift(incoming);
    if (!persist()) return;
    if (!target.authors.includes(me())) putMe(nextWriter(target));
    openStory(target.id);
    if (fromLink) announce('새 원고 도착! 이제 네 차례야 ♡');
    else announce('백업한 이야기를 불러왔어요.');
  }
  async function importFile(file) {
    if (!file) return;
    if (file.size > MAX_FILE) return announce('파일이 너무 커요. 3MB 이하만 가능해요.');
    try {
      const json = JSON.parse(await file.text());
      importStory(json && json.story ? json.story : json, false);
    } catch (err) { announce('백업을 읽을 수 없어요: ' + (err.message || '파일 오류')); }
    finally { $('importFile').value = ''; }
  }
  function encodeB64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decodeB64(encoded) {
    const plain = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(plain.padEnd(Math.ceil(plain.length / 4) * 4, '='));
    return Uint8Array.from(raw, (v) => v.charCodeAt(0));
  }
  async function packStory(story) {
    const data = new TextEncoder().encode(JSON.stringify(story));
    if (typeof CompressionStream !== 'undefined') {
      try {
        const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('gzip'));
        return 'g' + encodeB64(new Uint8Array(await new Response(stream).arrayBuffer()));
      } catch (_) { /* older browsers */ }
    }
    return 'j' + encodeB64(data);
  }
  async function unpackStory(encoded) {
    if (!encoded || encoded.length > 200000) throw Error('주소에 포함된 데이터가 너무 길어요.');
    const data = decodeB64(encoded.slice(1));
    let bytes = data;
    if (encoded[0] === 'g') {
      if (typeof DecompressionStream === 'undefined') throw Error('압축 링크를 지원하지 않는 브라우저예요. JSON 파일로 받아 주세요.');
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'));
      bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    } else if (encoded[0] !== 'j') throw Error('원고 주소가 올바르지 않아요.');
    if (bytes.length > MAX_FILE) throw Error('원고 크기가 너무 커요.');
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  function reminderText(story) {
    return nextWriter(story) + '아, 우리 "' + story.title + '" 다음 장면 네 차례야! 📖💌 시간 될 때 이어 써줘 :)';
  }
  function shareMessage(story) {
    return shareMode === 'reminder' ? reminderText(story) : '우리 릴레이소설, 이번엔 네 차례야! ♡';
  }
  async function openShare(mode = 'normal') {
    const story = current(); if (!story) return;
    shareMode = mode === 'reminder' ? 'reminder' : 'normal';
    shareUrl = '';
    $('recipientName').textContent = story.status === 'finished' ? '우리 둘이 읽을' : nextWriter(story);
    $('shareTitlePrefix').textContent = shareMode === 'reminder' ? '살짝 알림! 이번엔 ' : '이번엔 ';
    $('shareDescription').textContent = shareMode === 'reminder'
      ? '상대에게 이어 쓸 차례라는 메시지와 현재 원고 링크를 함께 보내요.'
      : '현재까지의 원고가 담긴 새 링크를 상대에게 보내 주세요.';
    $('nativeShareBtn').textContent = shareMode === 'reminder' ? '💌 메시지로 알려주기 ↗' : '📨 상대에게 링크 보내기 ↗';
    $('copyLinkBtn').textContent = shareMode === 'reminder' ? '🔗 메시지와 링크 복사' : '🔗 링크 복사하기';
    $('nativeShareBtn').disabled = true;
    $('copyLinkBtn').disabled = true;
    $('shareTip').textContent = '원고를 정리하고 있어요…';
    openModal('shareModal');
    try {
      const code = await packStory(story);
      if (currentId !== story.id || $('shareModal').classList.contains('hidden')) return;
      const link = location.href.split('#')[0].split('?')[0] + '#relay=' + code;
      if (link.length > MAX_LINK) {
        $('shareTip').textContent = '이야기가 길어져 링크로 보내기 어려워요. 아래 "파일로 보내기"를 눌러 JSON을 전달해 주세요.';
        $('nativeShareBtn').classList.add('hidden');
        $('copyLinkBtn').classList.add('hidden');
      } else {
        shareUrl = link;
        $('nativeShareBtn').disabled = false;
        $('copyLinkBtn').disabled = false;
        $('nativeShareBtn').classList.remove('hidden');
        $('copyLinkBtn').classList.remove('hidden');
        $('shareTip').textContent = '매 차례마다 새 링크를 보내 주세요. 같은 링크를 재사용하면 최신 내용으로 자동 갱신되지 않아요.';
      }
    } catch (_) {
      $('nativeShareBtn').classList.add('hidden');
      $('copyLinkBtn').classList.add('hidden');
      $('shareTip').textContent = '공유 링크를 만들지 못했어요. 아래 파일로 보내기를 이용해 주세요.';
    }
  }
  async function copyLink() {
    if (!shareUrl) return announce('링크를 먼저 만들어 주세요.');
    const story = current();
    const outgoing = shareMode === 'reminder' && story ? shareMessage(story) + '\n' + shareUrl : shareUrl;
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(outgoing);
      else {
        const input = element('textarea');
        input.value = outgoing; input.style.position = 'fixed'; input.style.opacity = '0';
        document.body.append(input); input.select();
        const ok = document.execCommand('copy'); input.remove();
        if (!ok) throw Error('not copied');
      }
      announce('링크를 복사했어요! 상대에게 붙여넣으면 돼요 💌');
    } catch (_) { announce('자동 복사가 안 돼요. 크롬에서 다시 시도해 주세요.'); }
  }
  async function shareNative() {
    if (!shareUrl) return announce('공유할 링크가 없어요.');
    const story = current();
    if (navigator.share) {
      try {
        await navigator.share({ title: '릴레이소설 · ' + (story?.title || '우리의 이야기'), text: story ? shareMessage(story) : '이번엔 네 차례야! ♡', url: shareUrl });
        announce('공유 화면에서 원하는 앱을 선택해 보내 주세요.');
      } catch (err) {
        if (err.name !== 'AbortError') announce('공유할 수 없어요. 링크 복사 버튼을 이용해 주세요.');
      }
    } else await copyLink();
  }
  async function importHash() {
    const hash = location.hash;
    if (!hash.startsWith('#relay=')) return false;
    history.replaceState(null, '', location.pathname + location.search);
    try {
      const incoming = await unpackStory(hash.slice(7));
      importStory(incoming, true);
    } catch (err) { announce('링크를 열 수 없어요: ' + (err.message || '잘못된 원고')); }
    return true;
  }
  function bind() {
    $('createForm').addEventListener('submit', createStory);
    $('homeBtn').addEventListener('click', home);
    $('switchStoryBtn').addEventListener('click', library);
    $('openLibraryWelcome').addEventListener('click', library);
    $('newStoryBtn').addEventListener('click', welcome);
    $('chapterInput').addEventListener('input', () => {
      const story = current(); if (!story) return;
      try { localStorage.setItem(DRAFT + story.id, $('chapterInput').value); }
      catch (_) { announce('임시 저장 공간이 부족해요.'); }
      updateCount();
    });
    $('submitChapterBtn').addEventListener('click', submitChapter);
    $('nudgeBtn').addEventListener('click', () => openShare('reminder'));
    $('identityBtn').addEventListener('click', chooseIdentity);
    $('toggleFinishedBtn').addEventListener('click', finishToggle);
    $('downloadBtn').addEventListener('click', exportMarkdown);
    $('exportJsonBtn').addEventListener('click', backup);
    $('menuBtn').addEventListener('click', () => openModal('menuModal'));
    $('menuLibrary').addEventListener('click', () => { closeModal('menuModal'); library(); });
    $('menuNew').addEventListener('click', () => { closeModal('menuModal'); welcome(); });
    $('menuImport').addEventListener('click', () => { closeModal('menuModal'); $('importFile').click(); });
    $('menuGuide').addEventListener('click', () => { closeModal('menuModal'); openModal('guideModal'); });
    $('importBtn').addEventListener('click', () => $('importFile').click());
    $('importFile').addEventListener('change', (event) => importFile(event.target.files?.[0]));
    $('nativeShareBtn').addEventListener('click', shareNative);
    $('copyLinkBtn').addEventListener('click', copyLink);
    $('downloadShareBtn').addEventListener('click', backup);
    document.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', () => closeModal(btn.dataset.close)));
    document.querySelectorAll('.overlay').forEach((overlay) => overlay.addEventListener('click', (event) => { if (event.target === overlay) closeModal(overlay.id); }));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        const modal = document.querySelector('.overlay:not(.hidden)');
        if (modal) closeModal(modal.id);
      }
    });
    window.addEventListener('hashchange', importHash);
  }
  bind();
  const preferredId = localStorage.getItem(ACTIVE);
  if (preferredId && stories.some((s) => s.id === preferredId)) openStory(preferredId);
  else if (stories.length) library();
  else welcome();
  importHash();
})();