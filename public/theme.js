const PAL={
 def:{n:"الافتراضي",d:["#0A0E1F","#9FB4FF","#4B5BDB","#2FB5A8"],l:["#F2F0E8","#1E6B50","#8FCBAE","#EBC98A"]},
 lav:{n:"لافندر",d:["#0B0D22","#B7B2FF","#5B6CF0","#C6B8FF"],l:["#F1F0F8","#4B3CD8","#B9B4FF","#8FA8FF"]},
 sun:{n:"غروب",d:["#140A1C","#FFB38A","#E0689B","#F2A97B"],l:["#F6EFEA","#A8381F","#F2A97B","#E8B5D6"]},
 neo:{n:"نيون",d:["#0B0620","#7FE7FF","#19C2E8","#E64AA8"],l:["#EEF3F6","#0B6E8A","#7FD6EA","#F0A6D0"]},
 min:{n:"نعناع",d:["#08140F","#A6F0C6","#3FBF8F","#E8D56A"],l:["#F1F3E8","#1E6B50","#A5E3C4","#F2E28A"]}};
var ST={mode:"auto",pal:"def",gl:1,rm:false};try{Object.assign(ST,JSON.parse(localStorage.getItem("gq")||"{}"))}catch(e){}
const isNight=()=>ST.mode==="dark"||(ST.mode==="auto"&&matchMedia("(prefers-color-scheme:dark)").matches);
function theme(){
 const n=isNight(),p=PAL[ST.pal]||PAL.def,c=n?p.d:p.l,r=document.documentElement.style,a=[.05,.08,.12][ST.gl],b=[.38,.5,.62][ST.gl];
 const v={"--bg":c[0],"--ac":c[1],"--b1":c[2],"--b2":c[3],"--tx":n?"#ECEFFA":"#1D2B25","--mu":n?"#A3ABC9":"#55645D",
  "--gb":n?`rgba(255,255,255,${a})`:`rgba(255,255,255,${b})`,"--gbr":n?"rgba(255,255,255,.22)":"rgba(255,255,255,.85)",
  "--btf":n?c[0]:"#FFFFFF","--ln":n?"rgba(255,255,255,.12)":"rgba(29,43,37,.12)","--ring":n?"rgba(255,255,255,.16)":"rgba(29,43,37,.14)",
  "--sh":n?"rgba(18,24,44,.88)":"rgba(250,248,242,.9)","--dg":n?"#ff9a86":"#b8402c","--bl":[10,22,34][ST.gl]+"px"};
 for(const k in v)r.setProperty(k,v[k]);
 document.body.classList.toggle("rm",ST.rm||matchMedia("(prefers-reduced-motion:reduce)").matches);
 const m=document.querySelector('meta[name="theme-color"]');if(m)m.content=c[0];
}
theme();matchMedia("(prefers-color-scheme:dark)").addEventListener("change",theme);
