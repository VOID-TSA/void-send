import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { ArrowDownToLine, Check, Copy, Link2, Send, ShieldCheck, Upload, Wifi, X, Zap, Globe2 } from 'lucide-react';

const SERVER = import.meta.env.VITE_SERVER_URL || (import.meta.env.DEV ? 'http://localhost:3001' : window.location.origin);
const CHUNK = 64 * 1024;
const MAX_SIZE = 100 * 1024 * 1024;
const bytes = n => n < 1024 ? `${n} B` : n < 1048576 ? `${(n/1024).toFixed(1)} KB` : `${(n/1048576).toFixed(1)} MB`;

export default function App() {
  const [socket,setSocket] = useState(null), [online,setOnline] = useState(false);
  const [mode,setMode] = useState('send'), [code,setCode] = useState(''), [joinCode,setJoinCode] = useState('');
  const [file,setFile] = useState(null), [peer,setPeer] = useState(false), [status,setStatus] = useState('Ready when you are');
  const [progress,setProgress] = useState(0), [transport,setTransport] = useState(''), [error,setError] = useState(''), [copied,setCopied] = useState(false);
  const [receiving,setReceiving] = useState(false), [done,setDone] = useState(false);
  const input = useRef(null), pc = useRef(null), channel = useRef(null), parts = useRef([]), received = useRef(0), meta = useRef(null);

  useEffect(() => {
    const s = io(SERVER, { transports: ['websocket','polling'] }); setSocket(s);
    s.on('connect',()=>{setOnline(true);setError('');}); s.on('disconnect',()=>{setOnline(false);setStatus('Server disconnected');});
    s.on('peer:joined',async()=>{setPeer(true);setStatus('Receiver connected · negotiating direct link'); await offer(s);});
    s.on('signal',async signal=>{try {const p=ensurePC(s); if(signal.description){await p.setRemoteDescription(signal.description); if(signal.description.type==='offer'){const answer=await p.createAnswer();await p.setLocalDescription(answer);s.emit('signal',{description:p.localDescription});}} else if(signal.candidate) await p.addIceCandidate(signal.candidate);} catch(e){setError(`Connection setup failed: ${e.message}`);}});
    s.on('relay:start',m=>{parts.current=[];received.current=0;meta.current=m;setReceiving(true);setDone(false);setProgress(0);setTransport('Server relay');setStatus('Receiving through relay');});
    s.on('relay:chunk',chunk=>{const b=chunk instanceof ArrayBuffer?chunk:chunk.buffer;parts.current.push(b);received.current+=b.byteLength;setProgress(Math.min(100,received.current/(meta.current?.size||1)*100));});
    s.on('relay:end',finish);
    s.on('peer:disconnected',()=>{setPeer(false);setStatus('Other device disconnected');});
    return ()=>{s.disconnect();pc.current?.close();};
  },[]);

  function ensurePC(s=socket){
    if(pc.current) return pc.current;
    const p=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});pc.current=p;
    p.onicecandidate=e=>{if(e.candidate)s?.emit('signal',{candidate:e.candidate});};
    p.ondatachannel=e=>setupChannel(e.channel);
    p.onconnectionstatechange=()=>{if(p.connectionState==='connected'){setTransport('Direct peer-to-peer');setStatus('Direct connection established');} if(p.connectionState==='failed')setStatus('Direct path failed · server relay available');};
    return p;
  }
  function setupChannel(ch){channel.current=ch;ch.binaryType='arraybuffer';ch.onopen=()=>{setTransport('Direct peer-to-peer');setStatus('Direct connection established');};ch.onmessage=e=>{
    if(typeof e.data==='string'){const m=JSON.parse(e.data);if(m.type==='meta'){parts.current=[];received.current=0;meta.current=m.file;setReceiving(true);setDone(false);setProgress(0);setStatus('Receiving directly');}if(m.type==='end')finish();}
    else {parts.current.push(e.data);received.current+=e.data.byteLength;setProgress(Math.min(100,received.current/(meta.current?.size||1)*100));}
  };}
  async function offer(s){try{const p=ensurePC(s);const ch=p.createDataChannel('void-send',{ordered:true});setupChannel(ch);const o=await p.createOffer();await p.setLocalDescription(o);s.emit('signal',{description:p.localDescription});}catch(e){setError(e.message);}}
  function finish(){if(!meta.current)return;const blob=new Blob(parts.current,{type:meta.current.type||'application/octet-stream'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=meta.current.name||'download';document.body.append(a);a.click();a.remove();setProgress(100);setReceiving(false);setDone(true);setStatus('Transfer complete · download started');parts.current=[];setTimeout(()=>URL.revokeObjectURL(url),60000);}
  function createRoom(){setError('');socket.emit('room:create',r=>{if(!r?.ok)return setError('Could not create room.');setCode(r.code);setMode('send');setStatus('Room created · waiting for receiver');});}
  function joinRoom(){setError('');socket.emit('room:join',joinCode,r=>{if(!r?.ok)return setError(r?.error||'Could not join room.');setCode(joinCode);setMode('receive');setStatus('Joined · waiting for sender');});}
  async function sendDirect(){const ch=channel.current;if(!file||ch?.readyState!=='open')throw Error('Direct connection is not ready.');setProgress(0);setDone(false);setStatus('Sending directly');ch.send(JSON.stringify({type:'meta',file:{name:file.name,size:file.size,type:file.type}}));let offset=0;while(offset<file.size){if(ch.bufferedAmount>1024*1024)await new Promise(resolve=>{ch.onbufferedamountlow=resolve;ch.bufferedAmountLowThreshold=256*1024;});const part=await file.slice(offset,offset+CHUNK).arrayBuffer();ch.send(part);offset+=part.byteLength;setProgress(offset/file.size*100);}ch.send(JSON.stringify({type:'end'}));setDone(true);setStatus('Transfer complete');}
  function sendRelay(){if(!file||!peer)return;socket.emit('relay:start',{name:file.name,size:file.size,type:file.type});let offset=0;setProgress(0);setDone(false);setStatus('Sending through server relay');setTransport('Server relay');const next=async()=>{if(offset>=file.size){socket.emit('relay:end');setDone(true);setStatus('Transfer complete');return;}const buf=await file.slice(offset,offset+CHUNK).arrayBuffer();socket.emit('relay:chunk',buf);offset+=buf.byteLength;setProgress(offset/file.size*100);setTimeout(next,0);};next().catch(e=>setError(e.message));}
  async function send(){if(!file)return;if(file.size>MAX_SIZE)return setError('MVP limit: 100 MB per file. Large-file streaming comes next.');setError('');try{if(channel.current?.readyState==='open')await sendDirect();else sendRelay();}catch(e){setError(e.message);}}
  async function copy(){try{await navigator.clipboard.writeText(code);setCopied(true);setTimeout(()=>setCopied(false),1500);}catch{setError('Clipboard unavailable; copy the code manually.');}}
  const sender=mode==='send';
  return <main className="shell">
    <header><a className="brand"><span className="mark"><Zap size={18} fill="currentColor"/></span> VOID<span className="slash">//</span>SEND</a><div className="online"><i className={online?'live':''}/>{online?'SERVER ONLINE':'CONNECTING'}</div></header>
    <section className="hero"><div className="eyebrow"><i/> PRIVATE FILE TRANSFER, REBUILT</div><h1>Send anything.<br/><em>Anywhere.</em></h1><p>No accounts. No friction. Just move your files.</p></section>
    <section className="card"><nav><button className={sender?'active':''} onClick={()=>setMode('send')}><Upload size={16}/> Send files</button><button className={!sender?'active':''} onClick={()=>setMode('receive')}><ArrowDownToLine size={16}/> Receive files</button></nav>
      {sender?<><button className="drop" onClick={()=>input.current?.click()} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();setFile(e.dataTransfer.files?.[0]||null);}}><input ref={input} hidden type="file" onChange={e=>setFile(e.target.files?.[0]||null)}/><span className="upload"><Upload size={22}/></span><b>{file?file.name:'Drop a file here'}</b><span>{file?`${bytes(file.size)} · ${file.type||'Unknown file type'}`:'or click to browse your device'}</span><small>Any file type · 100 MB MVP limit</small></button>
      {file&&<button className="remove" onClick={()=>setFile(null)}><X size={13}/> Remove file</button>}
      {!code?<button className="primary" disabled={!online} onClick={createRoom}><Zap size={16}/> Create transfer room</button>:<div className="room"><small>YOUR ROOM CODE</small><div className="code"><b>{code}</b><button onClick={copy}>{copied?<Check/>:<Copy/>}</button></div><p>Share this code with the person receiving your file.</p><div className="peer"><i className={peer?'live':''}/>{peer?'Receiver connected':'Waiting for receiver…'}</div>{peer&&<button className="primary" disabled={!file||(!channel.current&&false)} onClick={send}><Send size={16}/> Send file</button>}<div className="transport">Route: {transport||'Negotiating direct connection'}</div></div>}</>:<div className="receive"><span className="upload"><ArrowDownToLine size={22}/></span><b>Enter a transfer code</b><p>Ask the sender for their six-character room code.</p><input value={joinCode} maxLength={6} onChange={e=>setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,''))} placeholder="ABC123"/><button className="primary" disabled={!online||joinCode.length!==6} onClick={joinRoom}><Link2 size={16}/> Join transfer</button></div>}
      {(receiving||done||progress>0)&&<div className="progress"><div><span>{status}</span><b>{Math.round(progress)}%</b></div><div className="track"><i style={{width:`${progress}%`}}/></div></div>}
      <div className="status">{status}</div>{error&&<div className="error"><X size={14}/>{error}</div>}
    </section>
    <section className="features"><div><Zap/><b>Direct by default</b><span>WebRTC peer-to-peer when network conditions allow.</span></div><div><ShieldCheck/><b>Encrypted in transit</b><span>WebRTC uses DTLS. Deploy relay behind HTTPS.</span></div><div><Globe2/><b>Relay fallback</b><span>Server relay helps when direct paths fail.</span></div></section>
    <footer><span>VOID//SEND</span><span>MOVE DATA. NOT LIMITS.</span><span>EARLY BUILD · 0.1.0</span></footer>
  </main>;
}
