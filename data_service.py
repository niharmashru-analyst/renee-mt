from __future__ import annotations
import io, os, re, threading, time
from pathlib import Path
from typing import Any
import numpy as np
import pandas as pd
import requests

ROOT=Path(__file__).resolve().parents[1]
DATA_DIR=ROOT/"data"
MONTH_ORDER=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]

CONFIG={
 "customer":"Customer Name","category":"Category","channel":"Channel","zone":"Zone","name":"Name",
 "order_category":"Order Category","db_code":"DB Code","final_remarks":"Final Remarks",
 "order_id":"Order Id","order_qty":"Order Qty","order_value":"Order Value","invoice_qty":"Invoice Qty",
 "invoice_value":"Invoice Value","invoice_number":"InvoiceNumber","sale_loss":"Sale Loss",
 "order_received_date":"Order Received Date","invoice_date":"Invoice Date","delivery_status":"Delivery Status",
 "actual_delivery_days":"Actual Deli. Days","awb":"AWB NUMBER","courier":"COURIER","wh_remarks":"Wh. Remarks",
}
ITEMS_CONFIG={
 "doc_no":"Document No.","order_date":"Order Date","customer":"Customer Name","gtin":"GTIN",
 "description":"Description","order_qty":"Order Qty","order_value":"Order Amt. Exc. GST","invoice_qty":"Invoice Qty",
 "invoice_value":"Invoice Amt. Exc. GST","invoice_no":"Invoice No.",
}
CANCEL_TERMS=["Order below 7k","Below 7k Value Cancel","Cancel Under 5K Value","Low Qty Not Processed","Out Of Stock"]

class DataError(Exception): pass

class Cache:
 def __init__(self): self._data={}; self._lock=threading.Lock()
 def get(self,key,loader,ttl=None,force=False):
  ttl=ttl if ttl is not None else int(os.getenv("CACHE_TTL_SECONDS","300"))
  now=time.time()
  with self._lock:
   hit=self._data.get(key)
   if hit and not force and now-hit[0]<ttl: return hit[1]
  value=loader()
  with self._lock: self._data[key]=(time.time(),value)
  return value
 def clear(self):
  with self._lock: self._data.clear()
CACHE=Cache()

def json_safe(value:Any):
 if isinstance(value,dict): return {str(k):json_safe(v) for k,v in value.items()}
 if isinstance(value,(list,tuple)): return [json_safe(v) for v in value]
 if isinstance(value,pd.Timestamp): return value.isoformat() if not pd.isna(value) else None
 if isinstance(value,(np.integer,)): return int(value)
 if isinstance(value,(np.floating,)): return None if np.isnan(value) else float(value)
 if isinstance(value,(np.bool_,)): return bool(value)
 if value is pd.NaT: return None
 if isinstance(value,float) and np.isnan(value): return None
 try:
  if pd.isna(value): return None
 except Exception: pass
 return value

def _url(key): return os.getenv(key,"").strip()
def _local(name): return DATA_DIR/name

def _download(url:str)->bytes:
 if not url: raise DataError("Source URL is not configured.")
 sep="&" if "?" in url else "?"
 try: r=requests.get(url+("" if "download=1" in url else sep+"download=1"),timeout=60)
 except requests.RequestException as e: raise DataError(f"Could not reach SharePoint: {e}")
 if r.status_code!=200: raise DataError(f"SharePoint returned HTTP {r.status_code}. Check the sharing link.")
 return r.content

def _source_bytes(env_key,filename):
 url=_url(env_key)
 if url:return _download(url),"SharePoint"
 p=_local(filename)
 if not p.exists():raise DataError(f"Local source file is missing: {p}")
 return p.read_bytes(),"Local file"

def _clean_num(s):
 return pd.to_numeric(s.astype(str).str.replace(",","",regex=False).str.replace("₹","",regex=False).str.replace("%","",regex=False).str.strip().replace({"":np.nan,"nan":np.nan,"None":np.nan,"-":np.nan}),errors="coerce")

def _norm(x):
 if pd.isna(x): return ""
 s=str(x).strip()
 if s.endswith(".0"):
  try:s=str(int(float(s)))
  except:pass
 return s.lower()

def _rename(df,mapping):
 out=df.copy(); lookup={str(c).strip().lower():c for c in out.columns}; ren={}
 for target in mapping.values():
  if target in out.columns:continue
  src=lookup.get(str(target).strip().lower())
  if src is not None:ren[src]=target
 return out.rename(columns=ren)

def _json_records(df):
 if df is None or df.empty:return []
 return json_safe(df.astype(object).where(pd.notna(df),None).to_dict("records"))

def source_status():
 return {
  "dispatch":"SharePoint" if _url("SHAREPOINT_EXCEL_URL") else ("Local file" if _local("Dispatch Tracker.xlsx").exists() else "Missing"),
  "items":"SharePoint" if _url("SHAREPOINT_ORDER_ITEMS_URL") else ("Local file" if _local("SKU Wise Dispatch Tracker.xlsx").exists() else "Missing"),
  "stock":"SharePoint" if _url("STOCK_EXCEL_URL") else ("Local file" if _local("Stock File.xlsx").exists() else "Missing"),
  "stock_gap_order":"SharePoint" if _url("STOCK_ORDER_EXCEL_URL") else ("Local file" if _local("Order File.xlsx").exists() else "Missing"),
 }

def load_dispatch(force=False):
 def loader():
  raw,source=_source_bytes("SHAREPOINT_EXCEL_URL","Dispatch Tracker.xlsx")
  wb=pd.read_excel(io.BytesIO(raw),sheet_name=None)
  frames=[]
  for s,df in wb.items():
   s=str(s).strip()
   if s not in MONTH_ORDER or df is None or df.empty:continue
   d=_rename(df,CONFIG); d["Month"]=s; frames.append(d)
  if not frames:raise DataError("No monthly sheets (Jan-Dec) found in the dispatch workbook.")
  df=pd.concat(frames,ignore_index=True,sort=False)
  for k in ["order_qty","order_value","invoice_qty","invoice_value","sale_loss","actual_delivery_days"]:
   c=CONFIG[k]
   if c in df:df[c]=_clean_num(df[c])
  for k in ["order_received_date","invoice_date"]:
   c=CONFIG[k]
   if c in df:df[c]=pd.to_datetime(df[c],errors="coerce",dayfirst=True)
  df["__month_sort"]=df["Month"].map(lambda x:MONTH_ORDER.index(x) if x in MONTH_ORDER else 999)
  df.attrs["source"]=source
  return df.sort_values(["__month_sort"]).reset_index(drop=True)
 return CACHE.get("dispatch",loader,force=force)

def load_items(force=False):
 def loader():
  raw,source=_source_bytes("SHAREPOINT_ORDER_ITEMS_URL","SKU Wise Dispatch Tracker.xlsx")
  df=pd.read_excel(io.BytesIO(raw)); df=_rename(df,ITEMS_CONFIG)
  for k in ["order_qty","order_value","invoice_qty","invoice_value"]:
   c=ITEMS_CONFIG[k]
   if c in df:df[c]=_clean_num(df[c])
  df.attrs["source"]=source; return df
 return CACHE.get("items",loader,force=force)

def load_stock(force=False):
 def loader():
  raw,source=_source_bytes("STOCK_EXCEL_URL","Stock File.xlsx")
  wb=pd.read_excel(io.BytesIO(raw),sheet_name=None,header=0); combined={}
  for s,df in wb.items():
   if df is None or df.empty:continue
   df.columns=[str(c).strip() for c in df.columns]
   if len(df.columns)<2:continue
   ean_col=df.columns[0]; name_col=df.columns[1]; cols={str(c).strip().lower():c for c in df.columns}
   mwh=cols.get("mwh stock") or cols.get("mwh stock ")
   blr=cols.get("direct shelf blr"); uc=cols.get("uc inventory")
   for _,r in df.iterrows():
    key=_norm(r[ean_col])
    if not key:continue
    row=combined.setdefault(key,{"ean":str(r[ean_col]).strip(),"product":str(r[name_col]).strip() if pd.notna(r[name_col]) else "","mwh":0.0,"blr":0.0,"uc":0.0})
    for k,c in [("mwh",mwh),("blr",blr),("uc",uc)]:
     if c:
      v=pd.to_numeric(r[c],errors="coerce"); row[k]+=0 if pd.isna(v) else float(v)
  out=pd.DataFrame(list(combined.values())); out.attrs["source"]=source; return out
 return CACHE.get("stock",loader,force=force)

def apply_filters(df,filters):
 out=df
 for c,vals in (filters or {}).items():
  if vals and c in out.columns:out=out[out[c].astype(str).isin([str(v) for v in vals])]
 return out

def search_df(df,search):
 if not search:return df
 cols=[c for c in ["Order Id","AWB NUMBER","InvoiceNumber","Customer Name","External Document No.","SRO Number","DB Code","Name"] if c in df]
 mask=pd.Series(False,index=df.index)
 for c in cols:mask|=df[c].astype(str).str.contains(search,case=False,na=False)
 return df[mask]

def options():
 df=load_dispatch(); out={}
 for key in ["Month","Category","Order Category","Customer Name","Channel","Zone","Name","DB Code","Final Remarks"]:
  if key in df.columns:
   vals=df[key].dropna().astype(str).unique().tolist()
   out[key]=sorted(vals,key=lambda x:x.lower())
 months,current,prev=_periods(df)
 out["_meta"]={"current_month":current,"previous_month":prev,"months":months}
 return out

def order_options():
 df=load_dispatch()
 cols=list(df.columns)
 preferred=["AWB NUMBER","COURIER","Customer Name","Delivery Status","Order Id","Order Qty","Order Value","Order Received Date","Invoice Qty","Invoice Value","InvoiceNumber","Channel","Zone","Category","Name","DB Code","Final Remarks","Standard TAT","Actual Deli. Days"]
 defaults=[c for c in preferred if c in cols]
 return {"columns":cols,"default":defaults,"row_count":len(df)}

def default_order_columns(df):
 preferred=["AWB NUMBER","COURIER","Customer Name","Delivery Status","Order Id","Order Qty","Order Received Date"]
 return [c for c in preferred if c in df.columns] or list(df.columns[:8])

def summary(df):
 def s(k):
  c=CONFIG[k]
  return df[c].sum() if c in df.columns else 0
 oq,iq,ov,iv,sl=s("order_qty"),s("invoice_qty"),s("order_value"),s("invoice_value"),s("sale_loss")
 return {"order_qty":float(oq or 0),"invoice_qty":float(iq or 0),"fr_qty":float(iq/oq*100) if oq else None,
 "pending_qty":float((oq or 0)-(iq or 0)),"order_value":float(ov or 0),"invoice_value":float(iv or 0),
 "fr_value":float(iv/ov*100) if ov else None,"sale_loss":float(sl or 0),"orders":int(df[CONFIG["order_id"]].nunique()) if CONFIG["order_id"] in df else len(df)}

def _periods(df):
 months=[m for m in MONTH_ORDER if m in df["Month"].astype(str).unique()] if "Month" in df else []
 current=months[-1] if months else None; prev=months[-2] if len(months)>1 else None
 return months,current,prev

def fill_rate(filters=None):
 # The Month filter should pin which month is treated as "Current" — it must
 # NOT shrink the dataframe before the multi-month trend is computed, or the
 # trend chart degenerates to a single point (exactly what happened once the
 # Month filter started defaulting to the current month on every page load).
 # All OTHER filters (Category/Customer/Channel/Zone/Name) still narrow the
 # data as normal.
 filters=dict(filters or {}); month_selection=filters.pop("Month",None)
 base=apply_filters(load_dispatch(),filters)
 months,latest,_=_periods(base)
 current=month_selection[0] if month_selection and month_selection[0] in months else latest
 idx=months.index(current) if current in months else -1
 prev=months[idx-1] if idx>0 else None
 cur=base[base.Month==current] if current else base.iloc[0:0]; prv=base[base.Month==prev] if prev else base.iloc[0:0]
 monthly=[dict(summary(base[base.Month==m]),Month=m) for m in months]
 df=cur # customer/category breakdowns reflect the selected "current" period, matching the KPI cards on the same page
 cust=[]; cat=[]
 if CONFIG["customer"] in df:
  g=df.groupby(CONFIG["customer"],dropna=False).agg(order_count=(CONFIG["order_id"],"nunique"),order_qty=(CONFIG["order_qty"],"sum"),invoice_qty=(CONFIG["invoice_qty"],"sum"),sale_loss=(CONFIG["sale_loss"],"sum")).reset_index()
  g["fill_rate"]=np.where(g.order_qty!=0,g.invoice_qty/g.order_qty*100,np.nan); cust=_json_records(g.sort_values("order_qty",ascending=False).head(100))
 if CONFIG["category"] in df:
  g=df.groupby(CONFIG["category"],dropna=False).agg(orders=(CONFIG["order_id"],"nunique"),order_qty=(CONFIG["order_qty"],"sum"),invoice_qty=(CONFIG["invoice_qty"],"sum"),order_value=(CONFIG["order_value"],"sum"),invoice_value=(CONFIG["invoice_value"],"sum"),sale_loss=(CONFIG["sale_loss"],"sum")).reset_index()
  g["fr_qty"]=np.where(g.order_qty!=0,g.invoice_qty/g.order_qty*100,np.nan); g["fr_value"]=np.where(g.order_value!=0,g.invoice_value/g.order_value*100,np.nan); g["pending_qty"]=g.order_qty-g.invoice_qty
  cat=_json_records(g.sort_values("order_qty",ascending=False).head(100))
 return {"source":load_dispatch().attrs.get("source",""),"filters":options(),"current_month":current,"previous_month":prev,
 "current":summary(cur),"previous":summary(prv) if prev else None,"ytd":summary(base[base.Month.isin(months)]),"monthly":monthly,
 "customer":cust,"category":cat,"rows":len(base)}

def overview(filters=None):
 d=fill_rate(filters)
 status_filters=dict(filters or {})
 df=apply_filters(load_dispatch(),status_filters)
 status={}
 # Donut chart shows a breakdown of the "Final Remarks" column (displayed to
 # the user as "Order Remarks"), not Delivery Status.
 if CONFIG["final_remarks"] in df.columns:
  s=df[CONFIG["final_remarks"]].fillna("Blank").astype(str).replace("","Blank").value_counts().head(8)
  status=[{"status":k,"count":int(v)} for k,v in s.items()]
 monthly=d["monthly"]
 return {"source":d["source"],"current_month":d["current_month"],"previous_month":d["previous_month"],"current":d["current"],"previous":d["previous"],"ytd":d["ytd"],"monthly":monthly,"status":status,"rows":len(df),"filters":d["filters"]}

def orders(search="",filters=None,limit=100,offset=0,cols=None):
 df=apply_filters(load_dispatch(),filters or {}); df=search_df(df,search)
 total=len(df)
 selected=[c for c in (cols or []) if c in df.columns]
 if not selected:selected=default_order_columns(df)
 rows=df.iloc[offset:offset+limit][selected].copy()
 return {"total":total,"rows":_json_records(rows),"columns":selected,"offset":offset,"limit":limit}

def order_detail(order_id):
 df=load_dispatch(); col=CONFIG["order_id"]
 if col not in df:raise DataError("Order Id column not found")
 rows=df[df[col].astype(str)==str(order_id)]
 if rows.empty:raise DataError("Order not found")
 rec=_json_records(rows.iloc[[0]])[0]
 items=load_items(); item_rows=[]
 if not items.empty and ITEMS_CONFIG["doc_no"] in items:
  item_rows=_json_records(items[items[ITEMS_CONFIG["doc_no"]].astype(str)==str(order_id)].head(300))
 return {"order":rec,"items":item_rows}

def cancelled(terms=None,months=None,search="",columns=None):
 df=load_dispatch(); terms=terms or CANCEL_TERMS; col=CONFIG["wh_remarks"]
 if col not in df:return {"rows":[],"total":0,"terms":terms,"columns":[]}
 pattern="|".join(re.escape(t) for t in terms if t); out=df[df[col].astype(str).str.contains(pattern,case=False,na=False,regex=True)].copy()
 if months:out=out[out.Month.astype(str).isin(months)]
 out=search_df(out,search)
 preferred=["Order Id","Customer Name","Order Received Date","Order Qty","Order Value","AWB NUMBER","COURIER","Final Remarks","Wh. Remarks","Month"]
 cols=[c for c in (columns or preferred) if c in out.columns]
 return {"rows":_json_records(out[cols].head(1000)),"total":len(out),"terms":terms,"columns":cols}

def explorer(lens="chain",filters=None,limit=100):
 return explorer_breakdown({},lens,filters,limit)

DIM_LABELS={"chain":"Chain","shop":"Shop","category":"Category","product":"Product"}
DIM_COLS={"chain":CONFIG["name"],"shop":CONFIG["customer"],"category":CONFIG["category"]}

def _scoped_dispatch(scope,filters):
 df=apply_filters(load_dispatch(),filters or {})
 for dim,value in (scope or {}).items():
  if dim=="product":continue
  col=DIM_COLS.get(dim)
  if col and col in df:df=df[df[col].astype(str)==str(value)]
 return df

def _order_ids_for_product(value,df):
 items=load_items()
 if items.empty or ITEMS_CONFIG["gtin"] not in items:return set()
 doc=ITEMS_CONFIG["doc_no"]
 candidates=items[items[ITEMS_CONFIG["gtin"]].astype(str)==str(value)]
 return set(candidates[doc].astype(str).map(_norm)) if doc in candidates else set()

def explorer_breakdown(scope=None,by="chain",filters=None,limit=100):
 """Generalized N-level Explorer aggregation. `scope` is an ordered dict of
 already-fixed dimension->value pairs (e.g. {"chain":"Life Style"} or
 {"chain":"Life Style","product":"8904..."}), `by` is which dimension to
 group the next level by. Chain/Shop/Category all live on the dispatch
 table directly (filtered by simple equality); Product requires joining
 the separate SKU-level items table, restricted to the order IDs that
 survive the current scope + filters."""
 scope=scope or {}
 df=_scoped_dispatch(scope,filters)
 oid=CONFIG["order_id"]
 if "product" in scope:
  allowed=_order_ids_for_product(scope["product"],df)
  df=df[df[oid].astype(str).map(_norm).isin(allowed)] if oid in df else df.iloc[0:0]
 if df.empty:return {"rows":[],"by":by,"scope":scope,"available":_available_dims(scope)}
 if by=="product":
  items=load_items()
  if items.empty or ITEMS_CONFIG["gtin"] not in items or oid not in df:
   return {"rows":[],"by":by,"scope":scope,"available":_available_dims(scope)}
  doc=ITEMS_CONFIG["doc_no"]
  lookup=df[[oid]].drop_duplicates(); lookup["__key"]=lookup[oid].map(_norm)
  items2=items.copy(); items2["__key"]=items2[doc].map(_norm)
  src=items2.merge(lookup,on="__key",how="inner")
  group=ITEMS_CONFIG["gtin"]; label_col=ITEMS_CONFIG["description"]
  oq,iq=ITEMS_CONFIG["order_qty"],ITEMS_CONFIG["invoice_qty"]; idc="__key"
 else:
  col=DIM_COLS.get(by)
  if not col or col not in df:return {"rows":[],"by":by,"scope":scope,"available":_available_dims(scope)}
  group=col; label_col=col; src=df; oq,iq=CONFIG["order_qty"],CONFIG["invoice_qty"]; idc=oid
 g=src.groupby(group,dropna=False).agg(orders=(idc,"nunique"),order_qty=(oq,"sum"),invoice_qty=(iq,"sum")).reset_index()
 g["fill_rate"]=np.where(g.order_qty!=0,g.invoice_qty/g.order_qty*100,np.nan)
 g["value"]=g[group].astype(str); g["label"]=g["value"]
 if label_col!=group:
  labels=src.groupby(group)[label_col].first(); g["label"]=g[group].map(labels).fillna(g["value"])
 g=g.sort_values("order_qty",ascending=False).head(limit)
 return {"rows":_json_records(g[["value","label","orders","order_qty","invoice_qty","fill_rate"]]),
 "by":by,"scope":scope,"available":_available_dims(scope)}

def _available_dims(scope):
 return [d for d in ["chain","shop","category","product"] if d not in (scope or {})]

def explorer_drill(lens,value,filters=None,limit=100):
 df=apply_filters(load_dispatch(),filters or {})
 value=str(value)
 if lens=="chain":
  # Chain/Name -> customers
  group=CONFIG["customer"]; subset=df[df[CONFIG["name"]].astype(str)==value] if CONFIG["name"] in df else df.iloc[0:0]
  title=f"Customers in {value}"
 elif lens=="shop":
  group=CONFIG["order_id"]; subset=df[df[CONFIG["customer"]].astype(str)==value]; title=f"Orders for {value}"
 elif lens=="category":
  group=CONFIG["customer"]; subset=df[df[CONFIG["category"]].astype(str)==value]; title=f"Customers in {value}"
 elif lens=="product":
  items=load_items()
  if ITEMS_CONFIG["gtin"] not in items:
   subset=items.iloc[0:0]
  else:
   # Restrict to orders that survive the active filters before matching the GTIN.
   oid=CONFIG["order_id"]; doc=ITEMS_CONFIG["doc_no"]
   allowed=set(df[oid].astype(str).map(_norm)) if oid in df else None
   candidates=items[items[ITEMS_CONFIG["gtin"]].astype(str)==value]
   subset=candidates[candidates[doc].astype(str).map(_norm).isin(allowed)] if allowed is not None and doc in candidates else candidates
  group=ITEMS_CONFIG["description"]; title=f"SKUs for {value}"
 else:return {"title":"Drill-down","rows":[]}
 if subset.empty:return {"title":title,"rows":[]}
 if lens=="shop":
  cols=[c for c in ["Order Id","Customer Name","Order Qty","Invoice Qty","Order Value","Invoice Value","Delivery Status","Order Received Date"] if c in subset.columns]
 else:
  cols=[group]
  if CONFIG["order_id"] in subset: cols += [c for c in ["Order Qty","Invoice Qty","Order Value","Invoice Value","Order Id"] if c in subset.columns]
 out=subset[cols].drop_duplicates().head(limit)
 return {"title":title,"rows":_json_records(out)}

ORDER_EAN_HINTS=["ean","barcode","upc","gtin"]
ORDER_NAME_HINTS=["product","name","description","item"]
ORDER_QTY_HINTS=["order","qty","quantity","demand"]

def _guess_col(columns,hints):
 cols_lower={str(c).strip().lower():c for c in columns}
 for hint in hints:
  for cl,orig in cols_lower.items():
   if hint in cl:return orig
 return columns[0] if len(columns) else None

def _read_order_frame(order_file,filename,header_row=1):
 hdr_idx=max(0,int(header_row or 1)-1)
 if filename.lower().endswith(".csv"):df=pd.read_csv(io.BytesIO(order_file),header=hdr_idx)
 else:df=pd.read_excel(io.BytesIO(order_file),header=hdr_idx)
 df.columns=[str(c).strip() for c in df.columns]
 return df

def stock_columns(order_file=None,filename="",header_row=1,match_mode="EAN"):
 if order_file is None:
  p=_local("Order File.xlsx")
  if not p.exists():raise DataError("Local Order File.xlsx is missing.")
  order_file=p.read_bytes(); filename=p.name
 df=_read_order_frame(order_file,filename,header_row)
 cols=list(df.columns)
 key_hints=ORDER_NAME_HINTS if match_mode=="Product Name" else ORDER_EAN_HINTS
 default_key=_guess_col(cols,key_hints)
 default_qty=_guess_col(cols,ORDER_QTY_HINTS)
 # Full column list is always returned — never a filtered subset — so a real
 # production file's actual headers (whatever they're called) are always
 # selectable. The guess only picks which one is pre-selected by default.
 return {"columns":cols,"default_key_col":default_key,"default_qty_col":default_qty,
 "filename":filename or "Order File.xlsx","row_count":len(df),
 "preview":_json_records(df.head(5))}

def stock_gap(order_file,filename="",match_mode="EAN",key_col="",qty_col="",location="Ahmedabad",header_row=1):
 if order_file is None:
  p=_local("Order File.xlsx")
  if not p.exists():raise DataError("Local Order File.xlsx is missing.")
  order_file=p.read_bytes(); filename=p.name
 odf=_read_order_frame(order_file,filename,header_row)
 if not key_col or key_col not in odf.columns:raise DataError("Please select a valid order key column.")
 if not qty_col or qty_col not in odf.columns:raise DataError("Please select a valid order quantity column.")
 stock=load_stock()
 stock["__key"]=stock["ean"].map(_norm) if match_mode=="EAN" else stock["product"].map(_norm)
 odf["__key"]=odf[key_col].map(_norm) if match_mode=="EAN" else odf[key_col].astype(str).str.strip().str.lower()
 lookup=stock.set_index("__key"); avail_col="mwh" if location=="Ahmedabad" else "blr"
 rows=[]
 for _,r in odf.iterrows():
  key=r["__key"]; q=pd.to_numeric(r[qty_col],errors="coerce"); qty=0 if pd.isna(q) else float(q); found=key in lookup.index
  st=float(lookup.loc[key,avail_col]) if found else 0.0; gap=qty-st
  status="Not Found" if not found else ("Stockout" if st<=0 and qty>0 else ("Low" if gap>0 else "OK"))
  rows.append({"key":r[key_col],"order_qty":qty,"stock":st,"gap":max(gap,0),"status":status,"product":lookup.loc[key,"product"] if found else ""})
 return rows