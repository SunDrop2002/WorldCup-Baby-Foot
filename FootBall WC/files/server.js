// ═══════════════════════════════════════════════════════════════
//  World Cup Babyfoot — Game Server  (1v1 only)
// ═══════════════════════════════════════════════════════════════
const { WebSocketServer } = require('ws');
const { randomUUID } = require('crypto');

const PORT = process.env.PORT || 3000;
const TICK_MS = 16;
const TICK_SECS = TICK_MS / 1000;
const MATCH_SECS = 180;

const P = { x:40,y:18,w:820,h:512, get right(){return this.x+this.w}, get bottom(){return this.y+this.h}, get cx(){return this.x+this.w/2}, get cy(){return this.y+this.h/2} };
const BALL_R=10, FIG_W=13, FIG_H=34, MAX_SPD=9, MIN_SPD=2.5;
const MIN_D = BALL_R + FIG_W/2 + 3;         // tight radius: normal bounce/kick contact
const HOLD_CATCH_BONUS = 16;
const CATCH_R = MIN_D + HOLD_CATCH_BONUS;   // generous radius: catching only
const HOLD_COOLDOWN_MAX = 2.5;
const HOLD_BUFFER_SECS = 14/60;             // ~230ms — forgives slightly early/late catch presses
const PASS_CHARGE_MAX = 3;
const PASS_RECHARGE_SECS = 4;
const CHARGE_MAX_SECS = 72/60;              // ~1.2s to reach full charge
const CHARGE_BASE_POW = 7.5, CHARGE_MAX_POW = 15;
const GRAVITY = 0.002 * 60 * 60;            // client GRAVITY is per-frame at 60fps; convert to per-second^2
const LOFT_LAUNCH_VZ = 0.05 * 60;           // client value is per-frame; convert to per-second
const LOFT_SPEED = 5 * 60;                  // client vx is px/frame at 60fps; convert to px/sec (tick uses dt in seconds below)

// Must stay in exact sync with the client's ROD_DEFS_2V2 (worldcup-babyfoot-v2.html) —
// a mismatch here means the server collides the ball against different rod positions
// than the client renders, which is what caused the ball to get stuck mid-pitch online.
const ROD_DEFS=[
  {xFrac:.075,nFigs:1,team:'p1'},{xFrac:.200,nFigs:2,team:'p1'},
  {xFrac:.330,nFigs:3,team:'p2'},{xFrac:.440,nFigs:4,team:'p1'},
  {xFrac:.560,nFigs:4,team:'p2'},{xFrac:.670,nFigs:3,team:'p1'},
  {xFrac:.800,nFigs:2,team:'p2'},{xFrac:.925,nFigs:1,team:'p2'},
];

function offsetLimits(team){
  const rods=ROD_DEFS.filter(r=>r.team===team);
  let minO=-Infinity,maxO=Infinity;
  for(const rod of rods){
    const sp=P.h/(rod.nFigs+1);
    const lu=-(sp-FIG_H/2), ld=(P.h-sp*rod.nFigs-sp)+(sp-FIG_H/2);
    if(lu>minO)minO=lu; if(ld<maxO)maxO=ld;
  }
  return {min:minO,max:maxO};
}
const LIM={p1:offsetLimits('p1'),p2:offsetLimits('p2')};

// Gives the ball some horizontal drift at kickoff (matching the client's local
// physics) so it doesn't sit dead-center in the gap between the two middle rods
// with zero vx — that dead zone is what let the ball get stuck bouncing only
// vertically, unreachable by either player, in the old always-vx:0 kickoff.
function freshKickoff(){
  const dir = Math.random() > 0.5 ? 1 : -1;
  return { x:P.cx, y:P.cy, vx:(Math.random()-0.5)*3*60, vy:dir*(2.5+Math.random())*60, z:0, vz:0 };
}

// Minimum distance from point (px,py) to the segment (x1,y1)-(x2,y2). Used for
// swept catch detection so a fast ball can't "tunnel" past a figure in one tick.
function segPointDist(x1,y1,x2,y2,px,py){
  const dx=x2-x1, dy=y2-y1;
  const lenSq=dx*dx+dy*dy;
  let t = lenSq>1e-6 ? ((px-x1)*dx+(py-y1)*dy)/lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  const cx=x1+t*dx, cy=y1+t*dy;
  return Math.hypot(px-cx, py-cy);
}

const rooms = new Map();
const matchQueue = [];

function send(ws, data){ if(ws?.readyState===1) ws.send(JSON.stringify(data)); }

class Room {
  constructor(id){
    this.id=id;
    this.p1=null; this.p2=null;
    this.p1Team=null; this.p2Team=null;
    this.p1TeamReady=false; this.p2TeamReady=false;
    this.gameStarted=false;
    this.ball=freshKickoff();
    this.p1Off=0; this.p2Off=0;
    this.input={ p1:{up:false,down:false,kick:false}, p2:{up:false,down:false,kick:false} };
    this.score={p1:0,p2:0};
    this.timeLeft=MATCH_SECS;
    this.slowTick=0;
    this.goalPause=false; // guards _goal() against re-firing every tick while the ball still overlaps the goal line

    // ── Hold / catch / pass / charge / lofted state (mirrors client GAME fields) ──
    this.heldBy=null;              // { team, rodIdx, figIdx }
    this.holdTimer=0;
    this.holdCooldown={p1:0,p2:0};
    this.holdBuffer={p1:0,p2:0};   // seconds remaining of "kick was just pressed" leniency
    this._prevKick={p1:false,p2:false};
    this.passAnim=null;            // { fromBaseY, toBaseY, newFigIdx, t, dur }
    this.passCharges={p1:PASS_CHARGE_MAX,p2:PASS_CHARGE_MAX};
    this.passRecharge={p1:0,p2:0};
    this.chargeStart={p1:null,p2:null}; // Date.now() when that team started charging, else null
    this.lastTouchTeam=null;
    this.fxEvent=null;              // { type, team, frac?, powered? } — one-shot per-tick trigger for client sound/kick-angle/hit-effect
    this.tickInterval=null;
  }

  assign(ws, role){ this[role]=ws; ws.roomId=this.id; ws.role=role; }
  broadcast(data){ send(this.p1,data); send(this.p2,data); }

  onInput(role,offset,kick,up,down){
    const lim = role==='p1'?LIM.p1:LIM.p2;
    if(role==='p1') this.p1Off=Math.max(lim.min,Math.min(lim.max,offset));
    else            this.p2Off=Math.max(lim.min,Math.min(lim.max,offset));
    this.input[role]={ up:!!up, down:!!down, kick:!!kick };
  }

  onPass(role, dir){
    if(!this.heldBy || this.heldBy.team!==role) return;
    const h=this.heldBy;
    const rod=ROD_DEFS[h.rodIdx];
    const delta = dir==='prev' ? -1 : 1;
    const newIdx = h.figIdx+delta;
    if(newIdx<0 || newIdx>=rod.nFigs) return;
    if(this.passCharges[role]<=0){ this.fxEvent={ type:'passDenied', team:role }; return; } // out of pass charges
    this.passCharges[role]--;
    const sp=P.h/(rod.nFigs+1);
    const fromBaseY=P.y+sp*(h.figIdx+1), toBaseY=P.y+sp*(newIdx+1);
    this.passAnim={ fromBaseY, toBaseY, newFigIdx:newIdx, t:0, dur:20/60 };
    this.fxEvent={ type:'pass', team:role };
  }

  onChargeStart(role){
    if(!this.heldBy || this.heldBy.team!==role) return;
    this.chargeStart[role]=Date.now();
  }

  onChargeRelease(role){
    if(!this.heldBy || this.heldBy.team!==role || this.chargeStart[role]==null) return;
    const elapsedSecs=(Date.now()-this.chargeStart[role])/1000;
    const frac=Math.max(0, Math.min(1, elapsedSecs/CHARGE_MAX_SECS));
    this.chargeStart[role]=null;
    this._releaseGroundShot(role, frac);
  }

  onLofted(role){
    if(!this.heldBy || this.heldBy.team!==role) return;
    this.chargeStart[role]=null;
    this._releaseLoftedShot(role);
  }

  selectTeam(ws, teamId){
    if(ws.role==='p1'){ this.p1Team=teamId; this.p1TeamReady=true; }
    else              { this.p2Team=teamId; this.p2TeamReady=true; }
    const opp=ws.role==='p1'?this.p2:this.p1;
    send(opp,{type:'opp_team',teamId});
    if(this.p1TeamReady&&this.p2TeamReady) this.startGame();
  }

  startGame(){
    if(this.gameStarted) return;
    this.gameStarted=true;
    console.log(`🎮 Game starting: room ${this.id} | p1=${this.p1Team} p2=${this.p2Team}`);
    this.broadcast({type:'game_start',p1Team:this.p1Team,p2Team:this.p2Team});
    this._beginSimulationAfterCountdown();
  }

  // Freeze all simulation (ball + rods + timer) for the same 3.6s that the
  // client spends on its local 3-2-1-GO countdown overlay. Without this the
  // server was already ticking the ball the instant both players picked
  // teams (or the instant a rematch was accepted), so it could be bouncing
  // off walls/corners well before either player's countdown actually
  // finished and input unlocked. Also (re)used on rematch, since the tick/
  // timer intervals were cleared by _endGame() and otherwise never restarted.
  _beginSimulationAfterCountdown(){
    clearInterval(this.tickInterval); clearInterval(this._timer);
    setTimeout(()=>{
      if(!this.gameStarted) return; // room may have ended already (e.g. a player left)
      this.tickInterval=setInterval(()=>this._tick(),TICK_MS);
      this._timer=setInterval(()=>{ if(!this.gameStarted)return; this.timeLeft--; if(this.timeLeft<=0)this._endGame(); },1000);
    }, 3600);
  }

  _tick(){
    const dt=TICK_SECS*60; // express dt in "60fps frame units" so all the ported constants line up with the client's per-frame math
    // NOTE: fxEvent is NOT reset here. onPass/onChargeStart/onChargeRelease/
    // onLofted are called from the WS message handler *between* ticks, so an
    // event they set needs to survive until THIS tick's broadcast — it's
    // cleared right after broadcasting below instead, so it always reaches
    // the client exactly once regardless of whether it was set inside this
    // tick (catch/kick, from _tickHeld/_tickBall) or between ticks (pass/
    // charge/lofted, from the message handler).

    // ── Hold-ability cooldowns + input buffer (edge-triggered refresh below) ──
    for(const role of ['p1','p2']){
      if(this.holdCooldown[role]>0) this.holdCooldown[role]=Math.max(0,this.holdCooldown[role]-TICK_SECS);
      if(this.holdBuffer[role]>0)   this.holdBuffer[role]=Math.max(0,this.holdBuffer[role]-TICK_SECS);
      const kickNow=this.input[role].kick;
      if(kickNow && !this._prevKick[role]) this.holdBuffer[role]=HOLD_BUFFER_SECS; // rising edge
      this._prevKick[role]=kickNow;
    }
    // ── Pass charge regeneration ──
    for(const role of ['p1','p2']){
      if(this.passCharges[role]<PASS_CHARGE_MAX){
        this.passRecharge[role]+=TICK_SECS;
        if(this.passRecharge[role]>=PASS_RECHARGE_SECS){ this.passRecharge[role]=0; this.passCharges[role]++; }
      } else this.passRecharge[role]=0;
    }

    // Fully freeze physics during the post-goal celebration (matches offline's
    // goalPause) — otherwise the ball sits right on the goal line every tick
    // and _goal() would fire again and again until the celebration ends.
    if(!this.goalPause){
      if(this.heldBy){
        this._tickHeld(dt);
      } else {
        this._tickBall(dt);
      }
    }

    this.broadcast({
      type:'state',
      bx:Math.round(this.ball.x), by:Math.round(this.ball.y), bvx:this.ball.vx/60, bvy:this.ball.vy/60,
      bz:this.ball.z,
      p1Off:this.p1Off, p2Off:this.p2Off,
      s1:this.score.p1, s2:this.score.p2, t:this.timeLeft,
      heldBy:this.heldBy, holdTimer:this.holdTimer,
      holdCdP1:this.holdCooldown.p1, holdCdP2:this.holdCooldown.p2,
      passChP1:this.passCharges.p1, passChP2:this.passCharges.p2,
      passRcP1:this.passRecharge.p1, passRcP2:this.passRecharge.p2,
      lastTouch:this.lastTouchTeam, fx:this.fxEvent,
      passAnimActive:!!this.passAnim,
    });
    this.fxEvent=null; // sent exactly once — clear after broadcasting
  }

  // Ball frozen to the holding figure; follows rod offset; handles pass
  // animation and release (throw / charged / force-timeout) — mirrors the
  // client's _updateHeld().
  _tickHeld(dt){
    const h=this.heldBy;
    const rod=ROD_DEFS[h.rodIdx];
    const off=h.team==='p1'?this.p1Off:this.p2Off;
    const dir=h.team==='p1'?1:-1;
    const b=this.ball;
    const ballGx=P.x+rod.xFrac*P.w+dir*(FIG_W/2+BALL_R+2);

    if(this.passAnim){
      const pa=this.passAnim;
      pa.t=Math.min(1, pa.t+ (dt/60) / pa.dur);
      const e = pa.t<0.5 ? 2*pa.t*pa.t : 1-Math.pow(-2*pa.t+2,2)/2;
      const baseY=pa.fromBaseY+(pa.toBaseY-pa.fromBaseY)*e;
      b.x=ballGx; b.y=Math.max(P.y+BALL_R, Math.min(P.bottom-BALL_R, baseY+off));
      b.vx=0; b.vy=0;
      if(pa.t>=1){ h.figIdx=pa.newFigIdx; this.holdTimer=0; this.passAnim=null; }
      return;
    }

    const sp=P.h/(rod.nFigs+1);
    const figBaseY=P.y+sp*(h.figIdx+1);
    b.x=ballGx; b.y=Math.max(P.y+BALL_R, Math.min(P.bottom-BALL_R, figBaseY+off));
    b.vx=0; b.vy=0;

    this.holdTimer += dt/60;
    const forceRelease = this.holdTimer > 3.0;
    const chargingNow = this.chargeStart[h.team]!=null;

    if(chargingNow && forceRelease){
      const elapsedSecs=(Date.now()-this.chargeStart[h.team])/1000;
      this.chargeStart[h.team]=null;
      this._releaseGroundShot(h.team, Math.max(0,Math.min(1, elapsedSecs/CHARGE_MAX_SECS)));
      return;
    }

    const inp=this.input[h.team];
    const spaceStillHeld = (inp.kick || chargingNow) && !forceRelease;
    if(!spaceStillHeld){
      const rodDir = inp.up ? -1 : inp.down ? 1 : 0;
      b.vx = dir*7.5*60; b.vy = rodDir*6*60;
      this.lastTouchTeam=h.team;
      this.holdCooldown[h.team]=HOLD_COOLDOWN_MAX;
      this.heldBy=null; this.holdTimer=0; this.passAnim=null;
      this.fxEvent={ type:'throw', team:h.team };
    }
  }

  _releaseGroundShot(role, frac){
    if(!this.heldBy) return;
    const h=this.heldBy, b=this.ball, dir=h.team==='p1'?1:-1;
    const inp=this.input[role];
    const rodDir = inp.up ? -1 : inp.down ? 1 : 0;
    const power = CHARGE_BASE_POW + (CHARGE_MAX_POW-CHARGE_BASE_POW)*frac;
    b.vx = dir*power*60; b.vy = rodDir*(6+frac*2)*60;
    this.lastTouchTeam=role;
    this.holdCooldown[role]=HOLD_COOLDOWN_MAX;
    this.heldBy=null; this.holdTimer=0; this.passAnim=null;
    this.fxEvent={ type:'charged', team:role, frac };
  }

  _releaseLoftedShot(role){
    if(!this.heldBy) return;
    const h=this.heldBy, b=this.ball, dir=h.team==='p1'?1:-1;
    const inp=this.input[role];
    const rodDir = inp.up ? -1 : inp.down ? 1 : 0;
    b.vx = dir*LOFT_SPEED; b.vy = rodDir*3*60;
    b.z=0.02; b.vz=LOFT_LAUNCH_VZ;
    this.lastTouchTeam=role;
    this.holdCooldown[role]=HOLD_COOLDOWN_MAX;
    this.heldBy=null; this.holdTimer=0; this.passAnim=null;
    this.fxEvent={ type:'lofted', team:role };
  }

  _tickBall(dt){
    const b=this.ball;
    // Defensive: sanitize any NaN/Infinity that could otherwise permanently freeze the ball
    if(!Number.isFinite(b.vx) || !Number.isFinite(b.vy)){ b.vx=0; b.vy=0; }
    if(!Number.isFinite(b.x) || !Number.isFinite(b.y)){ b.x=P.cx; b.y=P.cy; }

    b.x+=b.vx*(dt/60); b.y+=b.vy*(dt/60);
    b.vx*=0.998; b.vy*=0.998;

    // Airborne arc for the lofted shot
    if(b.z>0 || b.vz!==0){
      b.vz -= GRAVITY*(dt/60);
      b.z += b.vz*(dt/60);
      if(b.z<=0){ b.z=0; b.vz=0; }
    }

    if(b.y-BALL_R<P.y){ b.y=P.y+BALL_R; b.vy=Math.abs(b.vy)*.92; }
    if(b.y+BALL_R>P.bottom){ b.y=P.bottom-BALL_R; b.vy=-Math.abs(b.vy)*.92; }

    // Goal only counts if the ball is actually on the ground — a lofted shot
    // sailing over the goal (still airborne) must not score.
    const gz=b.y>P.cy-56 && b.y<P.cy+56 && b.z<=0.05;
    if(b.x-BALL_R<P.x && gz){ this._goal('p2'); return; }
    if(b.x+BALL_R>P.right && gz){ this._goal('p1'); return; }

    if(b.x-BALL_R<P.x){ b.x=P.x+BALL_R; b.vx=Math.abs(b.vx)*.75; }
    if(b.x+BALL_R>P.right){ b.x=P.right-BALL_R; b.vx=-Math.abs(b.vx)*.75; }

    // While airborne the ball flies clear over the figures — skip collision.
    if(b.z<=0) this._collideFigs();

    const sp2=Math.hypot(b.vx,b.vy);
    if(sp2<MIN_SPD*60 && sp2>0.05*60){ const s=(MIN_SPD*60)/sp2; b.vx*=s; b.vy*=s; }
    // Slow-tick rescue: ball barely moving — matches the client's exact
    // condition (overall speed, not just horizontal), shortened window +
    // stronger kick so a stalled ball recovers quickly instead of sitting stuck.
    if(sp2<2.0*60) this.slowTick+=dt; else this.slowTick=0;
    if(this.slowTick>10){
      b.vx=(b.x<P.cx?1:-1)*(5+Math.random()*3)*60;
      b.vy=(Math.random()-.5)*6*60;
      this.slowTick=0;
    }
    const nearTop=b.y<P.y+BALL_R+8, nearBot=b.y>P.bottom-BALL_R-8;
    if((nearTop||nearBot) && sp2<6*60){
      b.vy = nearTop ? Math.abs(b.vy)+4*60 : -(Math.abs(b.vy)+4*60);
      b.vx += (Math.random()-.5)*4*60;
    }
  }

  _collideFigs(){
    const b=this.ball;
    let pinchCount=0, pinchDX=0, pinchDY=0;
    for(let rodIdx=0; rodIdx<ROD_DEFS.length; rodIdx++){
      if(this.heldBy) break;
      const rod=ROD_DEFS[rodIdx];
      const off=rod.team==='p1'?this.p1Off:this.p2Off;
      const rx=P.x+rod.xFrac*P.w, sp=P.h/(rod.nFigs+1);
      const dir=rod.team==='p1'?1:-1;
      const inp=this.input[rod.team];
      const powered = inp.kick || this.holdBuffer[rod.team]>0;
      const teamCooldown = this.holdCooldown[rod.team];

      for(let i=0;i<rod.nFigs;i++){
        if(this.heldBy) break;
        const fy=P.y+sp*(i+1)+off;

        if(powered && teamCooldown<=0){
          const segDist=segPointDist(this._prevBallX ?? b.x, this._prevBallY ?? b.y, b.x, b.y, rx, fy);
          if(segDist<CATCH_R){
            this.heldBy={ team:rod.team, rodIdx, figIdx:i };
            this.holdTimer=0;
            b.vx=0; b.vy=0;
            this.holdBuffer[rod.team]=0;
            this.fxEvent={ type:'catch', team:rod.team };
            break;
          }
        }

        const dx=b.x-rx, dy=b.y-fy, dist=Math.hypot(dx,dy);
        if(dist<MIN_D && dist>0.1){
          const nx=dx/dist, ny=dy/dist, ov=MIN_D-dist;
          b.x+=nx*ov*1.1; b.y+=ny*ov*1.1;
          pinchCount++; pinchDX+=nx; pinchDY+=ny;
          const dot=b.vx*nx+b.vy*ny;
          if(dot<0){ b.vx-=2*dot*nx; b.vy-=2*dot*ny; b.vx*=0.88; b.vy*=0.88; }
          this.lastTouchTeam=rod.team;
          const rodDir = inp.up ? -1 : inp.down ? 1 : 0;
          const power = (powered?7.5:4.5)*60;
          b.vx = dir*power + dir*Math.abs(b.vx)*0.12;
          b.vy = rodDir*5.5*60 + (Math.random()-.5)*1.5*60;
          this.fxEvent={ type:'kick', team:rod.team, powered };
          const sp2=Math.hypot(b.vx,b.vy);
          if(sp2>MAX_SPD*60){ const sc=(MAX_SPD*60)/sp2; b.vx*=sc; b.vy*=sc; }
        }
      }
    }
    // Pinch escape: ball wedged against 2+ figures in the same tick.
    if(pinchCount>=2){
      let ex=pinchDX, ey=pinchDY;
      const mag=Math.hypot(ex,ey);
      if(mag<0.3){ ex=0; ey=(b.y<P.cy)?-1:1; } else { ex/=mag; ey/=mag; }
      b.x+=ex*6; b.y+=ey*6;
      b.vx=ex*8*60; b.vy=ey*8*60;
      this.slowTick=0;
    }
    this._prevBallX=b.x; this._prevBallY=b.y;
  }

  _goal(scorer){
    // Without this guard, the ball sits past the goal line for one tick before
    // _tickBall() returns, so every subsequent 16ms tick saw it still inside
    // the goal zone and called _goal() again — incrementing the score ~180
    // times and queuing ~180 separate freshKickoff() resets that all fired
    // over the following 3 seconds, which looked like the ball "getting stuck
    // and jittering" at center as each queued reset re-randomized it in turn.
    if(this.goalPause) return;
    this.goalPause = true;
    this.score[scorer]++;
    this.broadcast({type:'goal',scorer,s1:this.score.p1,s2:this.score.p2});
    setTimeout(()=>{
      Object.assign(this.ball,freshKickoff());
      this.heldBy=null; this.holdTimer=0; this.passAnim=null;
      this.chargeStart={p1:null,p2:null};
      this.goalPause=false;
    },3000);
  }

  _endGame(){
    clearInterval(this.tickInterval); clearInterval(this._timer);
    this.gameStarted=false;
    this.broadcast({type:'game_end',s1:this.score.p1,s2:this.score.p2});
  }

  playerLeft(role){
    if(this.gameStarted){
      const opp=role==='p1'?this.p2:this.p1;
      send(opp,{type:'opp_disconnected'});
      clearInterval(this.tickInterval); clearInterval(this._timer);
    }
    rooms.delete(this.id);
  }
}

const wss = new WebSocketServer({ port: PORT });
console.log(`🚀 Game server running on ws://localhost:${PORT}`);

wss.on('connection', (ws, req) => {
  ws._addr = req.socket.remoteAddress;
  console.log(`🔌 Client connected | total: ${wss.clients.size}`);

  ws.on('message', raw => {
    let m; try{ m=JSON.parse(raw); }catch{ return; }
    switch(m.type){

      case 'create_room':{
        const id=randomUUID().slice(0,6).toUpperCase();
        const room=new Room(id); room.assign(ws,'p1');
        rooms.set(id,room);
        send(ws,{type:'room_created',roomId:id});
        break;
      }

      case 'find_match':{
        while(matchQueue.length && matchQueue[0].readyState!==1) matchQueue.shift();
        if(matchQueue.length>0){
          const other=matchQueue.shift();
          const id=randomUUID().slice(0,6).toUpperCase();
          const room=new Room(id);
          room.assign(other,'p1'); room.assign(ws,'p2');
          rooms.set(id,room);
          send(other,{type:'matched',roomId:id,role:'p1',oppUsername:'Opponent'});
          send(ws,   {type:'matched',roomId:id,role:'p2',oppUsername:'Opponent'});
          console.log(`✅ Match found: room ${id}`);
        } else {
          ws._inQueue=true; matchQueue.push(ws);
          send(ws,{type:'in_queue',msg:'Waiting for opponent…'});
        }
        break;
      }

      case 'join_room':{
        const room=rooms.get(m.roomId?.toUpperCase());
        if(!room)      { send(ws,{type:'error',msg:'Room not found.'}); return; }
        if(room.p2)    { send(ws,{type:'error',msg:'Room is full.'}); return; }
        if(room.p1===ws){ send(ws,{type:'error',msg:'You cannot join your own room.'}); return; }
        room.assign(ws,'p2');
        send(room.p1,{type:'matched',roomId:room.id,role:'p1',oppUsername:'Opponent'});
        send(ws,     {type:'matched',roomId:room.id,role:'p2',oppUsername:'Opponent'});
        break;
      }

      case 'select_team':{
        const room=rooms.get(ws.roomId); if(!room) return;
        room.selectTeam(ws, m.teamId);
        break;
      }

      case 'input':{
        const room=rooms.get(ws.roomId); if(!room) return;
        room.onInput(ws.role, m.offset, m.kick, m.up, m.down);
        break;
      }

      case 'pass':{
        const room=rooms.get(ws.roomId); if(!room) return;
        room.onPass(ws.role, m.dir);
        break;
      }

      case 'charge_start':{
        const room=rooms.get(ws.roomId); if(!room) return;
        room.onChargeStart(ws.role);
        break;
      }

      case 'charge_release':{
        const room=rooms.get(ws.roomId); if(!room) return;
        room.onChargeRelease(ws.role);
        break;
      }

      case 'lofted':{
        const room=rooms.get(ws.roomId); if(!room) return;
        room.onLofted(ws.role);
        break;
      }

      case 'rematch':{
        const room=rooms.get(ws.roomId); if(!room) return;
        if(!room.rematchVote) room.rematchVote=new Set();
        room.rematchVote.add(ws.role);
        if(room.rematchVote.size===2){
          room.rematchVote=null;
          Object.assign(room,{score:{p1:0,p2:0},timeLeft:MATCH_SECS,p1Off:0,p2Off:0,slowTick:0,gameStarted:true,goalPause:false});
          room.ball=freshKickoff();
          room.heldBy=null; room.holdTimer=0; room.passAnim=null;
          room.holdCooldown={p1:0,p2:0}; room.holdBuffer={p1:0,p2:0};
          room.passCharges={p1:PASS_CHARGE_MAX,p2:PASS_CHARGE_MAX}; room.passRecharge={p1:0,p2:0};
          room.chargeStart={p1:null,p2:null};
          room.p1TeamReady=false; room.p2TeamReady=false;
          room.broadcast({type:'rematch_ok'});
          room._beginSimulationAfterCountdown();
        } else {
          const opp=ws.role==='p1'?room.p2:room.p1;
          send(opp,{type:'rematch_requested'});
        }
        break;
      }

      case 'cancel':{
        const qi=matchQueue.indexOf(ws); if(qi>-1) matchQueue.splice(qi,1);
        const room=rooms.get(ws.roomId); if(room) room.playerLeft(ws.role);
        break;
      }
    }
  });

  ws.on('close',()=>{
    console.log(`❌ Client disconnected`);
    const qi=matchQueue.indexOf(ws); if(qi>-1) matchQueue.splice(qi,1);
    const room=ws.roomId?rooms.get(ws.roomId):null;
    if(room) room.playerLeft(ws.role);
  });
});
