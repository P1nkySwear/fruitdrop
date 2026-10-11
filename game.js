
"use strict";
/* ================= FruitDrop — своя игра, без рекламы ================= */

var TIERS = [
  {n:"Вишня",      r:18.4, c1:"#ff6b74", c2:"#d92632", score:1},
  {n:"Клубника",   r:25.3, c1:"#ff8fa0", c2:"#e4395b", score:3},
  {n:"Виноград",   r:32.2, c1:"#c084fc", c2:"#7e22ce", score:6},
  {n:"Мандарин",   r:39,  c1:"#ffb457", c2:"#f07b0e", score:10},
  {n:"Хурма",      r:43,  c1:"#ff9d6b", c2:"#e85d26", score:15},
  {n:"Яблоко",     r:52,  c1:"#ff7b72", c2:"#cf2226", score:21},
  {n:"Груша",      r:62,  c1:"#d3e97a", c2:"#84a823", score:28},
  {n:"Персик",     r:73,  c1:"#ffd3a8", c2:"#f59e6d", score:36},
  {n:"Ананас",     r:85,  c1:"#ffe08a", c2:"#e8b921", score:45},
  {n:"Дыня",       r:98,  c1:"#c4e88a", c2:"#77b447", score:55},
  {n:"Арбуз",      r:112, c1:"#7ed977", c2:"#2e8b43", score:66}
];
var DROP_WEIGHTS = [30,26,20,14,10];   // шансы появления тиров 1..5
var BOOST_COST = 150;
var START_COINS = 150;
var COMBO_WINDOW = 1.0;                // сек между слияниями для комбо
var DANGER_TIME=3.0;                   // сек над линией до проигрыша

var cv = document.getElementById("c"), ctx = cv.getContext("2d");
var stage = document.getElementById("stage");
var DPR = Math.min(window.devicePixelRatio || 1, 2.5);

/* ---- состояние ---- */
var W=0,H=0, bx0=0,bx1=0,by0=0,by1=0, S=1, lineY=0, spawnY=0;
var balls=[], held=null, nextTier=0, dropCd=0;

/* ---- Matter: жёсткая физика ---- */
var engine=Matter.Engine.create({enableSleeping:false});
engine.positionIterations=12;
engine.velocityIterations=10;
engine.constraintIterations=4;
engine.gravity.y=0.5;   // компенсация выросшего стакана: удар как до увеличения
var world=engine.world;
var mergeQueue=[], wallBodies=[];

/* ---- дизайн: картинки фруктов и фон стакана ---- */
var FRUIT_IMGS=[], BG_IMG=new Image(), ASSET_V=Date.now();   // ?v= — против устаревшего кэша картинок
(function(){
  var need=0;
  function cnt(){ need++; return function(){}; }
  for(var i=1;i<=11;i++){
    (function(n){
      var im=new Image(), cb=cnt();
      im.onload=cb; im.onerror=cb;
      im.src="fruits/Fruit"+n+".png?v="+ASSET_V;
      FRUIT_IMGS[n-1]=im;
    })(i);
  }
  BG_IMG.onload=function(){need--;}; BG_IMG.onerror=function(){need--;};
  BG_IMG.src="backgrounds/Background.png?v="+ASSET_V;
  need++;
})();
var score=0, coins= +(localStorage.getItem("fd_coins")||START_COINS), best= +(localStorage.getItem("fd_best")||0);
var soundOn = localStorage.getItem("fd_sound")!=="0";
var running=false, dead=false, removeMode=false, growMode=false;
var dangerT=0, lastMergeT=-9, combo=0;
var parts=[], floats=[];
var aimX=0, pointerDown=false;
var shakeT=0;

function $(id){ return document.getElementById(id); }
function rand(a,b){ return a + Math.random()*(b-a); }
function clamp(v,a,b){ return v<a?a:(v>b?b:v); }
function rOf(t){ return TIERS[t].r*S; }

function showTip(msg){
  var t=$("tip"); t.textContent=msg; t.classList.add("show");
  clearTimeout(t._h); t._h=setTimeout(function(){ t.classList.remove("show"); },2200);
}

/* ---- звук: короткие процедурные "поп" ---- */
var AC=null;
function audio(){ if(!AC){ try{ AC=new (window.AudioContext||window.webkitAudioContext)(); }catch(e){} } if(AC&&AC.state==="suspended") AC.resume(); return AC; }
function beep(freq, dur, vol, type){
  if(!soundOn) return; var a=audio(); if(!a) return;
  var o=a.createOscillator(), g=a.createGain();
  o.type=type||"sine"; o.frequency.value=freq;
  g.gain.setValueAtTime(vol||.15,a.currentTime);
  g.gain.exponentialRampToValueAtTime(.0001,a.currentTime+dur);
  o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime+dur);
}
function sndDrop(){ beep(180,.08,.10,"triangle"); }
function sndMerge(t){ beep(320+t*38,.14,.16,"sine"); beep(480+t*44,.10,.09,"triangle"); }
function sndBig(){ beep(240,.35,.2,"sawtooth"); beep(360,.3,.15,"sine"); beep(600,.4,.1,"sine"); }
function sndCoin(){ beep(900,.06,.08,"square"); }

/* ---- размеры поля ---- */
function layout(){
  var r = stage.getBoundingClientRect();
  W=r.width; H=r.height;
  cv.width=Math.round(W*DPR); cv.height=Math.round(H*DPR);
  ctx.setTransform(DPR,0,0,DPR,0,0);
  var pad=4;
  var topStrip=10;                       // стакан начинается почти от верха — превью внутри
  var bw=Math.min(W-pad*2, 440);
  var bh=Math.max(H-topStrip-pad, 300);
  S=bw/420;
  bx0=(W-bw)/2; bx1=bx0+bw; by0=topStrip; by1=H-pad;
  lineY=by0+140*S;
  spawnY=by0+48*S;
  aimX=clamp(aimX||W/2, bx0+30, bx1-30);
  if(typeof buildWalls==="function") buildWalls();
}

function pickTier(){
  var total=0,i; for(i=0;i<DROP_WEIGHTS.length;i++) total+=DROP_WEIGHTS[i];
  var x=Math.random()*total;
  for(i=0;i<DROP_WEIGHTS.length;i++){ x-=DROP_WEIGHTS[i]; if(x<0) return i; }
  return 0;
}

/* ---- шарики (тела Matter) ---- */
function addBall(t,x,y,vx,vy){
  var r=TIERS[t].r*S;
  var b=Matter.Bodies.circle(x,y,r,{
    label:"ball",
    density:0.001*Math.pow(1.35,t),   // вес растёт быстрее размера: крупный перевешивает
    friction:0.02, frictionStatic:0.05, frictionAir:0.0008,
    restitution:0.02,
    slop:0.02                          // жёсткий контакт: territory не нарушается
  });
  b.tier=t; b.cd=0.3; b.spawnPop=0.22;
  if(vx||vy) Matter.Body.setVelocity(b,{x:vx,y:vy});
  Matter.World.add(world,b);
  balls.push(b);
  return b;
}
function removeBall(b){
  b.removed=true;
  Matter.Composite.remove(world,b);
  var i=balls.indexOf(b); if(i>=0) balls.splice(i,1);
}
var wallOpts={isStatic:true,label:"wall",friction:0.02,restitution:0};
function buildWalls(){
  for(var i=0;i<wallBodies.length;i++) Matter.Composite.remove(world,wallBodies[i]);
  var w=bx1-bx0, h=by1-by0, mxy=(by0+by1)/2;
  wallBodies=[
    Matter.Bodies.rectangle(bx0+w/2, by1+40, w+400, 80, wallOpts),
    Matter.Bodies.rectangle(bx0-40, mxy, 80, h+400, wallOpts),
    Matter.Bodies.rectangle(bx1+40, mxy, 80, h+400, wallOpts),
    Matter.Bodies.rectangle(bx0+w/2, by0-42, w+400, 80, wallOpts)   // крышка у кромки: ничего не выскакивает над стаканом
  ];
  Matter.World.add(world,wallBodies);
}

function startGame(resume){
  for(var i=balls.length-1;i>=0;i--) removeBall(balls[i]);
  mergeQueue.length=0;
  parts=[]; floats=[];
  score=0; dangerT=0; combo=0; dead=false; dropCd=0;
  removeMode=false; growMode=false;
  $("bRemove").classList.remove("armed"); $("bGrow").classList.remove("armed");
  held=null; nextTier=pickTier();
  aimX=W/2;
  running=true;
  if(!resume) clearField();            // явный новый старт стирает сессию
  $("overlay").classList.add("hidden");
  updateHUD();
  spawnHeld();
}
function spawnHeld(){
  if(!nextTier && nextTier!==0) nextTier=pickTier();
  held={t:nextTier, x:clamp(aimX,bx0+rOf(nextTier)+2,bx1-rOf(nextTier)-2), y:spawnY};
  nextTier=pickTier();
}
function dropHeld(){
  if(!held||dead) return;
  addBall(held.t, held.x, spawnY, 0, 1);   // 1 юнит = ~60 px/s, просто отпускаем
  held=null;
  dropCd=.35; sndDrop(); saveField(true);
}

/* ---- слияние: события движка ---- */
Matter.Events.on(engine,"collisionStart",function(ev){
  if(!running) return;
  for(var i=0;i<ev.pairs.length;i++){
    var a=ev.pairs[i].bodyA, b=ev.pairs[i].bodyB;
    if(a.label!=="ball"||b.label!=="ball") continue;
    if(a.tier!==b.tier||a.merging||b.merging||a.cd>0||b.cd>0) continue;
    a.merging=b.merging=true;
    mergeQueue.push(a,b);
  }
});
function rescanTouching(){
  // досмотр: касающиеся одинаковые фрукты сливаются, даже если collisionStart уже был
  for(var i=0;i<balls.length;i++){
    var a=balls[i];
    if(a.merging||a.cd>0) continue;
    for(var j=i+1;j<balls.length;j++){
      var b=balls[j];
      if(b.merging||b.cd>0||a.tier!==b.tier) continue;
      var dx=b.position.x-a.position.x, dy=b.position.y-a.position.y;
      var min=TIERS[a.tier].r*S+TIERS[b.tier].r*S+2*S;
      if(dx*dx+dy*dy<min*min){
        a.merging=b.merging=true;
        mergeQueue.push(a,b);
        break;
      }
    }
  }
}
function processMerges(){
  while(mergeQueue.length){
    var a=mergeQueue.shift(), b=mergeQueue.shift();
    if(a.removed||b.removed) continue;
    var t=a.tier;
    var mx=(a.position.x+b.position.x)/2, my=(a.position.y+b.position.y)/2;
    removeBall(a); removeBall(b);
        if(t===TIERS.length-1){          // два арбуза исчезают с бонусом
          addScore(300,mx,my,true); coins+=25; sndBig();
          burst(mx,my,TIERS[t],26); floatText("+25🪙",mx,my);
    } else {
      var nb=addBall(t+1,mx,my,(a.velocity.x+b.velocity.x)*.25,(a.velocity.y+b.velocity.y)*.25);
      nb.cd=0.25;
      var targetR=TIERS[t+1].r*S, fromR=TIERS[t].r*S;
      Matter.Body.scale(nb, fromR/targetR, fromR/targetR);   // рождается маленьким и плавно растёт
      nb.grow={target:targetR};
      var now=perfNow();
      if(now-lastMergeT<COMBO_WINDOW) combo++; else combo=1;
      lastMergeT=now;
      var mult=Math.min(1+(combo-1)*.25, 2.5);
      var pts=Math.round(TIERS[t+1].score*mult);
      addScore(pts,mx,my,false);
      var cn=Math.round((t+2)*1.5);
      coins+=cn; sndMerge(t+1); sndCoin();
      burst(mx,my,TIERS[t+1],10+(t+1));
      floatText("+"+pts+(combo>1?" ×"+combo:"")+"  +"+cn+"🪙",mx,my);
    }
    updateHUD();
    saveField(true);        // слияние меняет поле — фиксируем сразу
  }
}
function addScore(p,x,y,big){ score+=p; if(score>best){ best=score; localStorage.setItem("fd_best",best);} }

function perfNow(){ return performance.now()/1000; }
function burst(x,y,tier,n){
  for(var i=0;i<n;i++){
    var a=rand(0,6.28), sp=rand(60,260)*S;
    parts.push({x:x,y:y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp-60*S,r:rand(2,5)*S,life:rand(.35,.7),t:0,c:tier.c1});
  }
}
function floatText(txt,x,y){ floats.push({x:x,y:y,txt:txt,life:1}); }

/* ---- опасная зона ---- */
function checkDanger(dt){
  if(removeMode||growMode) return;                 // бустер заряжен — таймер замер и ждёт
  var over=false, i, b;
  for(i=0;i<balls.length;i++){
    b=balls[i];
    if((b.aboveT||0)>1){ over=true; break; }       // фрукт непрерывно над линией дольше секунды
  }
  if(over) dangerT+=dt; else dangerT=Math.max(0,dangerT-dt*3);
  if(dangerT>=DANGER_TIME) gameOver();
}
/* ---- сохранение сессии ---- */
var FIELD_KEY="fd_field";
function saveField(force){
  if(dead||!running) return;
  var now=perfNow();
  if(!force && now-(saveField._t||0)<2) return;
  saveField._t=now;
  var data={v:1, score:score, nextTier:nextTier, balls:[]};
  for(var i=0;i<balls.length;i++){
    var b=balls[i];
    data.balls.push({t:b.tier,
      x:+((b.position.x-bx0)/(bx1-bx0)).toFixed(4),
      y:+((b.position.y-by0)/(by1-by0)).toFixed(4),
      vx:+(b.velocity.x).toFixed(3), vy:+(b.velocity.y).toFixed(3),
      a:+(b.angle||0).toFixed(3)});
  }
  try{ localStorage.setItem(FIELD_KEY, JSON.stringify(data)); }catch(e){}
}
function clearField(){ try{ localStorage.removeItem(FIELD_KEY); }catch(e){} }
function loadField(){
  try{
    var d=JSON.parse(localStorage.getItem(FIELD_KEY)||"null");
    if(!d||d.v!==1||!d.balls||!d.balls.length) return null;
    return d;
  }catch(e){ return null; }
}
function restoreField(d){
  for(var i=0;i<d.balls.length;i++){
    var s=d.balls[i];
    var b=addBall(s.t, bx0+s.x*(bx1-bx0), by0+s.y*(by1-by0), s.vx, s.vy);
    if(s.a) Matter.Body.setAngle(b, s.a);
    b.cd=0;                                 // восстановленные — без иммунитета
  }
  score=d.score||0;
  nextTier=(d.nextTier!=null)? d.nextTier : pickTier();
  held=null; dropCd=0;
  dangerT=0;
  updateHUD();
  spawnHeld();
}
function resumeOrStart(){
  var d=loadField();
  startGame(!!d);
  if(d) restoreField(d);
}

/* ---- перенос сохранения между устройствами ---- */
function exportSave(){
  saveField(true);
  var data={app:"fruitdrop",v:1,coins:coins,best:best,sound:soundOn?"1":"0",
            field:JSON.parse(localStorage.getItem(FIELD_KEY)||"null")};
  var blob=new Blob([JSON.stringify(data)],{type:"application/json"});
  var a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download="fruitdrop-save.json";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function(){ URL.revokeObjectURL(a.href); },2000);
  showTip("Файл сохранения скачан");
}
function importSave(file){
  var r=new FileReader();
  r.onload=function(){
    try{
      var d=JSON.parse(r.result);
      if(d.app!=="fruitdrop") throw 0;
      coins=d.coins||START_COINS;
      best=d.best||0;
      soundOn=d.sound!=="0";
      localStorage.setItem("fd_coins",String(coins));
      localStorage.setItem("fd_best",String(best));
      localStorage.setItem("fd_sound",soundOn?"1":"0");
      if(d.field) localStorage.setItem(FIELD_KEY,JSON.stringify(d.field)); else clearField();
      resumeOrStart();
      showTip("Сохранение загружено");
    }catch(e){ showTip("Файл не читается"); }
  };
  r.readAsText(file);
}

function gameOver(){
  dead=true; running=false; held=null; removeMode=false; growMode=false;
  clearField();                             // партия закончена — сессии больше нет
  localStorage.setItem("fd_coins",coins);
  localStorage.setItem("fd_best",best);
  showCard(
    "<h1>Игра окончена</h1>"+
    "<p>Фрукты вылезли за красную линию</p>"+
    "<div class='big'>"+score+"</div>"+
    "<p>Очки &nbsp;·&nbsp; рекорд: <b>"+best+"</b></p>"+
    "<p>Монет на счету: <b style='color:#ffd76a'>"+coins+" 🪙</b></p>"+
    "<div class='row'><button id='cRestart'>Играть ещё</button></div>"
  );
  $("cRestart").onclick=function(){ startGame(); };
}
function showCard(html){ $("card").innerHTML=html; $("overlay").classList.remove("hidden"); }
function showHelp(){
  showCard(
    "<h1>🍉 FruitDrop</h1>"+
    "<p>Веди пальцем, чтобы прицелиться, отпусти — фрукт упадёт.</p>"+
    "<p>Два одинаковых фрукта сливаются в следующий. Собери арбуз!</p>"+
    "<p style='margin-top:10px'><b>Бустеры</b> — стоят <b style='color:#e07a3a'>150 🪙</b>:</p>"+
    "<p>🗑 коснись фрукта — он исчезнет<br>🌪 встряхнуть всё поле<br>🧹 убрать все мелкие фрукты<br>⬆️ коснись фрукта — вырастет на размер</p>"+
    "<p>Монеты капают за каждое слияние.</p>"+
    "<div class='row'><button id='cGo'>Играть!</button></div>"
  );
  $("cGo").onclick=function(){ localStorage.setItem("fd_seen","1"); resumeOrStart(); };
}

/* ---- бустеры ---- */
function armRemove(){
  if(dead) return;
  removeMode=!removeMode;
  $("bRemove").classList.toggle("armed",removeMode);
  if(removeMode&&growMode){ growMode=false; $("bGrow").classList.remove("armed"); }
  if(removeMode) showTip("Коснись фрукта, чтобы убрать его");
}
function armGrow(){
  if(dead) return;
  growMode=!growMode;
  $("bGrow").classList.toggle("armed",growMode);
  if(growMode&&removeMode){ removeMode=false; $("bRemove").classList.remove("armed"); }
  if(growMode) showTip("Коснись фрукта — он вырастет");
}
function tryGrowAt(x,y){
  var bestI=-1,bestD=1e9;
  for(var i=0;i<balls.length;i++){
    var b=balls[i], dx=x-b.position.x, dy=y-b.position.y;
    var d=Math.sqrt(dx*dx+dy*dy);
    if(d<TIERS[b.tier].r*S+12*S && d<bestD){ bestD=d; bestI=i; }
  }
  if(bestI<0) return false;
  var b=balls[bestI];
  if(b.tier>=TIERS.length-1){ showTip("Это уже арбуз — больше некуда"); return true; }
  if(coins<BOOST_COST){ showTip("Не хватает монет"); return true; }
  coins-=BOOST_COST; localStorage.setItem("fd_coins",coins);
  var oldR=TIERS[b.tier].r*S;
  b.tier++;
  var targetR=TIERS[b.tier].r*S;
  Matter.Body.scale(b, oldR/targetR, oldR/targetR);
  Matter.Body.setMass(b, 0.001*Math.pow(1.35,b.tier)*Math.PI*targetR*targetR);
  b.grow={target:targetR};
  b.spawnPop=.25;
  burst(b.position.x,b.position.y,TIERS[b.tier],12);
  beep(300,.1,.12,"sine"); beep(520,.14,.1,"sine");
  growMode=false; $("bGrow").classList.remove("armed");
  updateHUD(); saveField(true);
  return true;
}
function doBroom(){
  if(dead) return;
  var n=0,i;
  for(i=0;i<balls.length;i++) if(balls[i].tier<=1) n++;
  if(n===0){ showTip("Мелких фруктов нет"); return; }
  if(coins<BOOST_COST){ showTip("Не хватает монет"); return; }
  coins-=BOOST_COST; localStorage.setItem("fd_coins",coins);
  for(i=balls.length-1;i>=0;i--){
    if(balls[i].tier<=1){ var s=balls[i]; burst(s.position.x,s.position.y,TIERS[s.tier],8); removeBall(s); }
  }
  beep(440,.12,.12,"triangle"); beep(660,.16,.09,"triangle");
  showTip("Подметено: "+n);
  updateHUD(); saveField(true);
}
function doShake(){
  if(dead||coins<BOOST_COST){ showTip(coins<BOOST_COST?"Не хватает монет":""); if(coins<BOOST_COST)return; }
  coins-=BOOST_COST; localStorage.setItem("fd_coins",coins);
  for(var i=0;i<balls.length;i++){
    Matter.Body.setVelocity(balls[i],{x:rand(-220,220)*S/60,y:-rand(180,420)*S/60});
  }
  shakeT=.35; beep(140,.25,.12,"sawtooth");
  showTip("Встряхнули!"); updateHUD(); saveField(true);
}
function tryRemoveAt(x,y){
  var bestI=-1,bestD=1e9;
  for(var i=0;i<balls.length;i++){
    var b=balls[i], dx=x-b.position.x, dy=y-b.position.y;
    var d=Math.sqrt(dx*dx+dy*dy);
    if(d<TIERS[b.tier].r*S+12*S && d<bestD){ bestD=d; bestI=i; }
  }
  if(bestI<0) return false;
  var b=balls[bestI];
  coins-=BOOST_COST; localStorage.setItem("fd_coins",coins);
  burst(b.position.x,b.position.y,TIERS[b.tier],12);
  removeBall(b);
  beep(700,.12,.12,"triangle");
  removeMode=false; $("bRemove").classList.remove("armed");
  updateHUD(); saveField(true);
  return true;
}

/* ---- HUD ---- */
function updateHUD(){
  $("score").textContent=score;
  $("best").textContent=best;
  $("coinval").textContent=coins;
  var poor=coins<BOOST_COST;
  $("bRemove").classList.toggle("poor",poor);
  $("bShake").classList.toggle("poor",poor);
  $("bBroom").classList.toggle("poor",poor);
  $("bGrow").classList.toggle("poor",poor);
}

/* ---- ввод ---- */
function px(e){
  var r=cv.getBoundingClientRect();
  var t=e.touches?e.touches[0]:e;
  return {x:t.clientX-r.left, y:t.clientY-r.top};
}
function onDown(e){
  if(pointerDown) return;              // второй палец не сбивает прицел
  audio();
  var p=px(e);
  if(removeMode){ if(tryRemoveAt(p.x,p.y)) { pointerDown=false; e.preventDefault(); return; } removeMode=false; $("bRemove").classList.remove("armed"); }
  if(growMode){ if(tryGrowAt(p.x,p.y)) { pointerDown=false; e.preventDefault(); return; } growMode=false; $("bGrow").classList.remove("armed"); }
  pointerDown=true;                    // началось прицеливание: фрукт следует за пальцем
  aimX=p.x;
  if(held) held.x=clamp(aimX,bx0+rOf(held.t)+2,bx1-rOf(held.t)-2);
  e.preventDefault();
}
function onMove(e){
  var p=px(e);
  aimX=p.x;
  if(held&&pointerDown) held.x=clamp(aimX,bx0+rOf(held.t)+2,bx1-rOf(held.t)-2);
  e.preventDefault();
}
function onUp(e){
  if(pointerDown&&held&&!dead){ dropHeld(); }
  pointerDown=false;
  e.preventDefault();
}
cv.addEventListener("mousedown",onDown); cv.addEventListener("mousemove",onMove);
window.addEventListener("mouseup",onUp);
cv.addEventListener("touchstart",onDown,{passive:false});
cv.addEventListener("touchmove",onMove,{passive:false});
cv.addEventListener("touchend",onUp,{passive:false});
cv.addEventListener("touchcancel",onUp,{passive:false});

$("bRemove").onclick=armRemove;
$("bShake").onclick=doShake;
$("bBroom").onclick=doBroom;
$("bGrow").onclick=armGrow;
$("btnSound").onclick=function(){ soundOn=!soundOn; localStorage.setItem("fd_sound",soundOn?"1":"0"); this.textContent=soundOn?"🔊":"🔇"; if(soundOn) beep(600,.07,.1); };
$("btnRestart").onclick=function(){
    if(dead){ startGame(); return; }
    showCard("<h2>Меню</h2>"+
      "<p>Текущий счёт сбросится, монеты останутся.</p>"+
      "<div class='row2'><button id='cExport'>💾 В файл</button><button id='cImport'>📂 Из файла</button></div>"+
      "<div class='row'><button class='ghost' id='cNo'>Закрыть</button><button id='cYes'>Заново</button></div>"+
      "<input type='file' id='cFile' accept='.json,application/json' style='display:none'>");
    $("cExport").onclick=exportSave;
    $("cImport").onclick=function(){ $("cFile").click(); };
    $("cFile").onchange=function(){ if(this.files[0]) importSave(this.files[0]); };
    $("cNo").onclick=function(){ $("overlay").classList.add("hidden"); };
    $("cYes").onclick=function(){ startGame(); };
};
$("btnSound").textContent=soundOn?"🔊":"🔇";

/* ---- отрисовка ---- */
function drawBall(x,y,t,pop,ghost,ang){
  var r=rOf(t);
  var k=pop>0? 1+pop*1.1 : 1;
  r*=k;
  var img=FRUIT_IMGS[t];
  ctx.save();
  if(ghost) ctx.globalAlpha=.55;
  ctx.translate(x,y);
  if(ang) ctx.rotate(ang);
  if(img && img.complete && img.naturalWidth>0){
    var s=r*1.08;                       // картинка чуть выступает за хитбокс — фрукт выглядит полноценно
    ctx.drawImage(img, -s, -s, s*2, s*2);
  } else {
    var T=TIERS[t];
    var gr=ctx.createRadialGradient(-r*.35,-r*.4,r*.1, 0,0,r*1.05);
    gr.addColorStop(0,T.c1); gr.addColorStop(.75,T.c2); gr.addColorStop(1,shade(T.c2,-18));
    ctx.beginPath(); ctx.arc(0,0,r,0,6.2832); ctx.fillStyle=gr; ctx.fill();
    var er=r*.13, pr=er*.55;
    var ex=r*.34, ey=-r*.02;
    ctx.beginPath(); ctx.arc(-ex,ey,er,0,6.2832); ctx.arc(ex,ey,er,0,6.2832); ctx.fillStyle="#fff"; ctx.fill();
    ctx.beginPath(); ctx.arc(-ex+er*.2,ey+er*.1,pr,0,6.2832); ctx.arc(ex+er*.2,ey+er*.1,pr,0,6.2832); ctx.fillStyle="#241a2e"; ctx.fill();
  }
  ctx.restore();
}
function shade(hex,amt){
  var n=parseInt(hex.slice(1),16), r=(n>>16)+amt, g=((n>>8)&255)+amt, b=(n&255)+amt;
  r=clamp(r,0,255); g=clamp(g,0,255); b=clamp(b,0,255);
  return "rgb("+(r|0)+","+(g|0)+","+(b|0)+")";
}
function draw(now){
  ctx.clearRect(0,0,W,H);
  var shx=0; if(shakeT>0){ shakeT-=1/60; shx=Math.sin(now*90)*shakeT*14*S; }
  ctx.save(); ctx.translate(shx,0);
  // коробка с фоном из дизайна
  var rr=18*S;
  ctx.beginPath();
  roundRect(bx0-8*S,by0-8*S,(bx1-bx0)+16*S,(by1-by0)+16*S,rr);
  if(BG_IMG.complete && BG_IMG.naturalWidth>0){
    ctx.save();
    ctx.clip();
    ctx.drawImage(BG_IMG, bx0-8*S, by0-8*S, (bx1-bx0)+16*S, (by1-by0)+16*S);
    ctx.restore();
  } else {
    ctx.fillStyle="rgba(255,255,255,.5)"; ctx.fill();
  }
  ctx.strokeStyle="rgba(242,150,150,.85)"; ctx.lineWidth=3*S; ctx.stroke();
  // опасная линия
  var warn=dangerT>0.35;
  ctx.save();
  ctx.setLineDash([10*S,8*S]);
  ctx.strokeStyle=warn? "rgba(255,90,90,"+(.5+.5*Math.sin(now*8))+")" : "rgba(255,120,120,.4)";
  ctx.lineWidth=2.5*S;
  ctx.beginPath(); ctx.moveTo(bx0+4*S,lineY); ctx.lineTo(bx1-4*S,lineY); ctx.stroke();
  ctx.restore();
  if(warn){
    var g2=ctx.createLinearGradient(0,by0,0,lineY);
    g2.addColorStop(0,"rgba(255,60,60,"+(0.10+0.10*Math.sin(now*8))+")");
    g2.addColorStop(1,"rgba(255,60,60,0)");
    ctx.fillStyle=g2; ctx.fillRect(bx0,by0,bx1-bx0,lineY-by0);
  }
  // шарики
  for(var i=0;i<balls.length;i++){
    var b=balls[i];
    if(b.spawnPop>0) b.spawnPop-=1/60;
    drawBall(b.position.x,b.position.y,b.tier,b.spawnPop>0?b.spawnPop:0,false,b.angle);
  }
  // прицел
  if(held&&!dead){
    var hr=rOf(held.t);
    ctx.save();
    ctx.setLineDash([4*S,7*S]);
    ctx.strokeStyle="rgba(170,90,80,.45)"; ctx.lineWidth=2*S;
    ctx.beginPath(); ctx.moveTo(held.x,held.y+hr+4*S); ctx.lineTo(held.x,by1-6*S); ctx.stroke();
    ctx.restore();
    drawBall(held.x,held.y,held.t,0,false);
  }
  // превью следующего фрукта — по центру, внутри верха стакана
  if(!dead){
    ctx.save();
    ctx.translate(W/2, by0+22*S);
    ctx.scale(.42,.42);
    drawBall(0,0,nextTier,0,false);
    ctx.restore();
  }
  // частицы
  for(i=parts.length-1;i>=0;i--){
    var p=parts[i]; p.t+=1/60;
    if(p.t>p.life){ parts.splice(i,1); continue; }
    p.vy+=900*S/60; p.x+=p.vx/60; p.y+=p.vy/60;
    ctx.globalAlpha=1-p.t/p.life;
    ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,6.2832); ctx.fillStyle=p.c; ctx.fill();
    ctx.globalAlpha=1;
  }
  // всплывающий текст
  ctx.textAlign="center";
  for(i=floats.length-1;i>=0;i--){
    var f=floats[i]; f.life-=1/70; f.y-=1.1*S;
    if(f.life<=0){ floats.splice(i,1); continue; }
    ctx.globalAlpha=Math.min(1,f.life*1.6);
    ctx.font="bold "+(15*Math.min(S,1.15))+"px sans-serif";
    ctx.fillStyle="#d97040";
    ctx.fillText(f.txt,f.x,f.y);
    ctx.globalAlpha=1;
  }
  ctx.restore();
}
function roundRect(x,y,w,h,r){
  ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
}

/* ---- цикл ---- */
var last=0, acc=0;
function frame(ts){
  requestAnimationFrame(frame);
  var now=ts/1000;
  var dt=Math.min(now-last,.05);
  if(now-last>0.5){          // возврат из паузы: прогнать физику вперёд
    if(running){ for(var s=0;s<24;s++) Engine_update_safe(); processMerges(); }
    acc=0;
  } else if(running){
    acc+=dt;
    while(acc>=1/60){
      for(var s2=0;s2<4;s2++) Engine_update_safe();
      for(var b3=0;b3<balls.length;b3++) if(balls[b3].cd>0) balls[b3].cd-=1/60;
      rescanTouching();
      processMerges();
      growStep();
      checkDanger(1/60);
      saveField();          // периодический автосейв (с троттлингом)
      if(dropCd>0) dropCd-=1/60;
      acc-=1/60;
    }
    if(!held&&dropCd<=0&&!dead) spawnHeld();
  }
  last=now;
  draw(now);
}
function Engine_update_safe(){
  Matter.Engine.update(engine, 1000/240);
  maintainBodies();
}
function growStep(){
  for(var i=0;i<balls.length;i++){
    var b=balls[i];
    if(!b.grow) continue;
    var cur=b.circleRadius, target=b.grow.target;
    if(cur<target-0.4){
      var s=Math.pow(target/cur, 1/12);
      Matter.Body.scale(b,s,s);
    } else {
      if(cur>target) Matter.Body.scale(b,target/cur,target/cur);
      Matter.Body.setMass(b, 0.001*Math.pow(1.35,b.tier)*Math.PI*target*target);
      b.grow=null;
    }
  }
}
function maintainBodies(){
  var vmax=1600*S/60, cxm=(bx0+bx1)/2;   // потолок 1600 px/s в юнитах Matter
  for(var i=0;i<balls.length;i++){
    var b=balls[i], r=TIERS[b.tier].r*S;
    // копим время непрерывного пребывания над линией (для таймера проигрыша)
    if(b.position.y<lineY) b.aboveT=(b.aboveT||0)+1/240;
    else b.aboveT=Math.max(0,(b.aboveT||0)-2/240);
    var vx=b.velocity.x, vy=b.velocity.y;
    var sp=Math.sqrt(vx*vx+vy*vy);
    if(sp>vmax) Matter.Body.setVelocity(b,{x:vx*vmax/sp, y:vy*vmax/sp});
    // зажат между полом/стенкой и более крупным шаром — выкатывается в сторону
    var floorPen=(b.position.y+r)-by1;
    var wallPenL=bx0-(b.position.x-r), wallPenR=(b.position.x+r)-bx1;
    var deep=floorPen>r*0.35 || wallPenL>r*0.35 || wallPenR>r*0.35;
    if(deep){
      for(var j=0;j<balls.length;j++){
        if(j===i) continue;
        var o=balls[j], ro=TIERS[o.tier].r*S;
        if(ro<r*1.15) continue;                     // давящий должен быть крупнее
        var dx=b.position.x-o.position.x, dy=b.position.y-o.position.y;
        var dd=Math.sqrt(dx*dx+dy*dy);
        if(dd<r+ro && (r+ro-dd)>r*0.25){
          if(floorPen>r*0.35) Matter.Body.setVelocity(b,{x:(cxm>b.position.x?1:-1)*5*S,y:-2*S});
          else if(wallPenL>r*0.35) Matter.Body.setVelocity(b,{x:5*S,y:-2*S});
          else Matter.Body.setVelocity(b,{x:-5*S,y:-2*S});
          break;
        }
      }
    }
    // страховка: вылетевший из мира шар возвращается в стакан
    if(b.position.y-r>by1+60 || b.position.x+r<bx0-60 || b.position.x-r>bx1+60){
      Matter.Body.setPosition(b,{x:clamp(b.position.x,bx0+r+2,bx1-r-2), y:by1-r-2});
      Matter.Body.setVelocity(b,{x:0,y:0});
    }
  }
}

/* ---- старт ---- */
layout();
window.addEventListener("resize",function(){ layout(); });
window.addEventListener("orientationchange",function(){ setTimeout(layout,300); });
updateHUD();
if(!localStorage.getItem("fd_seen")) showHelp(); else resumeOrStart();
document.addEventListener("visibilitychange", function(){ if(document.hidden) saveField(true); });
window.addEventListener("pagehide", function(){ saveField(true); });
window.addEventListener("beforeunload", function(){ saveField(true); });
requestAnimationFrame(frame);

if('serviceWorker' in navigator){ navigator.serviceWorker.register('sw.js').catch(function(){}); }
