from __future__ import annotations
import json
from pathlib import Path
from flask import Flask, jsonify, render_template, request, Response, send_from_directory
from . import data_service as ds

def _filters(args):
    mapping = {
        "Month":"month", "Category":"category", "Order Category":"order_category",
        "Customer Name":"customer", "Channel":"channel", "Zone":"zone",
        "Name":"name", "DB Code":"db_code", "Final Remarks":"final_remarks"
    }
    return {col: args.getlist(key) for col,key in mapping.items() if args.getlist(key)}

def _safe_json(value):
    return ds.json_safe(value)

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
TEMPLATE_DIR = BASE_DIR / "templates"

def create_app():
    # Explicit paths + explicit static route make deployment independent of
    # the current working directory and Flask's automatic static discovery.
    app=Flask(
        __name__,
        static_folder=None,
        template_folder=str(TEMPLATE_DIR),
    )

    @app.get("/static/<path:filename>")
    def static_files(filename):
        return send_from_directory(STATIC_DIR, filename)
    app.config["MAX_CONTENT_LENGTH"]=25*1024*1024  # 25MB upload cap (Stock Gap file uploads)

    @app.get("/")
    def home():
        return render_template("index.html")

    @app.get("/api/health")
    def health():
        return jsonify(_safe_json({"status":"ok","sources":ds.source_status()}))

    @app.get("/api/options")
    def api_options():
        return jsonify(_safe_json(ds.options()))

    @app.get("/api/overview")
    def api_overview():
        return jsonify(_safe_json(ds.overview(_filters(request.args))))

    @app.get("/api/fill-rate")
    def api_fill_rate():
        return jsonify(_safe_json(ds.fill_rate(_filters(request.args))))

    @app.get("/api/order-options")
    def api_order_options():
        return jsonify(_safe_json(ds.order_options()))

    @app.get("/api/orders")
    def api_orders():
        try:
            limit=max(1,min(500,int(request.args.get("limit",100))))
            offset=max(0,int(request.args.get("offset",0)))
        except ValueError:
            limit,offset=100,0
        cols=request.args.getlist("columns")
        return jsonify(_safe_json(ds.orders(request.args.get("search",""),_filters(request.args),limit,offset,cols)))

    @app.get("/api/orders.csv")
    def api_orders_csv():
        cols=request.args.getlist("columns")
        df=ds.load_dispatch().copy()
        df=ds.apply_filters(df,_filters(request.args))
        search=request.args.get("search","").strip()
        if search:
            df=ds.search_df(df,search)
        if cols:
            cols=[c for c in cols if c in df.columns]
        if not cols:
            cols=ds.default_order_columns(df)
        out=df[cols] if cols else df
        return Response(out.to_csv(index=False),mimetype="text/csv",
                        headers={"Content-Disposition":"attachment; filename=orders.csv"})

    @app.get("/api/order/<path:order_id>")
    def order_detail(order_id):
        try:
            return jsonify(_safe_json(ds.order_detail(order_id)))
        except ds.DataError as e:
            return jsonify({"error":str(e)}),404

    @app.get("/api/cancelled")
    def api_cancelled():
        return jsonify(_safe_json(ds.cancelled(
            request.args.getlist("term") or None,
            request.args.getlist("month") or None,
            request.args.get("search",""),
            request.args.getlist("columns")
        )))

    @app.get("/api/explorer")
    def api_explorer():
        try: limit=max(1,min(500,int(request.args.get("limit",100))))
        except ValueError: limit=100
        return jsonify(_safe_json(ds.explorer(request.args.get("lens","chain"),_filters(request.args),limit)))

    @app.get("/api/explorer/breakdown")
    def api_explorer_breakdown():
        """N-level drill-down. `scope` is a JSON object of already-fixed
        dimension->value pairs (e.g. {"chain":"Life Style"}), `by` is which
        dimension to break the next level down by (chain/shop/category/product)."""
        try: limit=max(1,min(500,int(request.args.get("limit",100))))
        except ValueError: limit=100
        try: scope=json.loads(request.args.get("scope","{}"))
        except (json.JSONDecodeError,TypeError): scope={}
        by=request.args.get("by","chain")
        return jsonify(_safe_json(ds.explorer_breakdown(scope,by,_filters(request.args),limit)))

    @app.get("/api/explorer/drill")
    def api_explorer_drill():
        return jsonify(_safe_json(ds.explorer_drill(
            request.args.get("lens","chain"),
            request.args.get("value",""),
            _filters(request.args),
            max(1,min(300,int(request.args.get("limit",100))))
        )))

    @app.post("/api/stock-columns")
    def stock_columns():
        f=request.files.get("file")
        try:
            return jsonify(_safe_json(ds.stock_columns(
                f.read() if f else None, f.filename if f else "",
                request.form.get("header_row",1),
                request.form.get("match_mode","EAN"),
            )))
        except Exception as e:
            return jsonify({"error":str(e)}),400

    @app.post("/api/stock-gap")
    def api_stock_gap():
        f=request.files.get("file")
        try:
            rows=ds.stock_gap(
                f.read() if f else None,
                f.filename if f else "",
                request.form.get("match_mode","EAN"),
                request.form.get("key_col",""),
                request.form.get("qty_col",""),
                request.form.get("location","Ahmedabad"),
                request.form.get("header_row",1),
            )
            return jsonify(_safe_json({"rows":rows,"total":len(rows)}))
        except Exception as e:
            return jsonify({"error":str(e)}),400

    @app.post("/api/refresh")
    def refresh():
        ds.CACHE.clear()
        return jsonify(_safe_json({"ok":True,"sources":ds.source_status()}))

    @app.errorhandler(ds.DataError)
    def data_error(e):
        return jsonify({"error":str(e)}),503

    return app

app=create_app()

if __name__=="__main__":
    app.run(host="127.0.0.1",port=5000,debug=True)
