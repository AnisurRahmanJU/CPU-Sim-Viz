
(function(){"use strict";

/* ══════════════════════════════════════════════════════════════════════
   ISA DEFINITION
   Opcodes: LOADI Rd #imm | LOAD Rd [addr] | STORE Rs [addr]
            ADD Rd Rs1 Rs2 | SUB Rd Rs1 Rs2 | MUL Rd Rs1 Rs2 | DIV Rd Rs1 Rs2
            AND Rd Rs1 Rs2 | OR Rd Rs1 Rs2 | XOR Rd Rs1 Rs2 | NOT Rd Rs1
            CMP Rs1 Rs2    | JMP label | JZ label | JNZ label | JN label
            MOV Rd Rs      | INP Rd   | OUT Rs   | HALT
   ══════════════════════════════════════════════════════════════════════ */

const OP = {LOADI:1,LOAD:2,STORE:3,ADD:4,SUB:5,MUL:6,DIV:7,AND:8,OR:9,XOR:10,NOT:11,CMP:12,JMP:13,JZ:14,JNZ:15,JN:16,MOV:17,INP:18,OUT:19,HALT:0};
const REG_ALIAS = ['zero','ra','sp','gp','tp','t0','t1','t2'];
const MEM_SZ = 64;

/* ── EXAMPLES ───────────────────────────────────────────────────────── */
const EXAMPLES = [
{name:"👋 Hello (প্রিন্ট 42)",
asm:`; রেজিস্টারে ৪২ রেখে প্রিন্ট করো
LOADI R1, #42
OUT   R1
HALT`},

{name:"➕ দুটি সংখ্যা যোগ",
asm:`; a=5, b=7, c = a+b প্রিন্ট করো
LOADI R1, #5
LOADI R2, #7
ADD   R3, R1, R2
OUT   R3
HALT`},

{name:"➖❌ বিয়োগ ও গুণ",
asm:`; (a - b) * c
LOADI R1, #10
LOADI R2, #4
LOADI R3, #3
SUB   R4, R1, R2
MUL   R5, R4, R3
OUT   R5
HALT`},

{name:"🧮 মেমরি স্টোর/লোড",
asm:`; মেমরিতে লিখে পড়ো
LOADI R1, #99
STORE R1, [5]
LOADI R1, #0
LOAD  R2, [5]
OUT   R2
HALT`},

{name:"🔀 if (a == b)",
asm:`; a==b হলে 1 নয়তো 0 প্রিন্ট
LOADI R1, #5
LOADI R2, #5
CMP   R1, R2
JZ    EQUAL
LOADI R3, #0
OUT   R3
JMP   END
EQUAL:
LOADI R3, #1
OUT   R3
END:
HALT`},

{name:"🔁 লুপ (1..5 যোগ)",
asm:`; sum = 1+2+3+4+5 = 15
LOADI R1, #0
LOADI R2, #1
LOADI R3, #6
LOOP:
CMP   R2, R3
JZ    DONE
ADD   R1, R1, R2
LOADI R4, #1
ADD   R2, R2, R4
JMP   LOOP
DONE:
OUT   R1
HALT`},

{name:"📊 ফিবোনাচি (n=8)",
asm:`; ফিবোনাচি: 0 1 1 2 3 5 8 13
LOADI R0, #0
LOADI R1, #1
LOADI R7, #8
LOADI R6, #0
FIB:
CMP   R6, R7
JZ    FIBDONE
OUT   R0
ADD   R2, R0, R1
MOV   R0, R1
MOV   R1, R2
LOADI R3, #1
ADD   R6, R6, R3
JMP   FIB
FIBDONE:
HALT`},

{name:"0️⃣1️⃣ AND/OR/XOR বিটওয়াইজ",
asm:`; বিটওয়াইজ অপারেশন
LOADI R1, #12
LOADI R2, #10
AND   R3, R1, R2
OR    R4, R1, R2
XOR   R5, R1, R2
OUT   R3
OUT   R4
OUT   R5
HALT`},

{name:"📥 INP (user input)",
asm:`; ইনপুট নিয়ে ২ দিয়ে গুণ করো
INP   R1
LOADI R2, #2
MUL   R3, R1, R2
OUT   R3
HALT`}
];

/* ── STATE ─────────────────────────────────────────────────────────── */
let prog = [], labels = {}, machCode = [];
let st = null, running = false, timer = null;
let microQ = [], inputQ = [];

function freshSt(){
  return{pc:0,regs:new Array(8).fill(0),mem:new Array(MEM_SZ).fill(0),
    flags:{Z:false,N:false,C:false},halted:false,cycle:0,output:[],
    lastReg:-1,lastMem:-1,lastPhase:'',lastInstrTxt:'',_cache:{}};
}

/* ── ASSEMBLER ──────────────────────────────────────────────────────── */
function assemble(src){
  const lines = src.split('\n');
  labels = {}; const cleaned = [];
  lines.forEach((raw,i)=>{
    let l = raw.split(';')[0].trim();
    if(!l) return;
    if(l.endsWith(':')){
      labels[l.slice(0,-1).trim().toUpperCase()] = cleaned.length;
      return;
    }
    cleaned.push({raw:l,srcIdx:i,origRaw:raw.trim()});
  });
  const errs=[]; prog=[];
  cleaned.forEach((e,addr)=>{
    const m = e.raw.match(/^([A-Za-z]+)\s*(.*)/);
    if(!m){errs.push(`লাইন ${e.srcIdx+1}: বুঝা যায়নি`);return;}
    const op = m[1].toUpperCase(), rest = m[2];
    if(!(op in OP)){errs.push(`লাইন ${e.srcIdx+1}: অজানা নির্দেশ '${op}'`);return;}
    const args = rest.split(',').map(s=>s.trim()).filter(Boolean);
    function r(tok){const x=tok.match(/^R([0-7])$/i);if(!x){errs.push(`লাইন ${e.srcIdx+1}: অবৈধ রেজিস্টার '${tok}'`);}return x?+x[1]:0;}
    function imm(tok){const x=tok.match(/^#(-?\d+)$/);if(!x){errs.push(`লাইন ${e.srcIdx+1}: অবৈধ ইমিডিয়েট '${tok}'`);}return x?+x[1]:0;}
    function addr(tok){const x=tok.match(/^\[(\d+)\]$/);if(!x){errs.push(`লাইন ${e.srcIdx+1}: অবৈধ ঠিকানা '${tok}'`);}return x?+x[1]:0;}
    function lbl(tok){const k=tok.toUpperCase();if(!(k in labels)){errs.push(`লাইন ${e.srcIdx+1}: অজানা লেবেল '${tok}'`);}return labels[k]??0;}
    let ins={op,srcIdx:e.srcIdx,raw:e.origRaw,addr};
    switch(op){
      case'LOADI': ins.rd=r(args[0]);ins.imm=imm(args[1]);break;
      case'LOAD':  ins.rd=r(args[0]);ins.maddr=addr(args[1]);break;
      case'STORE': ins.rs=r(args[0]);ins.maddr=addr(args[1]);break;
      case'ADD':case'SUB':case'MUL':case'DIV':
      case'AND':case'OR':case'XOR':
        ins.rd=r(args[0]);ins.rs1=r(args[1]);ins.rs2=r(args[2]);break;
      case'NOT':case'MOV': ins.rd=r(args[0]);ins.rs1=r(args[1]);break;
      case'CMP': ins.rs1=r(args[0]);ins.rs2=r(args[1]);break;
      case'JMP':case'JZ':case'JNZ':case'JN': ins.target=lbl(args[0]);ins.lbl=args[0];break;
      case'OUT': ins.rs=r(args[0]);break;
      case'INP': ins.rd=r(args[0]);break;
      case'HALT': break;
    }
    prog.push(ins);
  });
  // encode
  machCode = prog.map((ins,a)=>{
    const opc=OP[ins.op]||0;
    let word = (opc<<12);
    if('rd'in ins) word|=((ins.rd&7)<<9);
    if('rs1'in ins) word|=((ins.rs1&7)<<6);
    if('rs2'in ins) word|=((ins.rs2&7)<<3);
    if('imm'in ins) word|=(ins.imm&0x1FF);
    if('maddr'in ins) word|=(ins.maddr&0x3F);
    if('target'in ins) word|=(ins.target&0xFF);
    if('rs'in ins) word|=((ins.rs&7)<<9);
    return{addr:a,word,hex:'0x'+word.toString(16).toUpperCase().padStart(4,'0'),txt:ins.raw};
  });
  return errs;
}

/* ── MICRO STEP BUILDER ─────────────────────────────────────────────── */
function buildMicroQ(){
  microQ=[];
  if(st.halted||st.pc>=prog.length){microQ.push({ph:'DONE'});return;}
  const ins=prog[st.pc];
  microQ.push({ph:'FETCH',ins});
  microQ.push({ph:'DECODE',ins});
  microQ.push({ph:'EXECUTE',ins});
  if(ins.op==='LOAD'||ins.op==='STORE') microQ.push({ph:'MEMORY',ins});
  if(['LOADI','LOAD','ADD','SUB','MUL','DIV','AND','OR','XOR','NOT','MOV','INP'].includes(ins.op))
    microQ.push({ph:'WRITEBACK',ins});
}

function execMicro(){
  if(!microQ.length) buildMicroQ();
  const step=microQ.shift();
  st.lastReg=-1; st.lastMem=-1;

  clearDpHighlights();

  if(step.ph==='DONE'){
    setPhase('');
    setSb('ok','সম্পন্ন ✓');
    setTopStatus('প্রোগ্রাম শেষ');
    stopRun();
    return false;
  }

  const ins=step.ins;
  st.lastPhase=step.ph;
  st.lastInstrTxt=ins.raw;
  setPhase(step.ph);
  hi('disasm-'+prog.indexOf(ins));
  hiSrcLine(ins.srcIdx);

  /* ── FETCH ── */
  if(step.ph==='FETCH'){
    dphi('blk-PC','blk-IMEM');
    dpwire('w-pc-imem');
    dpset('dpPC','0x'+st.pc.toString(16).toUpperCase().padStart(2,'0'));
    dpset('dpIMar',st.pc);
    dpset('dpIMemOut',ins.op);
    pset('FETCH',ins.op);
    animPulse('w-pc-imem');
  }
  /* ── DECODE ── */
  else if(step.ph==='DECODE'){
    dphi('blk-IR','blk-DEC');
    dpwire('w-imem-ir','w-ir-dec');
    dpset('dpIR',ins.op);
    dpset('dpDEC',descIns(ins));
    pset('DECODE',descIns(ins));
    // show register selectors
    dpset('dpRS1','rs1='+(ins.rs1!==undefined?'R'+ins.rs1:'-'));
    dpset('dpRS2','rs2='+(ins.rs2!==undefined?'R'+ins.rs2:'-'));
    dpset('dpRD','rd='+(ins.rd!==undefined?'R'+ins.rd:ins.rs!==undefined?'R'+ins.rs:'-'));
    pset('DECODE',ins.op+' decoded');
  }
  /* ── EXECUTE ── */
  else if(step.ph==='EXECUTE'){
    dphi('blk-REG','blk-ALU','blk-DEC');
    dpwire('w-dec-alu','w-rega-alu','w-regb-alu');
    const a=ins.rs1!==undefined?st.regs[ins.rs1]:0;
    const b=ins.rs2!==undefined?st.regs[ins.rs2]:0;
    dpset('dpRegA',ins.rs1!==undefined?`R${ins.rs1}=${a}`:'—');
    dpset('dpRegB',ins.rs2!==undefined?`R${ins.rs2}=${b}`:'—');
    // compute result for display
    let res='—', opLabel=ins.op;
    switch(ins.op){
      case'LOADI': res=ins.imm; opLabel='MOV #'+ins.imm; break;
      case'ADD': res=a+b; break; case'SUB': res=a-b; break;
      case'MUL': res=a*b; break; case'DIV': res=b?Math.trunc(a/b):0; break;
      case'AND': res=a&b; break; case'OR': res=a|b; break;
      case'XOR': res=a^b; break; case'NOT': res=~st.regs[ins.rs1]; break;
      case'MOV': res=st.regs[ins.rs1]; break;
      case'CMP':
        const d=a-b; st.flags.Z=d===0; st.flags.N=d<0;
        dpset('dpFlags',`Z:${st.flags.Z?1:0} N:${st.flags.N?1:0}`);
        dphi('blk-FLAGS'); dpwire('w-alu-flags');
        res=d; opLabel='CMP'; break;
      case'JMP': st.pc=ins.target; dphi('blk-PC'); pset('EXECUTE','JMP →'+ins.lbl); break;
      case'JZ':  if(st.flags.Z){st.pc=ins.target;}else{st.pc++;} dphi('blk-PC'); break;
      case'JNZ': if(!st.flags.Z){st.pc=ins.target;}else{st.pc++;} dphi('blk-PC'); break;
      case'JN':  if(st.flags.N){st.pc=ins.target;}else{st.pc++;} dphi('blk-PC'); break;
      case'OUT':
        const v=st.regs[ins.rs];
        dpset('dpOUT',v);
        dphi('blk-OUT'); dpwire('w-alu-out');
        st.output.push({t:'out',txt:'▶ '+v});
        pset('EXECUTE','OUT='+v);
        addConsole(v,'out');
        break;
      case'INP':
        const iv=inputQ.shift()??0;
        ins._inp=iv; res=iv; opLabel='INP';
        st.output.push({t:'info',txt:'📥 INP='+iv});
        addConsole('INP: '+iv,'info');
        break;
      case'HALT':
        st.halted=true;
        st.output.push({t:'info',txt:'--- HALT ---'});
        addConsole('HALT — প্রোগ্রাম শেষ','info');
        break;
      case'LOAD': dpset('dpDmemAddr',ins.maddr); dphi('blk-DMEM'); break;
      case'STORE':
        dpset('dpDmemAddr',ins.maddr);
        dpset('dpDmemData',st.regs[ins.rs]);
        dphi('blk-DMEM'); dpwire('w-alu-dmem');
        break;
    }
    dpset('dpAluOp','op: '+opLabel);
    if(res!=='—') dpset('dpAluR',res);
    ins._alu=res;
    pset('EXECUTE',opLabel+'='+res);
  }
  /* ── MEMORY ── */
  else if(step.ph==='MEMORY'){
    dphi('blk-DMEM','blk-REG');
    if(ins.op==='LOAD'){
      dpwire('w-alu-dmem','w-dmem-wb');
      ins._loaded=st.mem[ins.maddr];
      dpset('dpDmemAddr',ins.maddr);
      dpset('dpDmemData',ins._loaded);
      pset('MEMORY','MEM['+ins.maddr+']='+ins._loaded);
    } else if(ins.op==='STORE'){
      dpwire('w-alu-dmem');
      st.mem[ins.maddr]=st.regs[ins.rs];
      st.lastMem=ins.maddr;
      dpset('dpDmemAddr',ins.maddr);
      dpset('dpDmemData',st.regs[ins.rs]);
      dpch('blk-DMEM');
      pset('MEMORY','MEM['+ins.maddr+']←'+st.regs[ins.rs]);
    }
  }
  /* ── WRITEBACK ── */
  else if(step.ph==='WRITEBACK'){
    dphi('blk-REG','blk-WB');
    dpwire('w-alu-res','w-wb-reg','w-dmem-wb');
    let wval;
    if(ins.op==='LOADI') wval=ins.imm;
    else if(ins.op==='LOAD') wval=ins._loaded;
    else if(ins.op==='INP') wval=ins._inp;
    else if(['ADD','SUB','MUL','DIV','AND','OR','XOR','NOT','MOV'].includes(ins.op)) wval=ins._alu;
    if(wval!==undefined){
      st.regs[ins.rd]=wval; st.lastReg=ins.rd;
      dpset('dpWrData',wval); dpset('dpWB','R'+ins.rd+'←'+wval);
      dpch('blk-REG');
      pset('WRITEBACK','R'+ins.rd+'='+wval);
    }
  }

  // advance PC (unless jump already set it)
  if(microQ.length===0){
    if(!['JMP','JZ','JNZ','JN'].includes(ins.op)&&!st.halted) st.pc++;
    st.cycle++;
  }

  // update all panels
  renderRegisters(); renderFlags(); renderMemory(); renderDisasm();
  updateDpStats();
  return !st.halted;
}

/* ── HELPERS ─────────────────────────────────────────────────────────── */
function descIns(ins){
  switch(ins.op){
    case'LOADI': return `LOADI R${ins.rd}, #${ins.imm}`;
    case'LOAD':  return `LOAD R${ins.rd}, [${ins.maddr}]`;
    case'STORE': return `STORE R${ins.rs}, [${ins.maddr}]`;
    case'ADD':   return `ADD R${ins.rd}=R${ins.rs1}+R${ins.rs2}`;
    case'SUB':   return `SUB R${ins.rd}=R${ins.rs1}-R${ins.rs2}`;
    case'MUL':   return `MUL R${ins.rd}=R${ins.rs1}×R${ins.rs2}`;
    case'DIV':   return `DIV R${ins.rd}=R${ins.rs1}÷R${ins.rs2}`;
    case'AND':   return `AND R${ins.rd}=R${ins.rs1}&R${ins.rs2}`;
    case'OR':    return `OR R${ins.rd}=R${ins.rs1}|R${ins.rs2}`;
    case'XOR':   return `XOR R${ins.rd}=R${ins.rs1}^R${ins.rs2}`;
    case'NOT':   return `NOT R${ins.rd}=~R${ins.rs1}`;
    case'MOV':   return `MOV R${ins.rd}←R${ins.rs1}`;
    case'CMP':   return `CMP R${ins.rs1},R${ins.rs2}`;
    case'JMP':   return `JMP ${ins.lbl}`;
    case'JZ':    return `JZ ${ins.lbl} (Z=${st.flags.Z?1:0})`;
    case'JNZ':   return `JNZ ${ins.lbl} (Z=${st.flags.Z?1:0})`;
    case'JN':    return `JN ${ins.lbl} (N=${st.flags.N?1:0})`;
    case'OUT':   return `OUT R${ins.rs}`;
    case'INP':   return `INP R${ins.rd}`;
    case'HALT':  return 'HALT';
    default: return ins.op;
  }
}

function he(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

/* ── DP HELPERS ──────────────────────────────────────────────────────── */
function clearDpHighlights(){
  document.querySelectorAll('.dp-box').forEach(b=>{b.classList.remove('hi','ch','ok')});
  document.querySelectorAll('.dp-wire').forEach(w=>w.classList.remove('hi','pulse'));
}
function dphi(...ids){ids.forEach(id=>{const e=document.getElementById(id);if(e)e.classList.add('hi');})}
function dpch(...ids){ids.forEach(id=>{const e=document.getElementById(id);if(e)e.classList.add('ch');})}
function dpwire(...ids){ids.forEach(id=>{const e=document.getElementById(id);if(e)e.classList.add('hi','pulse');})}
function dpset(id,val){const e=document.getElementById(id);if(e)e.textContent=val;}
function pset(phase,txt){const e=document.getElementById('ps-'+phase);if(e){e.textContent=txt||'—';}}

function animPulse(wireId){
  const wire=document.getElementById(wireId);
  const dot=document.getElementById('pulseDot');
  if(!wire||!dot) return;
  dot.setAttribute('opacity','1');
  const len=wire.getTotalLength?wire.getTotalLength():200;
  let start=null;
  const dur=500;
  function step(ts){
    if(!start) start=ts;
    const p=Math.min((ts-start)/dur,1);
    try{const pt=wire.getPointAtLength(p*len);dot.setAttribute('cx',pt.x);dot.setAttribute('cy',pt.y);}catch(e){}
    if(p<1) requestAnimationFrame(step);
    else dot.setAttribute('opacity','0');
  }
  requestAnimationFrame(step);
}

function setPhase(ph){
  document.querySelectorAll('.pipe-stage').forEach(c=>c.classList.toggle('active',c.dataset.phase===ph));
  document.getElementById('statPhase').textContent=ph||'—';
}
function updateDpStats(){
  if(!st) return;
  document.getElementById('statCycle').textContent=st.cycle;
  document.getElementById('statPC').textContent=st.pc;
  document.getElementById('statInstr').textContent=st.lastInstrTxt||'—';
}

/* ── RENDER REGISTERS ─────────────────────────────────────────────────── */
function renderRegisters(){
  const g=document.getElementById('regTable'); if(!g) return;
  g.innerHTML='';
  st.regs.forEach((v,i)=>{
    const ch=st.lastReg===i;
    const div=document.createElement('div');
    div.className='reg-row'+(ch?' changed':'');
    div.innerHTML=`<span class="reg-name">R${i}</span><span class="reg-alias">${REG_ALIAS[i]}</span><span class="reg-val">${v}</span><span class="reg-hex">0x${(v&0xFFFF).toString(16).toUpperCase().padStart(4,'0')}</span>`;
    div.addEventListener('dblclick',()=>{
      const nv=prompt(`R${i} = ?`,v);
      if(nv!==null&&!isNaN(+nv)){st.regs[i]=+nv;renderRegisters();}
    });
    g.appendChild(div);
  });
}

/* ── RENDER FLAGS ─────────────────────────────────────────────────────── */
function renderFlags(){
  const r=document.getElementById('flagsRow'); if(!r) return;
  r.innerHTML='';
  const defs=[['Z','Zero'],['N','Negative'],['C','Carry']];
  defs.forEach(([k,lbl])=>{
    const d=document.createElement('div');
    d.className='flag-box'+(st.flags[k]?' on':'');
    d.innerHTML=`<div style="font-size:9px;color:var(--text3)">${lbl}</div><div>${k}: ${st.flags[k]?'1':'0'}</div>`;
    r.appendChild(d);
  });
  dpset('dpFlags',`Z:${st.flags.Z?1:0} N:${st.flags.N?1:0} C:${st.flags.C?1:0}`);
}

/* ── RENDER MEMORY ─────────────────────────────────────────────────────── */
function renderMemory(){
  const g=document.getElementById('memGrid'); if(!g) return;
  g.innerHTML='';
  let used=0;
  for(let i=0;i<MEM_SZ;i++){
    if(st.mem[i]===0&&i!==st.lastMem) continue;
    used++;
    const d=document.createElement('div');
    d.className='mem-row'+(st.lastMem===i?' changed':'');
    d.innerHTML=`<span class="mem-addr">[${i}]</span><span class="mem-dec">${st.mem[i]}</span><span class="mem-hex">0x${(st.mem[i]&0xFFFF).toString(16).toUpperCase().padStart(4,'0')}</span>`;
    g.appendChild(d);
  }
  if(used===0){
    const d=document.createElement('div');
    d.className='mem-row'; d.style.color='var(--text3)';
    d.innerHTML='<span class="mem-addr">—</span><span>খালি</span><span></span>';
    g.appendChild(d);
  }
  document.getElementById('memUsedBadge').textContent=used+'/'+MEM_SZ;
}

/* ── RENDER DISASM ─────────────────────────────────────────────────────── */
function renderDisasm(){
  const pane=document.getElementById('disasmPane'); if(!pane) return;
  pane.innerHTML='';
  prog.forEach((ins,i)=>{
    const mc=machCode[i]||{addr:i,hex:'',txt:''};
    const isCur=st&&st.pc===i&&!st.halted;
    const d=document.createElement('div');
    d.className='code-line'+(isCur?' active-exec':'');
    d.id='disasm-'+i;
    d.innerHTML=`<span class="asm-addr">${String(i).padStart(3,' ')}</span><span class="asm-hex">${mc.hex}</span><span class="asm-src">${he(ins.raw)}</span>`;
    d.addEventListener('click',()=>{if(st&&!running){st.pc=i;microQ=[];renderDisasm();}});
    pane.appendChild(d);
  });
  document.getElementById('instrCountBadge').textContent=prog.length+' instructions';
}

function hi(id){const e=document.getElementById(id);if(e){e.classList.add('flash');setTimeout(()=>e.classList.remove('flash'),400);}}
function hiSrcLine(idx){
  // find src line in the editor textarea (by line index)
}

/* ── CONSOLE ─────────────────────────────────────────────────────────── */
function addConsole(txt,type){
  const box=document.getElementById('consoleBox');
  const d=document.createElement('div');
  d.className='con-line con-'+type;
  d.textContent=txt;
  box.appendChild(d);
  box.scrollTop=box.scrollHeight;
}
function clearConsole(){document.getElementById('consoleBox').innerHTML='';}

/* ── STATUS BAR ─────────────────────────────────────────────────────── */
function setSb(type,txt){
  const dot=document.getElementById('sbDot'),t=document.getElementById('sbTxt');
  dot.className='sb-dot'+(type?' '+type:'');
  t.textContent=txt;
}
function setTopStatus(txt){document.getElementById('topStatus').textContent=txt;}

/* ── MAIN ASSEMBLE ───────────────────────────────────────────────────── */
function doAssemble(){
  const src=document.getElementById('asmEditor').value;
  const errs=assemble(src);
  if(errs.length){
    addConsole('❌ অ্যাসেম্বল ত্রুটি:\n'+errs.join('\n'),'err');
    setSb('err','ত্রুটি: '+errs[0]);
    setTopStatus('ত্রুটি পাওয়া গেছে');
    return false;
  }
  clearConsole();
  addConsole(`✅ ${prog.length}টি নির্দেশ অ্যাসেম্বল হয়েছে`,'info');
  setSb('ok',prog.length+'টি নির্দেশ লোড');
  setTopStatus(prog.length+' instructions assembled');
  renderDisasm();
  return true;
}

/* ── RESET ───────────────────────────────────────────────────────────── */
function doReset(){
  stopRun(); st=freshSt(); microQ=[];
  clearDpHighlights(); setPhase('');
  ['dpPC','dpIMar','dpIMemOut','dpIR','dpDEC','dpRS1','dpRS2','dpRD',
   'dpRegA','dpRegB','dpWrData','dpAluOp','dpAluR','dpAluA','dpFlags',
   'dpDmemAddr','dpDmemData','dpWB','dpOUT','dpWrData'].forEach(id=>dpset(id,'—'));
  dpset('dpPC','0x00'); dpset('dpFlags','Z:0 N:0');
  ['ps-FETCH','ps-DECODE','ps-EXECUTE','ps-MEMORY','ps-WRITEBACK'].forEach(id=>dpset(id,'—'));
  updateDpStats();
  renderRegisters(); renderFlags(); renderMemory(); renderDisasm();
  setSb('','রিসেট হয়েছে'); setTopStatus('রিসেট');
}

/* ── RUN LOOP ─────────────────────────────────────────────────────────── */
function stopRun(){
  running=false;
  if(timer){clearTimeout(timer);timer=null;}
  document.getElementById('btnRun').disabled=false;
  document.getElementById('btnPause').disabled=true;
  document.getElementById('btnStep').disabled=false;
}
function runLoop(){
  if(!running) return;
  const cont=execMicro();
  if(cont===false){stopRun();return;}
  const spd=+document.getElementById('speedSlider').value;
  timer=setTimeout(runLoop,Math.max(40,1100-spd*100));
}

/* ── LOAD EXAMPLE ─────────────────────────────────────────────────────── */
function loadExample(i){
  const ex=EXAMPLES[i];
  document.getElementById('asmEditor').value=ex.asm;
  clearConsole();
  addConsole('📂 লোড হয়েছে: '+ex.name,'info');
}

/* ── DRAG & DROP FOR DATAPATH BOXES ──────────────────────────────────── */
function setupDragDrop(){
  const svg=document.getElementById('dpSvg');
  if(!svg) return;
  let dragEl=null, offsetX=0, offsetY=0, startX=0, startY=0;

  function getSvgPoint(evt){
    const pt=svg.createSVGPoint();
    pt.x=evt.clientX; pt.y=evt.clientY;
    const ctm=svg.getScreenCTM();
    if(!ctm) return {x:0,y:0};
    const inv=ctm.inverse();
    return pt.matrixTransform(inv);
  }
  function getTranslate(el){
    const tl=el.transform.baseVal;
    if(tl.numberOfItems===0) return {x:0,y:0};
    const m=tl.consolidate().matrix;
    return {x:m.e,y:m.f};
  }

  svg.querySelectorAll('.dp-box').forEach(box=>{
    box.addEventListener('pointerdown',e=>{
      dragEl=box;
      box.classList.add('dragging');
      // bring to front
      box.parentNode.appendChild(box);
      const p=getSvgPoint(e);
      const t=getTranslate(box);
      startX=t.x; startY=t.y;
      offsetX=p.x-t.x; offsetY=p.y-t.y;
      box.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    box.addEventListener('pointermove',e=>{
      if(dragEl!==box) return;
      const p=getSvgPoint(e);
      const nx=p.x-offsetX, ny=p.y-offsetY;
      box.setAttribute('transform',`translate(${nx-  (box.dataset.baseX?+box.dataset.baseX:0)},${ny-(box.dataset.baseY?+box.dataset.baseY:0)})`);
      box.setAttribute('transform',`translate(${nx},${ny})`);
    });
    box.addEventListener('pointerup',e=>{
      if(dragEl===box){
        dragEl=null;
        box.classList.remove('dragging');
        try{box.releasePointerCapture(e.pointerId);}catch(err){}
      }
    });
    box.addEventListener('pointercancel',()=>{
      if(dragEl===box){dragEl=null; box.classList.remove('dragging');}
    });
  });
}

function resetLayout(){
  document.querySelectorAll('#dpSvg .dp-box').forEach(box=>{
    box.removeAttribute('transform');
  });
}

/* ── WIRE UP UI ───────────────────────────────────────────────────────── */
// Populate example select
const sel=document.getElementById('exSel');
EXAMPLES.forEach((ex,i)=>{
  const opt=document.createElement('option');
  opt.value=i; opt.textContent=ex.name;
  sel.appendChild(opt);
});
sel.addEventListener('change',()=>{loadExample(+sel.value);doAssemble();doReset();});

document.getElementById('btnAssemble').addEventListener('click',()=>{if(doAssemble())doReset();});
document.getElementById('btnStep').addEventListener('click',()=>{
  if(!prog.length){if(!doAssemble())return;}
  if(!st){st=freshSt();}
  if(st.halted){addConsole('ইতোমধ্যে সম্পন্ন — রিসেট করুন','warn');return;}
  setSb('run','ধাপে ধাপে...');
  setTopStatus('step mode');
  execMicro();
});
document.getElementById('btnRun').addEventListener('click',()=>{
  if(!prog.length){if(!doAssemble())return;}
  if(!st){st=freshSt();}
  if(st.halted){doReset();return;}
  running=true;
  document.getElementById('btnRun').disabled=true;
  document.getElementById('btnPause').disabled=false;
  document.getElementById('btnStep').disabled=true;
  setSb('run','চলছে...');
  setTopStatus('▶ running...');
  runLoop();
});
document.getElementById('btnPause').addEventListener('click',()=>{
  stopRun(); setSb('','বিরতি দেওয়া হয়েছে'); setTopStatus('⏸ paused');
});
document.getElementById('btnReset').addEventListener('click',doReset);
document.getElementById('btnResetLayout').addEventListener('click',resetLayout);
document.getElementById('btnClearConsole').addEventListener('click',clearConsole);
document.getElementById('btnSetInput').addEventListener('click',()=>{
  const v=document.getElementById('inputStream').value;
  inputQ=v.trim().split(/\s+/).filter(Boolean).map(Number);
  addConsole('📥 ইনপুট সেট: '+inputQ.join(', '),'info');
});

// Segment tabs
document.querySelectorAll('.seg-tab').forEach(tab=>{
  tab.addEventListener('click',()=>{
    document.querySelectorAll('.seg-tab').forEach(t=>t.classList.remove('active'));
    tab.classList.add('active');
    const pane=tab.dataset.pane;
    document.getElementById('paneEditor').style.display=(pane==='editor'?'flex':'none');
    document.getElementById('paneDisasm').style.display=(pane==='disasm'?'flex':'none');
    if(pane==='disasm') renderDisasm();
  });
});

// Keyboard shortcuts
document.addEventListener('keydown',e=>{
  if(e.key==='F5'){e.preventDefault();if(doAssemble())doReset();}
  if(e.key==='F9'){e.preventDefault();document.getElementById('btnRun').click();}
  if(e.key==='F10'){e.preventDefault();document.getElementById('btnStep').click();}
  if(e.key==='F2'){e.preventDefault();doReset();}
});

/* ── INIT ─────────────────────────────────────────────────────────────── */
loadExample(0);
doAssemble();
st=freshSt();
renderRegisters(); renderFlags(); renderMemory();
setupDragDrop();
setSb('ok','প্রস্তুত — F5 অ্যাসেম্বল, F9 চালাও, F10 ধাপ, বক্স টেনে সরানো যায়');
setTopStatus('প্রস্তুত');

})();
