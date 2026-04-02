// Chay trong terminal: node add_chatbox.js
import { readFileSync, writeFileSync } from 'fs';
let c = readFileSync('index.html', 'utf8');

// 1. Fix loi JS
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
#svc-box{position:fixed;bottom:88px;right:24px;z-index:9999;width:340px;max-height:520px;background:#1a1a1a;border:1px solid rgba(255,255,255,.12);border-radius:14px;display:none;flex-direction:column;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,.7);}
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
.svc-m{max-width:88%;padding:8px 11px;border-radius:11px;font-size:12px;line-height:1.5;word-break:break-word;}
.svc-m.u{align-self:flex-end;background:#e62020;color:#fff;border-bottom-right-radius:3px;}
.svc-m.a{align-self:flex-start;background:rgba(255,255,255,.08);color:#ddd;border-bottom-left-radius:3px;}
.svc-lbl{font-size:10px;color:#666;margin-bottom:2px;}
.svc-typ{align-self:flex-start;background:rgba(255,255,255,.06);color:#777;padding:7px 11px;border-radius:10px;font-size:11px;font-style:italic;}
#svc-iw{padding:9px;border-top:1px solid rgba(255,255,255,.07);display:flex;gap:5px;align-items:flex-end;flex-shrink:0;}
#svc-i{flex:1;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:#fff;padding:7px 9px;border-radius:7px;font-size:12px;resize:none;font-family:inherit;line-height:1.4;}
#svc-i::placeholder{color:rgba(255,255,255,.3);}
#svc-sb{background:#e62020;color:#fff;border:none;width:32px;height:32px;border-radius:7px;cursor:pointer;font-size:14px;flex-shrink:0;}
#svc-img-btn{background:rgba(255,255,255,.08);color:#ccc;border:1px solid rgba(255,255,255,.12);width:32px;height:32px;border-radius:7px;cursor:pointer;font-size:15px;flex-shrink:0;display:flex;align-items:center;justify-content:center;transition:background .2s;}
#svc-img-btn:hover{background:rgba(255,255,255,.16);}
#svc-img-input{display:none;}
.svc-products{display:flex;flex-direction:column;gap:6px;margin-top:6px;max-width:100%;}
.svc-prod-card{display:flex;align-items:center;gap:8px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:7px 9px;cursor:pointer;transition:background .2s;text-decoration:none;}
.svc-prod-card:hover{background:rgba(230,32,32,.15);border-color:rgba(230,32,32,.4);}
.svc-prod-img{width:44px;height:44px;object-fit:cover;border-radius:5px;flex-shrink:0;background:#222;}
.svc-prod-info{flex:1;overflow:hidden;}
.svc-prod-name{font-size:11px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.svc-prod-brand{font-size:10px;color:#aaa;}
.svc-prod-price{font-size:11px;color:#e62020;font-weight:700;white-space:nowrap;}
#svc-img-preview{padding:6px 9px 0;display:none;align-items:center;gap:7px;background:rgba(255,255,255,.04);border-top:1px solid rgba(255,255,255,.07);}
#svc-img-preview img{width:42px;height:42px;object-fit:cover;border-radius:6px;}
#svc-img-preview span{font-size:11px;color:#aaa;flex:1;}
#svc-img-cancel{background:none;border:none;color:#aaa;font-size:14px;cursor:pointer;}
.svc-search-badge{display:inline-block;font-size:10px;background:rgba(230,32,32,.2);color:#e62020;border:1px solid rgba(230,32,32,.3);border-radius:4px;padding:1px 6px;margin-bottom:5px;}
.svc-img-thumb{width:70px;height:70px;object-fit:cover;border-radius:8px;margin-bottom:5px;display:block;}
</style>`;

// 3. HTML chatbox
var html = `
<input type="file" id="svc-img-input" accept="image/*">
<button id="svc-btn" onclick="svcToggle()">&#128172;<span id="svc-dot"></span></button>
<div id="svc-box">
  <div class="svc-hdr">
    <div style="display:flex;align-items:center;gap:9px">
      <div class="svc-avt">&#129302;</div>
      <div><div class="svc-hn">SneakerVN AI</div><div class="svc-hs">Tu van &amp; Tim kiem 24/7</div></div>
    </div>
    <button class="svc-xb" onclick="svcToggle()">&#10005;</button>
  </div>
  <div id="svc-start">
    <p>Xin chao! Toi la AI tu van cua <strong style="color:#e62020">SneakerVN</strong>.<br>Hoi ve san pham hoac <strong>up anh giay</strong> de tim kiem!<br>Cho toi biet ten ban nhe!</p>
    <input id="svc-gn" placeholder="Ho ten cua ban" onkeydown="if(event.key==='Enter')svcStart()">
    <input id="svc-ge" placeholder="Email (tuy chon)" type="email">
    <button onclick="svcStart()">Bat Dau Tu Van</button>
  </div>
  <div id="svc-conv" style="display:none;flex:1;flex-direction:column;overflow:hidden">
    <div id="svc-msgs"></div>
    <div id="svc-img-preview">
      <img id="svc-preview-thumb" src="" alt="">
      <span id="svc-preview-name">Anh da chon</span>
      <button id="svc-img-cancel" onclick="svcCancelImage()" title="Huy">&#10005;</button>
    </div>
    <div id="svc-iw">
      <button id="svc-img-btn" onclick="document.getElementById('svc-img-input').click()" title="Tim kiem bang hinh anh">&#128247;</button>
      <textarea id="svc-i" rows="1" placeholder="Hoi ve san pham, size, gia... hoac up anh giay"
        onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();svcSend()}"
        oninput="this.style.height='auto';this.style.height=Math.min(this.scrollHeight,70)+'px'"></textarea>
      <button id="svc-sb" onclick="svcSend()">&#10148;</button>
    </div>
  </div>
</div>`;

// 4. JS chatbox tích hợp tìm kiếm văn bản + hình ảnh
var js = `<script>
var svcSid=localStorage.getItem('svn_chat_sid'),svcLast=0,svcPoll=null,svcBusy=false,svcPendingImage=null;

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
    svcAdd('a','Xin chao '+n+'! Toi la AI tu van SneakerVN. Hoi ve bat ki san pham nao hoac bam nut camera de tim kiem bang hinh anh nhe!');
    svcPoll=setInterval(svcPollFn,5000);
  })
  .catch(function(e){alert('Loi: '+e.message);});
}

/* ── Chon anh ── */
function svcOnImagePicked(evt){
  var file=evt.target.files[0];if(!file)return;
  var reader=new FileReader();
  reader.onload=function(e){
    svcPendingImage={base64:e.target.result,name:file.name};
    document.getElementById('svc-preview-thumb').src=e.target.result;
    document.getElementById('svc-preview-name').textContent=file.name;
    document.getElementById('svc-img-preview').style.display='flex';
    document.getElementById('svc-i').placeholder='Them mo ta (tuy chon)...';
    document.getElementById('svc-i').focus();
  };
  reader.readAsDataURL(file);
  evt.target.value='';
}

function svcCancelImage(){
  svcPendingImage=null;
  document.getElementById('svc-img-preview').style.display='none';
  document.getElementById('svc-i').placeholder='Hoi ve san pham, size, gia... hoac up anh giay';
}

/* ── Gui tin nhan ── */
function svcSend(){
  if(svcBusy||!svcSid)return;
  var i=document.getElementById('svc-i'),msg=(i.value||'').trim();
  if(svcPendingImage){
    var img=svcPendingImage;svcPendingImage=null;
    document.getElementById('svc-img-preview').style.display='none';
    i.value='';i.style.height='auto';
    i.placeholder='Hoi ve san pham, size, gia... hoac up anh giay';
    svcSearchByImage(img.base64,msg);return;
  }
  if(!msg)return;
  i.value='';i.style.height='auto';
  if(svcIsSearchQuery(msg))svcSearchByText(msg);
  else svcSendToChat(msg);
}

/* ── Phat hien y dinh tim kiem san pham ── */
function svcIsSearchQuery(txt){
  var t=txt.toLowerCase();
  var kws=['tim','co ','co ban','ban ','show','cho xem','muon mua','gia','nike','adidas','puma',
    'converse','vans','jordan','yeezy','air','ultra','running','san pham','giay','sneaker',
    'dep','thuong hieu','hang','mau','size','co so'];
  return kws.some(function(k){return t.indexOf(k)>=0;});
}

/* ── TIM KIEM BANG VAN BAN ──
   1. Goi /api/chat/message de AI tu van + luu lich su
   2. Song song goi /api/sanpham?search=... de lay san pham thuc
   3. Hien thi reply AI + card san pham  */
function svcSearchByText(msg){
  svcAdd('u',msg);svcBusy=true;svcShowTyping();
  var keyword=svcExtractKeyword(msg);
  Promise.all([
    fetch('/api/chat/message',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({session_id:svcSid,message:msg})}).then(function(r){return r.json();}),
    fetch('/api/sanpham?search='+encodeURIComponent(keyword)+'&limit=5').then(function(r){return r.json();})
  ]).then(function(res){
    svcHideTyping();
    var reply=res[0].reply||'Xin loi, thu lai sau!';
    var products=(res[1].data||[]).slice(0,5);
    svcAddWithProducts(reply,products,keyword,false);
    svcBusy=false;
  }).catch(function(){
    svcHideTyping();svcAdd('a','Loi ket noi! Vui long thu lai.');svcBusy=false;
  });
}

function svcExtractKeyword(txt){
  var stops=['co','cho','toi','xem','muon','mua','ban','tim','gia','bao','nhieu','nhe','duoc','khong','nhu','vay'];
  var t=txt.toLowerCase();
  stops.forEach(function(s){t=t.replace(new RegExp('\\b'+s+'\\b','g'),'');});
  t=t.replace(/\s+/g,' ').trim();
  return t.length>2?t:txt;
}

/* ── TIM KIEM BANG HINH ANH ──
   1. Hien thi thumb anh
   2. Goi /api/search/image -> Vision AI tra ve {brand,model,query,description}
   3. Goi /api/sanpham?search=... voi keyword tu Vision
   4. Goi /api/chat/message de AI sinh cau tra loi tu nhien ve anh + san pham
   5. Hien thi reply + card san pham  */
function svcSearchByImage(base64,extraText){
  svcBusy=true;
  // Show anh user vua gui
  var wrap=document.createElement('div');
  wrap.style.cssText='display:flex;flex-direction:column;align-items:flex-end;gap:3px';
  var thumb=document.createElement('img');
  thumb.src=base64;thumb.style.cssText='width:70px;height:70px;object-fit:cover;border-radius:8px;';
  wrap.appendChild(thumb);
  if(extraText){var t=document.createElement('div');t.className='svc-m u';t.textContent=extraText;wrap.appendChild(t);}
  var w=document.getElementById('svc-msgs');w.appendChild(wrap);w.scrollTop=w.scrollHeight;
  svcShowTyping();

  // Buoc 1: Vision AI phan tich anh
  fetch('/api/search/image',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({image:base64})})
  .then(function(r){return r.json();})
  .then(function(vision){
    var searchQuery=vision.query||vision.brand||'giay sneaker';
    var desc=vision.description||('Tim: '+searchQuery);
    // Buoc 2 & 3 song song: lay san pham + goi chat API
    var chatMsg='[Tim kiem bang anh] Khach up anh giay. Vision AI phan tich: '+desc
      +'. Thuong hieu: '+(vision.brand||'chua ro')+', Model: '+(vision.model||'chua ro')
      +', Mau: '+(vision.color||'chua ro')+(extraText?'. Ghi chu: '+extraText:'')
      +'. Da tim duoc san pham tu DB. Hay tu van ngan gon giup khach chon san pham phu hop.';
    return Promise.all([
      fetch('/api/chat/message',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({session_id:svcSid,message:chatMsg})}).then(function(r){return r.json();}),
      fetch('/api/sanpham?search='+encodeURIComponent(searchQuery)+'&limit=5').then(function(r){return r.json();}),
      Promise.resolve(searchQuery)
    ]);
  })
  .then(function(res){
    svcHideTyping();
    var reply=res[0].reply||'Tim thay san pham tuong tu!';
    var products=(res[1].data||[]).slice(0,5);
    var keyword=res[2];
    svcAddWithProducts(reply,products,keyword,true);
    svcBusy=false;
  })
  .catch(function(err){
    svcHideTyping();console.error('Image search error:',err);
    svcAdd('a','Xin loi! Khong the phan tich anh luc nay. Vui long mo ta bang chu hoac thu lai.');
    svcBusy=false;
  });
}

/* ── Chat thuan (khong search) ── */
function svcSendToChat(msg){
  svcAdd('u',msg);svcBusy=true;svcShowTyping();
  fetch('/api/chat/message',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({session_id:svcSid,message:msg})})
  .then(function(r){return r.json();})
  .then(function(d){svcHideTyping();svcAdd('a',d.reply||'Xin loi!');svcBusy=false;})
  .catch(function(){svcHideTyping();svcAdd('a','Loi ket noi!');svcBusy=false;});
}

/* ── Typing indicator ── */
function svcShowTyping(){
  var t=document.createElement('div');t.className='svc-typ';t.id='svc-typ';
  t.textContent='AI dang xu ly...';
  var w=document.getElementById('svc-msgs');w.appendChild(t);w.scrollTop=99999;
}
function svcHideTyping(){var t=document.getElementById('svc-typ');if(t)t.remove();}

/* ── Render bubble AI + card san pham ── */
function svcAddWithProducts(replyText,products,keyword,isImage){
  var w=document.getElementById('svc-msgs');if(!w)return;
  var outer=document.createElement('div');
  outer.style.cssText='display:flex;flex-direction:column;max-width:92%;align-self:flex-start;';
  var lbl=document.createElement('div');lbl.className='svc-lbl';lbl.textContent='SneakerVN AI';
  outer.appendChild(lbl);
  var bubble=document.createElement('div');bubble.className='svc-m a';
  var badge=document.createElement('div');badge.className='svc-search-badge';
  badge.textContent=isImage?'Ket qua tim theo anh':'Tim: '+keyword;
  bubble.appendChild(badge);
  var br=document.createElement('br');bubble.appendChild(br);
  var span=document.createElement('span');span.textContent=replyText;bubble.appendChild(span);
  outer.appendChild(bubble);
  if(products&&products.length>0){
    var cardWrap=document.createElement('div');cardWrap.className='svc-products';
    products.forEach(function(p){
      var card=document.createElement('a');card.className='svc-prod-card';card.href='#';
      card.onclick=function(e){
        e.preventDefault();
        if(window.showProductDetail)window.showProductDetail(p.masanpham);
        else if(window.openProductModal)window.openProductModal(p.masanpham);
        else svcSendToChat('Cho toi xem them thong tin san pham '+p.tensanpham);
      };
      var PLACEHOLDER='data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44"><rect fill="%23333" width="44" height="44" rx="5"/><text x="22" y="30" font-size="22" text-anchor="middle" fill="%23666">&#128769;</text></svg>';
      var img=document.createElement('img');img.className='svc-prod-img';
      img.src=p.hinhanh||PLACEHOLDER;img.onerror=function(){this.src=PLACEHOLDER;};
      card.appendChild(img);
      var info=document.createElement('div');info.className='svc-prod-info';
      var name=document.createElement('div');name.className='svc-prod-name';name.textContent=p.tensanpham;
      var brand=document.createElement('div');brand.className='svc-prod-brand';brand.textContent=p.thuonghieu||'';
      var price=document.createElement('div');price.className='svc-prod-price';
      price.textContent=Number(p.giaban).toLocaleString('vi-VN')+'đ';
      info.appendChild(name);info.appendChild(brand);info.appendChild(price);
      card.appendChild(info);cardWrap.appendChild(card);
    });
    outer.appendChild(cardWrap);
  } else {
    var nr=document.createElement('div');nr.style.cssText='font-size:11px;color:#888;margin-top:4px;';
    nr.textContent='Khong tim thay san pham phu hop, thu tu khoa khac nhe!';
    outer.appendChild(nr);
  }
  w.appendChild(outer);w.scrollTop=w.scrollHeight;
}

/* ── Bubble don gian ── */
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

/* ── Load lich su ── */
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

/* ── Polling tin moi ── */
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

/* ── Khoi tao ── */
document.addEventListener('DOMContentLoaded',function(){
  if(svcSid)svcShowConv();
  var inp=document.getElementById('svc-img-input');
  if(inp)inp.addEventListener('change',svcOnImagePicked);
});
<\/script>`;

// Chen vao file
c = c.replace('</head>', css + '</head>');
var idx = c.lastIndexOf('</body>');
c = c.slice(0, idx) + html + '\n' + js + '\n' + c.slice(idx);

writeFileSync('index.html', c);
console.log('Done! Chatbox nang cap da them vao index.html');
console.log('Tinh nang moi:');
console.log('  [TEXT SEARCH]  Tu dong phat hien y dinh tim kiem -> goi song song /api/chat/message + /api/sanpham');
console.log('  [IMAGE SEARCH] Upload anh -> /api/search/image (Vision AI) -> /api/sanpham -> /api/chat/message');
console.log('  [CARDS] Hien thi card san pham inline trong chatbox');
console.log('  [HISTORY] Lich su chat van duoc luu va polling binh thuong');
console.log('Chay: git add -A && git commit -m "feat: chatbox text+image search" && git push origin main');