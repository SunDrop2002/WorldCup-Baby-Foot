const WebSocket = require('ws');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
const safety = setTimeout(() => { console.log('SAFETY TIMEOUT'); process.exit(2); }, 25000);

async function run() {
  const p1 = new WebSocket('ws://localhost:3000');
  const p2 = new WebSocket('ws://localhost:3000');
  let states = [];
  let goals = [];

  await Promise.all([
    new Promise(res => p1.on('open', res)),
    new Promise(res => p2.on('open', res)),
  ]);
  const roomId = await new Promise(res => {
    p1.on('message', function h(raw) {
      const m = JSON.parse(raw);
      if (m.type === 'room_created') { p1.off('message', h); res(m.roomId); }
    });
    p1.send(JSON.stringify({ type: 'create_room' }));
  });
  await new Promise(res => {
    p2.on('message', function h(raw) {
      const m = JSON.parse(raw);
      if (m.type === 'matched') { p2.off('message', h); res(); }
    });
    p2.send(JSON.stringify({ type: 'join_room', roomId }));
  });

  p1.on('message', raw => {
    const m = JSON.parse(raw);
    if (m.type === 'state') states.push(m);
    if (m.type === 'goal') goals.push(m);
  });

  p1.send(JSON.stringify({ type: 'select_team', teamId: 'brazil' }));
  p2.send(JSON.stringify({ type: 'select_team', teamId: 'germany' }));

  console.log('waiting for countdown (3.6s) to finish...');
  await sleep(4000);

  // Force the ball right at p2's goal line (right side), moving further in,
  // dead-center vertically — this is exactly the scenario that used to
  // retrigger _goal() every tick for 3 seconds.
  console.log('teleporting ball onto the goal line via debug hook...');
  p1.send(JSON.stringify({
    type: '__debug_set_ball',
    ball: { x: 858, y: 274, vx: 300, vy: 0, z: 0, vz: 0 },
  }));

  await sleep(3500); // full goal-pause window (3s) + margin

  console.log('score after goal:', JSON.stringify(states[states.length - 1] ? { s1: states[states.length-1].s1, s2: states[states.length-1].s2 } : null));
  console.log('number of goal broadcasts received:', goals.length);
  if (goals.length > 0) console.log('goal messages:', JSON.stringify(goals));

  // Check ball position stability in the last 500ms of the window (should be
  // a single settled kickoff, not jittering between many different positions)
  const tail = states.slice(-30);
  const xs = tail.map(s => s.bx);
  const uniqueXsCount = new Set(xs).size;
  console.log('unique ball x-positions in last 30 ticks (post-reset):', uniqueXsCount, JSON.stringify(xs.slice(0, 10)));

  const pass = goals.length === 1 && (states[states.length-1]?.s2 === 1 || states[states.length-1]?.s1 === 1);
  console.log(pass ? 'PASS: exactly one goal registered' : 'FAIL: goal count or score mismatch');

  clearTimeout(safety);
  p1.close(); p2.close();
  process.exit(pass ? 0 : 1);
}
run().catch(e => { console.log('ERROR:', e.stack || e); clearTimeout(safety); process.exit(1); });
