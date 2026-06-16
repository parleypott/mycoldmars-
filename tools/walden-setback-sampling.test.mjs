// Verifies the Walden setback checker samples the element's whole boundary, not just
// its corners. densifyLocalRing below is BYTE-IDENTICAL to the function shipped in
// public/walden/index.html — same pure-JS source, so this test exercises the real
// logic. The page feeds the densified ring to turf (pointToLineDistance /
// booleanPointInPolygon); here we feed it to equivalent pure-JS geometry so the test
// runs headless. The claim under test is geometric: densified sampling catches a lot
// violation that vertex-only sampling misses, and never the reverse.
//
// run: node public/walden/setback-sampling.test.mjs

// ---- shipped function (keep identical to index.html) ----
function densifyLocalRing(pts,closed,step){step=step||1.5;const out=[],N=pts.length;if(!N)return out;const last=closed?N:N-1;for(let i=0;i<last;i++){const a=pts[i],b=pts[(i+1)%N];out.push(a);const dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy),n=Math.floor(len/step);for(let k=1;k<=n;k++){const t=k*step/len;out.push([a[0]+dx*t,a[1]+dy*t]);}}if(!closed)out.push(pts[N-1]);return out;}

// ---- pure-JS geometry mirroring what turf does on the page ----
function distPointToSeg(p,a,b){const vx=b[0]-a[0],vy=b[1]-a[1],wx=p[0]-a[0],wy=p[1]-a[1];const c2=vx*vx+vy*vy;let t=c2?(wx*vx+wy*vy)/c2:0;t=Math.max(0,Math.min(1,t));const cx=a[0]+t*vx,cy=a[1]+t*vy;return Math.hypot(p[0]-cx,p[1]-cy);}
function distPointToPolyline(p,line){let mn=Infinity;for(let i=0;i<line.length-1;i++)mn=Math.min(mn,distPointToSeg(p,line[i],line[i+1]));return mn;}
function minRingToLine(ring,line){let mn=Infinity;for(const p of ring)mn=Math.min(mn,distPointToPolyline(p,line));return mn;}
function pointInPoly(p,poly){let inside=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const xi=poly[i][0],yi=poly[i][1],xj=poly[j][0],yj=poly[j][1];if(((yi>p[1])!==(yj>p[1]))&&(p[0]<(xj-xi)*(p[1]-yi)/(yj-yi)+xi))inside=!inside;}return inside;}
function anyOutside(ring,poly){return ring.some(p=>!pointInPoly(p,poly));}

// rotate a box (cx,cy,w,l,deg) into 4 local corners — mirrors boxRingLocal()
function box(cx,cy,w,l,deg){const r=deg*Math.PI/180,c=Math.cos(r),s=Math.sin(r),hw=w/2,hl=l/2;return [[-hw,-hl],[hw,-hl],[hw,hl],[-hw,hl]].map(([x,y])=>[cx+(x*c-y*s),cy+(x*s+y*c)]);}

let pass=0,fail=0;
const approx=(a,b,e=1e-9)=>Math.abs(a-b)<=e;
function ok(name,cond){if(cond){pass++;}else{fail++;console.log('  FAIL:',name);}}

// ---------- 1. densifyLocalRing structural properties ----------
{
  const sq=[[0,0],[10,0],[10,10],[0,10]];
  const closed=densifyLocalRing(sq,true,2.5);
  // every original vertex preserved exactly
  ok('closed keeps all 4 corners',sq.every(v=>closed.some(p=>approx(p[0],v[0])&&approx(p[1],v[1]))));
  // closing edge sampled: a point near (5,0)? mid of bottom edge present
  ok('closed samples edges (mid bottom edge present)',closed.some(p=>approx(p[0],5)&&approx(p[1],0)));
  // closing edge (left edge, x=0) sampled between (0,10)->(0,0)
  ok('closed samples the closing edge',closed.some(p=>approx(p[0],0)&&p[1]>0&&p[1]<10));
  ok('closed denser than input',closed.length>sq.length);

  const open=densifyLocalRing(sq,false,2.5);
  // open must include BOTH endpoints and NOT fabricate the closing edge mid-point at (0,5)
  ok('open includes first vertex',approx(open[0][0],0)&&approx(open[0][1],0));
  ok('open includes last vertex',approx(open[open.length-1][0],0)&&approx(open[open.length-1][1],10));

  // zero-length edge (duplicate pts) must not NaN / loop forever
  const degen=densifyLocalRing([[3,3],[3,3],[6,3]],true,1);
  ok('zero-length edge: no NaN',degen.every(p=>Number.isFinite(p[0])&&Number.isFinite(p[1])));
  ok('empty input safe',densifyLocalRing([],true,1).length===0);
}

// ---------- 2. nearestLotLine: rotated box vs a jutting lot-line corner ----------
// Lot boundary is a polyline with a corner that juts inward toward the box at (0,0).
// Box is rotated 45° so an EDGE faces the corner — the corner sits closer to the edge
// than to either flanking vertex. Setback = 5 ft.
{
  const SETBACK=5;
  const lotLine=[[-30,18],[0,10],[30,18]];          // V, apex (0,10) juts down toward the box top edge
  const b=box(0,0,12,12,0);                          // axis-aligned; top EDGE (y=6) faces the apex
  const verts=b;                                    // corners only (old behaviour)
  const dense=densifyLocalRing(b,true,1.5);         // whole boundary (new behaviour)

  const dV=minRingToLine(verts,lotLine);
  const dD=minRingToLine(dense,lotLine);
  ok('densified clearance <= vertex-only clearance',dD<=dV+1e-9);
  ok('vertex-only MISSES the violation (reads as clear)',dV>SETBACK);
  ok('densified CATCHES the violation (inside setback)',dD<SETBACK);
  ok('and they genuinely differ',(dV-dD)>0.3);
}

// ---------- 3. outsideLot: box edge crosses a concave notch, corners all inside ----------
// L-shaped parcel with a notch cut out of the top. A wide box sits low with all 4
// corners inside the solid part, but its top edge bridges across the notch (outside).
{
  const parcel=[[0,0],[20,0],[20,20],[12,20],[12,8],[8,8],[8,20],[0,20]]; // notch x∈[8,12], y∈[8,20]
  const b=box(10,5,16,8,0);  // x∈[2,18], y∈[1,9]; corners at (2,1),(18,1),(18,9),(2,9)
  // all 4 corners inside the solid lower band (y<8) or solid columns (x<8 or x>12)
  ok('all corners inside parcel (false sense of safety)',!anyOutside(b,parcel));
  // top edge runs y=9 from x=2..18, crossing the notch (x∈[8,12], y>8 is OUTSIDE)
  const dense=densifyLocalRing(b,true,1.5);
  ok('densified detects the edge crossing into the notch',anyOutside(dense,parcel));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
