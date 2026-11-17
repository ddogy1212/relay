/* Cloud sync test: two independent phones + mocked protected RPC server. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto, createHash } = require('node:crypto');
const source = fs.readFileSync('app.js', 'utf8');
new vm.Script(source);
const sha = (text) => createHash('sha256').update(text).digest('hex');
const rooms = new Map();

async function rpcMock(url, req) {
  const fn = String(url).split('/').pop();
  const p = JSON.parse(req.body || '{}');
  const json = (data, status=200) => new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
  if (fn === 'relay_sync_create') {
    if(rooms.has(p.p_room_id)) return json({message:'ALREADY_EXISTS'},400);
    rooms.set(p.p_room_id,{ id:p.p_room_id, title:p.p_title, authors:[p.p_author_a,p.p_author_b],
      keys:[p.p_key_a_hash,p.p_key_b_hash], scenes:(p.p_scenes||[]).map((s,i)=>({id:String(i+1),author:i%2?p.p_author_b:p.p_author_a,text:s.text,createdAt:new Date().toISOString()})),
      status:'writing',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString() });
    return json({ok:true,id:p.p_room_id,count:p.p_scenes.length});
  }
  const room=rooms.get(p.p_room_id);
  const role=room ? room.keys.indexOf(sha(p.p_token||'')) : -1;
  if (!room || role<0) return fn==='relay_sync_read' ? json(null) : json({message:'UNAUTHORIZED'},403);
  if(fn==='relay_sync_read') return json({
    id:room.id,title:room.title,authors:room.authors,scenes:room.scenes,status:room.status,
    createdAt:room.createdAt,updatedAt:room.updatedAt
  });
  if(fn==='relay_sync_append'){
    if (role!==room.scenes.length%2) return json({message:'NOT_YOUR_TURN'},400);
    if (p.p_expected_count!==room.scenes.length) return json({message:'STALE_VERSION'},400);
    room.scenes.push({id:String(room.scenes.length+1),author:room.authors[role],text:p.p_content,createdAt:new Date().toISOString()});
    room.updatedAt=new Date().toISOString();
    return json({ok:true,count:room.scenes.length});
  }
  if(fn==='relay_sync_set_finished'){
    room.status=p.p_finished?'finished':'writing';
    room.updatedAt=new Date().toISOString();
    return json({ok:true,status:room.status});
  }
  return json({message:'UNKNOWN_RPC'},404);
}

function phone(initialHash='', seeded={}) {
  const store = new Map(Object.entries(seeded)), nodes=new Map(), windowEvents={};
  let copied='';
  class El {
    constructor(id='') {
      this.id=id;this.value='';this.events={};this.children=[];this.textContent='';
      this.disabled=false;this.style={};this.dataset={};
      const hidden=new Set(['storyView','libraryView','shareModal','menuModal','guideModal','nudgeBtn','enableCloudBtn','inviteBtn'].includes(id)?['hidden']:[]);
      this.classList={contains:x=>hidden.has(x),add:(...v)=>v.forEach(x=>hidden.add(x)),remove:(...v)=>v.forEach(x=>hidden.delete(x)),toggle:(x,flag)=>{const on=flag===undefined?!hidden.has(x):!!flag;on?hidden.add(x):hidden.delete(x);return on;}};
    }
    addEventListener(type,fn){(this.events[type] ||= []).push(fn);}
    fire(type){for(const fn of (this.events[type]||[]))fn({preventDefault(){},target:this,currentTarget:this});}
    append(...items){this.children.push(...items);}
    appendChild(el){this.children.push(el);return el;}
    replaceChildren(...items){this.children=items;}
    remove(){}
    select(){}
    focus(){}
    querySelector(){return get('modalClose');}
  }
  const get=(id)=>{if(!nodes.has(id))nodes.set(id,new El(id));return nodes.get(id);};
  const form=get('createForm');form.elements={title:{value:''},me:{value:''},partner:{value:''}};
  form.reset=()=>{Object.values(form.elements).forEach(o=>o.value='');};
  const overlays=['shareModal','menuModal','guideModal','joinModal'].map(get);
  const loc={href:'https://example.org/relay/'+initialHash,hash:initialHash,pathname:'/relay/',search:''};
  const doc={
    body:new El('body'),hidden:false,
    getElementById:get, createElement:()=>new El(),
    querySelectorAll:(q)=>q==='.overlay'?overlays:[],
    querySelector:(q)=>q==='.editor-footer'?get('editor-footer'):q==='.overlay:not(.hidden)'?overlays.find(el=>!el.classList.contains('hidden'))||null:null,
    addEventListener(){},execCommand:()=>true,
  };
  const context=vm.createContext({
    document:doc,location:loc,history:{replaceState(){}},
    window:{scrollTo(){},isSecureContext:true,addEventListener:(name,fn)=>windowEvents[name]=fn},
    localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)},
    navigator:{clipboard:{async writeText(v){copied=v;}}},
    fetch:rpcMock, crypto:webcrypto, TextEncoder,TextDecoder,Response,Blob,atob,btoa,console,
    setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,confirm:()=>true
  });
  vm.runInContext(source,context,{filename:'app.js'});
  return {get,form,store,loc,get copied(){return copied;},
    stories:()=>JSON.parse(store.get('relay_stories_v1')||'[]'),
    async refresh(){get('cloudRefreshBtn').fire('click');await settle();}};
}
const settle=()=>new Promise(resolve=>setTimeout(resolve,90));

async function main() {
  const a=phone();
  a.form.elements.title.value='두 사람의 시간';
  a.form.elements.me.value='봄';
  a.form.elements.partner.value='여름';
  a.form.fire('submit');
  await settle();
  assert.equal(a.stories().length,1,'story exists locally');
  const roomId=a.stories()[0].id;
  assert.ok(rooms.has(roomId),'cloud room created');
  assert.equal(a.get('cloudStatus').classList.contains('online'),true,'first phone is connected');
  assert.equal(a.get('inviteBtn').classList.contains('hidden'),false,'first phone can invite');
  a.get('copyLinkBtn').fire('click');
  await settle();
  const invite=a.copied;
  assert.ok(invite.includes('#join='),'one-time invitation available');
  // A creator must not accidentally lose their writing role by opening their own invite.
  a.get('joinFromStoryBtn').fire('click');
  a.get('joinUrlInput').value=invite;
  a.get('joinSubmitBtn').fire('click');
  await settle();
  assert.equal(JSON.parse(a.store.get('relay_cloud_keys_v1'))[roomId].role,0,'creator keeps own writer role');
  const b=phone(new URL(invite).hash);
  await settle();
  assert.equal(b.stories()[0].id,roomId,'second phone joined same room');
  assert.equal(b.store.get('relay_me_v2'),'여름','joining writer assigned correctly');
  assert.equal(b.get('cloudStatus').classList.contains('online'),true);

  a.get('chapterInput').value='봄이 먼저 첫 장면을 썼어요.';
  a.get('chapterInput').fire('input');
  a.get('submitChapterBtn').fire('click');
  await settle();
  assert.equal(rooms.get(roomId).scenes.length,1,'first cloud scene saved');
  assert.equal(b.stories()[0].scenes.length,0,'receiver has stale local cache until refresh');
  await b.refresh();
  assert.equal(b.stories()[0].scenes.length,1,'new scene synchronizes to receiver');
  assert.equal(b.get('chapterInput').disabled,false,'second writer can write');

  b.get('chapterInput').value='여름이 그 이야기를 이어 썼어요.';
  b.get('submitChapterBtn').fire('click');
  await settle();
  assert.equal(rooms.get(roomId).scenes.length,2,'second writer cloud scene saved');
  await a.refresh();
  assert.equal(a.stories()[0].scenes.length,2,'returning phone receives partner text');
  assert.equal(a.get('chapterInput').disabled,false,'turn comes back to first writer');
  assert.equal(a.get('nudgeBtn').classList.contains('hidden'),true,'no nudge on own turn');

  // Regression: two phones may have received the SAME offline story UUID.
  // A new cloud room must never reuse this UUID, or cloud creation returns 409.
  const offlineId='e4fb7e83-4f1a-4f16-92f2-c68d32200011';
  const legacy={
    id:offlineId,title:'옛 원고',authors:['첫째','둘째'],
    scenes:[{id:'old-scene',author:'첫째',text:'기존 장면을 보존한다.',createdAt:new Date().toISOString()}],
    status:'writing',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()
  };
  const seed={relay_stories_v1:JSON.stringify([legacy]),relay_active_story_v2:offlineId,relay_me_v2:'첫째'};
  const author=phone('',seed), recipient=phone('',seed);
  author.get('enableCloudBtn').fire('click');
  await settle();
  const migrated=author.stories().find(s=>s.title==='옛 원고');
  assert.ok(migrated && migrated.id!==offlineId,'migrated story has a FRESH cloud UUID');
  assert.ok(rooms.has(migrated.id),'new cloud room exists without old-id collision');
  author.get('inviteBtn').fire('click');
  await settle();
  author.get('copyLinkBtn').fire('click');
  await settle();
  recipient.get('joinFromStoryBtn').fire('click');
  recipient.get('joinUrlInput').value=author.copied;
  recipient.get('joinSubmitBtn').fire('click');
  await settle();
  assert.equal(recipient.stories().some(s=>s.id===migrated.id),true,'second phone joins creator room via pasted link');
  assert.equal(recipient.get('roomCode').textContent,author.get('roomCode').textContent,'both phones display identical room code');
  assert.equal(recipient.stories().find(s=>s.id===migrated.id).scenes.length,1,'migrated original chapter is present on both');
  assert.equal(recipient.stories().find(s=>s.id===offlineId).scenes.length,1,'previous local copy stays intact');

  console.log('PASS cloud: create → invite → second phone joins → remote chapters sync → alternating turns');
}
main().catch(err=>{console.error(err);process.exitCode=1;});