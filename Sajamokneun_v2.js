'use strict';
// ============================================================================
// Model-based search bot. Single file, no imports. Ports physics.js exactly.
// ============================================================================
var GW=432, HW=216, PHL=32, PGY=244, BGY=252, NPHW=25, NTT=176, NTB=192;
var SELF_REACH_LAG=12; // @param:SELF_REACH_LAG — bot/params.json의 제출용 인라인 사본
var OPP_REACH_LAG=0;  // @param:OPP_REACH_LAG — bot/params.json의 제출용 인라인 사본
var STATE_AWARE_REACH=0; // @param:STATE_AWARE_REACH
var LYING_PENALTY_PER_FRAME=0; // @param:LYING_PENALTY_PER_FRAME
var DEPTH=4, BEAM=48; // @param:DEPTH_BEAM
var ROLLOUT_TOUCH_TRACKING=0; // @param:ROLLOUT_TOUCH_TRACKING
var ROOT_DIVERSITY=0; // @param:ROOT_DIVERSITY
var SEARCH_DIAGNOSTICS=0; // @param:SEARCH_DIAGNOSTICS

// ---- flat state: Int32Array(22) --------------------------------------------
// 0 bx 1 by 2 bvx 3 bvy | player block base 4 (LEFT=p1) and 13 (RIGHT=p2)
// +0 x +1 y +2 vy +3 st +4 fn +5 dly +6 lie +7 dd +8 coll
var SZ=22, PL=4, PR=13;

function stepLean(s, ax,ay,ah, bx_,by_,bh,touch,ME){
  var bx=s[0],by=s[1],bvx=s[2],bvy=s[3], ground=0;
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
    if(st<3 && iy===-1 && s[o+1]===PGY){ s[o+2]=-16; st=1; s[o+3]=1; s[o+4]=0; }
    var pfy=s[o+1]+s[o+2]; s[o+1]=pfy;
    if(pfy<PGY) s[o+2]+=1;
    else if(pfy>PGY){ s[o+2]=0; s[o+1]=PGY; s[o+4]=0;
      if(st===3){ st=4;s[o+3]=4;s[o+4]=0;s[o+6]=3; } else { st=0;s[o+3]=0; } }
    if(ih===1){
      if(st===1){ s[o+5]=5;s[o+4]=0;st=2;s[o+3]=2; }
      else if(st===0&&ix!==0){ st=3;s[o+3]=3;s[o+4]=0;s[o+7]=ix;s[o+2]=-5; }
    }
    if(st===1) s[o+4]=(s[o+4]+1)%3;
    else if(st===2){ if(s[o+5]<1){ s[o+4]+=1; if(s[o+4]>4){ s[o+4]=0; s[o+3]=1; } } else s[o+5]-=1; }
  }
  for(var q=0;q<2;q++){
    var oo=q===0?PL:PR, jx=q===0?ax:bx_, jy=q===0?ay:by_;
    var ddx=s[0]-s[oo], ddy=s[1]-s[oo+1];
    if(ddx<=PHL&&ddx>=-PHL&&ddy<=PHL&&ddy>=-PHL){
      if(s[oo+8]===0){
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
var LAND=new Int32Array(2);
function landing(bx,by,bvx,bvy){
  var n=0;
  while(n<300){
    var fx=bx+bvx; if(fx<0||fx>GW) bvx=-bvx;
    if(by+bvy<0) bvy=1;
    var d=bx-HW;
    if(d<NPHW&&d>-NPHW&&by>NTT){ if(by<=NTB){ if(bvy>0) bvy=-bvy; } else { var a=bvx<0?-bvx:bvx; bvx=d<0?-a:a; } }
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
  prev:null, prevAct:{x:0,y:0,hit:0}, lastTick:-99,
  oppPrevX:null, oppDX:0,
  myTouch:0, oppTouch:0, prevBallLeft:null, prevCollSelf:false, prevCollOpp:false,
  budgetMs:32, worstMs:0, panic:0
};

var ACT=[[0,0,0],[1,0,0],[-1,0,0],[0,-1,0],[1,-1,0],[-1,-1,0],
         [0,-1,1],[1,-1,1],[-1,-1,1],[0,0,1],[1,0,1],[-1,0,1],[0,1,1],[1,1,1],[-1,1,1]];
var ROOT_QUOTA=(BEAM/ACT.length)|0;

// Two fixed arenas alternate by depth. All allocations happen once at load.
function makeArena(){
  var nodes=new Array(BEAM), order=new Int32Array(BEAM), rc=new Int32Array(ACT.length);
  for(var i=0;i<BEAM;i++) nodes[i]={s:new Int32Array(SZ),fx:0,fy:0,fh:0,has:0,sc:0,dead:0,ri:-1,mt:0,ot:0};
  return {nodes:nodes,order:order,rc:rc};
}
var ARENA_A=makeArena(), ARENA_B=makeArena();
var WORK_STATE=new Int32Array(SZ), OPP_ACT=new Int32Array(3);
var WORK_META={mt:0,ot:0};
var ROOT_METRICS={ticks:new Int32Array(DEPTH),sum:new Int32Array(DEPTH),one:new Int32Array(DEPTH)};

// Stable constrained top-BEAM. Strict '>' keeps earlier candidates ahead on ties.
function offer(arena,count,state,sc,dead,fx,fy,fh,has,ri,mt,ot){
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
  n.fx=fx; n.fy=fy; n.fh=fh; n.has=has; n.ri=ri;n.mt=mt;n.ot=ot;
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

function timeoutAction(snap,t0){
  G.panic++; G.prev=snap;
  var el=Date.now()-t0; if(el>G.worstMs) G.worstMs=el;
  return G.prevAct;
}

function decideCore(snap,t0){
  var isR = snap.side==='RIGHT';
  var ME = isR?PR:PL, OP = isR?PL:PR;
  var mySign = isR?-1:1;               // +1 means "attack toward +x"
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

  // ---------- opponent movement estimate ----------
  if(G.oppPrevX!==null){ var d=snap.opp.x-G.oppPrevX; G.oppDX = d; }
  G.oppPrevX = snap.opp.x;
  if(Date.now()-t0>=G.budgetMs) return timeoutAction(snap,t0);

  // ---------- lag compensation: this snapshot's frame runs my PREVIOUS action ----------
  var pa=G.prevAct;
  oppPolicy(s0,OP,isR,OPP_ACT);
  stepLean(s0, isR?OPP_ACT[0]:pa.x, isR?OPP_ACT[1]:pa.y, isR?OPP_ACT[2]:pa.hit,
                isR?pa.x:OPP_ACT[0], isR?pa.y:OPP_ACT[1], isR?pa.hit:OPP_ACT[2],root,ME);
  if(Date.now()-t0>=G.budgetMs) return timeoutAction(snap,t0);

  // ---------- search ----------
  var best = search(s0, ME, OP, isR, mySign, myNear, myFar, frameGroup, t0);
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
  if((st===1||st===2) && bdx<50 && bdy<50){ h=1; y=1; x=toNet; }
  out[0]=x; out[1]=y; out[2]=h;
}

function search(s0, ME, OP, isR, mySign, myNear, myFar, frameGroup, t0){
  var root=ARENA_A.nodes[0]; root.has=0; root.sc=0; root.dead=0;root.ri=-1; ARENA_A.order[0]=0;
  if(ROLLOUT_TOUCH_TRACKING&&(root.mt>=5||root.ot>=5))return G.prevAct;
  var src=ARENA_A, dst=ARENA_B, srcCount=1, dstCount=0, work=WORK_STATE;
  for(var d=0; d<DEPTH; d++){
    dstCount=0; var timedOut=0;if(ROOT_DIVERSITY)dst.rc.fill(0);
    expand:
    for(var bi=0; bi<srcCount; bi++){
      if(Date.now()-t0>=G.budgetMs){ timedOut=1; break expand; }
      var nd=src.nodes[src.order[bi]];
      if(nd.dead){
        dstCount=offer(dst,dstCount,nd.s,nd.sc,nd.dead,nd.fx,nd.fy,nd.fh,nd.has,nd.ri,nd.mt,nd.ot);
        continue;
      }
      for(var ai=0; ai<ACT.length; ai++){
        if(Date.now()-t0>=G.budgetMs){ timedOut=1; break expand; }
        var a=ACT[ai];
        work.set(nd.s);
        WORK_META.mt=nd.mt;WORK_META.ot=nd.ot;
        var g=0;
        oppPolicy(work,OP,isR,OPP_ACT);
        var touchDead=0;
        for(var f=0; f<frameGroup; f++){
          g = stepLean(work, isR?OPP_ACT[0]:a[0], isR?OPP_ACT[1]:a[1], isR?OPP_ACT[2]:a[2],
                             isR?a[0]:OPP_ACT[0], isR?a[1]:OPP_ACT[1], isR?a[2]:OPP_ACT[2],WORK_META,ME);
          touchDead=ROLLOUT_TOUCH_TRACKING&&(WORK_META.mt>=5||WORK_META.ot>=5);
          if(g||touchDead) break;
        }
        var fx=nd.has?nd.fx:a[0], fy=nd.has?nd.fy:a[1], fh=nd.has?nd.fh:a[2];
        var ri=nd.has?nd.ri:ai;
        var sc=evaluate(work, ME, OP, isR, myNear, myFar, g, d,WORK_META.mt,WORK_META.ot);
        dstCount=offer(dst,dstCount,work,sc,g||touchDead,fx,fy,fh,1,ri,WORK_META.mt,WORK_META.ot);
      }
    }
    if(timedOut){
      G.panic++;
      if(d===0) return dstCount>0 ? nodeAction(dst.nodes[dst.order[0]]) : G.prevAct;
      return nodeAction(src.nodes[src.order[0]]);
    }
    var tmp=src; src=dst; dst=tmp; srcCount=dstCount;
    if(SEARCH_DIAGNOSTICS)recordRootDiversity(d,src,srcCount);
    if(Date.now()-t0>=G.budgetMs){ G.panic++; return nodeAction(src.nodes[src.order[0]]); }
  }
  return nodeAction(src.nodes[src.order[0]]);
}

// Reachable interval after forced dive motion and lying recovery.
// REACH[0] is its centre, REACH[1] is radius including the 32px body half-width.
var REACH=new Int32Array(2);
function selfReachInterval(s,ME,isR,lpf){
  var st=s[ME+3], frames=lpf, x=s[ME], y=s[ME+1], vy=s[ME+2], lie=s[ME+6];
  var lo=isR?248:32, hi=isR?400:184;
  if(st===3){
    var dd=s[ME+7];
    while(frames>0 && st===3){
      x+=dd*8; if(x<lo)x=lo; else if(x>hi)x=hi;
      frames--;
      var fy=y+vy;
      if(fy>PGY){ st=4; lie=3; }
      else { y=fy; if(fy<PGY) vy+=1; }
    }
  }
  if(st===4 && frames>0){
    var locked=lie+2; if(locked<0)locked=0; if(locked>frames)locked=frames;
    frames-=locked; if(frames>0)st=0;
  }
  if(st>=3) frames=0;
  else { frames-=SELF_REACH_LAG; if(frames<0)frames=0; }
  REACH[0]=x; REACH[1]=32+frames*6;
}

function lyingFramesLeft(s,ME){
  if(s[ME+3]!==4) return 0;
  var n=s[ME+6]+2; return n>0?n:0;
}

function evaluate(s, ME, OP, isR, myNear, myFar, ground, depth,mt,ot){
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
    var anchor=s[ME], selfReach;
    if(STATE_AWARE_REACH){ selfReachInterval(s,ME,isR,lpf); anchor=REACH[0]; selfReach=REACH[1]; }
    else selfReach=6*(lpf-SELF_REACH_LAG)+32;
    var need = lpx - anchor; if(need<0) need=-need;
    var canReach = need <= selfReach;
    sc -= 900;
    sc -= canReach?0:2500;
    sc -= need*1.5;
  } else {
    sc += 900;
    var oneed = lpx - s[OP]; if(oneed<0) oneed=-oneed;
    var oppReach = 6*(lpf-OPP_REACH_LAG)+32;
    var slack = oneed - oppReach;    // >0 => unreachable
    sc += slack>0 ? (1800 + slack*12) : slack*9;
    // prefer deep/steep balls
    sc += (s[3]>0? s[3]*3 : 0);
  }
  // positioning: be near own court centre-ish / under future ball
  var post = landsMine ? lpx : (myNear+myFar)/2;
  var pd = s[ME]-post; if(pd<0) pd=-pd;
  sc -= pd*0.6;
  // touch limit pressure
  var myTouch=ROLLOUT_TOUCH_TRACKING?mt:G.myTouch;
  if(myTouch>=3) sc -= 400*(myTouch-2);
  if(LYING_PENALTY_PER_FRAME && s[ME+3]===4)
    sc -= lyingFramesLeft(s,ME)*LYING_PENALTY_PER_FRAME;
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
  if(snap.side === 'RIGHT') return decideCore(snap,t0);
  var t={}; for(var k in snap) if(Object.prototype.hasOwnProperty.call(snap,k)) t[k]=snap[k];
  t.side='RIGHT';
  t.self=mirrorPlayer(snap.self);
  t.opp =mirrorPlayer(snap.opp);
  var b={}; for(var k2 in snap.ball) if(Object.prototype.hasOwnProperty.call(snap.ball,k2)) b[k2]=snap.ball[k2];
  b.x=GW-snap.ball.x; b.xVelocity=-snap.ball.xVelocity;
  b.expectedLandingPointX=GW-snap.ball.expectedLandingPointX;
  t.ball=b;
  var a=decideCore(t,t0);
  return {x:-a.x, y:a.y, hit:a.hit};
}
decide.__rootMetrics=ROOT_METRICS;
