'use strict';
// ############################################################################
// #  스킬 블록 — 대회 당일 여기만 고칩니다.                                    #
// #  봇 파일 맨 위(‘use strict’ 바로 아래)에 통째로 붙여넣으세요.              #
// #  그리고 decide 의 return 을 아래 §3 대로 한 줄 감싸면 끝입니다.            #
// ############################################################################

// ── §1  설정 — 이 일곱 줄만 고칩니다 ────────────────────────────────────────
var SK = {
  on:    false,             // 스킬 확인 전에는 false. 확인 후 true 로.
  gauge: 'self.gauge',      // 내 게이지 경로.  Probe 출력에서 그대로 복사
  ogauge:'opp.gauge',       // 상대 게이지 경로
  full:  100,               // 만충 값.  Probe 의 "값 범위" 줄에서 확인
  key:   'skill',           // 발동할 때 반환 객체에 넣을 키 이름
  fire:  0,                 // 0 = 발동 안 함(수비만)   1 = 발동함
  guard: 1                  // 1 = 상대 만충이면 위험한 강스매시를 아치로 낮춤
};
// 기본값이 fire:0, guard:1 인 이유:
//   수비 반응은 자책 위험이 0이고 몇 줄이면 되지만,
//   발동은 물리를 바꿔서 우리 예측을 어긋나게 만들 수 있습니다.
//   측정으로 이득이 확인되기 전까지 fire 는 0 으로 둡니다.

// ── §2  로직 — 여기는 고치지 않습니다 ───────────────────────────────────────
function skPick(o, path) {                       // 'a.b.c' 를 따라감. 없으면 undefined
  var p = path.split('.'), v = o;
  for (var i = 0; i < p.length; i++) { if (v == null) return undefined; v = v[p[i]]; }
  return v;
}
function skFull(v) { return typeof v === 'number' && v >= SK.full; }

function applySkill(s, a) {
  if (!SK.on || !a) return a;
  try {
    // 수비: 상대가 만충이면 강스매시(y=+1)를 아치(y=-1)로 낮춥니다.
    // 강스매시는 실패하면 자기 코트에 꽂히고, 상대 반격 각도도 넓게 열어줍니다.
    if (SK.guard && skFull(skPick(s, SK.ogauge)) && a.hit === 1 && a.y === 1) a.y = -1;

    // 공격: 내가 만충이고 "이미 파워히트를 치려는 순간"에만 발동합니다.
    // 아무 때나 쓰면 게이지만 버리고, 물리가 바뀌어 예측이 어긋납니다.
    if (SK.fire && skFull(skPick(s, SK.gauge)) && a.hit === 1 && s.self.state === 1) a[SK.key] = 1;
  } catch (e) { /* 스킬 로직이 죽어도 기본 액션은 그대로 나갑니다 */ }
  return a;
}

function finishSkillAction(s, a, left) {
  var out = applySkill(s, {x:left?-a.x:a.x, y:a.y, hit:a.hit});
  G.prevAct = {x:left?-out.x:out.x, y:out.y, hit:out.hit};
  return out;
}

// ── §3  호출 — decide 안의 return 이 **두 곳**입니다. 둘 다 감싸세요 ──────────
//
//    RIGHT 경로 (decide 첫 줄):
//      전:  if(snap.side === 'RIGHT') return decideCore(snap, t0);
//      후:  if(snap.side === 'RIGHT') return finishSkillAction(snap, decideCore(snap, t0), false);
//
//    LEFT 경로 (decide 마지막 줄):
//      전:  return {x:-a.x, y:a.y, hit:a.hit};
//      후:  return finishSkillAction(snap, a, true);
//
//    한 곳만 감싸면 한쪽 코트에서만 스킬이 동작합니다. 화면상으로는 티가 안 나고
//    경기의 절반에서만 조용히 안 먹습니다. 붙인 뒤 반드시 두 곳인지 세어보세요.
//
//    두 번 다 원본 `snap` 을 넘깁니다. finishSkillAction 은 실제 출력과 다음 틱의
//    G.prevAct 를 같은 정규화 물리 입력으로 맞추고 일회성 skill 키는 저장하지 않습니다.
//
//  이미 붙여놓은 버전: bot/seed_search_skill.js  ← 당일엔 여기서 §1 일곱 줄만 고치세요

// ============================================================================
// Model-based search bot. Single file, no imports. Ports physics.js exactly.
// ============================================================================
var GW=432, HW=216, PHL=32, PGY=244, BGY=252, NPHW=25, NTT=176, NTB=192;
var BALL_MAX_Y_VELOCITY=40;
var SELF_REACH_LAG=12; // @param:SELF_REACH_LAG — bot/params.json의 제출용 인라인 사본
var OPP_REACH_LAG=0;  // @param:OPP_REACH_LAG — bot/params.json의 제출용 인라인 사본
var STATE_AWARE_REACH=0; // @param:STATE_AWARE_REACH
var DIVE_COST=400,JUMP_COST=200;
var DEPTH=4, BEAM=48; // @param:DEPTH_BEAM
var ROLLOUT_TOUCH_TRACKING=1; // @param:ROLLOUT_TOUCH_TRACKING
var ROOT_DIVERSITY=0; // @param:ROOT_DIVERSITY
var SEARCH_DIAGNOSTICS=0; // @param:SEARCH_DIAGNOSTICS
var OPP_STATE_REACH=0; // @param:OPP_STATE_REACH
var SHOT_SELECT=0; // @param:SHOT_SELECT
var BLOCK_ASSIST=1; // @param:BLOCK_ASSIST
var ROOT_QUOTA=1; // @param:ROOT_QUOTA
var SHOT_TOUCH_CROSS_BONUS=5000;
var BLOCK_NET_DISTANCE=64, BLOCK_POST_OFFSET=40;

// ---- flat state: Int32Array(22) --------------------------------------------
// 0 bx 1 by 2 bvx 3 bvy | player block base 4 (LEFT=p1) and 13 (RIGHT=p2)
// +0 x +1 y +2 vy +3 st +4 fn +5 dly +6 lie +7 dd +8 coll
var SZ=22, PL=4, PR=13;

function clampBallYVelocity(v){
  return v>BALL_MAX_Y_VELOCITY ? BALL_MAX_Y_VELOCITY
       : (v<-BALL_MAX_Y_VELOCITY ? -BALL_MAX_Y_VELOCITY : v);
}

function stepLean(s, ax,ay,ah, bx_,by_,bh,touch,ME,probe){
  var bx=s[0],by=s[1],bvx=s[2],bvy=s[3], ground=0;
  // physics.js clamps at the start of every world-physics frame.
  bvy=clampBallYVelocity(bvy);
  var ballWasLeft=bx<HW;
  var fx=bx+bvx; if(fx<0||fx>GW) bvx=-bvx;
  if(by+bvy<0) bvy=1;
  var d=bx-HW;
  if(d<NPHW&&d>-NPHW&&by>NTT){
    if(by<=NTB){ if(bvy>0) bvy=-bvy; }
    else { var a=bvx<0?-bvx:bvx; bvx = d<0 ? -a : a; }
  }
  var fy=by+bvy;
  if(fy>BGY){ ground=1; bvy=-bvy; by=BGY; }
  else { by=fy; bx=bx+bvx; bvy+=1; }
  s[0]=bx;s[1]=by;s[2]=bvx;s[3]=bvy;
  if(ROLLOUT_TOUCH_TRACKING&&touch&&ballWasLeft!==(bx<HW)){ touch.mt=0;touch.ot=0; }
  for(var p=0;p<2;p++){
    var o=p===0?PL:PR, ix=p===0?ax:bx_, iy=p===0?ay:by_, ih=p===0?ah:bh;
    var st=s[o+3];
    if(st===4){ s[o+6]-=1; if(s[o+6]<-1) s[o+3]=0; continue; }
    var vx=0; if(st<5) vx = st<3 ? ix*6 : s[o+7]*8;
    var px=s[o]+vx;
    if(p===0){ if(px<32)px=32; else if(px>184)px=184; } else { if(px<248)px=248; else if(px>400)px=400; }
    s[o]=px;
    if(st<3 && iy===-1 && s[o+1]===PGY){ s[o+2]=-16; st=1; s[o+3]=1; s[o+4]=0;if(touch&&o===ME)touch.dc=(touch.dc|0)+JUMP_COST; }
    var pfy=s[o+1]+s[o+2]; s[o+1]=pfy;
    if(pfy<PGY) s[o+2]+=1;
    else if(pfy>PGY){ s[o+2]=0; s[o+1]=PGY; s[o+4]=0;
      if(st===3){ st=4;s[o+3]=4;s[o+4]=0;s[o+6]=3; } else { st=0;s[o+3]=0; } }
    if(ih===1){
      if(st===1){ s[o+5]=5;s[o+4]=0;st=2;s[o+3]=2; }
      else if(st===0&&ix!==0){ st=3;s[o+3]=3;s[o+4]=0;s[o+7]=ix;s[o+2]=-5;if(touch&&o===ME)touch.dc=(touch.dc|0)+DIVE_COST; }
    }
    if(st===1) s[o+4]=(s[o+4]+1)%3;
    else if(st===2){ if(s[o+5]<1){ s[o+4]+=1; if(s[o+4]>4){ s[o+4]=0; s[o+3]=1; } } else s[o+5]-=1; }
  }
  for(var q=0;q<2;q++){
    var oo=q===0?PL:PR, jx=q===0?ax:bx_, jy=q===0?ay:by_;
    var ddx=s[0]-s[oo], ddy=s[1]-s[oo+1];
    if(ddx<=PHL&&ddx>=-PHL&&ddy<=PHL&&ddy>=-PHL){
      if(s[oo+8]===0){
        if(probe&&oo===ME){probe.hit=1;probe.bx=s[0];probe.bvy=s[3];probe.power=s[oo+3]===2;}
        if(ROLLOUT_TOUCH_TRACKING&&touch){ if(oo===ME)touch.mt++;else touch.ot++; }
        var pxx=s[oo];
        if(s[0]<pxx) s[2]=-(((pxx-s[0])/3)|0);
        else if(s[0]>pxx) s[2]=(((s[0]-pxx)/3)|0);
        var av=s[3]<0?-s[3]:s[3]; s[3]=-av; if(av<15) s[3]=-15;
        if(s[oo+3]===2){
          var m=(jx<0?-jx:jx)+1;
          s[2] = s[0]<HW ? m*10 : -m*10;
          var b2=s[3]<0?-s[3]:s[3]; s[3]=b2*jy*2;
        }
        s[oo+8]=1;
      }
    } else s[oo+8]=0;
  }
  return ground;
}

// ---- exact free-flight landing prediction ---------------------------------
// LAND: x, frames, whether the path hit the risky net-top band.
var LAND=new Int32Array(3);
function landing(bx,by,bvx,bvy){
  var n=0;LAND[2]=0;
  while(n<300){
    // Keep free-flight prediction identical to the real world step.
    bvy=clampBallYVelocity(bvy);
    var fx=bx+bvx; if(fx<0||fx>GW) bvx=-bvx;
    if(by+bvy<0) bvy=1;
    var d=bx-HW;
    if(d<NPHW&&d>-NPHW&&by>NTT){ if(by<=NTB){ LAND[2]=1;if(bvy>0) bvy=-bvy; } else { var a=bvx<0?-bvx:bvx; bvx=d<0?-a:a; } }
    var fy=by+bvy;
    if(fy>BGY){ LAND[0]=bx; LAND[1]=n+1; return; }
    by=fy; bx=bx+bvx; bvy+=1; n++;
  }
  LAND[0]=bx; LAND[1]=300;
}

// ---- jump arc table --------------------------------------------------------
var JY=[],JV=[]; (function(){ var y=PGY,v=-16; for(var k=0;k<40;k++){ JY.push(y);JV.push(v); var ny=y+v; if(ny<PGY){y=ny;v++;} else if(ny>PGY) break; else {y=ny;} } })();
var DY=[],DV=[]; (function(){ var y=PGY,v=-5; for(var k=0;k<40;k++){ DY.push(y);DV.push(v); var ny=y+v; if(ny<PGY){y=ny;v++;} else if(ny>PGY) break; else {y=ny;} } })();

function inferVy(st,y,prevY,frameGroup){
  if(st!==1&&st!==2&&st!==3) return 0;
  var A=(st===3)?DY:JY, V=(st===3)?DV:JV, n=0, one=0, m=0;
  for(var k=0;k<A.length;k++) if(A[k]===y){ var vv=V[k]; if(n===0){one=vv;m=vv;} else if(vv>m)m=vv; n++; }
  if(n===0) return 0;
  if(n===1) return one;
  if(prevY!==null&&prevY!==undefined){
    for(var i=0;i<A.length;i++) if(A[i]===y){
      var vp=V[i]-frameGroup;
      if(y-(frameGroup*vp+((frameGroup*(frameGroup-1))/2|0))===prevY) return V[i];
    }
  }
  return m;
}

// ---- persistent memory ------------------------------------------------------
var G = {
  prev:null, prevAct:{x:0,y:0,hit:0},
  myTouch:0, oppTouch:0, prevBallLeft:null, prevCollSelf:false, prevCollOpp:false,
  budgetMs:32, worstMs:0, panic:0
};

var ACT=[[0,0,0],[1,0,0],[-1,0,0],[0,-1,0],[1,-1,0],[-1,-1,0],
         [0,-1,1],[1,-1,1],[-1,-1,1],[0,0,1],[1,0,1],[-1,0,1],[0,1,1],[1,1,1],[-1,1,1]];

// Two fixed arenas alternate by depth. All allocations happen once at load.
function makeArena(){
  var nodes=new Array(BEAM), order=new Int32Array(BEAM), rc=new Int32Array(ACT.length);
  for(var i=0;i<BEAM;i++) nodes[i]={s:new Int32Array(SZ),fx:0,fy:0,fh:0,has:0,sc:0,dead:0,ri:-1,mt:0,ot:0,dc:0};
  return {nodes:nodes,order:order,rc:rc};
}
var ARENA_A=makeArena(), ARENA_B=makeArena();
var WORK_STATE=new Int32Array(SZ), OPP_ACT=new Int32Array(3);
var WORK_META={mt:0,ot:0,dc:0};
var ROOT_METRICS={ticks:new Int32Array(DEPTH),sum:new Int32Array(DEPTH),one:new Int32Array(DEPTH)};
var SEARCH_METRICS={decisions:0,searches:0,panics:0,depth:new Int32Array(DEPTH+1),shotTriggers:0,shotKinds:new Int32Array(3)};
var SHOT_STATE=new Int32Array(SZ), SHOT_META={mt:0,ot:0,dc:0}, SHOT_PROBE={hit:0,power:0,bx:0,bvy:0}, SHOT_PICK=new Int32Array(3);
var OPP_REACH=new Int32Array(3);

// Stable constrained top-BEAM. Strict '>' keeps earlier candidates ahead on ties.
function offer(arena,count,state,sc,dead,fx,fy,fh,has,ri,mt,ot,dc){
  var nodes=arena.nodes, order=arena.order, pos,slot,j;
  if(count===BEAM){
    if(ROOT_DIVERSITY){
      var forced=arena.rc[ri]<ROOT_QUOTA, victimRoot;
      pos=-1;
      for(j=BEAM-1;j>=0;j--){
        victimRoot=nodes[order[j]].ri;
        if(forced ? arena.rc[victimRoot]>ROOT_QUOTA
                  : (victimRoot===ri||arena.rc[victimRoot]>ROOT_QUOTA)){ pos=j;break; }
      }
      if(pos<0||(!forced&&!(sc>nodes[order[pos]].sc))) return count;
      slot=order[pos]; arena.rc[nodes[slot].ri]--;
      for(j=pos;j<BEAM-1;j++) order[j]=order[j+1];
      pos=BEAM-1;
    } else {
      if(!(sc>nodes[order[BEAM-1]].sc)) return count;
      slot=order[BEAM-1]; pos=BEAM-1;
    }
  } else { slot=count; pos=count; count++; }
  while(pos>0 && sc>nodes[order[pos-1]].sc){ order[pos]=order[pos-1]; pos--; }
  order[pos]=slot;
  var n=nodes[slot]; n.s.set(state); n.sc=sc; n.dead=dead;
  n.fx=fx; n.fy=fy; n.fh=fh; n.has=has; n.ri=ri;n.mt=mt;n.ot=ot;n.dc=dc;
  if(ROOT_DIVERSITY) arena.rc[ri]++;
  return count;
}
function nodeAction(n){ return n&&n.has ? {x:n.fx,y:n.fy,hit:n.fh} : {x:0,y:0,hit:0}; }

function recordRootDiversity(depth,arena,count){
  var mask=0,roots=0;
  for(var i=0;i<count;i++){
    var ri=arena.nodes[arena.order[i]].ri, bit=1<<ri;
    if((mask&bit)===0){mask|=bit;roots++;}
  }
  ROOT_METRICS.ticks[depth]++;ROOT_METRICS.sum[depth]+=roots;
  if(roots===1)ROOT_METRICS.one[depth]++;
}

function panicHit(){
  G.panic++;
  if(SEARCH_DIAGNOSTICS)SEARCH_METRICS.panics++;
}
function recordDepth(depth){
  if(SEARCH_DIAGNOSTICS){SEARCH_METRICS.searches++;SEARCH_METRICS.depth[depth]++;}
}

function timeoutAction(snap,t0){
  panicHit();recordDepth(0); G.prev=snap;
  var el=Date.now()-t0; if(el>G.worstMs) G.worstMs=el;
  return G.prevAct;
}

function decideCore(snap,t0){
  if(SEARCH_DIAGNOSTICS)SEARCH_METRICS.decisions++;
  var isR = snap.side==='RIGHT';
  var ME = isR?PR:PL, OP = isR?PL:PR;
  var myNear = isR?HW:0, myFar = isR?GW:HW;
  var frameGroup=(snap.config&&snap.config.tickFrameGroupSize)|0;
  if(frameGroup<1)frameGroup=3;

  // ---------- rebuild ----------
  var root=ARENA_A.nodes[0], s0=root.s;
  s0[0]=snap.ball.x; s0[1]=snap.ball.y; s0[2]=snap.ball.xVelocity; s0[3]=snap.ball.yVelocity;
  var prevSelfY = G.prev? G.prev.self.y : null, prevOppY = G.prev? G.prev.opp.y : null;
  for(var i=0;i<2;i++){
    var o=i===0?ME:OP, v=i===0?snap.self:snap.opp, py = i===0?prevSelfY:prevOppY;
    s0[o]=v.x; s0[o+1]=v.y; s0[o+2]=inferVy(v.state,v.y,py,frameGroup);
    s0[o+3]=v.state; s0[o+4]=v.frameNumber; s0[o+7]=v.divingDirection;
    s0[o+5]=(v.state===2&&v.frameNumber===0)?4:0;
    s0[o+6]=(v.state===4)?3:-1;
    var dx=snap.ball.x-v.x, dy=snap.ball.y-v.y;
    s0[o+8]=(dx<=PHL&&dx>=-PHL&&dy<=PHL&&dy>=-PHL)?1:0;
  }

  // ---------- touch bookkeeping ----------
  var ballLeft = snap.ball.x < HW;
  if(G.prevBallLeft!==null && ballLeft!==G.prevBallLeft){ G.myTouch=0; G.oppTouch=0; }
  G.prevBallLeft = ballLeft;
  var cs = s0[ME+8]===1, co = s0[OP+8]===1;
  if(cs&&!G.prevCollSelf) G.myTouch++;
  if(co&&!G.prevCollOpp) G.oppTouch++;
  G.prevCollSelf=cs; G.prevCollOpp=co;
  root.mt=G.myTouch;root.ot=G.oppTouch;

  if(Date.now()-t0>=G.budgetMs) return timeoutAction(snap,t0);

  // ---------- lag compensation: this snapshot's frame runs my PREVIOUS action ----------
  var pa=G.prevAct;
  oppPolicy(s0,OP,isR,OPP_ACT);
  stepLean(s0, isR?OPP_ACT[0]:pa.x, isR?OPP_ACT[1]:pa.y, isR?OPP_ACT[2]:pa.hit,
                isR?pa.x:OPP_ACT[0], isR?pa.y:OPP_ACT[1], isR?pa.hit:OPP_ACT[2],root,ME,null);
  if(Date.now()-t0>=G.budgetMs) return timeoutAction(snap,t0);

  // ---------- search ----------
  var best;
  if(SHOT_SELECT&&chooseShot(s0,ME,OP,isR,frameGroup,t0)) best={x:SHOT_PICK[0],y:SHOT_PICK[1],hit:1};
  else best = search(s0, ME, OP, isR, myNear, myFar, frameGroup, t0);
  G.prev = snap; G.prevAct = best;
  var el = Date.now()-t0; if(el>G.worstMs) G.worstMs=el;
  return best;
}

// opponent policy used inside rollouts: a competent receiver
function oppPolicy(s,O,selfIsRight,out){
  // O is the opponent's block; opponent side is opposite of self
  var oppIsRight = !selfIsRight;
  var near = oppIsRight?HW:0, far = oppIsRight?GW:HW;
  landing(s[0],s[1],s[2],s[3]);
  var lpx=LAND[0], onOwn = lpx>near && lpx<far;
  var toNet = oppIsRight?-1:1;
  var tgt = onOwn ? (lpx - toNet*10) : (near+far)/2;
  var dx = tgt - s[O];
  var x = (dx>6)?1:((dx<-6)?-1:0);
  var y=0,h=0;
  var st=s[O+3];
  var bdx=s[0]-s[O], bdy=s[1]-s[O+1];
  if(bdx<0)bdx=-bdx; if(bdy<0)bdy=-bdy;
  if(st===0 && bdx<40 && s[1]>40 && s[1]<150 && s[3]>0) y=-1;
  if(st===1||st===2){h=1;y=1;if(bdx<50&&bdy<50)x=0;}
  out[0]=x; out[1]=y; out[2]=h;
}

function intervalSlack(x,lo,hi){
  if(x<lo)return lo-x;
  if(x>hi)return x-hi;
  var a=x-lo,b=hi-x;return -(a<b?a:b);
}

// Deterministic power-shot selector outside the beam. No angle heuristic:
// every candidate is ranked only by exact landing, reach interval and net risk.
function chooseShot(s0,ME,OP,isR,frameGroup,t0){
  var st=s0[ME+3];if(st!==1&&st!==2)return 0;
  var found=0,best=-2147483647,bestX=0,bestY=0;
  for(var yi=0;yi<3;yi++){
    var sy=yi-1;
    for(var xi=0;xi<3;xi++){
      if(Date.now()-t0>=G.budgetMs)return 0;
      var sx=xi===0?0:(xi===1?1:-1);
      SHOT_STATE.set(s0);SHOT_META.mt=ARENA_A.nodes[0].mt;SHOT_META.ot=ARENA_A.nodes[0].ot;SHOT_META.dc=0;
      oppPolicy(SHOT_STATE,OP,isR,OPP_ACT);
      var contact=0;
      for(var f=0;f<frameGroup;f++){
        SHOT_PROBE.hit=0;SHOT_PROBE.power=0;
        var ground=stepLean(SHOT_STATE,
          isR?OPP_ACT[0]:sx,isR?OPP_ACT[1]:sy,isR?OPP_ACT[2]:1,
          isR?sx:OPP_ACT[0],isR?sy:OPP_ACT[1],isR?1:OPP_ACT[2],SHOT_META,ME,SHOT_PROBE);
        if(SHOT_PROBE.hit){
          if(SHOT_PROBE.power){
            var speed=(sx<0?-sx:sx)+1;
            var av=SHOT_PROBE.bvy<0?-SHOT_PROBE.bvy:SHOT_PROBE.bvy;if(av<15)av=15;
            SHOT_STATE[2]=SHOT_PROBE.bx<HW?speed*10:-speed*10;
            // expectedLandingPointXWhenPowerHit applies the same cap before
            // advancing the first predicted frame.
            SHOT_STATE[3]=clampBallYVelocity(av*sy*2);contact=1;
          }
          break;
        }
        if(ground)break;
      }
      if(!contact)continue;
      if(ROLLOUT_TOUCH_TRACKING&&(SHOT_META.mt>=5||SHOT_META.ot>=5))continue;
      landing(SHOT_STATE[0],SHOT_STATE[1],SHOT_STATE[2],SHOT_STATE[3]);
      var lpx=LAND[0],lpf=LAND[1],netRisk=LAND[2];
      oppReachInterval(SHOT_STATE,OP,isR,lpf);
      var slack=intervalSlack(lpx,OPP_REACH[0],OPP_REACH[1]);
      var ySlack=BGY-OPP_REACH[2];if(ySlack<0)ySlack=-ySlack;ySlack-=PHL;
      if(ySlack>slack)slack=ySlack;
      var landsOpp=isR?lpx<HW:lpx>=HW;
      if(!landsOpp||netRisk)continue;
      var score=slack;
      if(SHOT_META.mt>=3&&landsOpp)score+=SHOT_TOUCH_CROSS_BONUS;
      if(!found||score>best){found=1;best=score;bestX=sx;bestY=sy;}
    }
  }
  if(!found)return 0;
  SHOT_PICK[0]=bestX;SHOT_PICK[1]=bestY;
  if(SEARCH_DIAGNOSTICS){SEARCH_METRICS.shotTriggers++;SEARCH_METRICS.shotKinds[bestY+1]++;}
  return 1;
}

function search(s0, ME, OP, isR, myNear, myFar, frameGroup, t0){
  var root=ARENA_A.nodes[0]; root.has=0; root.sc=0; root.dead=0;root.ri=-1;root.dc=0; ARENA_A.order[0]=0;
  if(ROLLOUT_TOUCH_TRACKING&&(root.mt>=5||root.ot>=5)){recordDepth(0);return G.prevAct;}
  var blockMode=BLOCK_ASSIST&&blockThreat(s0,OP,isR);
  var src=ARENA_A, dst=ARENA_B, srcCount=1, dstCount=0, work=WORK_STATE;
  for(var d=0; d<DEPTH; d++){
    dstCount=0; var timedOut=0;if(ROOT_DIVERSITY)dst.rc.fill(0);
    expand:
    for(var bi=0; bi<srcCount; bi++){
      if(Date.now()-t0>=G.budgetMs){ timedOut=1; break expand; }
      var nd=src.nodes[src.order[bi]];
      if(nd.dead){
        dstCount=offer(dst,dstCount,nd.s,nd.sc,nd.dead,nd.fx,nd.fy,nd.fh,nd.has,nd.ri,nd.mt,nd.ot,nd.dc);
        continue;
      }
      for(var ai=0; ai<ACT.length; ai++){
        if(Date.now()-t0>=G.budgetMs){ timedOut=1; break expand; }
        var a=ACT[ai];
        work.set(nd.s);
        WORK_META.mt=nd.mt;WORK_META.ot=nd.ot;WORK_META.dc=nd.dc;
        var g=0;
        oppPolicy(work,OP,isR,OPP_ACT);
        var touchDead=0;
        for(var f=0; f<frameGroup; f++){
          g = stepLean(work, isR?OPP_ACT[0]:a[0], isR?OPP_ACT[1]:a[1], isR?OPP_ACT[2]:a[2],
                             isR?a[0]:OPP_ACT[0], isR?a[1]:OPP_ACT[1], isR?a[2]:OPP_ACT[2],WORK_META,ME,null);
          touchDead=ROLLOUT_TOUCH_TRACKING&&(WORK_META.mt>=5||WORK_META.ot>=5);
          if(g||touchDead) break;
        }
        var fx=nd.has?nd.fx:a[0], fy=nd.has?nd.fy:a[1], fh=nd.has?nd.fh:a[2];
        var ri=nd.has?nd.ri:ai;
        var sc=evaluate(work, ME, OP, isR, myNear, myFar, g, d,WORK_META.mt,WORK_META.ot,blockMode)-WORK_META.dc;
        dstCount=offer(dst,dstCount,work,sc,g||touchDead,fx,fy,fh,1,ri,WORK_META.mt,WORK_META.ot,WORK_META.dc);
      }
    }
    if(timedOut){
      panicHit();recordDepth(d);
      if(d===0) return dstCount>0 ? nodeAction(dst.nodes[dst.order[0]]) : G.prevAct;
      return nodeAction(src.nodes[src.order[0]]);
    }
    var tmp=src; src=dst; dst=tmp; srcCount=dstCount;
    if(SEARCH_DIAGNOSTICS)recordRootDiversity(d,src,srcCount);
    if(Date.now()-t0>=G.budgetMs){ panicHit();recordDepth(d+1);return nodeAction(src.nodes[src.order[0]]); }
  }
  recordDepth(DEPTH);
  return nodeAction(src.nodes[src.order[0]]);
}

// Reachable interval after forced dive motion and lying recovery.
// REACH[0] is its centre, REACH[1] is radius including the 32px body half-width.
var REACH=new Int32Array(3);
function selfReachInterval(s,ME,isR,lpf){
  var st=s[ME+3], frames=lpf, x=s[ME], y=s[ME+1], vy=s[ME+2], lie=s[ME+6],canWalk=1;
  var lo=isR?248:32, hi=isR?400:184;
  if(st===3){
    var dd=s[ME+7];
    while(frames>0 && st===3){
      x+=dd*8; if(x<lo)x=lo; else if(x>hi)x=hi;
      frames--;
      var fy=y+vy;
      if(fy>PGY){ y=PGY;vy=0;st=4; lie=3; }
      else { y=fy; if(fy<PGY) vy+=1; }
    }
  }
  if(st===4 && frames>0){
    var locked=lie+2; if(locked<0)locked=0; if(locked>frames)locked=frames;
    frames-=locked; if(frames>0)st=0;
  }
  if(st>=3)canWalk=0;
  if(st!==3&&st!==4&&y<PGY&&frames>0){while(frames>0&&y<PGY){frames--;var ay=y+vy;if(ay>PGY){y=PGY;vy=0;break;}y=ay;if(ay<PGY)vy++;}if(y<PGY)canWalk=0;}
  if(canWalk){frames-=SELF_REACH_LAG;if(frames<0)frames=0;}else frames=0;
  REACH[0]=x; REACH[1]=32+frames*6;REACH[2]=y;
}

// Opponent reachable interval. Unlike the old symmetric radius, diving keeps
// its forced direction and airborne/lying frames consume movement time.
function oppReachInterval(s,O,isR,lpf){
  var st=s[O+3],frames=lpf,x=s[O],y=s[O+1],vy=s[O+2],lie=s[O+6],canWalk=1;
  var oppIsRight=!isR,centreLo=oppIsRight?248:32,centreHi=oppIsRight?400:184;
  if(st===3){
    var dd=s[O+7];
    while(frames>0&&st===3){
      x+=dd*8;if(x<centreLo)x=centreLo;else if(x>centreHi)x=centreHi;
      frames--;
      var fy=y+vy;
      if(fy>PGY){y=PGY;vy=0;st=4;lie=3;}
      else {y=fy;if(fy<PGY)vy++;}
    }
    if(st===3)canWalk=0;
  }
  if(st===4&&frames>0){
    var locked=lie+2;if(locked<0)locked=0;if(locked>frames)locked=frames;
    frames-=locked;if(frames>0)st=0;else if(locked>0)canWalk=0;
  }
  if(st!==3&&st!==4&&y<PGY&&frames>0){
    while(frames>0&&y<PGY){
      frames--;var ay=y+vy;
      if(ay>PGY){y=PGY;vy=0;break;}
      y=ay;if(ay<PGY)vy++;
    }
    if(y<PGY)canWalk=0;
  }
  if(canWalk){frames-=OPP_REACH_LAG;if(frames<0)frames=0;}else frames=0;
  var radius=PHL+frames*6,lo=x-radius,hi=x+radius;
  var courtLo=oppIsRight?HW:0,courtHi=oppIsRight?GW:HW;
  if(lo<courtLo)lo=courtLo;if(hi>courtHi)hi=courtHi;
  OPP_REACH[0]=lo;OPP_REACH[1]=hi;OPP_REACH[2]=y;
}

function blockThreat(s,O,isR){
  var ballOpp=isR?s[0]<HW:s[0]>=HW;if(!ballOpp)return 0;
  if(s[3]<=0)return 0;
  var nd=s[O]-HW;if(nd<0)nd=-nd;if(nd>BLOCK_NET_DISTANCE)return 0;
  return 1;
}

function evaluate(s, ME, OP, isR, myNear, myFar, ground, depth,mt,ot,blockMode){
  var sc=0;
  if(ground){
    var lx=s[0];
    var mine = isR ? (lx>=HW) : (lx<HW);
    return mine ? -10000 : 10000;
  }
  if(ROLLOUT_TOUCH_TRACKING){if(mt>=5)return -10000;if(ot>=5)return 10000;}
  landing(s[0],s[1],s[2],s[3]);
  var lpx=LAND[0], lpf=LAND[1];
  var landsMine = isR ? (lpx>=HW) : (lpx<HW);
  if(landsMine){
    // can I get there?
    var anchor=s[ME], selfReach,reachY=s[ME+1];
    if(STATE_AWARE_REACH){ selfReachInterval(s,ME,isR,lpf); anchor=REACH[0]; selfReach=REACH[1];reachY=REACH[2]; }
    else {var walk=lpf-SELF_REACH_LAG;if(walk<0)walk=0;selfReach=PHL+6*walk;}
    var need = lpx - anchor; if(need<0) need=-need;
    var yNeed=BGY-reachY;if(yNeed<0)yNeed=-yNeed;
    var canReach = need <= selfReach&&yNeed<=PHL;
    sc -= 900;
    sc -= canReach?0:2500;
    sc -= need*1.5;
  } else {
    sc += 900;
    var slack;
    if(OPP_STATE_REACH){oppReachInterval(s,OP,isR,lpf);slack=intervalSlack(lpx,OPP_REACH[0],OPP_REACH[1]);}
    else {var oneed=lpx-s[OP];if(oneed<0)oneed=-oneed;var oppReach=6*(lpf-OPP_REACH_LAG)+32;slack=oneed-oppReach;}
    sc += slack>0 ? (1800 + slack*12) : slack*9;
    // Prefer steep balls, but never reward speed discarded by physics.js on
    // the next frame (notably the old extreme-downward-speed net exploit).
    var effectiveVy=clampBallYVelocity(s[3]);
    sc += (effectiveVy>0? effectiveVy*3 : 0);
  }
  // positioning: be near own court centre-ish / under future ball
  var post = landsMine ? lpx : (myNear+myFar)/2;
  var ballOpp=isR?s[0]<HW:s[0]>=HW;
  if(BLOCK_ASSIST&&blockMode&&ballOpp&&!landsMine)post=isR?HW+BLOCK_POST_OFFSET:HW-BLOCK_POST_OFFSET;
  var pd = s[ME]-post; if(pd<0) pd=-pd;
  sc -= pd*0.6;
  // touch limit pressure
  var myTouch=ROLLOUT_TOUCH_TRACKING?mt:G.myTouch;
  if(myTouch>=3) sc -= 400*(myTouch-2);
  return sc;
}


// ---------------------------------------------------------------------------
// Side normalisation. All strategy code above runs in "I am RIGHT" coordinates.
// Playing LEFT simply mirrors the world (x -> 432-x). This removes every
// side-conditional code path AND makes evaluation tie-breaks side-independent
// (the action table lists +x before -x, and a stable sort turns that into a
// hidden directional preference that is good for one side and bad for the other).
// ---------------------------------------------------------------------------
// 정규화 래퍼. LEFT 를 미러링해서 decideCore 는 항상 RIGHT 기준 단일 경로로 돕니다.
// 모르는 필드(당일 추가될 게이지 등)는 그대로 통과시킵니다 — 얕은 복사 후 좌표만 덮어씀.
// 이렇게 하지 않으면 새 필드가 LEFT 경로에서만 사라져 좌우 비대칭이 생깁니다.
function mirrorPlayer(p){
  var o={}; for(var k in p) if(Object.prototype.hasOwnProperty.call(p,k)) o[k]=p[k];
  o.x=GW-p.x; o.divingDirection=-p.divingDirection; return o;
}
function decide(snap){
  var t0=Date.now();
  if(snap.side === 'RIGHT') return finishSkillAction(snap,decideCore(snap,t0),false);
  var t={}; for(var k in snap) if(Object.prototype.hasOwnProperty.call(snap,k)) t[k]=snap[k];
  t.side='RIGHT';
  t.self=mirrorPlayer(snap.self);
  t.opp =mirrorPlayer(snap.opp);
  var b={}; for(var k2 in snap.ball) if(Object.prototype.hasOwnProperty.call(snap.ball,k2)) b[k2]=snap.ball[k2];
  b.x=GW-snap.ball.x; b.xVelocity=-snap.ball.xVelocity;
  b.expectedLandingPointX=GW-snap.ball.expectedLandingPointX;
  t.ball=b;
  var a=decideCore(t,t0);
  return finishSkillAction(snap,a,true);
}
decide.__rootMetrics=ROOT_METRICS;
decide.__searchMetrics=SEARCH_METRICS;
