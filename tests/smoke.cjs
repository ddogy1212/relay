/* Minimal dependency-free UI flow tests for relay. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const source = fs.readFileSync('app.js', 'utf8');
new vm.Script(source, { filename: 'app.js' });

function setup(hash = '') {
  const storage = new Map();
  const cache = new Map();
  class Elem {
    constructor(tag = 'div', id = '') {
      this.tagName = tag.toUpperCase(); this.id = id; this.children = []; this.events = {};
      this.value = ''; this.textContent = ''; this.style = { setProperty() {} }; this.dataset = {};
      const values = new Set(['libraryView', 'studioView'].includes(id) ? (id === 'studioView' ? ['hidden'] : []) : ['createModal','guideModal','shareModal','readModal','nameModal'].includes(id) ? ['hidden'] : []);
      this.classList = { add: (...v) => v.forEach((x) => values.add(x)),
        remove: (...v) => v.forEach((x) => values.delete(x)),
        contains: (v) => values.has(v),
        toggle: (v, enabled) => { if (enabled === undefined) enabled = !values.has(v); if (enabled) values.add(v); else values.delete(v); return enabled; } };
    }
    addEventListener(type, callback) { (this.events[type] ||= []).push(callback); }
    fire(type, e = {}) { for (const fn of this.events[type] || []) fn({ currentTarget: this, target: this, preventDefault() {}, ...e }); }
    append(...children) { this.children.push(...children); }
    appendChild(child) { this.children.push(child); return child; }
    replaceChildren(...children) { this.children = children; }
    querySelector(selector) { return get(this.id + ' ' + selector); }
    setAttribute() {}
    focus() {}
    select() {}
    remove() {}
    scrollIntoView() {}
    reset() {}
  }
  function get(id) { if (!cache.has(id)) cache.set(id, new Elem('div', id)); return cache.get(id); }
  const form = get('createForm');
  form.elements = {
    title: { value: '' }, premise: { value: '' }, genre: { value: '판타지' },
    limit: { value: '800' }, authors: { value: '' }
  };
  const doc = {
    body: new Elem('body'),
    activeElement: null,
    getElementById: get,
    createElement: (tag) => new Elem(tag),
    createTextNode: (str) => ({ textContent: String(str) }),
    querySelectorAll: () => [],
    querySelector: () => null
  };
  const location = { href: 'https://example.com/relay/' + hash, hash, pathname: '/relay/', search: '' };
  const context = vm.createContext({
    document: doc, window: { scrollTo() {}, addEventListener() {}, isSecureContext: true },
    history: { replaceState() {} }, location, navigator: { clipboard: { writeText: async () => {} } },
    localStorage: { getItem: (k) => storage.get(k) || null, setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) },
    crypto: webcrypto, TextEncoder, TextDecoder, Blob, Response, btoa, atob, confirm: () => true,
    setTimeout: () => 0, clearTimeout() {}, requestAnimationFrame: (callback) => callback(),
    console
  });
  vm.runInContext(source, context, { filename: 'app.js' });
  const state = () => JSON.parse(storage.get('relay_stories_v1') || '[]');
  return { get, form, state, storage };
}

async function run() {
  const t = setup();
  assert.equal(t.state().length, 0, 'new library is empty');

  t.form.elements.title.value = '별빛을 모으는 밤';
  t.form.elements.premise.value = '달이 사라진 마을에서 이어지는 비밀';
  t.form.elements.genre.value = '미스터리';
  t.form.elements.authors.value = '가을, 겨울';
  t.form.fire('submit');

  assert.equal(t.state().length, 1, 'story creation persists');
  assert.equal(t.state()[0].authors.join(','), '가을,겨울', 'author order preserved');
  assert.equal(t.get('nextWriter').textContent, '가을');

  t.get('writerInput').value = '가을';
  t.get('sceneText').value = '첫 번째 작가가 조용히 문을 열었다. 책상 위 편지에는 오늘 날짜가 적혀 있었다.';
  t.get('publishScene').fire('click');
  assert.equal(t.state()[0].scenes.length, 1, 'first scene saved');
  assert.equal(t.get('nextWriter').textContent, '겨울');

  t.get('writerInput').value = '가을';
  t.get('sceneText').value = '순서를 어기고 두 번째 장면을 쓰려고 하는 잘못된 집필 시도입니다.';
  t.get('publishScene').fire('click');
  assert.equal(t.state()[0].scenes.length, 1, 'incorrect writer rejected');

  t.get('writerInput').value = '겨울';
  t.get('publishScene').fire('click');
  assert.equal(t.state()[0].scenes.length, 2, 'second writer can publish');
  assert.equal(t.get('nextWriter').textContent, '가을', 'round robin advances');

  await new Promise((resolve) => setImmediate(resolve));
  const link = t.get('shareLinkInput').value;
  assert.ok(link.startsWith('https://example.com/relay/#relay='), 'handoff snapshot link created');

  const received = setup(new URL(link).hash);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(received.state().length, 1, 'recipient imports snapshot');
  assert.equal(received.state()[0].scenes.length, 2, 'recipient sees all scenes');
  assert.equal(received.get('nextWriter').textContent, '가을', 'recipient sees next author');

  console.log('PASS: story creation, author rotation, reject wrong author, scene saving, share link and cross-device import');
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
