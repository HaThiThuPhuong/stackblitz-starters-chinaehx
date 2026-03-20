// Chay trong terminal: node add_chatbox.js
import { readFileSync, writeFileSync } from 'fs';
let c = readFileSync('index.html', 'utf8');

// 1. Fix loi JS (box-drawing, HTML comments, escaped backticks)
c = c.replace(/<script([^>]*)>([\s\S]*?)<\/script>/g, function(m, attr, code) {
  if (attr.indexOf('src=') >= 0) return m;
  code = code.replace(/[\u2500-\u27FF]/g, '-');
  code = code.replace(/<!--[\s\S]*?-->/g, '');
  code = code.replace(/\\`/g, '`');
  code = code.replace(/\\\${/g, '${');
  code = code.replace(/^\s*<script>\s*$/gm, '');
  return '<script' + attr + '>' + code + '<\/script>';
});

// 2. CSS chatbox
var css = `<style>
#svc-btn{position:fixed;bottom:24px;right:24px;z-index:9999;width:54px;height:54px;border-radius:50%;border:none;cursor:pointer;background:#e62020;color:#fff;font-size:22px;box-shadow:0 4px 16px rgba(230,32,32,.5);transition:transform .2s;display:flex;align-items:center;justify-content:center;}
#svc-btn:hover{transform:scale(1.08);}
#svc-dot{position:absolute;top:2px;right:2px;width:11px;height:11px;background:#4caf50;border-radius:50%;border:2px solid #111;display:none;}
#svc-box{position:fixed;bottom:88px;right:24px;z-index:9999;width:320px;max-height:480px;background:#1a1a1a;border:1px solid rgba(255,255,255,.12);border-radius:14px;display:none;flex-direction:column;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,.7);}
#svc-box.open{display:flex;}
.svc-hdr{background:linear-gradient(135deg,#b01208,#e62020);padding:12px 14px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;}
.svc-avt{width:32px;height:32px;border-radius:50%;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;font-size:14px;}
.svc-hn{font-weight:700;font-size:13px;color:#fff;}
.svc-hs{font-size:10px;color:rgba(255,255,255,.7);}
.svc-xb{background:none;border:none;color:#fff;font-size:16px;cursor:pointer;opacity:.8;}
#svc-start{padding:16px;display:flex;flex-direction:column;gap:9px;}
#svc-start p{font-size:12px;color:#aaa;text-align:center;line-height:1.6;margin:0;}
#svc-start input{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#fff;padding:8px 11px;border-radius:7px;font-size:12px;width:100%;box-sizing:border-box;}
#svc-start input::placeholder{color:rgba(255,255,255,.35);}
#svc-start button{background:#e62020;color:#fff;border:none;padding:9px;border-radius:7px;font-weight:700;cursor:pointer;font-size:12px;}
#svc-msgs{flex:1;overflow-y:auto;padding:11px;display:flex;flex-direction:column;gap:7px;}
.svc-m{max-width:82%;padding:8px 11px;border-radius:11px;font-size:12px;line-height:1.5;word-break:break-word;}
.svc-m.u{align-self:flex-end;background:#e62020;color:#fff;border-bottom-right-radius:3px;}
.svc-m.a{align-self:flex-start;background:rgba(255,255,255,.08);color:#ddd;border-bottom-left-radius:3px;}
.svc-lbl{font-size:10px;color:#666;margin-bottom:2px;}
.svc-typ{align-self:flex-start;background:rgba(255,255,255,.06);color:#777;padding:7px 11px;border-radius:10px;font-size:11px;font-style:italic;}
#svc-iw{padding:9px;border-top:1px solid rgba(255,255,255,.07);display:flex;gap:5px;align-items:flex-end;flex-shrink:0;}
#svc-i{flex:1;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:#fff;padding:7px 9px;border-radius:7px;font-size:12px;resize:none;font-family:inherit;line-height:1.4;}
#svc-i::placeholder{color:rgba(255,255,255,.3);}
#svc-sb{background:#e62020;color:#fff;border:none;width:32px;height:32px;border-radius:7px;cursor:pointer;font-size:14px;flex-shrink:0;}
</style>`;

// 3. HTML chatbox
var html = `
<button id="svc-btn" onclick="svcToggle()">&#128172;<span id="svc-dot"></span></button>
<div id="svc-box">
  <div class="svc-hdr">
    <div style="display:flex;align-items:center;gap:9px">
      <div class="svc-avt">&#129302;</div>
      <div><div class="svc-hn">SneakerVN AI</div><div class="svc-hs">Tu van 24/7</div></div>
    </div>
    <button class="svc-xb" onclick="svcToggle()">&#10005;</button>
  </div>
  <div id="svc-start">
    <p>Xin chao! Toi la AI tu van cua <strong style="color:#e62020">SneakerVN</strong>.<br>Cho toi biet ten ban nhe!</p>
    <input id="svc-gn" placeholder="Ho ten cua ban" onkeydown="if(event.key==='Enter')svcStart()">
    <input id="svc-ge" placeholder="Email (tuy chon)" type="email">
    <button onclick="svcStart()">Bat Dau Tu Van</button>
  </div>
  <div id="svc-conv" style="display:none;flex:1;flex-direction:column;overflow:hidden">
    <div id="svc-msgs"></div>
    <div id="svc-iw">
      <textarea id="svc-i" rows="1" placeholder="Hoi ve san pham, size, gia..."
        onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();svcSend()}"
        oninput="this.style.height='auto';this.style.height=Math.min(this.scrollHeight,70)+'px'"></textarea>
      <button id="svc-sb" onclick="svcSend()">&#10148;</button>
    </div>
  </div>
</div>`;

// 4. JS chatbox
var js = `<script>
var svcSid=localStorage.getItem('svn_chat_sid'),svcLast=0,svcPoll=null,svcBusy=false;

function svcToggle(){
  var b=document.getElementById('svc-box');
  if(b.classList.contains('open')){
    b.classList.remove('open');
    if(svcPoll){clearInterval(svcPoll);svcPoll=null;}
  } else {
    b.classList.add('open');
    document.getElementById('svc-dot').style.display='none';
    if(svcSid){svcShowConv();svcLoadHist();svcPoll=setInterval(svcPollFn,5000);}
    else setTimeout(function(){var e=document.getElementById('svc-gn');if(e)e.focus();},150);
  }
}

function svcShowConv(){
  document.getElementById('svc-start').style.display='none';
  var c=document.getElementById('svc-conv');
  c.style.display='flex';c.style.flexDirection='column';c.style.flex='1';c.style.overflow='hidden';
}

function svcStart(){
  var n=(document.getElementById('svc-gn').value||'').trim()||'Khach';
  var e=(document.getElementById('svc-ge').value||'').trim();
  fetch('/api/chat/session',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({guest_name:n,guest_email:e})})
  .then(function(r){return r.json();})
  .then(function(d){
    if(!d.session){alert(d.error||'Loi');return;}
    svcSid=d.session.id;localStorage.setItem('svn_chat_sid',svcSid);
    svcShowConv();
    svcAdd('a','Xin chao '+n+'! Toi la AI tu van SneakerVN. Ban can ho tro gi ve giay sneaker?');
    svcPoll=setInterval(svcPollFn,5000);
  })
  .catch(function(e){alert('Loi: '+e.message);});
}

function svcSend(){
  if(svcBusy||!svcSid)return;
  var i=document.getElementById('svc-i'),msg=(i.value||'').trim();if(!msg)return;
  i.value='';i.style.height='auto';
  svcAdd('u',msg);svcBusy=true;
  var t=document.createElement('div');t.className='svc-typ';t.id='svc-typ';t.textContent='AI dang soan...';
  var w=document.getElementById('svc-msgs');w.appendChild(t);w.scrollTop=99999;
  fetch('/api/chat/message',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({session_id:svcSid,message:msg})})
  .then(function(r){return r.json();})
  .then(function(d){var t=document.getElementById('svc-typ');if(t)t.remove();svcAdd('a',d.reply||'Xin loi!');svcBusy=false;})
  .catch(function(){var t=document.getElementById('svc-typ');if(t)t.remove();svcAdd('a','Loi ket noi!');svcBusy=false;});
}

function svcLoadHist(){
  if(!svcSid)return;
  fetch('/api/chat/session/'+svcSid+'/messages')
  .then(function(r){return r.json();})
  .then(function(ms){
    if(!Array.isArray(ms)||!ms.length)return;
    document.getElementById('svc-msgs').innerHTML='';
    ms.forEach(function(m){svcAdd(m.sender==='guest'?'u':'a',m.message,m.created_at);if(m.id>svcLast)svcLast=m.id;});
  }).catch(function(){});
}

function svcAdd(who,text,time){
  var w=document.getElementById('svc-msgs');if(!w)return;
  var d=document.createElement('div');d.style.cssText='display:flex;flex-direction:column';
  if(who==='a'){var l=document.createElement('div');l.className='svc-lbl';l.textContent='SneakerVN AI';d.appendChild(l);}
  var b=document.createElement('div');b.className='svc-m '+who;
  var s=document.createElement('span');s.textContent=text;b.innerHTML=s.innerHTML;
  if(time){var ts=document.createElement('div');ts.style.cssText='font-size:10px;opacity:.5;margin-top:3px';
    ts.textContent=new Date(time).toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit'});b.appendChild(ts);}
  d.appendChild(b);w.appendChild(d);w.scrollTop=w.scrollHeight;
}

function svcPollFn(){
  if(!svcSid||svcBusy)return;
  fetch('/api/chat/session/'+svcSid+'/messages')
  .then(function(r){return r.json();})
  .then(function(ms){
    if(!Array.isArray(ms))return;
    ms.forEach(function(m){
      if(m.id>svcLast){
        svcAdd(m.sender==='guest'?'u':'a',m.message,m.created_at);svcLast=m.id;
        var b=document.getElementById('svc-box');
        if(!b||!b.classList.contains('open'))document.getElementById('svc-dot').style.display='block';
      }
    });
  }).catch(function(){});
}

if(svcSid)document.addEventListener('DOMContentLoaded',function(){svcShowConv();});
<\/script>`;

// Chèn vào file
c = c.replace('</head>', css + '</head>');
var idx = c.lastIndexOf('</body>');
c = c.slice(0, idx) + html + '\n' + js + '\n' + c.slice(idx);

writeFileSync('index.html', c);
console.log('✅ Done! Chatbox da duoc them vao index.html');
console.log('   Chay: git add -A && git commit -m "add chatbox" && git push origin main');