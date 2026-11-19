"use strict";
const $ = id => document.getElementById(id);
const config=window.PORTAL;
const base=(config?.url || "").replace(/\/+$/,"");
const configured=/^https:\/\/[a-z0-9.-]+$/i.test(base) && !!config?.publishableKey;
let session=null, email="", sentAt=0, access=null, signup=false;
const notice=text=>{$("status").textContent=text;};
function show(id){for(const k of ["login","verify","member"]) $(k).hidden=k!==id;}
async function api(path,body,token){
  const headers={"Content-Type":"application/json","apikey":config.publishableKey};
  if(token) headers.Authorization="Bearer "+token;
  const response=await fetch(base+path,{method:"POST",headers,body:JSON.stringify(body)});
  if(!response.ok){const e=new Error("request failed");e.status=response.status;
    const detail=await response.json().catch(()=>({}));
    e.code=detail.error_code || detail.code || ""; throw e;}
  if(response.status===204) return {};
  return response.json();
}
function action(node, handler){
  node.addEventListener(node.tagName==="FORM"?"submit":"click",async event=>{
    event.preventDefault();const button=node.tagName==="FORM"?node.querySelector("button"):node;
    button.disabled=true;
    try{await handler();}catch(e){
      if(e.downloadProbe) notice(e.status?"설치 파일 서버가 HTTP "+e.status+" 오류를 반환했습니다. 관리자에게 이 번호를 알려주세요.":"설치 파일 서버에 연결하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 다운로드해주세요.");
      else if(e.status===429) notice("요청이 많습니다. 잠시 뒤 다시 시도하세요.");
      else if(node.id==="verify" && (e.code==="otp_expired" || e.status===403)) notice("코드가 일치하지 않거나 만료·사용된 코드입니다. 가장 최근 메일의 코드를 확인하거나 ‘새 코드 받기’를 눌러주세요.");
      else if(node.id==="verify") notice("로그인 코드를 확인하지 못했습니다. 연결 상태를 확인하고 다시 시도하세요."+(e.code && /^[a-z_]+$/.test(e.code)?" ("+e.code+")":""));
      else if(e.status===401||e.status===403) notice("로그인 상태 또는 다운로드 권한을 확인하세요.");
      else notice("요청을 완료하지 못했습니다. 연결 상태와 관리자 설정을 확인하세요.");
    }
    finally{button.disabled=node.id==="download" ? !access?.allowed : false;}
  });
}
action($("login"),async()=>{
  if(!configured){notice("관리자가 로그인 연결을 준비 중입니다. CSV 양식은 지금 받을 수 있습니다.");return;}
  email=$("email").value.trim();signup=$("signup").checked===true;await sendCode();
});
async function sendCode(){
  const remaining=Math.ceil((sentAt+60000-Date.now())/1000);
  if(remaining>0){notice(remaining+"초 후 새 코드를 요청할 수 있습니다.");return;}
  await api("/auth/v1/otp",{email,create_user:signup});sentAt=Date.now();show("verify");$("code").value="";
  notice(email+"로 요청했습니다. 가장 최근 사건조회 인증 메일의 숫자를 입력하세요. 메일이 없으면 스팸함과 이메일 주소를 확인하세요.");$("code").focus();
}
action($("resend"),sendCode);
action($("verify"),async()=>{
  const s=await api("/auth/v1/verify",{email,token:$("code").value.trim(),type:"email"});
  if(!s.access_token)throw new Error("login");
  session={...s,expires_at:s.expires_at || Date.now()/1000+s.expires_in};show("member");$("account").textContent=s.user?.email || email;notice("");$("code").value="";
  await refreshAccess();
});
action($("again"),async()=>{show("login");notice("");$("code").value="";});
action($("logout"),async()=>{
  try{if(session)await api("/auth/v1/logout",{},session.access_token);}
  finally{session=null;access=null;$("admin").hidden=true;$("member-list").replaceChildren();$("download").disabled=true;show("login");notice("로그아웃했습니다.");}
});
action($("download"),async()=>{
  if(!session || Date.now()/1000 >= session.expires_at){session=null;show("login");notice("세션이 만료되었습니다. 다시 로그인하세요.");return;}
  if(!await refreshAccess())return;
  notice("설치 파일 연결을 확인하고 있습니다…");
  const data=await api("/storage/v1/object/sign/court-releases/windows/CourtLookupSetup.exe",{expiresIn:3600},session.access_token);
  const url=new URL(data.signedURL,base+"/");
  if(url.origin!==base)throw new Error("invalid download origin");
  if(url.pathname.startsWith("/object/sign/"))url.pathname="/storage/v1"+url.pathname;
  if(!url.pathname.startsWith("/storage/v1/object/sign/court-releases/"))throw new Error("invalid signed path");
  url.searchParams.set("download","CourtLookupSetup.exe");
  try{
    const probe=await fetch(url.href,{headers:{Range:"bytes=0-0"},signal:AbortSignal.timeout(30000),cache:"no-store"});
    if(probe.body)await probe.body.cancel();
    if(!probe.ok){const e=new Error("download server error");e.status=probe.status;throw e;}
  }catch(e){e.downloadProbe=true;throw e;}
  const a=document.createElement("a");a.href=url.href;a.download="CourtLookupSetup.exe";a.click();notice("파일 서버 연결 확인 완료. 다운로드를 시작했습니다. Chrome 다운로드 목록에서 완료 여부를 확인하세요. 중단되면 이 버튼을 다시 눌러주세요.");
});
if(!configured){$("send").disabled=true;notice("로그인 연결 준비 중입니다. CSV 양식은 지금 받을 수 있습니다.");}

const memberLabels={pending:"승인 대기",active:"사용 가능",suspended:"사용 정지"};
async function rpc(name,body={}){
  if(!session || Date.now()/1000>=session.expires_at){const e=new Error("expired");e.status=401;throw e;}
  return api("/rest/v1/rpc/"+name,body,session.access_token);
}
async function refreshAccess(){
  access=null;$("download").disabled=true;$("admin").hidden=true;
  $("membership-status").textContent="승인 상태 확인 중…";
  try{access=await rpc("court_access");}
  catch(e){$("membership-status").textContent="승인 상태를 확인하지 못했습니다. 새로고침하거나 다시 로그인하세요.";throw e;}
  const expired=access.expires_at && Date.parse(access.expires_at)<=Date.now();
  $("membership-status").textContent=(expired?"사용기간 만료":memberLabels[access.status]||"승인 대기")+
    (access.expires_at?" · 종료 시각 "+new Date(access.expires_at).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"})+" (한국시간)":"");
  $("download").disabled=!access.allowed;
  $("pending-help").hidden=access.status!=="pending";
  $("admin").hidden=!(access.allowed && access.is_admin);
  return !!access.allowed;
}
action($("refresh-access"),refreshAccess);
function expiryDate(iso){return iso?new Date(Date.parse(iso)-1).toLocaleDateString("sv-SE",{timeZone:"Asia/Seoul"}):"";}
function expiryInstant(date){return date?new Date(Date.parse(date+"T00:00:00+09:00")+86400000).toISOString():null;}
async function loadMembers(){
  const members=await rpc("court_list_members");$("member-list").replaceChildren();
  for(const member of members){
    const row=document.createElement("form");row.className="member-row";
    const name=document.createElement("strong");name.textContent=(member.email||member.user_id)+(member.is_admin?" · 관리자":"");row.append(name);
    if(member.is_admin){$("member-list").append(row);continue;}
    const status=document.createElement("select");status.setAttribute("aria-label",(member.email||"회원")+" 승인 상태");
    for(const [value,label] of Object.entries(memberLabels)){const o=document.createElement("option");o.value=value;o.textContent=label;status.append(o);}status.value=member.status;
    const expiry=document.createElement("input");expiry.type="date";expiry.value=expiryDate(member.expires_at);expiry.setAttribute("aria-label",(member.email||"회원")+" 사용 종료일");
    const save=document.createElement("button");save.textContent="변경 저장";save.type="submit";
    const result=document.createElement("span");result.setAttribute("role","status");
    row.append(status,expiry,save,result);
    row.addEventListener("submit",async event=>{
      event.preventDefault();save.disabled=true;result.textContent="저장 중…";
      try{await rpc("court_update_member",{target:member.user_id,new_status:status.value,expiry:expiryInstant(expiry.value)});result.textContent="저장 완료";}
      catch(e){result.textContent=e.status===401||e.status===403?"관리자 로그인을 다시 확인하세요.":"저장 실패. 목록을 새로고침하고 다시 시도하세요.";}
      finally{save.disabled=false;}
    });$("member-list").append(row);
  }
}
action($("reload-members"),loadMembers);
