const $=s=>document.querySelector(s), content=$("#content");
const state={page:"home",navToken:0,charts:[],optionsCache:null,
 orderCols:null, cancelCols:null, cancelTerms:null,
 custCols:["Customer Name","Orders","Order Qty","Invoice Qty","Fill Rate","Sale Loss"],
 catCols:["Category","Orders","Order Qty","Invoice Qty","Pending Qty","Fill Rate","Fill Rate Value","Sale Loss"],
 stockCols:["Key","Product","Order Qty","Stock","Gap","Status"], lastStockRows:[],
 explorerScope:{}, explorerLabels:{}, explorerBy:"chain", explorerCols:{}, explorerBucket:null, explorerData:null,
 tableSort:{}, // generic per-table sort state, keyed by an id string. {col:null,dir:null}
};
const fmtN=v=>v==null||v===""?"—":Number(v).toLocaleString("en-IN",{maximumFractionDigits:0});
const fmt1=v=>v==null?"—":Number(v).toLocaleString("en-IN",{maximumFractionDigits:1});
const fmtP=v=>v==null?"—":Number(v).toFixed(1)+"%";
const fmtC=v=>{if(v==null||v==="")return"—";let n=Number(v),a=Math.abs(n),s=n<0?"-":"";return a>=1e7?`${s}₹ ${(a/1e7).toFixed(2)} Cr`:a>=1e5?`${s}₹ ${(a/1e5).toFixed(2)} L`:`${s}₹ ${a.toLocaleString("en-IN",{maximumFractionDigits:0})}`};
// Sale Loss: always shown in lacs with 2 decimals, regardless of magnitude
// (fmtC only switches to L once a value crosses ₹1L, so small losses like
// ₹86 were showing as a plain rupee figure instead).
const fmtL=v=>{if(v==null||v==="")return"—";const n=Number(v);return `${n<0?"-":""}₹ ${(Math.abs(n)/1e5).toFixed(2)} L`};
const esc=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
const isNum=v=>v!==null&&v!==""&&!Number.isNaN(Number(v))&&typeof v!=="boolean";
async function api(url,opt){
 $("#status").className="live"; $("#status").innerHTML='<i></i> Loading';
 try{const r=await fetch(url,opt);const d=await r.json();if(!r.ok)throw Error(d.error||"Request failed");$("#status").innerHTML='<i></i> Live';return d}
 catch(e){$("#status").className="live";$("#status").innerHTML='<i></i> Error';throw e}
}
function toast(msg,error=false){const x=document.createElement("div");x.className="toast"+(error?" error":"");x.textContent=msg;document.body.appendChild(x);setTimeout(()=>x.remove(),3200)}
function kpi(label,val,sub="",icon="•",delta=""){return `<div class="card kpi"><div class="kpi-top"><span>${esc(label)}</span><span class="kpi-icon">${icon}</span></div><div class="kpi-value">${val}${delta}</div>${sub?`<div class="kpi-sub">${esc(sub)}</div>`:""}</div>`}
function deltaHtml(cur,prev,invert=false){
 if(cur==null||prev==null||Number(prev)===0)return "";
 const d=(Number(cur)-Number(prev))/Math.abs(Number(prev))*100;
 const good=invert?d<=0:d>=0;
 return `<span class="delta ${good?"up":"down"}">${d>=0?"▲":"▼"} ${Math.abs(d).toFixed(1)}%</span>`
}
function card(title,sub,body,cls=""){return `<div class="card ${cls}"><div class="card-head"><div><div class="card-title">${esc(title)}</div>${sub?`<div class="card-sub">${esc(sub)}</div>`:""}</div></div>${body}</div>`}
function loading(){return '<div class="card loading"><span class="spinner"></span>Loading data…</div>'}
function empty(msg="No data available"){return `<div class="empty">${esc(msg)}</div>`}

// ---------- Shared options / current-month cache ----------
async function ensureOptions(force=false){
 if(!state.optionsCache||force) state.optionsCache=await api("/api/options");
 return state.optionsCache;
}

// ---------- Filters (Month / Category / Customer / Channel / Zone / Name) ----------
function buildFilters(options, onApply, preset={}){
 const fields=[["Month","month"],["Category","category"],["Customer Name","customer"],["Channel","channel"],["Zone","zone"],["Name","name"]];
 let html=`<div class="card filters-card"><div class="filters-head"><div class="filters-title">Filters</div><div class="filters-actions"><button class="btn-ghost" id="clearFilters">Clear all</button><button class="btn-primary" id="applyFilters">Apply</button></div></div><div class="filter-grid">`;
 for(const [label,key] of fields){
   const vals=options?.[label]||[];
   const pre=new Set(preset[label]||[]);
   html+=`<div class="filter-field"><span class="filter-label">${esc(label)}</span><div class="multi" data-filter="${key}" data-label="${esc(label)}">
     <button type="button" class="multi-trigger"><span class="multi-placeholder">All ${esc(label.toLowerCase())}</span><span>⌄</span></button>
     <div class="multi-menu"><input class="multi-search" placeholder="Search ${esc(label.toLowerCase())}…"><div class="multi-options">
       ${vals.map((v,i)=>`<label class="multi-option"><input type="checkbox" value="${esc(v)}" ${pre.has(v)?"checked":""}><span>${esc(v)}</span></label>`).join("")}
     </div><div class="multi-foot"><button class="link-btn select-all">Select all</button><button class="link-btn clear-one">Clear</button></div></div>
   </div></div>`;
 }
 html+=`</div></div>`;
 content.insertAdjacentHTML("afterbegin",html);
 const box=document.querySelector(".filters-card");
 box.querySelectorAll(".multi").forEach(m=>{
   const trig=m.querySelector(".multi-trigger");
   trig.onclick=e=>{e.stopPropagation();document.querySelectorAll(".multi.open").forEach(x=>x!==m&&x.classList.remove("open"));m.classList.toggle("open")};
   m.querySelector(".multi-search").oninput=e=>{const q=e.target.value.toLowerCase();m.querySelectorAll(".multi-option").forEach(o=>o.style.display=o.textContent.toLowerCase().includes(q)?"flex":"none")};
   m.querySelector(".select-all").onclick=()=>{m.querySelectorAll(".multi-option input").forEach(x=>x.checked=true);updateMulti(m)};
   m.querySelector(".clear-one").onclick=()=>{m.querySelectorAll("input[type=checkbox]").forEach(x=>x.checked=false);updateMulti(m)};
   m.querySelectorAll(".multi-option input").forEach(x=>x.onchange=()=>updateMulti(m));
   updateMulti(m); // reflect any preset (e.g. current-month default) in the placeholder text right away
 });
 box.querySelector("#applyFilters").onclick=()=>{document.querySelectorAll(".multi.open").forEach(x=>x.classList.remove("open"));onApply()};
 box.querySelector("#clearFilters").onclick=()=>{box.querySelectorAll(".multi-option input").forEach(x=>x.checked=false);box.querySelectorAll(".multi").forEach(updateMulti);onApply()};
 return box;
}
function updateMulti(m){
 // Query both classes: this span's own class flips between multi-placeholder
 // and multi-count as selections change, so matching only one of them means
 // the lookup silently fails (and the label goes stale) the moment it toggles.
 const checked=[...m.querySelectorAll(".multi-option input:checked")], ph=m.querySelector(".multi-placeholder,.multi-count"), label=m.dataset.label;
 ph.textContent=checked.length?`${checked.length} selected`:`All ${label.toLowerCase()}`;
 ph.className=checked.length?"multi-count":"multi-placeholder";
}
function selectedParams(){
 const p=new URLSearchParams();
 document.querySelectorAll(".multi[data-filter]").forEach(m=>m.querySelectorAll("input:checked").forEach(x=>p.append(m.dataset.filter,x.value)));
 return p;
}
document.addEventListener("click",e=>{if(!e.target.closest(".multi"))document.querySelectorAll(".multi.open").forEach(x=>x.classList.remove("open"));if(!e.target.closest(".columns-wrap"))document.querySelectorAll(".columns-wrap.open").forEach(x=>x.classList.remove("open"))});

// ---------- Sortable, column-configurable table ----------
// Display-name overrides: the source Excel header stays the actual data key
// (used for row lookups, sorting, column-picker state, CSV export) — only the
// text shown to the user changes. Add more "raw header":"shown label" pairs
// here as needed.
const COL_DISPLAY_NAMES={"Final Remarks":"Order Remarks"};
const colLabel=c=>COL_DISPLAY_NAMES[c]||c;
// `rows` should hold RAW values (numbers/strings), never pre-formatted display
// strings — sorting and the numeric right-align both depend on the raw type.
// Pass `formatters` to control how a column's raw value is displayed.
function table(rows,{clickable=false,columns=null,id="tbl",emptyMsg="No data",sortState=null,formatters=null}={}){
 if(!rows?.length)return empty(emptyMsg);
 const cols=(columns&&columns.length?columns:Object.keys(rows[0])).filter(c=>rows.some(r=>Object.prototype.hasOwnProperty.call(r,c)));
 const thead=cols.map(c=>{
   if(!sortState)return `<th>${esc(colLabel(c))}</th>`;
   const active=sortState.col===c&&sortState.dir;
   const arrow=active?(sortState.dir==="asc"?" ▲":" ▼"):"";
   return `<th class="sortable" data-col="${esc(c)}" title="Click to sort">${esc(colLabel(c))}${arrow}</th>`;
 }).join("");
 let html=`<div class="table-wrap"><table id="${esc(id)}"><thead><tr>${thead}</tr></thead><tbody>`;
 rows.forEach((r,i)=>{
  html+=`<tr ${clickable?`class="clickrow" data-row="${i}"`:""}>${cols.map(c=>{
    const raw=r[c]; const disp=formatters&&formatters[c]?formatters[c](raw):raw;
    return `<td class="${isNum(raw)?"num":""}">${esc(disp)}</td>`;
  }).join("")}</tr>`;
 });
 return html+"</tbody></table></div>";
}
// 3-state cycle per column: none -> ascending -> descending -> none.
function withSort(rows,sort){
 if(!sort||!sort.col||!sort.dir)return rows;
 const {col,dir}=sort;
 const numeric=rows.every(r=>r[col]==null||r[col]===""||isNum(r[col]));
 const copy=[...rows];
 copy.sort((a,b)=>{
  let av=a[col],bv=b[col];
  if(numeric){av=av==null||av===""?-Infinity:Number(av);bv=bv==null||bv===""?-Infinity:Number(bv);return dir==="asc"?av-bv:bv-av}
  av=(av??"").toString().toLowerCase();bv=(bv??"").toString().toLowerCase();
  if(av<bv)return dir==="asc"?-1:1; if(av>bv)return dir==="asc"?1:-1; return 0;
 });
 return copy;
}
function wireSort(host,key,rerender){
 const tbl=host.querySelector("table[id]"); if(!tbl)return;
 tbl.querySelectorAll("th.sortable").forEach(th=>th.onclick=()=>{
  const c=th.dataset.col; const cur=state.tableSort[key]||{col:null,dir:null};
  const dir=cur.col===c?(cur.dir==="asc"?"desc":cur.dir==="desc"?null:"asc"):"asc";
  state.tableSort[key]=dir?{col:c,dir}:{col:null,dir:null};
  rerender();
 });
}
function columnButton(allCols,selected,id){
 const set=new Set(selected);
 return `<div class="columns-wrap" id="${id}"><button class="btn-secondary columns-trigger">☷ Columns</button><div class="columns-menu"><div class="columns-head"><b>Show columns</b><button class="link-btn col-all">All</button></div><div class="columns-list">${allCols.map(c=>`<label class="col-option"><input type="checkbox" value="${esc(c)}" ${set.has(c)?"checked":""}><span>${esc(colLabel(c))}</span></label>`).join("")}</div></div></div>`;
}
function wireColumns(root,onChange){
 const wrap=root.querySelector(".columns-wrap"); if(!wrap)return;
 wrap.querySelector(".columns-trigger").onclick=e=>{e.stopPropagation();wrap.classList.toggle("open")};
 wrap.querySelector(".col-all").onclick=()=>{wrap.querySelectorAll("input").forEach(x=>x.checked=true);onChange([...wrap.querySelectorAll("input:checked")].map(x=>x.value))};
 wrap.querySelectorAll("input").forEach(x=>x.onchange=()=>onChange([...wrap.querySelectorAll("input:checked")].map(x=>x.value)));
}
function chart(id,option){
 const el=document.getElementById(id);if(!el)return;
 if(typeof echarts==="undefined"){el.innerHTML='<div class="empty">Chart library failed to load. Check your network/ad-blocker and refresh.</div>';return}
 try{
  const existing=echarts.getInstanceByDom(el); if(existing)existing.dispose();
  const c=echarts.init(el);c.setOption(option);state.charts.push(c);return c;
 }
 catch(e){el.innerHTML=`<div class="empty">Chart failed to render: ${esc(e.message)}</div>`;console.error("chart render error",id,e)}
}
function chartBase(){return {color:["#c9976a","#e7aebb","#7a2e3d","#8a726d","#f3b95f","#58d39b"],textStyle:{fontFamily:"Inter",color:"#3E3E3C"},grid:{left:48,right:18,top:38,bottom:32},tooltip:{backgroundColor:"#1c1216",borderColor:"#523c33",textStyle:{color:"#fff"}},legend:{textStyle:{color:"#3E3E3C"},top:5}}}
// `pos` lets two overlapping lines offset their labels (top/bottom) so ECharts'
// automatic overlap-hiding doesn't silently drop labels when values are close.
function lineSeries(name,data,pos="top"){return {name,type:"line",smooth:true,showSymbol:true,symbolSize:0,data,label:{show:true,position:pos,fontSize:9,color:"#3E3E3C",formatter:p=>p.value==null?"":Number(p.value).toFixed(1)+"%"},labelLayout:{hideOverlap:false}}}
function fmtMetric(m,v){if(/rate|fr/i.test(m))return fmtP(v);if(/loss/i.test(m))return fmtL(v);if(/value/i.test(m))return fmtC(v);return fmtN(v)}

async function sourceInfo(){try{const d=await api("/api/health");$("#sourceNote").innerHTML=`Dispatch: ${esc(d.sources.dispatch)}<br>Items: ${esc(d.sources.items)}<br>Stock: ${esc(d.sources.stock)}<br>Stock Gap: ${esc(d.sources.stock_gap_order)}`}catch(e){}}

// ---------- Overview / Home ----------
function homeResultsHtml(d){
 return `<div class="grid kpi-grid">
 ${kpi("Order Qty",fmtN(d.current.order_qty),d.current_month||"Current month","O",deltaHtml(d.current.order_qty,d.previous?.order_qty))}
 ${kpi("Invoice Qty",fmtN(d.current.invoice_qty),d.current_month||"Current month","I",deltaHtml(d.current.invoice_qty,d.previous?.invoice_qty))}
 ${kpi("Fill Rate — Qty",fmtP(d.current.fr_qty),"Current month","%",deltaHtml(d.current.fr_qty,d.previous?.fr_qty))}
 ${kpi("Sale Loss",fmtL(d.current.sale_loss),"Current month","₹",deltaHtml(d.current.sale_loss,d.previous?.sale_loss,true))}
 </div>
 <div class="section-gap grid two-col">
 ${card("Monthly Fill Rate",`Apr–${d.current_month||"current"} · YTD through ${d.current_month||"—"}`,`<div id="homeTrend" class="chart"></div>`)}
 ${card("Delivery Status","Current filtered data",`<div id="statusChart" class="chart chart-sm"></div>`)}
 </div>
 <div class="section-gap grid two-col">
 ${card("Monthly Order & Invoice Qty","Operational volume",`<div id="volumeChart" class="chart"></div>`)}
 ${card("Current vs Previous vs YTD","Comparison uses current selected period",`<div class="table-wrap"><table><thead><tr><th>Metric</th><th>${esc(d.previous_month||"Previous")}</th><th>${esc(d.current_month||"Current")}</th><th>YTD</th></tr></thead><tbody>
 <tr><td>Order Qty</td><td class="num">${fmtN(d.previous?.order_qty)}</td><td class="num">${fmtN(d.current.order_qty)}</td><td class="num">${fmtN(d.ytd.order_qty)}</td></tr>
 <tr><td>Invoice Qty</td><td class="num">${fmtN(d.previous?.invoice_qty)}</td><td class="num">${fmtN(d.current.invoice_qty)}</td><td class="num">${fmtN(d.ytd.invoice_qty)}</td></tr>
 <tr><td>Fill Rate — Qty</td><td class="num">${fmtP(d.previous?.fr_qty)}</td><td class="num">${fmtP(d.current.fr_qty)}</td><td class="num">${fmtP(d.ytd.fr_qty)}</td></tr>
 <tr><td>Sale Loss</td><td class="num">${fmtL(d.previous?.sale_loss)}</td><td class="num">${fmtL(d.current.sale_loss)}</td><td class="num">${fmtL(d.ytd.sale_loss)}</td></tr>
 </tbody></table></div>`)}
 </div>`;
}
function renderHomeCharts(d){
 const months=d.monthly.map(x=>x.Month);
 chart("homeTrend",{...chartBase(),grid:{...chartBase().grid,bottom:44},xAxis:{type:"category",data:months},yAxis:{type:"value",min:0,max:100,name:"%"},series:[lineSeries("Qty Fill Rate",d.monthly.map(x=>x.fr_qty),"top"),lineSeries("Value Fill Rate",d.monthly.map(x=>x.fr_value),"bottom")]});
 chart("statusChart",{...chartBase(),legend:{show:false},tooltip:{...chartBase().tooltip,trigger:"item",formatter:p=>`${esc(p.name)}: ${fmtN(p.value)} (${p.percent}%)`},series:[{type:"pie",radius:["40%","66%"],center:["50%","52%"],avoidLabelOverlap:true,label:{show:true,color:"#3E3E3C",fontSize:10,formatter:p=>`${p.name}\n${fmtN(p.value)}`,lineHeight:13},labelLine:{length:10,length2:10},labelLayout:{moveOverlap:"shiftY"},data:d.status.map(x=>({name:x.status,value:x.count}))}]});
 chart("volumeChart",{...chartBase(),xAxis:{type:"category",data:months},yAxis:{type:"value"},series:[{name:"Order Qty",type:"bar",data:d.monthly.map(x=>x.order_qty),label:{show:true,position:"top",fontSize:9,color:"#3E3E3C",formatter:p=>fmtN(p.value)}},{name:"Invoice Qty",type:"bar",data:d.monthly.map(x=>x.invoice_qty),label:{show:true,position:"top",fontSize:9,color:"#3E3E3C",formatter:p=>fmtN(p.value)}}]});
}
async function homePage(myToken){
 $("#pageTitle").textContent="Executive Overview"; content.innerHTML=loading();
 const opts=await ensureOptions(); if(state.navToken!==myToken)return; const cm=opts._meta?.current_month;
 content.innerHTML=`<div id="filterMount"></div><div id="homeResults"></div>`;
 buildFilters(opts,()=>refreshHome(myToken),cm?{Month:[cm]}:{});
 await refreshHome(myToken);
}
async function refreshHome(myToken){
 const q=selectedParams().toString();
 $("#homeResults").innerHTML=loading();
 const d=await api("/api/overview"+(q?"?"+q:"")); if(state.navToken!==myToken)return;
 $("#homeResults").innerHTML=homeResultsHtml(d);
 renderHomeCharts(d);
}

// ---------- Fill Rate ----------
function fillResultsHtml(d){
 return `<div class="grid kpi-grid">
 ${kpi("Order Qty",fmtN(d.current.order_qty),d.current_month||"Current","O",deltaHtml(d.current.order_qty,d.previous?.order_qty))}
 ${kpi("Invoice Qty",fmtN(d.current.invoice_qty),d.current_month||"Current","I",deltaHtml(d.current.invoice_qty,d.previous?.invoice_qty))}
 ${kpi("Fill Rate — Qty",fmtP(d.current.fr_qty),"Current period","%")}
 ${kpi("Pending Qty",fmtN(d.current.pending_qty),"Order Qty − Invoice Qty","P")}
 </div>
 <div class="section-gap grid kpi-grid">
 ${kpi("Order Value",fmtC(d.current.order_value),d.current_month||"Current","₹")}
 ${kpi("Invoice Value",fmtC(d.current.invoice_value),d.current_month||"Current","₹")}
 ${kpi("Fill Rate — Value",fmtP(d.current.fr_value),"Current period","%")}
 ${kpi("Sale Loss",fmtL(d.current.sale_loss),"Current period","₹")}
 </div>
 <div class="section-gap grid two-col">
 ${card("Fill Rate Trend",`Current: ${d.current_month||"—"} · Previous: ${d.previous_month||"—"} · YTD through ${d.current_month||"—"}`,`<div id="fillTrend" class="chart"></div>`)}
 ${card("Customer Performance","Top customers by order quantity",`<div id="customerTable"></div>`)}
 </div>
 <div class="section-gap">${card("Category Performance","Sortable analytical view",`<div id="categoryTable"></div>`)}</div>`;
}
async function fillPage(myToken){
 $("#pageTitle").textContent="Fill Rate Performance"; content.innerHTML=loading();
 const opts=await ensureOptions(); if(state.navToken!==myToken)return; const cm=opts._meta?.current_month;
 content.innerHTML=`<div id="filterMount"></div><div id="fillResults"></div>`;
 buildFilters(opts,()=>refreshFillWithFilters(myToken),cm?{Month:[cm]}:{});
 await refreshFillWithFilters(myToken);
}
async function refreshFillWithFilters(myToken){
 const q=selectedParams().toString();
 $("#fillResults").innerHTML=loading();
 const d=await api("/api/fill-rate"+(q?"?"+q:"")); if(state.navToken!==myToken)return;
 $("#fillResults").innerHTML=fillResultsHtml(d);
 renderCustomer(d.customer); renderCategory(d.category);
 chart("fillTrend",{...chartBase(),grid:{...chartBase().grid,bottom:44},xAxis:{type:"category",data:d.monthly.map(x=>x.Month)},yAxis:{type:"value",min:0,max:100,name:"%"},series:[lineSeries("Qty Fill Rate",d.monthly.map(x=>x.fr_qty),"top"),lineSeries("Value Fill Rate",d.monthly.map(x=>x.fr_value),"bottom")]});
}
const CUST_ALL_COLS=["Customer Name","Orders","Order Qty","Invoice Qty","Fill Rate","Sale Loss"];
const CUST_FMT={"Fill Rate":fmtP,"Sale Loss":fmtL,"Order Qty":fmtN,"Invoice Qty":fmtN,"Orders":fmtN};
const CAT_ALL_COLS=["Category","Orders","Order Qty","Invoice Qty","Pending Qty","Fill Rate","Fill Rate Value","Sale Loss"];
const CAT_FMT={"Fill Rate":fmtP,"Fill Rate Value":fmtP,"Sale Loss":fmtL,"Order Qty":fmtN,"Invoice Qty":fmtN,"Pending Qty":fmtN,"Orders":fmtN};
function renderCustomer(rows){
 state._custRows=rows||[];
 const mapped=state._custRows.map(r=>({["Customer Name"]:r["Customer Name"],Orders:r.order_count,"Order Qty":r.order_qty,"Invoice Qty":r.invoice_qty,"Fill Rate":r.fill_rate,"Sale Loss":r.sale_loss}));
 if(!state.tableSort.cust)state.tableSort.cust={col:null,dir:null};
 const sorted=withSort(mapped,state.tableSort.cust);
 const host=$("#customerTable");
 host.innerHTML=`<div class="table-tools" style="padding:0 16px 10px;justify-content:flex-end">${columnButton(CUST_ALL_COLS,state.custCols,"custColumnWrap")}</div>`+table(sorted,{columns:state.custCols,id:"custTbl",sortState:state.tableSort.cust,formatters:CUST_FMT});
 wireColumns(host,c=>{state.custCols=c;renderCustomer(state._custRows)});
 wireSort(host,"cust",()=>renderCustomer(state._custRows));
}
function renderCategory(rows){
 state._catRows=rows||[];
 const mapped=state._catRows.map(r=>({Category:r.Category,Orders:r.orders,"Order Qty":r.order_qty,"Invoice Qty":r.invoice_qty,"Pending Qty":r.pending_qty,"Fill Rate":r.fr_qty,"Fill Rate Value":r.fr_value,"Sale Loss":r.sale_loss}));
 if(!state.tableSort.cat)state.tableSort.cat={col:null,dir:null};
 const sorted=withSort(mapped,state.tableSort.cat);
 const host=$("#categoryTable");
 host.innerHTML=`<div class="table-tools" style="padding:0 16px 10px;justify-content:flex-end">${columnButton(CAT_ALL_COLS,state.catCols,"catColumnWrap")}</div>`+table(sorted,{columns:state.catCols,id:"catTbl",sortState:state.tableSort.cat,formatters:CAT_FMT});
 wireColumns(host,c=>{state.catCols=c;renderCategory(state._catRows)});
 wireSort(host,"cat",()=>renderCategory(state._catRows));
}

// ---------- Order Tracking (hidden from nav for now, code kept intact) ----------
async function ordersPage(myToken){
 $("#pageTitle").textContent="Order Tracking";content.innerHTML=loading();const o=await api("/api/order-options");if(state.navToken!==myToken)return;state.orderCols=o.default;
 const opts=await ensureOptions(); if(state.navToken!==myToken)return; const cm=opts._meta?.current_month;
 content.innerHTML=`<div id="filterMount"></div><div class="card"><div class="toolbar"><input class="searchbox" id="osearch" placeholder="Search Order ID, AWB, Customer, SRO…"><button class="btn-secondary" id="osearchBtn">Search</button><div id="orderColumns">${columnButton(o.columns,o.default,"orderColumnWrap")}</div><a class="btn-primary" id="exportOrders" href="#">Export CSV</a></div><div id="orderBody">${loading()}</div></div>`;
 buildFilters(opts,()=>loadOrders(0,myToken),cm?{Month:[cm]}:{});
 wireColumns(document.querySelector("#orderColumns"),cols=>{state.orderCols=cols;loadOrders(0,myToken)});
 $("#osearchBtn").onclick=()=>loadOrders(0,myToken);$("#osearch").onkeydown=e=>{if(e.key==="Enter")loadOrders(0,myToken)};
 $("#exportOrders").onclick=e=>{e.preventDefault();const p=selectedParams();p.set("search",$("#osearch").value||"");state.orderCols.forEach(c=>p.append("columns",c));window.location="/api/orders.csv?"+p.toString()};
 await loadOrders(0,myToken);
}
async function loadOrders(offset=0,myToken){
 const p=selectedParams();p.set("search",$("#osearch")?.value||"");p.set("limit","100");p.set("offset",String(offset));state.orderCols.forEach(c=>p.append("columns",c));
 const d=await api("/api/orders?"+p.toString()); if(myToken!==undefined&&state.navToken!==myToken)return;
 $("#orderBody").innerHTML=`<div class="count-line"><b>${fmtN(d.total)}</b> orders found · showing ${d.rows.length} · page ${Math.floor(d.offset/d.limit)+1}</div>`+table(d.rows,{clickable:true,columns:d.columns,id:"ordersTable"})+`<div class="pagination"><span>${d.offset+1}-${Math.min(d.offset+d.rows.length,d.total)} of ${d.total}</span><div class="page-buttons"><button id="prev" ${d.offset<=0?"disabled":""}>← Prev</button><button id="next" ${d.offset+d.limit>=d.total?"disabled":""}>Next →</button></div></div>`;
 $("#prev")?.addEventListener("click",()=>loadOrders(Math.max(0,d.offset-d.limit),myToken));$("#next")?.addEventListener("click",()=>loadOrders(d.offset+d.limit,myToken));
 const otbl=document.getElementById("ordersTable");
 if(otbl)otbl.querySelector("tbody").onclick=e=>{
  const tr=e.target.closest("tr"); if(!tr)return;
  const idx=[...tr.parentNode.children].indexOf(tr);
  showOrder(d.rows[idx]?.["Order Id"]);
 };
}
async function showOrder(id){
 if(!id)return;try{const d=await api("/api/order/"+encodeURIComponent(id));const body=table([d.order]);const items=table(d.items||[]);$("#modal-root").innerHTML=`<div class="modal-backdrop"><div class="modal"><div class="modal-head"><div><div class="modal-title">Order ${esc(id)}</div><div class="card-sub">Order details and line items</div></div><button class="modal-close" id="modalClose">Close</button></div><div class="modal-body"><div class="section-gap">${body}</div><div class="section-gap">${card("Line Items","Up to 300 lines",items)}</div></div></div></div>`;$("#modalClose").onclick=()=>$("#modal-root").innerHTML=""}catch(e){toast(e.message,true)}
}

// ---------- Cancelled Orders ----------
async function cancelledPage(myToken){
 $("#pageTitle").textContent="Cancelled Orders"; content.innerHTML=loading();
 const opts=await ensureOptions(); if(state.navToken!==myToken)return; const cm=opts._meta?.current_month;
 const d0=await api("/api/cancelled"); if(state.navToken!==myToken)return; // learn the full column set + full reason-term list (no filters applied)
 state.cancelCols=d0.columns; state.cancelTerms=d0.terms;
 content.innerHTML=`<div id="filterMount"></div><div class="card"><div class="toolbar"><input class="searchbox" id="csearch" placeholder="Search cancelled orders…"><button class="btn-secondary" id="cbtn">Search</button><div id="cancelColumns">${columnButton(["Order Id","Customer Name","Order Received Date","Order Qty","Order Value","AWB NUMBER","COURIER","Final Remarks","Wh. Remarks","Month"],state.cancelCols,"cancelColumnWrap")}</div></div>
 <div class="term-picker"><span class="filter-label">Cancellation reasons</span><div class="term-list" id="cancelTermList">${state.cancelTerms.map(t=>`<label class="term-chip"><input type="checkbox" value="${esc(t)}" checked><span>${esc(t)}</span></label>`).join("")}</div></div>
 <div id="cancelBody"></div></div>`;
 buildFilters(opts,()=>loadCancelled(myToken),cm?{Month:[cm]}:{});
 wireColumns(document.querySelector("#cancelColumns"),c=>{state.cancelCols=c;loadCancelled(myToken)});
 document.querySelectorAll("#cancelTermList input").forEach(x=>x.onchange=()=>loadCancelled(myToken));
 $("#cbtn").onclick=()=>loadCancelled(myToken);$("#csearch").onkeydown=e=>{if(e.key==="Enter")loadCancelled(myToken)};
 await loadCancelled(myToken);
}
async function loadCancelled(myToken){
 const p=selectedParams(); p.set("search",$("#csearch").value||"");
 state.cancelCols.forEach(c=>p.append("columns",c));
 [...document.querySelectorAll("#cancelTermList input:checked")].forEach(x=>p.append("term",x.value));
 const d=await api("/api/cancelled?"+p.toString()); if(myToken!==undefined&&state.navToken!==myToken)return;
 state._cancelData=d;
 renderCancelledTable();
}
function renderCancelledTable(){
 const d=state._cancelData; if(!d)return;
 if(!state.tableSort.cancel)state.tableSort.cancel={col:null,dir:null};
 const sorted=withSort(d.rows,state.tableSort.cancel);
 const host=$("#cancelBody");
 host.innerHTML=`<div class="count-line"><b>${fmtN(d.total)}</b> cancelled orders · matching terms: ${d.terms.map(esc).join(", ")}</div>`+table(sorted,{columns:d.columns,id:"cancelTbl",sortState:state.tableSort.cancel});
 wireSort(host,"cancel",renderCancelledTable);
}

// ---------- Fill Rate Explorer (N-level drill-down) ----------
const DIM_LABELS_JS={chain:"Chain",shop:"Shop",category:"Category",product:"Product"};
// Fill-rate performance bands used by the summary chips. Shared by the chip
// render (counts) and the click-to-filter logic (which rows to keep) so the
// two never drift apart.
const FR_BUCKETS=[{key:"100",label:"100%+",test:v=>v>=100,cls:"ok"},{key:"70",label:"70–100%",test:v=>v>=70&&v<100,cls:"ok"},{key:"50",label:"50–70%",test:v=>v>=50&&v<70,cls:"warn"},{key:"0",label:"0–50%",test:v=>v<50,cls:"danger"}];
const EXPLORER_ALL_COLS=["Label","Value","Orders","Order Qty","Invoice Qty","Fill Rate"];
const EXPLORER_DEFAULT_COLS=["Label","Orders","Order Qty","Invoice Qty","Fill Rate"];
const EXPLORER_FMT={"Order Qty":fmtN,"Invoice Qty":fmtN,"Orders":fmtN,"Fill Rate":fmtP};
async function explorerPage(myToken){
 $("#pageTitle").textContent="Fill Rate Explorer";
 state.explorerScope={}; state.explorerLabels={}; state.explorerBy="chain"; state.explorerBucket=null;
 content.innerHTML=loading();
 const opts=await ensureOptions(); if(state.navToken!==myToken)return; const cm=opts._meta?.current_month;
 content.innerHTML=`<div id="filterMount"></div><div class="card">
  <div id="explorerCrumbs" class="count-line"></div>
  <div class="explorer-toolbar" id="explorerPills"></div>
  <div id="explorerSummary"></div>
  <div id="explorerChart" class="chart"></div>
  <div id="explorerTable"></div>
 </div>`;
 buildFilters(opts,()=>loadExplorerLevel(myToken),cm?{Month:[cm]}:{});
 await loadExplorerLevel(myToken);
}
async function loadExplorerLevel(myToken){
 $("#explorerTable").innerHTML=loading();
 const p=selectedParams(); p.set("by",state.explorerBy); p.set("scope",JSON.stringify(state.explorerScope)); p.set("limit","200");
 try{
  const d=await api("/api/explorer/breakdown?"+p.toString()); if(myToken!==undefined&&state.navToken!==myToken)return;
  state.explorerData=d;
  renderExplorerCrumbs(d); renderExplorerPills(d); renderExplorerSummary(d); renderExplorer(d);
 }catch(e){if(myToken===undefined||state.navToken===myToken)$("#explorerTable").innerHTML=`<div class="error">${esc(e.message)}</div>`}
}
// Rows currently on screen after the active fill-rate bucket filter (if any).
// Table + chart read through this; the summary chips always count against
// the full unfiltered set so their numbers don't shift as you filter.
function explorerVisibleRows(d){
 const rows=d.rows||[];
 if(!state.explorerBucket)return rows;
 const bucket=FR_BUCKETS.find(b=>b.key===state.explorerBucket);
 return bucket?rows.filter(r=>r.fill_rate!=null&&bucket.test(Number(r.fill_rate))):rows;
}
// Fill-rate distribution: how many of the current breakdown's rows fall into
// each performance band. Recomputed from whatever's on screen right now, so
// it always matches the active filters/scope/level.
function renderExplorerSummary(d){
 const rows=d.rows||[];
 const el=document.getElementById("explorerSummary");
 if(!el)return;
 if(!rows.length){el.innerHTML="";return}
 const counts=FR_BUCKETS.map(b=>({...b,count:rows.filter(r=>r.fill_rate!=null&&b.test(Number(r.fill_rate))).length}));
 const total=rows.length;
 el.innerHTML=`<div class="fr-summary">${counts.map(c=>`<div class="fr-chip fr-${c.cls}${state.explorerBucket===c.key?" fr-chip-active":""}" data-bucket="${c.key}" style="cursor:pointer"><b>${c.count}</b><span>${esc(c.label)}</span><i>${total?Math.round(c.count/total*100):0}%</i></div>`).join("")}<div class="fr-summary-note">${state.explorerBucket?`showing ${DIM_LABELS_JS[state.explorerBy]||state.explorerBy} rows in ${esc(counts.find(c=>c.key===state.explorerBucket)?.label||"")} · <a href="#" id="explorerBucketClear" style="color:var(--accent)">clear</a>`:`of ${fmtN(total)} ${DIM_LABELS_JS[state.explorerBy]||state.explorerBy} rows shown`}</div></div>`;
 el.querySelectorAll(".fr-chip").forEach(chip=>chip.onclick=()=>{
  const key=chip.dataset.bucket;
  state.explorerBucket=state.explorerBucket===key?null:key;
  renderExplorerSummary(state.explorerData);
  renderExplorer(state.explorerData);
 });
 const clear=document.getElementById("explorerBucketClear");
 if(clear)clear.onclick=e=>{e.preventDefault();state.explorerBucket=null;renderExplorerSummary(state.explorerData);renderExplorer(state.explorerData)};
}
function renderExplorerCrumbs(d){
 const entries=Object.entries(state.explorerScope);
 const parts=[`<span class="crumb${entries.length===0?" crumb-active":""}" data-idx="-1">All</span>`];
 entries.forEach(([dim,val],i)=>{
  parts.push(`<span class="crumb-sep">›</span><span class="crumb${i===entries.length-1?" crumb-active":""}" data-idx="${i}">${esc(state.explorerLabels[dim]||val)}</span>`);
 });
 $("#explorerCrumbs").innerHTML=`<b>${fmtN((d.rows||[]).length)}</b> groups&nbsp;&nbsp;${parts.join("")}`;
 $("#explorerCrumbs").querySelectorAll(".crumb[data-idx]").forEach(el=>el.onclick=()=>{
  const idx=Number(el.dataset.idx); const keys=Object.keys(state.explorerScope);
  if(idx===keys.length-1)return;
  const newScope={}; keys.slice(0,idx+1).forEach(k=>newScope[k]=state.explorerScope[k]);
  state.explorerScope=newScope;
  const order=["chain","shop","category","product"];
  state.explorerBy=order.find(x=>!(x in newScope))||"chain";
  state.explorerBucket=null;
  loadExplorerLevel();
 });
}
function renderExplorerPills(d){
 const avail=d.available&&d.available.length?d.available:["chain","shop","category","product"];
 const rows=d.rows||[];
 const pillsHtml=avail.map(dim=>`<button class="lens-btn${dim===state.explorerBy?" active":""}" data-dim="${dim}">${DIM_LABELS_JS[dim]||dim}</button>`).join("");
 const dimLabel=DIM_LABELS_JS[state.explorerBy]||state.explorerBy;
 const selectHtml=rows.length?`<select id="explorerValueSelect" style="margin-left:auto;min-height:33px;border:1px solid var(--line);border-radius:6px;padding:6px 8px;background:#fff;color:var(--text2);font-size:11px;max-width:220px">
   <option value="">All ${esc(dimLabel.toLowerCase())}</option>
   ${rows.map(r=>`<option value="${esc(r.value)}">${esc(r.label)}</option>`).join("")}
 </select>`:"";
 $("#explorerPills").innerHTML=pillsHtml+selectHtml;
 $("#explorerPills").querySelectorAll(".lens-btn").forEach(b=>b.onclick=()=>{state.explorerBy=b.dataset.dim;state.explorerBucket=null;loadExplorerLevel()});
 const sel=document.getElementById("explorerValueSelect");
 if(sel)sel.onchange=()=>{
  const val=sel.value; if(!val)return;
  const row=rows.find(r=>String(r.value)===val); if(!row)return;
  drillInto({Value:row.value,Label:row.label});
 };
}
// Scope the explorer down to one specific value of the current dimension
// (via a table-row click or the value dropdown) and move to the next level.
function drillInto(row){
 state.explorerScope={...state.explorerScope,[state.explorerBy]:row.Value};
 state.explorerLabels={...state.explorerLabels,[state.explorerBy]:row.Label};
 const pref=["shop","product","category","chain"].filter(x=>!(x in state.explorerScope));
 if(!pref.length){toast("No further breakdown available for this combination.",false);return}
 state.explorerBy=pref[0];
 state.explorerBucket=null;
 loadExplorerLevel();
}
function renderExplorer(d){
 const rawRows=explorerVisibleRows(d);
 const key="explorer_"+state.explorerBy; // columns/sort persist per dimension (chain/shop/category/product),
 // so leaving a level and coming back (e.g. via breadcrumb) keeps your choices.
 if(!(key in state.explorerCols))state.explorerCols[key]=[...EXPLORER_DEFAULT_COLS];
 if(!(key in state.tableSort))state.tableSort[key]={col:null,dir:null};
 const mapped=rawRows.map(r=>({Label:r.label,Value:r.value,Orders:r.orders,"Order Qty":r.order_qty,"Invoice Qty":r.invoice_qty,"Fill Rate":r.fill_rate}));
 const cols=state.explorerCols[key]; const sort=state.tableSort[key];
 const sorted=withSort(mapped,sort);
 const hint=Object.keys(state.explorerScope).length?"click a row to break it down further ↳":"click any row to drill down ↳";
 const toolbar=`<div class="table-tools" style="padding:10px 16px;justify-content:space-between;flex-wrap:wrap;gap:8px"><span style="color:var(--accent);font-size:11px">${hint}</span>${columnButton(EXPLORER_ALL_COLS,cols,key+"_colwrap")}</div>`;
 const host=$("#explorerTable");
 host.innerHTML=mapped.length?toolbar+table(sorted,{clickable:true,columns:cols,id:"explorerTableData",sortState:sort,formatters:EXPLORER_FMT}):toolbar+empty("No groups available for this breakdown.");
 wireColumns(host,c=>{state.explorerCols[key]=c;renderExplorer(d)});
 wireSort(host,key,()=>renderExplorer(d));
 renderExplorerChart(rawRows);
 const tbl=document.getElementById("explorerTableData");
 if(tbl)tbl.querySelector("tbody").onclick=e=>{
  const tr=e.target.closest("tr"); if(!tr)return;
  const idx=[...tr.parentNode.children].indexOf(tr); const row=sorted[idx]; if(!row)return;
  drillInto(row);
 };
}
// Horizontal bar chart: avoids the rotated-label cutoff/overlap that a vertical
// bar chart gets into once category names are long or there are many of them —
// each row gets its own line, so nothing needs to be squeezed or rotated.
function renderExplorerChart(rows){
 const top=rows.slice(0,20).slice().reverse(); // reverse so the #1 row ends up nearest the top of the chart
 const el=document.getElementById("explorerChart");
 if(el)el.style.height=Math.max(320,top.length*28+70)+"px";
 chart("explorerChart",{
  ...chartBase(),
  legend:{show:false},
  grid:{left:10,right:60,top:20,bottom:20,containLabel:true},
  tooltip:{...chartBase().tooltip,trigger:"axis",axisPointer:{type:"shadow"}},
  yAxis:{type:"category",data:top.map(x=>x.label),axisLabel:{color:"#3E3E3C",fontSize:10,formatter:v=>v&&v.length>26?v.slice(0,25)+"…":v}},
  xAxis:{type:"value",min:0,max:100},
  series:[{name:"Fill Rate",type:"bar",data:top.map(x=>x.fill_rate),label:{show:true,position:"right",formatter:p=>p.value==null?"":Number(p.value).toFixed(1)+"%",fontSize:9,color:"#3E3E3C"}}]
 });
}

// ---------- Stock Gap ----------
async function stockPage(myToken){
 $("#pageTitle").textContent="Stock Gap";content.innerHTML=`<div class="card"><div class="card-head"><div><div class="card-title">Stock vs Order Comparison</div><div class="card-sub">Choose the order-file columns explicitly. Headers are read before any comparison runs.</div></div></div><div class="stock-controls">
 <div class="control"><label>Order file</label><input type="file" id="stockFile" accept=".xlsx,.xls,.csv"></div>
 <div class="control"><label>Header row #</label><input type="number" id="sheader" value="1" min="1" style="min-height:39px"></div>
 <div class="control"><label>Location</label><select id="sloc"><option>Ahmedabad</option><option>Bangalore</option></select></div>
 <div class="control"><label>Match mode</label><select id="smode"><option value="EAN">EAN / SKU</option><option value="Product Name">Product Name</option></select></div>
 <div class="control"><label>Order key column</label><select id="skey" disabled><option>Select file first</option></select></div>
 <div class="control"><label>Order quantity column</label><select id="sqty" disabled><option>Select file first</option></select></div>
 <div class="run"><button class="btn-primary" id="runStock" disabled>Run Comparison</button></div>
 </div><div class="help" id="stockHelp">If no file is selected, the attached local Order File.xlsx is used. Selecting a file will automatically load its actual headers.</div>
 <div id="stockPreviewWrap"></div></div>
 <div class="section-gap grid two-col"><div class="card"><div class="card-head"><div><div class="card-title">Result</div><div class="card-sub" id="stockSummary">Waiting for comparison</div></div><div id="stockColumns"></div></div><div id="stockTable"></div></div><div class="card"><div class="card-head"><div><div class="card-title">Gap Analysis</div><div class="card-sub">Order quantity vs available stock</div></div></div><div id="stockChart" class="chart"></div></div></div>`;
 const file=$("#stockFile");file.onchange=()=>loadStockHeaders(file.files[0],myToken);
 $("#smode").onchange=()=>loadStockHeaders(file.files[0],myToken);
 $("#sheader").onchange=()=>loadStockHeaders(file.files[0],myToken);
 $("#runStock").onclick=runStock;
 await loadStockHeaders(null,myToken);
}
async function loadStockHeaders(file,myToken){
 const fd=new FormData();if(file)fd.append("file",file);fd.append("header_row",$("#sheader").value||"1");fd.append("match_mode",$("#smode").value||"EAN");
 try{
  const d=await api("/api/stock-columns",{method:"POST",body:fd});
  if(myToken!==undefined&&state.navToken!==myToken)return;
  // Always populate with EVERY column in the file — never a filtered
  // subset — so any real-world header name is selectable. The backend
  // only suggests which one to pre-select.
  fillSelect($("#skey"),d.columns,d.default_key_col);
  fillSelect($("#sqty"),d.columns,d.default_qty_col);
  $("#runStock").disabled=false;
  $("#stockHelp").textContent=`${d.filename}: ${d.row_count.toLocaleString("en-IN")} rows, ${d.columns.length} columns detected. Review the key and quantity selections, then run the comparison.`;
  const prev=d.preview||[];
  $("#stockPreviewWrap").innerHTML=prev.length?`<div class="section-gap" style="padding:0 17px 14px"><details><summary style="cursor:pointer;color:var(--accent);font-size:11px;font-weight:700">🔍 Preview loaded data (first ${prev.length} rows, ${d.columns.length} columns) — check this matches what you expect</summary><div style="margin-top:8px">${table(prev)}</div></details></div>`:"";
 }
 catch(e){if(myToken===undefined||state.navToken===myToken){$("#runStock").disabled=true;toast(e.message,true)}}
}
function fillSelect(sel,vals,preferred){
 const idx=preferred&&vals.includes(preferred)?vals.indexOf(preferred):0;
 sel.innerHTML=vals.map((v,i)=>`<option value="${esc(v)}" ${i===idx?"selected":""}>${esc(v)}</option>`).join("");
 sel.disabled=false; // BUG FIX: the <select> starts with the `disabled` attribute in
 // the markup (so it's visibly inert before a file loads); previously nothing ever
 // cleared that attribute once headers arrived, so the dropdown stayed unclickable
 // forever even after being populated. This was the "can't click / no list shows" bug.
}
const STOCK_ALL_COLS=["Key","Product","Order Qty","Stock","Gap","Status"];
const STOCK_FMT={"Order Qty":fmtN,"Stock":fmtN,"Gap":fmtN};
function renderStockTable(){
 const raw=state.lastStockRows||[];
 const statusFilter=state.stockStatusFilter||"All";
 const search=(state.stockSearch||"").toLowerCase();
 let filtered=raw;
 if(statusFilter!=="All")filtered=filtered.filter(r=>r.status===statusFilter);
 if(search)filtered=filtered.filter(r=>String(r.product||"").toLowerCase().includes(search)||String(r.key||"").toLowerCase().includes(search));
 const rows=filtered.map(r=>({Key:r.key,Product:r.product,"Order Qty":r.order_qty,Stock:r.stock,Gap:r.gap,Status:r.status}));
 if(!state.tableSort.stock)state.tableSort.stock={col:null,dir:null};
 const sorted=withSort(rows,state.tableSort.stock);
 const counts={}; raw.forEach(r=>counts[r.status]=(counts[r.status]||0)+1);
 const statuses=["All",...Object.keys(counts)];
 const chips=statuses.map(s=>`<button class="status-chip${statusFilter===s?" active":""}" data-status="${esc(s)}">${esc(s)} (${s==="All"?raw.length:counts[s]||0})</button>`).join("");
 const host=$("#stockTable");
 host.innerHTML=`<div class="table-tools" style="flex-wrap:wrap;gap:8px"><div class="status-chips">${chips}</div><input class="searchbox" id="stockSearch" placeholder="Search product or key…" value="${esc(state.stockSearch||"")}" style="max-width:220px"></div>`+table(sorted,{columns:state.stockCols,id:"stockTbl",emptyMsg:raw.length?"No rows match this filter":"Run a comparison to see results",sortState:state.tableSort.stock,formatters:STOCK_FMT});
 wireSort(host,"stock",renderStockTable);
 host.querySelectorAll(".status-chip").forEach(b=>b.onclick=()=>{state.stockStatusFilter=b.dataset.status;renderStockTable()});
 const sBox=host.querySelector("#stockSearch");
 if(sBox){
  sBox.oninput=()=>{state.stockSearch=sBox.value;renderStockTable()};
  sBox.focus(); sBox.setSelectionRange(sBox.value.length,sBox.value.length); // re-render replaces the DOM node each keystroke, so restore focus/cursor
 }
}
async function runStock(){
 const fd=new FormData();const f=$("#stockFile").files[0];if(f)fd.append("file",f);fd.append("key_col",$("#skey").value);fd.append("qty_col",$("#sqty").value);fd.append("match_mode",$("#smode").value);fd.append("location",$("#sloc").value);fd.append("header_row",$("#sheader").value||"1");
 $("#stockTable").innerHTML=loading();try{
  const d=await api("/api/stock-gap",{method:"POST",body:fd});
  $("#stockSummary").textContent=`${fmtN(d.total)} rows processed`;
  state.lastStockRows=d.rows||[];
  state.stockStatusFilter="All"; state.stockSearch="";
  $("#stockColumns").innerHTML=columnButton(STOCK_ALL_COLS,state.stockCols,"stockColumnWrap");
  wireColumns($("#stockColumns"),c=>{state.stockCols=c;renderStockTable()});
  renderStockTable();
  const counts={};state.lastStockRows.forEach(r=>counts[r.status]=(counts[r.status]||0)+1);
  chart("stockChart",{...chartBase(),xAxis:{type:"category",data:Object.keys(counts)},yAxis:{type:"value"},series:[{type:"bar",data:Object.values(counts),label:{show:true,position:"top",color:"#3E3E3C",formatter:p=>fmtN(p.value)}}]})
 }catch(e){$("#stockTable").innerHTML=`<div class="error">${esc(e.message)}</div>`}
}

async function navigate(page){
 const myToken=++state.navToken; // any async page work that resolves after we've
 // navigated elsewhere checks this and bails out instead of writing into DOM
 // that a later page has already replaced (this was the "Cannot set properties
 // of null" crash — a stale page's fetch finishing after you'd already clicked
 // to a different tab).
 state.page=page;state.charts.forEach(c=>{try{c.dispose()}catch(e){}});state.charts=[];
 document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.page===page));
 try{if(page==="home")await homePage(myToken);else if(page==="orders")await ordersPage(myToken);else if(page==="stock")await stockPage(myToken);else if(page==="cancelled")await cancelledPage(myToken);else if(page==="fill")await fillPage(myToken);else if(page==="explorer")await explorerPage(myToken)}catch(e){if(state.navToken===myToken)content.innerHTML=`<div class="error">${esc(e.message)}</div>`}
}
document.querySelectorAll(".nav-item").forEach(b=>b.onclick=()=>navigate(b.dataset.page));
$("#refresh").onclick=async()=>{try{await api("/api/refresh",{method:"POST"});state.optionsCache=null;await sourceInfo();await navigate(state.page);toast("Data cache refreshed")}catch(e){toast(e.message,true)}};
window.addEventListener("resize",()=>state.charts.forEach(c=>{try{c.resize()}catch(e){}}));
sourceInfo();navigate("home");