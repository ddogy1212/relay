/* Two-person relay smoke test — no external npm dependencies. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('app.js', 'utf8');
new vm.Script(source, { filename: 'app.js' });

function setup(initialHash = '') {
  const memory = new Map();
  const cache = new Map();
  const winEvents = {};
  let copied = '';

  class El {
    constructor(tag='div', id='') {
      this.tagName = tag.toUpperCase();
      this.id = id;
      this.value = '';
      this.events = {};
      this.dataset = {};
      this.style = {};
      this.children = [];
      this.textContent = '';
      this.disabled = false;
      const list = new Set(['storyView','libraryView','shareModal','menuModal','guideModal','openLibraryWelcome','noChapters','notMyTurn','finishedBox'].includes(id) ? ['hidden'] : []);
      this.classList = {
        contains: (v) => list.has(v),
        add: (...args) => args.forEach(v=>list.add(v)),
        remove: (...args) => args.forEach(v=>list.delete(v)),
        toggle: (v, state) => { const newState = state === undefined ? !list.has(v) : Boolean(state); if(newState) list.add(v); else list.delete(v); return newState; }
      };
    }
    addEventListener(type, cb) { (this.events[type] ||= []).push(cb); }
    fire(type, extra = {}) { for(const cb of this.events[type] || []) cb({ target:this, currentTarget:this, preventDefault() {}, ...extra }); }
    append(...args) { this.children.push(...args); }
    appendChild(el) { this.children.push(el); return el; }
    replaceChildren(...args) { this.children = args; }
    remove() {}
    setAttribute() {}
    select() {}
    focus() {}
    click() { this.fire('click'); }
    querySelector() { return get('modalCloseStub'); }
  }
  function get(id) { if(!cache.has(id)) cache.set(id, new El('div',id)); return cache.get(id); }
  const form = get('createForm');
  form.elements = { title:{value:''}, me:{value:''}, partner:{value:''} };
  form.reset = () => { form.elements.title.value=''; form.elements.me.value=''; form.elements.partner.value=''; };
  const overlays=['shareModal','menuModal','guideModal'].map(get);
  const doc={
    body:new El('body','body'),activeElement:null,
    getElementById:get,
    createElement:(tag)=>new El(tag),
    querySelectorAll:(s)=>s==='.overlay' ? overlays : [],
    querySelector:(s)=>s==='.editor-footer'?get('editor-footer') : s==='.overlay:not(.hidden)' ? (overlays.find(v=>!v.classList.contains('hidden'))||null) : null,
    addEventListener() {},
    execCommand(){return true;}
  };
  const loc={href:'https://example.org/relay/'+initialHash,hash:initialHash,pathname:'/relay/',search:''};
  const context=vm.createContext({
    document:doc,location:loc,history:{replaceState(){}},
    window:{isSecureContext:true,scrollTo(){},addEventListener:(kind,cb)=>{winEvents[kind]=cb;}},
    navigator:{clipboard:{async writeText(text){copied=text;}}},
    localStorage:{getItem:(k)=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,String(v)),removeItem:(k)=>memory.delete(k)},
    TextEncoder,TextDecoder,Blob,Response,atob,btoa,console,
    setTimeout:()=>0,clearTimeout(){},confirm:()=>true,
  });
  vm.runInContext(source,context,{filename:'app.js'});
  return {
    get,form,memory,loc,
    stories:()=>JSON.parse(memory.get('relay_stories_v1')||'[]'),
    get copied(){return copied;},
    async receive(url){loc.hash=new URL(url).hash;loc.href='https://example.org/relay/'+loc.hash; await winEvents.hashchange();await new Promise(r=>setImmediate(r));}
  };
}

async function test() {
  const left=setup();
  assert.equal(left.stories().length,0);
  left.form.elements.title.value='별빛 아래 우리';
  left.form.elements.me.value='첫째';
  left.form.elements.partner.value='둘째';
  left.form.fire('submit');

  assert.equal(left.stories().length,1,'creates story');
  assert.equal(left.stories()[0].authors.join('/'),'첫째/둘째','two authors exactly');
  assert.equal(left.get('turnName').textContent,'첫째 (나)','first writer starts');

  left.get('chapterInput').value='평범했던 우리의 밤에 낯선 편지가 도착했다.';
  left.get('chapterInput').fire('input');
  left.get('submitChapterBtn').fire('click');
  assert.equal(left.stories()[0].scenes.length,1,'first scene persists');
  assert.equal(left.get('turnName').textContent,'둘째 (상대)','turn switches to second');
  assert.equal(left.get('chapterInput').disabled,true,'first writer cannot write on second turn');
  await new Promise(r=>setImmediate(r));
  left.get('copyLinkBtn').fire('click');
  await new Promise(r=>setImmediate(r));
  const link=left.copied;
  assert.ok(link.includes('#relay='),'snapshot handoff link copied');

  const right=setup(new URL(link).hash);
  await new Promise(r=>setImmediate(r));
  assert.equal(right.stories().length,1,'new device imports story');
  assert.equal(right.stories()[0].scenes.length,1,'first text survives handoff');
  assert.equal(right.memory.get('relay_me_v2'),'둘째','receiving phone assigned second writer');
  assert.equal(right.get('chapterInput').disabled,false,'second writer can write');
  right.get('chapterInput').value='편지 안에는 내일 일어날 일들이 또박또박 적혀 있었다.';
  right.get('submitChapterBtn').fire('click');
  assert.equal(right.stories()[0].scenes.length,2,'second scene added');
  await new Promise(r=>setImmediate(r));
  right.get('copyLinkBtn').fire('click');
  await new Promise(r=>setImmediate(r));
  await left.receive(right.copied);
  assert.equal(left.stories()[0].scenes.length,2,'first phone receives updated story');
  assert.equal(left.get('chapterInput').disabled,false,'first author can now write again');

  left.get('chapterInput').value='세 번째 장면, 다시 내가 쓰는 이야기.';
  left.get('submitChapterBtn').fire('click');
  assert.equal(left.stories()[0].scenes.length,3,'round-robin continues');
  console.log('PASS: onboarding, alternating turns, local drafts, sharing, receiving, and returning to first writer');
}
test().catch(err=>{console.error(err);process.exitCode=1;});
