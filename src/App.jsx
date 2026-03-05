import { dbGet, dbSet, dbList, dbDel } from "./storage";
import { useState, useEffect, useRef, useCallback } from "react";

const HR_PASSWORD = "hr@admin2026";
const LINK = typeof window !== "undefined" ? window.location.href : "";





async function ai(system, user) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
  method:"POST", headers:{"Content-Type":"application/json", "Authorization":`Bearer ${process.env.REACT_APP_GROQ_API_KEY}`},
    body:JSON.stringify({ model:"llama3-8b-8192", max_tokens:2000, messages:[{role:"system",content:system},{role:"user",content:user}]})
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const d = await res.json();
  if (d.error) throw new Error(JSON.stringify(d.error));
  const txt = d.choices?.[0]?.message?.content||"";
  return JSON.parse(txt.replace(/```json\n?|\n?```/g,"").trim());
}

function MatrixRain() {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext("2d"); let raf;
    const chars = "アイウエオカキクケコ01ABCDEF@#$%";
    let drops = [];
    const resize = () => { c.width=c.offsetWidth; c.height=c.offsetHeight; drops=Array(Math.floor(c.width/16)).fill(0).map(()=>Math.random()*c.height/16|0); };
    resize(); window.addEventListener("resize",resize);
    const draw = () => {
      ctx.fillStyle="rgba(0,0,0,0.05)"; ctx.fillRect(0,0,c.width,c.height);
      for(let i=0;i<drops.length;i++){
        const b=Math.random();
        ctx.fillStyle=b>0.97?"#ffffff":b>0.7?"#00ff41":"#003b00";
        ctx.font="14px monospace";
        ctx.fillText(chars[Math.floor(Math.random()*chars.length)],i*16,drops[i]*16);
        if(drops[i]*16>c.height&&Math.random()>0.97) drops[i]=0; else drops[i]++;
      }
      raf=requestAnimationFrame(draw);
    };
    draw();
    return ()=>{ cancelAnimationFrame(raf); window.removeEventListener("resize",resize); };
  },[]);
  return <canvas ref={ref} style={{position:"absolute",inset:0,width:"100%",height:"100%",zIndex:0}} />;
}

export default function App() {
  const [view, setView] = useState("hr-login"); // hr-login | hr-dash | candidate | exam-intro | exam | scoring | done
  const [hrPass, setHrPass] = useState("");
  const [hrErr, setHrErr] = useState("");
  const [isHR, setIsHR] = useState(false);

  // HR dashboard state
  const [assessment, setAssessment] = useState(null); // {role, seniority, domain, skills, questions, createdAt}
  const [candidates, setCandidates] = useState([]);
  const [jdText, setJdText] = useState("");
  const [updating, setUpdating] = useState(false);
  const [updateStep, setUpdateStep] = useState("");
  const [updateErr, setUpdateErr] = useState("");
  const [copied, setCopied] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);

  // Candidate state
  const [candName, setCandName] = useState("");
  const [candEmail, setCandEmail] = useState("");
  const [candErr, setCandErr] = useState("");
  const [candEntering, setCandEntering] = useState(false);

  // Exam state
  const [candUser, setCandUser] = useState(null);
  const [examQs, setExamQs] = useState([]);
  const [qIdx, setQIdx] = useState(0);
  const [answers, setAnswers] = useState({});
  const [timeLeft, setTimeLeft] = useState(60);
  const [asmtId, setAsmtId] = useState(null);

  const fmt = s => `${Math.floor(s/60)}:${(s%60).toString().padStart(2,"0")}`;

  // Restore HR session
  useEffect(()=>{ (async()=>{ const s=await dbGet("hr-session"); if(s){ setIsHR(true); setView("hr-dash"); await loadHRData(); } })(); },[]);

  // Load assessment + candidates
  async function loadHRData() {
    const a = await dbGet("active-assessment");
    setAssessment(a||null);
    const keys = await dbList("result:");
    const res = [];
    for(const k of keys){ const r=await dbGet(k); if(r?.completedAt) res.push(r); }
    res.sort((a,b)=>(b.pct||0)-(a.pct||0));
    setCandidates(res);
  }

  // Exam timer
  useEffect(()=>{
    if(view!=="exam") return;
    if(timeLeft<=0){ handleNextQ(); return; }
    const t=setTimeout(()=>setTimeLeft(p=>p-1),1000);
    return ()=>clearTimeout(t);
  },[timeLeft,view]);

  // ── HR Login ──────────────────────────────────────────────
  async function handleHRLogin() {
    if(hrPass===HR_PASSWORD){
      await dbSet("hr-session",{ok:true});
      setIsHR(true); setView("hr-dash"); setHrErr(""); setHrPass("");
      await loadHRData();
    } else { setHrErr("Incorrect password"); }
  }

  async function hrLogout() {
    await dbDel("hr-session"); setIsHR(false); setView("hr-login");
  }

  // ── Update Assessment ─────────────────────────────────────
  async function handleUpdateAssessment() {
    if(!jdText.trim()) return;
    setUpdating(true); setUpdateErr(""); setUpdateStep("Parsing job description...");
    try {
      // Parse JD
      const parsed = await ai(
        "You are an HR analyst. Return ONLY valid JSON. No markdown.",
        `Parse this job description and return:
{"role":"job title","seniority":"junior or mid or senior or lead","skills":["s1","s2","s3","s4","s5"],"domain":"industry"}
JD: ${jdText}`
      );
      if(!parsed.role) throw new Error("Could not parse JD");

      const {role,seniority,domain,skills} = parsed;
      const sk = skills?.join(", ")||role;
      const allQs = [];

      setUpdateStep("Generating MCQ questions (1/3)...");
      try {
        const r = await ai("Return ONLY a JSON array. No markdown.",
          `Generate 5 MCQs for a ${seniority} ${role} in ${domain}. Skills: ${sk}.
Return array: [{"q":"question?","options":["A) opt","B) opt","C) opt","D) opt"],"correct":"A"},...]`);
        (Array.isArray(r)?r:[]).slice(0,5).forEach((m,i)=>{ if(m.q) allQs.push({id:`m${i}`,type:"mcq",q:m.q,options:m.options||[],correct:m.correct||"A",time:60}); });
      } catch(e){ console.warn(e); }

      setUpdateStep("Generating short answer questions (2/3)...");
      try {
        const r = await ai("Return ONLY a JSON array. No markdown.",
          `Generate 3 short answer questions for a ${seniority} ${role} in ${domain}. Skills: ${sk}.
Return array: [{"q":"question?"},...]`);
        (Array.isArray(r)?r:[]).slice(0,3).forEach((s,i)=>{ if(s.q) allQs.push({id:`s${i}`,type:"short",q:s.q,time:300}); });
      } catch(e){ console.warn(e); }

      setUpdateStep("Generating scenario questions (3/3)...");
      try {
        const r = await ai("Return ONLY a JSON array. No markdown.",
          `Generate 2 scenario questions for a ${seniority} ${role} in ${domain}. Skills: ${sk}.
Return array: [{"q":"detailed scenario?"},...]`);
        (Array.isArray(r)?r:[]).slice(0,2).forEach((s,i)=>{ if(s.q) allQs.push({id:`c${i}`,type:"case",q:s.q,time:600}); });
      } catch(e){ console.warn(e); }

      if(allQs.length===0) throw new Error("No questions generated. Try again.");

      // Clear old results
      const oldKeys = await dbList("result:");
      for(const k of oldKeys) await dbDel(k);

      const newAsmt = {role,seniority,domain,skills,questions:allQs,createdAt:new Date().toISOString()};
      await dbSet("active-assessment", newAsmt);
      setAssessment(newAsmt); setCandidates([]); setJdText(""); setUpdateStep("");
    } catch(e){ setUpdateErr("Failed: "+e.message); setUpdateStep(""); }
    setUpdating(false);
  }

  async function handleClearResults() {
    if(!window.confirm("Clear all candidate results?")) return;
    const keys = await dbList("result:");
    for(const k of keys) await dbDel(k);
    setCandidates([]);
  }

  function copyLink() {
    navigator.clipboard.writeText(LINK).then(()=>{ setCopied(true); setTimeout(()=>setCopied(false),2000); });
  }

  // ── Candidate Enter ───────────────────────────────────────
  async function handleCandEnter() {
    if(!candName.trim()){ setCandErr("Enter your name"); return; }
    if(!candEmail.trim()||!candEmail.includes("@")){ setCandErr("Enter a valid email"); return; }
    if(!assessment?.questions?.length){ setCandErr("No assessment available yet"); return; }
    setCandEntering(true); setCandErr("");
    const existing = await dbGet(`result:${assessment.createdAt}:${candEmail.trim().toLowerCase()}`);
    if(existing?.completedAt){ setView("done"); setCandEntering(false); return; }
    setCandUser({name:candName.trim(), email:candEmail.trim().toLowerCase()});
    setExamQs(assessment.questions); setQIdx(0); setAnswers({});
    setTimeLeft(assessment.questions[0]?.time||60);
    const id = `result:${assessment.createdAt}:${candEmail.trim().toLowerCase()}`;
    await dbSet(id,{id,role:assessment.role,seniority:assessment.seniority,name:candName.trim(),email:candEmail.trim().toLowerCase(),startedAt:new Date().toISOString(),answers:{}});
    setAsmtId(id);
    setView("exam-intro"); setCandEntering(false);
  }

  // ── Exam ──────────────────────────────────────────────────
  const handleNextQ = useCallback(async()=>{
    const next = qIdx+1;
    if(next>=examQs.length){ await submitExam(); return; }
    setQIdx(next); setTimeLeft(examQs[next]?.time||60);
  },[qIdx,examQs]);

  async function saveAnswer(id,val) {
    if(!asmtId) return;
    const r=await dbGet(asmtId); if(r) await dbSet(asmtId,{...r,answers:{...(r.answers||{}),[id]:val}});
  }

  async function submitExam() {
    setView("scoring");
    const saved = await dbGet(asmtId);
    const merged = {...(saved?.answers||{}),...answers};
    const qaPairs = examQs.map(q=>({type:q.type,q:q.q,a:merged[q.id]||"(no answer)",correct:q.correct,options:q.options}));
    try {
      const result = await ai("Score candidates 0-10 per question. Return ONLY valid JSON.",
        `Score this ${assessment.role} (${assessment.seniority}) assessment.
${qaPairs.map((qa,i)=>`Q${i+1}[${qa.type}]: ${qa.q}\n${qa.options?`Options:${qa.options.join("|")}\nCorrect:${qa.correct}`:""}\nAnswer:${qa.a}`).join("\n\n")}
Return: {"scores":[n,n,n,n,n,n,n,n,n,n],"strength":"text","weakness":"text","reasoning":"text"}`);
      const scores = Array.isArray(result.scores)?result.scores:examQs.map(()=>0);
      const total = scores.reduce((s,n)=>s+(Number(n)||0),0);
      const max = examQs.length*10; const pct=max>0?(total/max)*100:0;
      const rec = pct>=75?"SELECTED":pct>=50?"HOLD":"REJECTED";
      await dbSet(asmtId,{...saved,answers:merged,scores,total,max,pct,rec,strength:result.strength||"",weakness:result.weakness||"",reasoning:result.reasoning||"",completedAt:new Date().toISOString(),qaPairs});
    } catch{}
    setView("done");
  }

  // ═══════════════════════════ UI ═══════════════════════════
  const G = "#00ff41";
  const bg = "#000";
  const card = { background:"rgba(0,20,0,0.85)", border:"1px solid #1a4a1a", borderRadius:8, padding:20 };
  const inp = { background:"rgba(0,40,0,0.5)", border:"1px solid #1a6a1a", color:G, borderRadius:6, padding:"14px 16px", width:"100%", fontFamily:"'Courier New',monospace", fontSize:15, outline:"none", boxSizing:"border-box" };
  const bigBtn = (col="#00ff41",bg2="rgba(0,60,0,0.7)",border2="#00ff41") => ({ display:"flex",alignItems:"center",justifyContent:"center",gap:10, background:bg2, border:`2px solid ${border2}`, color:col, borderRadius:6, padding:"16px 20px", width:"100%", fontFamily:"'Courier New',monospace", fontWeight:"bold", fontSize:15, letterSpacing:"0.12em", cursor:"pointer", transition:"all 0.15s" });

  return (
    <div style={{position:"relative",minHeight:"100vh",background:bg,fontFamily:"'Courier New',monospace",overflow:"hidden"}}>
      <style>{`
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
        @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        @keyframes fi{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
        input::placeholder{color:#1a5a1a} textarea::placeholder{color:#1a5a1a}
        input:focus,textarea:focus{border-color:#00ff41!important;box-shadow:0 0 0 2px rgba(0,255,65,0.15)}
        ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:#000}::-webkit-scrollbar-thumb{background:#1a4a1a;border-radius:2px}
        select option{background:#001400;color:#00ff41}
        details summary::-webkit-details-marker{display:none}
      `}</style>
      <MatrixRain />
      <div style={{position:"relative",zIndex:10,minHeight:"100vh"}}>

      {/* ══════════════ CANDIDATE PORTAL ══════════════ */}
      {view==="candidate" && (
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:"100vh",padding:"20px 16px"}}>
          {/* Big title */}
          <div style={{textAlign:"center",marginBottom:32,animation:"fi 0.5s ease"}}>
            <div style={{color:G,fontSize:52,fontWeight:"bold",letterSpacing:"0.05em",lineHeight:1,textShadow:`0 0 30px ${G},0 0 60px rgba(0,255,65,0.3)`}}>AI</div>
            <div style={{color:G,fontSize:42,fontWeight:"bold",letterSpacing:"0.05em",lineHeight:1.1,textShadow:`0 0 30px ${G},0 0 60px rgba(0,255,65,0.3)`}}>RECRUITMENT</div>
            <div style={{color:"#3a8a3a",fontSize:12,letterSpacing:"0.25em",marginTop:6}}>CANDIDATE PORTAL</div>
          </div>

          {/* Job badge */}
          {assessment && (
            <div style={{...card,marginBottom:20,width:"100%",maxWidth:480,textAlign:"center",animation:"fi 0.4s ease",border:"1px solid #2a6a2a"}}>
              <div style={{color:G,fontSize:18,fontWeight:"bold",marginBottom:4}}>{assessment.role}</div>
              <div style={{color:"#3a8a3a",fontSize:13}}>{assessment.seniority?.charAt(0).toUpperCase()+assessment.seniority?.slice(1)} · {assessment.domain}</div>
            </div>
          )}

          {/* Entry form */}
          <div style={{...card,width:"100%",maxWidth:480,animation:"fi 0.3s ease"}}>
            <div style={{color:"#3a8a3a",fontSize:11,letterSpacing:"0.2em",marginBottom:6}}>// ENTER YOUR DETAILS</div>
            <div style={{color:"#2a7a2a",fontSize:13,marginBottom:20,lineHeight:1.6}}>Enter your name and email to begin the assessment</div>
            <input
              value={candName} onChange={e=>setCandName(e.target.value)}
              style={{...inp,marginBottom:12}} placeholder="Enter your full name..."
            />
            <input
              type="email" value={candEmail} onChange={e=>setCandEmail(e.target.value)}
              style={{...inp,marginBottom:16}} placeholder="Enter your email address..."
              onKeyDown={e=>e.key==="Enter"&&handleCandEnter()}
            />
            {candErr && <div style={{color:"#ff4444",fontSize:12,marginBottom:12,padding:"8px 12px",background:"rgba(80,0,0,0.4)",borderRadius:4,border:"1px solid #440000"}}>{candErr}</div>}
            {candEntering
              ? <div style={{textAlign:"center",padding:16,color:G,fontSize:13,letterSpacing:"0.1em"}}>LOADING ASSESSMENT...</div>
              : <button onClick={handleCandEnter} style={bigBtn()}>▶ PROCEED TO TEST</button>
            }
          </div>

          {/* HR login link */}
          <button onClick={()=>{setView("hr-login");setHrErr("");}} style={{marginTop:24,background:"none",border:"none",color:"#1a5a1a",fontSize:11,cursor:"pointer",fontFamily:"monospace",letterSpacing:"0.1em"}}>
            HR LOGIN →
          </button>
        </div>
      )}

      {/* ══════════════ HR LOGIN ══════════════════════ */}
      {view==="hr-login" && (
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:"100vh",padding:"20px 16px"}}>
          <div style={{textAlign:"center",marginBottom:40,animation:"fi 0.5s ease"}}>
            <div style={{color:G,fontSize:52,fontWeight:"bold",letterSpacing:"0.05em",lineHeight:1,textShadow:`0 0 30px ${G}`}}>AI</div>
            <div style={{color:G,fontSize:42,fontWeight:"bold",letterSpacing:"0.05em",lineHeight:1.1,textShadow:`0 0 30px ${G}`}}>RECRUITMENT</div>
            <div style={{color:"#3a8a3a",fontSize:12,letterSpacing:"0.25em",marginTop:6}}>HR PORTAL</div>
          </div>

          <div style={{...card,width:"100%",maxWidth:480,animation:"fi 0.3s ease"}}>
            <div style={{color:"#3a8a3a",fontSize:11,letterSpacing:"0.2em",marginBottom:6}}>// HR LOGIN</div>
            <div style={{color:"#2a7a2a",fontSize:13,marginBottom:20}}>Enter your HR password to continue</div>
            <input
              type="password" value={hrPass} onChange={e=>setHrPass(e.target.value)}
              style={{...inp,marginBottom:14}} placeholder="Enter HR password..."
              onKeyDown={e=>e.key==="Enter"&&handleHRLogin()}
            />
            {hrErr && <div style={{color:"#ff4444",fontSize:12,marginBottom:12,padding:"8px 12px",background:"rgba(80,0,0,0.4)",borderRadius:4}}>{hrErr}</div>}
            <button onClick={handleHRLogin} style={bigBtn()}>▶ LOGIN</button>
          </div>

          <button onClick={()=>setView("candidate")} style={{marginTop:20,background:"none",border:"none",color:"#1a5a1a",fontSize:11,cursor:"pointer",fontFamily:"monospace",padding:"8px",letterSpacing:"0.1em"}}>CANDIDATE PORTAL →</button>
        </div>
      )}

      {/* ══════════════ HR DASHBOARD ══════════════════ */}
      {view==="hr-dash" && isHR && !showLeaderboard && (
        <div style={{minHeight:"100vh",padding:"0 0 40px"}}>
          {/* Top bar */}
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 16px",borderBottom:"1px solid #0a2a0a",background:"rgba(0,10,0,0.9)",position:"sticky",top:0,zIndex:100}}>
            <div>
              <div style={{color:G,fontSize:17,fontWeight:"bold",letterSpacing:"0.08em"}}>AI RECRUITMENT</div>
              <div style={{color:"#2a6a2a",fontSize:10,letterSpacing:"0.2em"}}>// HR DASHBOARD</div>
            </div>
            <button onClick={hrLogout} style={{background:"rgba(60,0,0,0.6)",border:"2px solid #880000",color:"#ff4444",padding:"8px 18px",borderRadius:6,fontFamily:"monospace",fontWeight:"bold",fontSize:13,cursor:"pointer",letterSpacing:"0.1em"}}>LOGOUT</button>
          </div>

          <div style={{padding:"16px"}}>
            {/* Active Assessment Card */}
            <div style={{...card,marginBottom:16,border:"1px solid #1a5a1a"}}>
              {assessment ? (
                <>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                    <span style={{fontSize:16}}>✅</span>
                    <span style={{color:"#2a7a2a",fontSize:11,letterSpacing:"0.2em"}}>ACTIVE ASSESSMENT</span>
                  </div>
                  <div style={{color:G,fontSize:24,fontWeight:"bold",marginBottom:6,lineHeight:1.2}}>{assessment.role}</div>
                  <div style={{color:"#3a8a3a",fontSize:13,marginBottom:16}}>
                    {assessment.seniority?.charAt(0).toUpperCase()+assessment.seniority?.slice(1)}-Level
                    {" · "}{assessment.questions?.filter(q=>q.type==="mcq").length||0} MCQs
                    {" · "}{assessment.questions?.filter(q=>q.type==="short").length||0} Short
                    {" · "}{assessment.questions?.filter(q=>q.type==="case").length||0} Case
                    {" · "}{candidates.length} candidate{candidates.length!==1?"s":""} done
                  </div>
                  <button onClick={()=>setShowLeaderboard(true)} style={{...bigBtn(G,"rgba(0,50,0,0.7)","#00ff41"),marginBottom:10,width:"auto",padding:"12px 20px"}}>
                    📊 LEADERBOARD
                  </button>
                  {"  "}
                  <button onClick={handleClearResults} style={{...bigBtn("#ffaa00","rgba(40,20,0,0.7)","#ffaa00"),width:"auto",padding:"12px 20px",display:"inline-flex"}}>
                    🗑 CLEAR
                  </button>
                </>
              ) : (
                <div style={{textAlign:"center",padding:"20px 0"}}>
                  <div style={{color:"#2a6a2a",fontSize:28,marginBottom:8}}>📋</div>
                  <div style={{color:"#2a7a2a",fontSize:13}}>No active assessment. Paste a JD below to create one.</div>
                </div>
              )}
            </div>

            {/* Candidate Test Link */}
            {assessment && (
              <div style={{...card,marginBottom:16,border:"1px solid #1a5a1a"}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                  <span style={{fontSize:16}}>📤</span>
                  <span style={{color:"#2a7a2a",fontSize:11,letterSpacing:"0.2em"}}>CANDIDATE TEST LINK</span>
                </div>
                <div style={{color:"#2a7a2a",fontSize:13,marginBottom:14,lineHeight:1.6}}>
                  Share this link with candidates. They open it on <span style={{color:G,fontWeight:"bold"}}>any device</span> — no setup needed!
                </div>
                <div style={{background:"rgba(0,30,0,0.7)",border:"1px solid #1a5a1a",borderRadius:6,padding:"12px 14px",marginBottom:14,wordBreak:"break-all",fontSize:13,color:G,lineHeight:1.5}}>
                  {LINK}
                </div>
                <button onClick={copyLink} style={{...bigBtn(G,"rgba(0,50,0,0.7)"),width:"auto",padding:"12px 24px"}}>
                  📋 {copied?"✓ COPIED!":"COPY LINK"}
                </button>
              </div>
            )}

            {/* Update JD */}
            <div style={{...card,border:"1px solid #1a4a1a"}}>
              <div style={{color:"#2a7a2a",fontSize:11,letterSpacing:"0.2em",marginBottom:12}}>// {assessment?"UPDATE":"CREATE"} JOB DESCRIPTION</div>
              {assessment && (
                <div style={{background:"rgba(40,20,0,0.5)",border:"1px solid #4a3000",borderRadius:6,padding:"10px 14px",marginBottom:14,fontSize:12,color:"#aa6600"}}>
                  ⚠ This will replace the current assessment and clear all results
                </div>
              )}
              <textarea
                value={jdText} onChange={e=>setJdText(e.target.value)}
                rows={8} style={{...inp,resize:"vertical",lineHeight:1.6,marginBottom:14}}
                placeholder="Paste the full job description here..."
              />
              {updateErr && <div style={{color:"#ff4444",fontSize:12,marginBottom:12,padding:"8px 12px",background:"rgba(80,0,0,0.4)",borderRadius:4}}>{updateErr}</div>}
              {updating ? (
                <div>
                  <div style={{color:G,fontSize:13,marginBottom:10,letterSpacing:"0.08em"}}>{updateStep}</div>
                  <div style={{display:"flex",gap:6}}>
                    {[0,1,2,3].map(i=><div key={i} style={{flex:1,height:4,borderRadius:2,background:"rgba(0,255,65,0.15)",overflow:"hidden"}}>
                      <div style={{height:"100%",background:G,width:updateStep.includes(`${i+1}/3`)||updateStep.includes("Saving")||(i===0&&updateStep.includes("2/3"))||(i<=1&&updateStep.includes("3/3"))||(i<=2&&updateStep.includes("Saving"))?"100%":"0%",transition:"width 0.3s"}} />
                    </div>)}
                  </div>
                </div>
              ) : (
                <button onClick={handleUpdateAssessment} disabled={!jdText.trim()} style={{...bigBtn(G,"rgba(0,50,0,0.7)"),opacity:!jdText.trim()?0.4:1}}>
                  🔄 {assessment?"UPDATE ASSESSMENT":"CREATE ASSESSMENT"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════ LEADERBOARD ═══════════════════ */}
      {view==="hr-dash" && isHR && showLeaderboard && (
        <div style={{minHeight:"100vh",padding:"0 0 40px"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 16px",borderBottom:"1px solid #0a2a0a",background:"rgba(0,10,0,0.9)",position:"sticky",top:0,zIndex:100}}>
            <div>
              <div style={{color:G,fontSize:17,fontWeight:"bold",letterSpacing:"0.08em"}}>AI RECRUITMENT</div>
              <div style={{color:"#2a6a2a",fontSize:10,letterSpacing:"0.2em"}}>// LEADERBOARD</div>
            </div>
            <button onClick={()=>setShowLeaderboard(false)} style={{background:"rgba(0,30,0,0.6)",border:"2px solid #1a5a1a",color:G,padding:"8px 16px",borderRadius:6,fontFamily:"monospace",fontSize:12,cursor:"pointer"}}>← BACK</button>
          </div>
          <div style={{padding:16}}>
            {/* Stats */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:16}}>
              {[["TOTAL",candidates.length,G],["SELECTED",candidates.filter(c=>c.rec==="SELECTED").length,"#00ff41"],["HOLD",candidates.filter(c=>c.rec==="HOLD").length,"#ffaa00"],["REJECTED",candidates.filter(c=>c.rec==="REJECTED").length,"#ff4444"]].map(([l,v,col])=>(
                <div key={l} style={{...card,textAlign:"center",padding:12}}>
                  <div style={{color:col,fontSize:22,fontWeight:"bold"}}>{v}</div>
                  <div style={{color:"#2a6a2a",fontSize:9,marginTop:3,letterSpacing:"0.1em"}}>{l}</div>
                </div>
              ))}
            </div>

            {candidates.length===0 ? (
              <div style={{...card,textAlign:"center",padding:40}}>
                <div style={{color:"#2a6a2a",fontSize:13}}>No candidates have completed the assessment yet.</div>
              </div>
            ) : (
              candidates.map((c,i)=>(
                <details key={c.id||i} style={{...card,marginBottom:10,padding:0,overflow:"hidden"}}>
                  <summary style={{padding:"14px 16px",cursor:"pointer",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                    <span style={{color:"#2a6a2a",fontWeight:"bold",fontSize:12}}>#{i+1}</span>
                    <span style={{color:G,fontWeight:"bold",fontSize:14,flex:1}}>{c.name}</span>
                    <span style={{color:"#2a7a2a",fontSize:11}}>{c.email}</span>
                    <span style={{color:G,fontWeight:"bold"}}>{c.pct?.toFixed(0)}%</span>
                    <span style={{
                      padding:"2px 10px",borderRadius:4,fontSize:11,fontWeight:"bold",
                      background:c.rec==="SELECTED"?"rgba(0,80,0,0.5)":c.rec==="HOLD"?"rgba(60,40,0,0.5)":"rgba(60,0,0,0.5)",
                      border:`1px solid ${c.rec==="SELECTED"?"#00ff41":c.rec==="HOLD"?"#ffaa00":"#ff4444"}`,
                      color:c.rec==="SELECTED"?"#00ff41":c.rec==="HOLD"?"#ffaa00":"#ff4444"
                    }}>{c.rec}</span>
                  </summary>
                  <div style={{padding:"0 16px 16px",borderTop:"1px solid #0a2a0a"}}>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginTop:14,marginBottom:14}}>
                      <div style={{background:"rgba(0,20,0,0.5)",border:"1px solid #0a3a0a",borderRadius:6,padding:12}}>
                        <div style={{color:"#2a6a2a",fontSize:10,letterSpacing:"0.15em",marginBottom:6}}>STRENGTHS</div>
                        <div style={{color:"#2a8a2a",fontSize:12,lineHeight:1.5}}>{c.strength||"—"}</div>
                      </div>
                      <div style={{background:"rgba(20,0,0,0.5)",border:"1px solid #3a0a0a",borderRadius:6,padding:12}}>
                        <div style={{color:"#6a2a2a",fontSize:10,letterSpacing:"0.15em",marginBottom:6}}>WEAKNESSES</div>
                        <div style={{color:"#8a4a2a",fontSize:12,lineHeight:1.5}}>{c.weakness||"—"}</div>
                      </div>
                    </div>
                    {c.reasoning&&<div style={{color:"#2a6a2a",fontSize:11,marginBottom:14,lineHeight:1.5}}><span style={{color:"#1a4a1a"}}>AI: </span>{c.reasoning}</div>}
                    <div style={{color:"#1a5a1a",fontSize:10,letterSpacing:"0.15em",marginBottom:10}}>ANSWERS</div>
                    {(c.qaPairs||[]).map((qa,j)=>(
                      <div key={j} style={{border:"1px solid #0a2a0a",borderRadius:6,padding:12,marginBottom:8}}>
                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                          <span style={{color:"#1a5a1a",fontSize:10}}>Q{j+1} · {qa.type?.toUpperCase()}</span>
                          {c.scores?.[j]!=null&&<span style={{color:c.scores[j]>=7?"#00ff41":c.scores[j]>=4?"#ffaa00":"#ff4444",fontWeight:"bold"}}>{c.scores[j]}/10</span>}
                        </div>
                        <div style={{color:"#2a8a2a",fontSize:12,marginBottom:6}}>{qa.q}</div>
                        <div style={{color:"#2a6a2a",fontSize:11,background:"rgba(0,15,0,0.5)",padding:"8px 10px",borderRadius:4}}>
                          {qa.a==="(no answer)"?<i style={{color:"#1a4a1a"}}>No answer</i>:qa.a}
                        </div>
                      </div>
                    ))}
                    {/* Override */}
                    <div style={{marginTop:12,display:"flex",alignItems:"center",gap:10}}>
                      <span style={{color:"#2a6a2a",fontSize:11}}>Override:</span>
                      <select value={c.rec} onChange={async e=>{
                        const updated={...c,rec:e.target.value,overridden:true};
                        await dbSet(c.id,updated);
                        setCandidates(prev=>prev.map((x,xi)=>xi===i?updated:x));
                      }} style={{background:"rgba(0,20,0,0.7)",border:"1px solid #1a5a1a",color:G,padding:"4px 8px",borderRadius:4,fontFamily:"monospace",fontSize:12,cursor:"pointer"}}>
                        <option value="SELECTED">SELECTED</option>
                        <option value="HOLD">HOLD</option>
                        <option value="REJECTED">REJECTED</option>
                      </select>
                    </div>
                  </div>
                </details>
              ))
            )}
          </div>
        </div>
      )}

      {/* ══════════════ EXAM INTRO ════════════════════ */}
      {view==="exam-intro" && (
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:"100vh",padding:"20px 16px"}}>
          <div style={{...card,width:"100%",maxWidth:480,animation:"fi 0.4s ease"}}>
            <div style={{textAlign:"center",marginBottom:24}}>
              <div style={{color:G,fontSize:24,fontWeight:"bold",marginBottom:4}}>{assessment?.role}</div>
              <div style={{color:"#3a8a3a",fontSize:13}}>{assessment?.seniority?.toUpperCase()} LEVEL ASSESSMENT</div>
            </div>
            <div style={{border:"1px solid #0a3a0a",borderRadius:6,padding:16,marginBottom:20}}>
              {[["Total Questions",examQs.length],["MCQs",`${examQs.filter(q=>q.type==="mcq").length} × 1 min each`],["Short Answers",`${examQs.filter(q=>q.type==="short").length} × 5 min each`],["Case Studies",`${examQs.filter(q=>q.type==="case").length} × 10 min each`]].map(([k,v])=>(
                <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:"1px solid #0a2a0a",fontSize:13}}>
                  <span style={{color:"#2a6a2a"}}>{k}</span><span style={{color:G}}>{v}</span>
                </div>
              ))}
            </div>
            <div style={{color:"#1a5a1a",fontSize:12,lineHeight:1.9,marginBottom:22}}>
              ⚠ Timer auto-advances each question<br/>
              ⚠ No back navigation<br/>
              ⚠ Answers saved automatically
            </div>
            <button onClick={()=>{setView("exam");setTimeLeft(examQs[0]?.time||60);}} style={bigBtn()}>▶ START TEST</button>
          </div>
        </div>
      )}

      {/* ══════════════ EXAM ══════════════════════════ */}
      {view==="exam" && examQs[qIdx] && (()=>{
        const q=examQs[qIdx]; const urgent=timeLeft<=30;
        return (
          <div style={{minHeight:"100vh",padding:"0 0 40px"}}>
            {/* Timer bar */}
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 16px",background:"rgba(0,10,0,0.9)",borderBottom:"1px solid #0a2a0a",position:"sticky",top:0,zIndex:100}}>
              <div style={{color:"#2a6a2a",fontSize:12}}>Q {qIdx+1} / {examQs.length} · {q.type.toUpperCase()}</div>
              <div style={{fontSize:20,fontWeight:"bold",color:urgent?"#ff4444":G,animation:urgent?"pulse 1s infinite":"none"}}>{fmt(timeLeft)}</div>
            </div>
            {/* Progress */}
            <div style={{height:4,background:"rgba(0,255,65,0.1)"}}>
              <div style={{height:"100%",background:G,width:`${(qIdx/examQs.length)*100}%`,transition:"width 0.4s"}} />
            </div>
            <div style={{padding:16}}>
              <div style={{...card,marginBottom:14}}>
                <div style={{color:"#2a6a2a",fontSize:11,letterSpacing:"0.15em",marginBottom:10}}>// {q.type.toUpperCase()}</div>
                <div style={{color:G,fontSize:15,lineHeight:1.7,marginBottom:20}}>{q.q}</div>
                {q.type==="mcq"&&q.options ? (
                  <div style={{display:"grid",gap:10}}>
                    {q.options.map(opt=>(
                      <button key={opt} onClick={()=>setAnswers(p=>({...p,[q.id]:opt.charAt(0)}))}
                        style={{textAlign:"left",padding:"14px 16px",border:`2px solid ${answers[q.id]===opt.charAt(0)?"#00ff41":"#1a4a1a"}`,borderRadius:6,background:answers[q.id]===opt.charAt(0)?"rgba(0,60,0,0.6)":"rgba(0,20,0,0.4)",color:answers[q.id]===opt.charAt(0)?G:"#2a7a2a",cursor:"pointer",fontFamily:"monospace",fontSize:13,transition:"all 0.1s"}}>
                        {opt}
                      </button>
                    ))}
                  </div>
                ):(
                  <textarea value={answers[q.id]||""} onChange={e=>setAnswers(p=>({...p,[q.id]:e.target.value}))}
                    rows={6} style={{...inp,resize:"vertical"}} placeholder="Type your answer here..." />
                )}
              </div>
              <button onClick={async()=>{await saveAnswer(q.id,answers[q.id]||"");await handleNextQ();}} style={bigBtn()}>
                {qIdx===examQs.length-1?"▶ SUBMIT ASSESSMENT":"▶ NEXT QUESTION"}
              </button>
            </div>
          </div>
        );
      })()}

      {/* ══════════════ SCORING ═══════════════════════ */}
      {view==="scoring" && (
        <div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh"}}>
          <div style={{textAlign:"center"}}>
            <div style={{fontSize:48,marginBottom:20,animation:"spin 2s linear infinite",display:"inline-block"}}>⚙️</div>
            <div style={{color:G,fontSize:16,letterSpacing:"0.1em",marginBottom:8}}>SCORING YOUR RESPONSES</div>
            <div style={{color:"#2a6a2a",fontSize:12}}>AI is evaluating your answers...</div>
          </div>
        </div>
      )}

      {/* ══════════════ DONE ══════════════════════════ */}
      {view==="done" && (
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:"100vh",padding:"20px 16px"}}>
          <div style={{...card,width:"100%",maxWidth:440,textAlign:"center",animation:"fi 0.5s ease"}}>
            <div style={{fontSize:64,marginBottom:16}}>✅</div>
            <div style={{color:G,fontSize:26,fontWeight:"bold",marginBottom:10,textShadow:`0 0 20px ${G}`}}>Test Submitted!</div>
            <div style={{color:"#2a8a2a",fontSize:14,marginBottom:8}}>Your assessment has been submitted successfully.</div>
            <div style={{color:"#2a6a2a",fontSize:12,marginBottom:28}}>Our team will review your results and be in touch soon.</div>
            <button onClick={()=>{setView("candidate");setCandName("");setCandEmail("");}} style={bigBtn()}>← BACK TO HOME</button>
          </div>
        </div>
      )}

      </div>
    </div>
  );
}
