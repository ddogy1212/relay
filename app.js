(() => {
  'use strict';

  const STORAGE_KEY = 'relay_stories_v1';
  const NAME_KEY = 'relay_penname_v1';
  const DRAFT_PREFIX = 'relay_draft_';
  const MIN_LENGTH = 20;
  const MAX_IMPORT_BYTES = 3 * 1024 * 1024;
  const MAX_SHARE_URL = 12000;
  const $ = (id) => document.getElementById(id);
  const genreStyles = {
    '판타지': { icon: '✦', color: '#ded9f7' },
    '미스터리': { icon: '🔍', color: '#dae4e8' },
    '로맨스': { icon: '♡', color: '#f5d8db' },
    'SF': { icon: '◈', color: '#d7e8ef' },
    '스릴러': { icon: '☾', color: '#e3dce4' },
    '일상': { icon: '☕', color: '#f2e3cd' },
    '호러': { icon: '🕯', color: '#dfd9d7' },
    '자유': { icon: '✎', color: '#e3e4d3' }
  };
  const prompts = [
    '평범해 보이던 물건에 숨겨진 비밀을 하나 남겨 보세요.',
    '이번 장면의 마지막 문장을 질문으로 끝내 보세요.',
    '등장인물이 사실을 숨기고 있다는 단서를 심어 보세요.',
    '누군가 예상하지 못한 장소에서 나타나게 해 보세요.',
    '이야기의 시간을 딱 10분 뒤로 보내 보세요.',
    '앞 장면의 사소한 물건이 중요한 역할을 하게 해 보세요.',
    '주인공이 두 가지 선택지 앞에 서게 해 보세요.',
    '한 문장의 대사로 분위기를 뒤집어 보세요.',
    '새로운 감각(소리, 냄새, 온기)으로 장면을 시작해 보세요.',
    '다음 작가가 풀어야 할 작은 수수께끼를 남겨 보세요.',
    '기대하던 일이 벌어졌지만 결과는 예상과 다르게 만들어 보세요.'
  ];

  let stories = readStories();
  let activeId = null;
  let toastTimer = null;
  let currentShareLink = '';
  let lastFocusedElement = null;

  function uid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'relay_' + Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  function count(text) { return Array.from(text || '').length; }
  function short(text, max) { const chars = Array.from(text || ''); return chars.length > max ? chars.slice(0, max).join('') + '…' : (text || ''); }
  function formatted(n) { return Number(n).toLocaleString('ko-KR'); }
  function timeAgo(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '방금 전';
    const days = Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
    if (!days) return '오늘';
    if (days === 1) return '어제';
    return (d.getMonth() + 1) + '월 ' + d.getDate() + '일';
  }
  function nickname() { return (localStorage.getItem(NAME_KEY) || '').trim(); }
  function activeStory() { return stories.find((s) => s.id === activeId) || null; }
  function nextAuthor(story) {
    if (!story.authors.length) return null;
    return story.authors[story.scenes.length % story.authors.length];
  }
  function node(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function toast(message) {
    clearTimeout(toastTimer);
    $('toast').textContent = message;
    $('toast').classList.add('show');
    toastTimer = setTimeout(() => $('toast').classList.remove('show'), 3600);
  }
  function safeDate(value) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  }
  function cleanStory(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('올바른 작품 파일이 아니에요.');
    if (typeof raw.title !== 'string' || !raw.title.trim() || !Array.isArray(raw.scenes)) throw new Error('제목 또는 장면 정보가 없어요.');
    if (raw.scenes.length > 2000) throw new Error('장면 수가 너무 많아요.');
    const seenAuthors = new Set();
    const authors = (Array.isArray(raw.authors) ? raw.authors : [])
      .filter((a) => typeof a === 'string')
      .map((a) => a.trim().slice(0, 24))
      .filter((a) => { if (!a || seenAuthors.has(a)) return false; seenAuthors.add(a); return true; })
      .slice(0, 20);
    const scenes = raw.scenes.map((s) => {
      if (!s || typeof s.text !== 'string' || typeof s.author !== 'string' || count(s.text) > 1200) throw new Error('장면 데이터가 올바르지 않아요.');
      const text = s.text.trim();
      if (!text) throw new Error('빈 장면이 포함되어 있어요.');
      return { id: (typeof s.id === 'string' && s.id.length < 100) ? s.id : uid(), text, author: s.author.trim().slice(0, 24) || '익명', createdAt: safeDate(s.createdAt) };
    });
    const rawId = typeof raw.id === 'string' ? raw.id : '';
    return {
      id: /^[a-zA-Z0-9_-]{4,100}$/.test(rawId) ? rawId : uid(),
      title: raw.title.trim().slice(0, 60),
      premise: typeof raw.premise === 'string' ? raw.premise.trim().slice(0, 300) : '',
      genre: Object.prototype.hasOwnProperty.call(genreStyles, raw.genre) ? raw.genre : '자유',
      authors, limit: [500, 800, 1200].includes(Number(raw.limit)) ? Number(raw.limit) : 800,
      scenes, status: raw.status === 'finished' ? 'finished' : 'writing',
      createdAt: safeDate(raw.createdAt), updatedAt: safeDate(raw.updatedAt)
    };
  }
  function readStories() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      if (!Array.isArray(raw)) return [];
      return raw.slice(0, 500).flatMap((s) => { try { return [cleanStory(s)]; } catch (_) { return []; } });
    } catch (_) { return []; }
  }
  function saveStories() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(stories)); return true; }
    catch (_) { toast('저장 공간이 부족해요. JSON 백업을 먼저 내려받아 주세요.'); return false; }
  }

  function updateNameUI() {
    const name = nickname();
    $('nameBadge').textContent = name || '작가 이름';
    $('nameAvatar').textContent = Array.from(name || '나')[0];
  }
  function showModal(id) {
    lastFocusedElement = document.activeElement;
    $(id).classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    const first = $(id).querySelector('input:not([readonly]),textarea,button');
    if (first) setTimeout(() => first.focus(), 50);
  }
  function closeModal(id) {
    $(id).classList.add('hidden');
    if (!document.querySelector('.modal-backdrop:not(.hidden)')) document.body.style.overflow = '';
    if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') lastFocusedElement.focus();
  }
  function showLibrary() {
    activeId = null;
    $('libraryView').classList.remove('hidden');
    $('studioView').classList.add('hidden');
    $('libraryNav').classList.add('active');
    renderLibrary();
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  function showCreate() {
    $('createForm').reset();
    const name = nickname();
    if (name) $('createForm').elements.authors.placeholder = '예: ' + name + ', 친구, 다른 친구';
    showModal('createModal');
  }

  function renderLibrary() {
    $('statStories').textContent = formatted(stories.length);
    $('statChapters').textContent = formatted(stories.reduce((a, s) => a + s.scenes.length, 0));
    $('statCharacters').textContent = formatted(stories.reduce((a, s) => a + s.scenes.reduce((n, c) => n + count(c.text), 0), 0));
    $('libraryCount').textContent = stories.length;
    const q = $('storySearch').value.trim().toLowerCase();
    const visible = stories.filter((s) => (s.title + ' ' + s.premise + ' ' + s.genre).toLowerCase().includes(q)).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    const grid = $('storyGrid');
    grid.replaceChildren();
    for (const story of visible) grid.appendChild(makeCard(story));
    if (visible.length && !q) {
      const add = node('button', 'card-add');
      add.type = 'button';
      add.append(node('span', 'card-add-icon', '+'), node('strong', '', '새 이야기 쓰기'), node('small', '', '또 하나의 세계를 펼쳐 보세요'));
      add.addEventListener('click', showCreate);
      grid.appendChild(add);
    }
    const empty = !visible.length;
    $('emptyState').classList.toggle('hidden', !empty);
    $('emptyState').querySelector('h3').textContent = q ? '검색 결과가 없어요.' : '아직 첫 장이 비어 있어요.';
    $('emptyState').querySelector('p').textContent = q ? '다른 제목이나 장르를 검색해 보세요.' : '작품을 만들고 친구에게 다음 장을 넘겨 보세요.\n어쩌면 생각하지 못한 결말을 만나게 될지도!';
    $('emptyState').querySelector('.empty-buttons').classList.toggle('hidden', !!q);
  }
  function makeCard(story) {
    const style = genreStyles[story.genre];
    const card = node('button', 'story-card');
    card.type = 'button';
    card.setAttribute('aria-label', story.title + ' 집필실 열기');
    card.style.textAlign = 'left';
    card.style.padding = '0';
    const art = node('div', 'card-art');
    art.style.setProperty('--card-bg', style.color);
    art.append(node('span', 'card-genre', story.genre), node('span', 'card-symbol', style.icon), node('span', 'card-chapter', 'CHAPTER ' + String(story.scenes.length).padStart(2, '0')));
    const body = node('div', 'card-body');
    body.append(node('h3', 'card-title', story.title), node('p', 'card-description', story.premise || '어떤 이야기가 펼쳐질까요? 다음 문장을 기다리고 있어요.'));
    const foot = node('div', 'card-foot');
    const next = story.status === 'finished' ? '✦ 완결' : (nextAuthor(story) ? '다음: ' + nextAuthor(story) : '누구나 이어 쓰기');
    foot.append(node('span', 'card-next', next), node('span', 'card-arrow', '↗'));
    body.append(foot); card.append(art, body);
    card.addEventListener('click', () => openStory(story.id));
    return card;
  }

  function openStory(id) {
    const story = stories.find((s) => s.id === id);
    if (!story) return toast('작품을 찾지 못했어요.');
    activeId = id;
    $('libraryView').classList.add('hidden');
    $('studioView').classList.remove('hidden');
    $('libraryNav').classList.remove('active');
    $('sceneText').value = localStorage.getItem(DRAFT_PREFIX + story.id) || '';
    $('writerInput').value = nickname();
    renderStudio();
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  function renderStudio() {
    const story = activeStory();
    if (!story) return;
    const next = nextAuthor(story);
    $('crumbTitle').textContent = story.title;
    $('studioTitle').textContent = story.title;
    $('studioPremise').textContent = story.premise || '아직 정해지지 않은 이야기. 다음 문장이 세계를 만들어요.';
    $('studioGenre').textContent = story.genre;
    $('studioSceneCount').textContent = story.scenes.length + '개의 장면';
    $('studioLastDate').textContent = '최근 기록 ' + timeAgo(story.updatedAt);
    $('studioCover').textContent = genreStyles[story.genre].icon;
    $('studioCover').style.background = genreStyles[story.genre].color;
    $('storyStatus').textContent = story.status === 'finished' ? '완결' : '집필 중';
    $('storyStatus').classList.toggle('finished', story.status === 'finished');
    $('nextWriter').textContent = story.status === 'finished' ? '이야기 완결' : (next || '모든 작가에게 열린 차례');
    $('turnNumber').textContent = String(story.scenes.length + 1).padStart(2, '0') + '번째 장면';
    $('timelineTotal').textContent = story.scenes.length;
    $('detailGenre').textContent = story.genre;
    $('detailLimit').textContent = '최대 ' + formatted(story.limit) + '자';
    $('detailMode').textContent = story.authors.length ? '순서대로 릴레이' : '자유 릴레이';
    $('finishStory').textContent = story.status === 'finished' ? '◇ 집필 다시 시작하기' : '◇ 이야기 완결하기';
    $('sceneText').maxLength = story.limit;
    const last = story.scenes[story.scenes.length - 1];
    $('contextText').textContent = last ? short(last.text, 400) : '첫 문장은 무엇이 될까요? 새로운 세계의 문을 열어 주세요.';
    $('contextAuthor').textContent = last ? '— ' + last.author + ' · 장면 ' + story.scenes.length : '아직 작성된 장면이 없어요.';
    const timeline = $('timelineList'); timeline.replaceChildren();
    if (!story.scenes.length) timeline.append(node('p', 'timeline-blank', '여기서부터 이야기가 시작돼요. ✳'));
    story.scenes.forEach((scene, index) => {
      const btn = node('button', 'timeline-item' + (index === story.scenes.length - 1 ? ' active' : ''));
      btn.type = 'button';
      btn.append(node('span', 'timeline-number', String(index + 1).padStart(2, '0')));
      const info = node('span', 'timeline-info');
      info.append(node('strong', '', scene.author), node('p', '', short(scene.text.replace(/\s+/g, ' '), 35)), node('small', '', timeAgo(scene.createdAt)));
      btn.append(info);
      btn.addEventListener('click', () => showReader(index));
      timeline.append(btn);
    });
    const list = $('authorOrder'); list.replaceChildren();
    if (!story.authors.length) list.append(node('span', 'author-chip next', '열린 릴레이 · 누구나'));
    story.authors.forEach((name, i) => {
      list.append(node('span', 'author-chip' + (name === next && story.status !== 'finished' ? ' next' : ''), String(i + 1) + '. ' + name));
    });
    $('sceneText').classList.toggle('hidden', story.status === 'finished');
    $('writerInput').disabled = story.status === 'finished';
    $('sceneText').disabled = story.status === 'finished';
    $('publishScene').disabled = story.status === 'finished';
    $('completedMessage').classList.toggle('hidden', story.status !== 'finished');
    updateEditorMeta();
  }
  function updateEditorMeta() {
    const story = activeStory();
    if (!story) return;
    const value = count($('sceneText').value);
    $('charCounter').replaceChildren(node('strong', '', formatted(value)), document.createTextNode(' / ' + formatted(story.limit) + '자'));
    const invalid = value > story.limit;
    $('charProgressBar').style.width = Math.min(100, value * 100 / story.limit) + '%';
    $('charProgressBar').classList.toggle('over', invalid);
    $('limitHint').textContent = invalid ? '글자 수를 줄여 주세요.' : (value < MIN_LENGTH ? '최소 ' + MIN_LENGTH + '자부터 등록할 수 있어요' : '좋아요! 이번 장면을 등록할 수 있어요.');
    $('draftStatus').textContent = '● 자동 저장';
  }

  function createStory(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const title = String(form.elements.title.value || '').trim();
    const premise = String(form.elements.premise.value || '').trim();
    const genre = String(form.elements.genre.value || '자유');
    const limit = Number(form.elements.limit.value) || 800;
    const seen = new Set();
    const authors = String(form.elements.authors.value || '').split(',').map((n) => n.trim()).filter((n) => {
      if (!n || seen.has(n)) return false;
      seen.add(n); return true;
    });
    if (!title) return toast('작품 제목을 적어 주세요.');
    if (authors.length > 20 || authors.some((a) => count(a) > 24)) return toast('작가는 20명까지, 이름은 24자까지 가능해요.');
    const now = new Date().toISOString();
    const story = cleanStory({ id: uid(), title, premise, genre, limit, authors, scenes: [], status: 'writing', createdAt: now, updatedAt: now });
    stories.unshift(story);
    if (!saveStories()) { stories.shift(); return; }
    closeModal('createModal');
    openStory(story.id);
    toast('새 소설이 만들어졌어요. 첫 장면을 써 보세요! ✳');
  }
  function createDemo() {
    const now = new Date().toISOString();
    const demo = cleanStory({
      id: uid(), title: '자정 이후의 도서관', genre: '미스터리', limit: 800, authors: [],
      premise: '매일 자정, 도서관의 책들은 한 사람의 미래를 다시 쓴다.',
      createdAt: now, updatedAt: now, status: 'writing',
      scenes: [
        { id: uid(), author: '초록잉크', createdAt: now, text: '도서관이 문을 닫은 지 한 시간이 지났다. 그런데 가장 안쪽 서가에서 책장을 넘기는 소리가 들렸다. 지우는 열쇠 꾸러미를 꽉 쥐고 그쪽으로 걸었다. 누군가 책 한 권을 펼쳐 둔 채 사라져 있었다. 그 책에는 아직 일어나지 않은 내일의 날짜가 적혀 있었다.' },
        { id: uid(), author: '달빛', createdAt: now, text: '첫 페이지에는 자신의 이름이 쓰여 있었다. 지우는 다음 줄을 읽고 숨을 멈췄다. “오늘 자정, 이 문장을 읽은 사람은 선택해야 한다.” 책장 사이에서 작은 종소리가 울렸다. 지우가 고개를 돌렸을 때, 방금 전까지 비어 있던 의자에 누군가 앉아 있었다.' }
      ]
    });
    stories.unshift(demo);
    if (!saveStories()) { stories.shift(); return; }
    openStory(demo.id);
    toast('예시 작품을 열었어요. 다음 장면을 직접 이어 보세요!');
  }
  function publishScene() {
    const story = activeStory();
    if (!story || story.status === 'finished') return toast('완결된 이야기에는 새 장면을 쓸 수 없어요.');
    const author = $('writerInput').value.trim();
    const text = $('sceneText').value.trim();
    if (!author || count(author) > 24) return toast('작가 이름을 1~24자로 적어 주세요.');
    if (story.authors.length && author !== nextAuthor(story)) return toast('이번 차례는 "' + nextAuthor(story) + '" 작가예요. 작가 이름을 확인해 주세요.');
    if (count(text) < MIN_LENGTH) return toast('장면을 최소 ' + MIN_LENGTH + '자 이상 적어 주세요.');
    if (count(text) > story.limit) return toast('이 작품은 한 장면에 최대 ' + story.limit + '자까지 쓸 수 있어요.');
    const now = new Date().toISOString();
    const scene = { id: uid(), author, text, createdAt: now };
    story.scenes.push(scene);
    const originalUpdatedAt = story.updatedAt;
    story.updatedAt = now;
    if (!saveStories()) { story.scenes.pop(); story.updatedAt = originalUpdatedAt; return; }
    localStorage.setItem(NAME_KEY, author);
    updateNameUI();
    localStorage.removeItem(DRAFT_PREFIX + story.id);
    $('sceneText').value = '';
    renderStudio();
    toast('장면이 등록됐어요! 이제 다음 작가에게 넘겨 주세요. ✦');
    openShare();
  }

  function showReader(startIndex) {
    const story = activeStory();
    if (!story) return;
    $('readTitle').textContent = story.title;
    $('readCount').textContent = story.scenes.length + '개의 장면 · ' + formatted(story.scenes.reduce((n, s) => n + count(s.text), 0)) + '자';
    const body = $('readBody'); body.replaceChildren();
    if (!story.scenes.length) {
      body.append(node('p', 'read-empty', '첫 장면을 기다리고 있어요.'));
    } else {
      story.scenes.forEach((scene, i) => {
        if (i) body.append(node('div', 'read-divider'));
        const section = node('section', 'read-chapter');
        section.id = 'readChapter_' + i;
        section.append(node('span', '', 'CHAPTER ' + String(i + 1).padStart(2, '0')), node('p', '', scene.text), node('footer', '', '✎ ' + scene.author));
        body.append(section);
      });
    }
    showModal('readModal');
    if (Number.isInteger(startIndex) && startIndex > 0) {
      requestAnimationFrame(() => { const target = $('readChapter_' + startIndex); if (target) target.scrollIntoView({ block: 'start' }); });
    } else body.scrollTop = 0;
  }
  function finishStory() {
    const story = activeStory();
    if (!story) return;
    const finish = story.status !== 'finished';
    if (finish && !story.scenes.length) return toast('한 장면 이상 쓴 뒤 완결할 수 있어요.');
    if (!confirm(finish ? '이 작품을 완결할까요? 나중에 다시 집필을 시작할 수 있어요.' : '완결 상태를 해제하고 다시 집필을 시작할까요?')) return;
    story.status = finish ? 'finished' : 'writing';
    story.updatedAt = new Date().toISOString();
    saveStories(); renderStudio(); toast(finish ? '이야기를 완결했어요. 축하해요! ✦' : '다시 다음 장면을 쓸 수 있어요.');
  }
  function deleteStory() {
    const story = activeStory();
    if (!story) return;
    if (!confirm('"' + story.title + '" 작품을 이 기기에서 삭제할까요?\n삭제 전 JSON 백업을 권장합니다. 다른 사람이 받은 원고에는 영향을 주지 않아요.')) return;
    stories = stories.filter((s) => s.id !== story.id);
    localStorage.removeItem(DRAFT_PREFIX + story.id);
    saveStories(); showLibrary(); toast('이 기기에서 작품을 삭제했어요.');
  }

  function safeFilename(title, ext) { return (title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim().slice(0, 45) || 'relay-story') + ext; }
  function downloadFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = node('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  function backupOne() {
    const story = activeStory(); if (!story) return;
    downloadFile(safeFilename(story.title, '.json'), JSON.stringify({ app: 'relay', version: 1, story }, null, 2), 'application/json;charset=utf-8');
    toast('JSON 백업을 저장했어요.');
  }
  function downloadMarkdown() {
    const story = activeStory(); if (!story) return;
    const lines = ['# ' + story.title, '', story.premise || '', '', '> 장르: ' + story.genre + ' · 장면 ' + story.scenes.length + '개', ''];
    story.scenes.forEach((scene, i) => {
      lines.push('## ' + String(i + 1).padStart(2, '0') + ' · ' + scene.author, '', scene.text, '');
    });
    downloadFile(safeFilename(story.title, '.md'), lines.join('\n'), 'text/markdown;charset=utf-8');
    toast('전체 원고를 저장했어요.');
  }
  function importStory(story, source) {
    const cleaned = cleanStory(story);
    const i = stories.findIndex((s) => s.id === cleaned.id);
    if (i !== -1) {
      const local = stories[i];
      if (local.scenes.length > cleaned.scenes.length) {
        toast('이 기기에 더 많은 장면이 있어서 기존 작품을 보존했어요.');
        openStory(local.id); return;
      }
      const same = JSON.stringify(local.scenes) === JSON.stringify(cleaned.scenes);
      if (local.scenes.length === cleaned.scenes.length && !same) {
        const copy = Object.assign({}, cleaned, { id: uid(), title: cleaned.title + ' (다른 버전)' });
        stories.unshift(copy);
        if (saveStories()) { openStory(copy.id); toast('내용이 달라 별도 버전으로 불러왔어요.'); }
        return;
      }
      stories[i] = cleaned;
    } else stories.unshift(cleaned);
    if (!saveStories()) return;
    openStory(cleaned.id);
    toast(source === 'link' ? '전달받은 이야기를 열었어요! 다음 장면을 이어 주세요.' : '백업 작품을 불러왔어요!');
  }
  async function importBackupFile(file) {
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) return toast('파일이 너무 커요. 3MB 이하의 JSON 파일을 사용해 주세요.');
    try {
      const data = JSON.parse(await file.text());
      const entry = data && data.story ? data.story : data;
      importStory(entry, 'file');
    } catch (err) { toast('불러오기 실패: ' + (err.message || '파일을 확인해 주세요.')); }
    finally { $('importFile').value = ''; }
  }
  function byteToBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function base64ToBytes(encoded) {
    const str = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(str.padEnd(Math.ceil(str.length / 4) * 4, '='));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  }
  async function encodeSnapshot(story) {
    const jsonBytes = new TextEncoder().encode(JSON.stringify(story));
    if (typeof CompressionStream !== 'undefined') {
      try {
        const compressed = new Blob([jsonBytes]).stream().pipeThrough(new CompressionStream('gzip'));
        const result = new Uint8Array(await new Response(compressed).arrayBuffer());
        return 'g' + byteToBase64(result);
      } catch (_) { /* fallback to plain JSON */ }
    }
    return 'j' + byteToBase64(jsonBytes);
  }
  async function decodeSnapshot(encoded) {
    if (typeof encoded !== 'string' || encoded.length > 200000) throw new Error('링크 크기가 올바르지 않아요.');
    const bytes = base64ToBytes(encoded.slice(1));
    let output = bytes;
    if (encoded[0] === 'g') {
      if (typeof DecompressionStream === 'undefined') throw new Error('이 브라우저는 압축 원고 링크를 지원하지 않아요. JSON 파일로 받아 주세요.');
      const decompressed = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      output = new Uint8Array(await new Response(decompressed).arrayBuffer());
    } else if (encoded[0] !== 'j') throw new Error('원고 링크 형식을 알 수 없어요.');
    if (output.length > MAX_IMPORT_BYTES) throw new Error('링크의 작품 데이터가 너무 커요.');
    return JSON.parse(new TextDecoder().decode(output));
  }
  async function openShare() {
    const story = activeStory(); if (!story) return;
    $('shareNextWriter').textContent = story.status === 'finished' ? '완결된 작품' : (nextAuthor(story) || '다음 이야기를 쓸 누구나');
    $('shareLinkInput').value = '원고 링크 생성 중...';
    $('shareLinkBox').classList.remove('hidden');
    $('shareLinkHelp').textContent = '받는 사람이 링크를 열면 현재까지의 원고가 그 기기에 복사됩니다.';
    showModal('shareModal');
    try {
      const snapshot = await encodeSnapshot(story);
      if (activeId !== story.id || $('shareModal').classList.contains('hidden')) return;
      const base = location.href.split('#')[0].split('?')[0];
      const link = base + '#relay=' + snapshot;
      if (link.length > MAX_SHARE_URL) {
        currentShareLink = '';
        $('shareLinkBox').classList.add('hidden');
        $('shareLinkHelp').textContent = '원고가 길어져 링크로 전달하기 어려워요. 아래 JSON 파일을 내려받아 다음 사람에게 보내 주세요.';
      } else { currentShareLink = link; $('shareLinkInput').value = link; }
    } catch (_) {
      currentShareLink = '';
      $('shareLinkBox').classList.add('hidden');
      $('shareLinkHelp').textContent = '링크를 만들 수 없어요. 아래 JSON 백업을 사용해 주세요.';
    }
  }
  async function copyShare() {
    if (!currentShareLink) return toast('복사할 링크가 없어요. JSON 파일을 이용해 주세요.');
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(currentShareLink);
      else {
        $('shareLinkInput').select();
        if (!document.execCommand('copy')) throw new Error('copy rejected');
      }
      toast('원고 전달 링크를 복사했어요! ✦');
      $('copyShareLink').textContent = '복사됨 ✓';
      setTimeout(() => $('copyShareLink').textContent = '링크 복사', 2000);
    } catch (_) { $('shareLinkInput').select(); toast('링크를 선택했어요. 직접 복사해 주세요.'); }
  }
  async function importFromHash() {
    const hash = location.hash;
    if (!hash.startsWith('#relay=')) return;
    history.replaceState(null, '', location.pathname + location.search);
    try {
      const raw = await decodeSnapshot(hash.slice('#relay='.length));
      importStory(raw, 'link');
    } catch (err) { toast('전달 링크를 열 수 없어요: ' + (err.message || '파일을 확인해 주세요.')); }
  }

  function bind() {
    ['topCreate', 'heroCreate', 'emptyCreate'].forEach((id) => $(id).addEventListener('click', showCreate));
    ['guideNav', 'heroGuide'].forEach((id) => $(id).addEventListener('click', () => showModal('guideModal')));
    ['homeButton', 'libraryNav', 'backToLibrary'].forEach((id) => $(id).addEventListener('click', showLibrary));
    $('guideStart').addEventListener('click', () => { closeModal('guideModal'); showCreate(); });
    $('nameButton').addEventListener('click', () => { $('nicknameInput').value = nickname(); showModal('nameModal'); });
    $('nameForm').addEventListener('submit', (event) => {
      event.preventDefault();
      const name = $('nicknameInput').value.trim();
      if (!name) return toast('작가 이름을 적어 주세요.');
      localStorage.setItem(NAME_KEY, name);
      updateNameUI();
      if (activeId) $('writerInput').value = name;
      closeModal('nameModal'); toast('작가 이름을 설정했어요.');
    });
    $('createForm').addEventListener('submit', createStory);
    $('demoCreate').addEventListener('click', createDemo);
    $('storySearch').addEventListener('input', renderLibrary);
    $('importTop').addEventListener('click', () => $('importFile').click());
    $('importFile').addEventListener('change', (event) => importBackupFile(event.target.files[0]));
    $('sceneText').addEventListener('input', () => {
      const story = activeStory();
      if (!story) return;
      try { localStorage.setItem(DRAFT_PREFIX + story.id, $('sceneText').value); }
      catch (_) { toast('임시 저장 공간이 부족해요.'); }
      updateEditorMeta();
    });
    $('writerInput').addEventListener('change', () => {
      const newName = $('writerInput').value.trim();
      if (newName) { localStorage.setItem(NAME_KEY, newName); updateNameUI(); }
    });
    $('publishScene').addEventListener('click', publishScene);
    $('newPrompt').addEventListener('click', () => {
      const old = $('promptText').textContent;
      const choices = prompts.filter((p) => p !== old);
      $('promptText').textContent = choices[Math.floor(Math.random() * choices.length)];
    });
    $('readButton').addEventListener('click', () => showReader());
    $('readAllButton').addEventListener('click', () => showReader());
    $('shareButton').addEventListener('click', openShare);
    $('copyShareLink').addEventListener('click', copyShare);
    $('shareDownloadJson').addEventListener('click', backupOne);
    $('downloadText').addEventListener('click', downloadMarkdown);
    $('backupStory').addEventListener('click', backupOne);
    $('finishStory').addEventListener('click', finishStory);
    $('deleteStory').addEventListener('click', deleteStory);
    document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => closeModal(button.dataset.close)));
    document.querySelectorAll('.modal-backdrop').forEach((backdrop) => backdrop.addEventListener('click', (event) => { if (event.target === backdrop) closeModal(backdrop.id); }));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        const open = document.querySelector('.modal-backdrop:not(.hidden)');
        if (open) closeModal(open.id);
      }
    });
    window.addEventListener('hashchange', importFromHash);
  }

  bind();
  updateNameUI();
  renderLibrary();
  importFromHash();
})();