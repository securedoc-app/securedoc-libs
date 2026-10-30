/*
 * Tabla de Datos — Librería reutilizable (Web Component nativo)
 * Etiqueta: <data-table>
 *
 * Componente de tabla interactiva: ordenar, buscar (una sola caja arriba,
 * búsqueda por palabras con AND), paginar, reordenar filas (arrastrar),
 * importar y exportar. Cada capacidad se activa/desactiva por atributo.
 * El componente NO lee ni guarda datos por su cuenta: recibe datos por
 * propiedades JS y avisa de todo cambio con CustomEvent para que la app
 * decida qué hacer.
 *
 * Sin Shadow DOM (hereda Bootstrap 5 de la app). Sin eval/Function,
 * sin document.write, sin eventos inline, sin innerHTML con datos.
 */
(function () {
  "use strict";

  if (window.customElements && customElements.get("data-table")) return;

  /* ---------- utilidades puras (dentro del ámbito privado) ---------- */

  function el(tag, opts, children) {
    var n = document.createElement(tag);
    if (opts) {
      if (opts.class) n.className = opts.class;
      if (opts.text != null) n.textContent = String(opts.text);
      if (opts.attrs) {
        for (var a in opts.attrs) {
          if (Object.prototype.hasOwnProperty.call(opts.attrs, a)) {
            n.setAttribute(a, opts.attrs[a]);
          }
        }
      }
      if (opts.props) {
        for (var p in opts.props) {
          if (Object.prototype.hasOwnProperty.call(opts.props, p)) {
            n[p] = opts.props[p];
          }
        }
      }
      if (opts.on) {
        for (var ev in opts.on) {
          if (Object.prototype.hasOwnProperty.call(opts.on, ev)) {
            n.addEventListener(ev, opts.on[ev]);
          }
        }
      }
    }
    if (children) {
      for (var i = 0; i < children.length; i++) {
        var c = children[i];
        if (c == null || c === false) continue;
        n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
      }
    }
    return n;
  }

  function isTrueAttr(host, name) {
    if (!host.hasAttribute(name)) return false;
    var v = host.getAttribute(name);
    return v === "" || v === name || v === "true" || v === "1";
  }

  function cellRaw(row, col) {
    return row ? row[col.key] : undefined;
  }

  function cellText(row, col) {
    var v = cellRaw(row, col);
    if (typeof col.format === "function") {
      try { return String(col.format(v, row)); } catch (e) { return ""; }
    }
    return v == null ? "" : String(v);
  }

  function compareValues(a, b, type) {
    if (a == null && b == null) return 0;
    if (a == null) return -1;
    if (b == null) return 1;
    if (type === "number") {
      var na = parseFloat(a), nb = parseFloat(b);
      na = isNaN(na) ? 0 : na; nb = isNaN(nb) ? 0 : nb;
      return na - nb;
    }
    if (type === "date") {
      var da = new Date(a).getTime(), db = new Date(b).getTime();
      da = isNaN(da) ? 0 : da; db = isNaN(db) ? 0 : db;
      return da - db;
    }
    return String(a).localeCompare(String(b), undefined, {
      numeric: true, sensitivity: "base"
    });
  }

  function toCSV(cols, rows) {
    function esc(v) {
      var s = v == null ? "" : String(v);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    var out = [cols.map(function (c) {
      return esc(c.label != null ? c.label : c.key);
    }).join(",")];
    for (var i = 0; i < rows.length; i++) {
      out.push(cols.map(function (c) { return esc(rows[i][c.key]); }).join(","));
    }
    return out.join("\r\n");
  }

  function parseCSV(text) {
    var out = [], row = [], field = "", inq = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inq) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inq = false;
        } else { field += c; }
      } else {
        if (c === '"') inq = true;
        else if (c === ",") { row.push(field); field = ""; }
        else if (c === "\n") { row.push(field); field = ""; out.push(row); row = []; }
        else if (c === "\r") { /* ignora */ }
        else field += c;
      }
    }
    if (field !== "" || row.length) { row.push(field); out.push(row); }
    return out;
  }

  function csvToObjects(text, cols) {
    var rows = parseCSV(text);
    if (!rows.length) return [];
    var header = rows[0];
    var keys = header.map(function (h) {
      var hh = String(h).trim();
      for (var j = 0; j < cols.length; j++) {
        if (String(cols[j].label) === hh || String(cols[j].key) === hh) {
          return cols[j].key;
        }
      }
      return hh;
    });
    var res = [];
    for (var r = 1; r < rows.length; r++) {
      var o = {}, line = rows[r], empty = true;
      for (var k = 0; k < keys.length; k++) {
        o[keys[k]] = line[k] != null ? line[k] : "";
        if (o[keys[k]] !== "") empty = false;
      }
      if (!empty) res.push(o);
    }
    return res;
  }

  function download(filename, content, mime) {
    try {
      var blob = new Blob([content], { type: mime || "text/plain" });
      var url = URL.createObjectURL(blob);
      var a = el("a", { attrs: { href: url, download: filename } });
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 0);
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ----------------------- el Web Component ----------------------- */

  var DataTable = class extends HTMLElement {
    static get observedAttributes() {
      return [
        "sortable", "searchable", "paginated", "page-size",
        "reorderable", "exportable", "importable",
        "striped", "hover", "bordered", "size", "empty-text", "caption"
      ];
    }

    constructor() {
      super();
      this._columns = [];
      this._data = [];
      this._sortKey = null;
      this._sortDir = 0;        // 0 ninguno, 1 asc, -1 desc
      this._search = "";
      this._page = 1;
      this._dragItem = null;    // referencia al objeto fila arrastrado
      this._ready = false;
    }

    /* ---- propiedades JS ---- */
    get columns() { return this._columns.slice(); }
    set columns(v) {
      this._columns = Array.isArray(v) ? v.map(function (c) {
        return typeof c === "string"
          ? { key: c, label: c }
          : {
              key: c.key,
              label: c.label != null ? c.label : c.key,
              type: c.type || "string",
              sortable: c.sortable !== false,
              format: typeof c.format === "function" ? c.format : null,
              align: c.align || null
            };
      }) : [];
      this._render();
    }

    get data() { return this._data.slice(); }
    set data(v) {
      this._data = Array.isArray(v) ? v.slice() : [];
      this._page = 1;
      this._render();
    }

    get pageSize() {
      var n = parseInt(this.getAttribute("page-size"), 10);
      return n > 0 ? n : 10;
    }
    set pageSize(n) { this.setAttribute("page-size", String(n)); }

    /* ---- ciclo de vida ---- */
    connectedCallback() {
      this._ready = true;
      this._render();
    }
    attributeChangedCallback() {
      if (this._ready) this._render();
    }

    /* ---- API pública cómoda ---- */
    setData(cols, rows) {
      if (cols) this.columns = cols;
      if (rows) this.data = rows;
    }
    getVisibleRows() { return this._computeView().rows.slice(); }
    clearFilters() { this._search = ""; this._page = 1; this._render(); }

    /* ---- lógica interna: buscar -> ordenar -> paginar ---- */
    _computeView() {
      var self = this;
      var cols = this._columns;
      var rows = this._data;

      // búsqueda única por palabras con AND: todas las palabras deben
      // aparecer en el texto combinado de todas las columnas de la fila
      var tokens = this._search
        ? this._search.toLowerCase().split(/\s+/).filter(Boolean)
        : [];
      if (tokens.length) {
        rows = rows.filter(function (r) {
          var hay = "";
          for (var i = 0; i < cols.length; i++) {
            hay += " " + cellText(r, cols[i]).toLowerCase();
          }
          for (var t = 0; t < tokens.length; t++) {
            if (hay.indexOf(tokens[t]) === -1) return false; // AND
          }
          return true;
        });
      }

      // orden
      if (this._sortKey && this._sortDir) {
        var col = null;
        for (var k = 0; k < cols.length; k++) {
          if (cols[k].key === this._sortKey) { col = cols[k]; break; }
        }
        var dir = this._sortDir, type = col ? col.type : "string";
        rows = rows.slice().sort(function (a, b) {
          return compareValues(a[self._sortKey], b[self._sortKey], type) * dir;
        });
      }

      var total = rows.length;
      var paginated = isTrueAttr(this, "paginated");
      var pages = 1, page = 1, view = rows;
      if (paginated) {
        var ps = this.pageSize;
        pages = Math.max(1, Math.ceil(total / ps));
        page = Math.min(Math.max(1, this._page), pages);
        this._page = page;
        view = rows.slice((page - 1) * ps, page * ps);
      }
      return { rows: view, total: total, pages: pages, page: page };
    }

    _emit(name, detail, cancelable) {
      return this.dispatchEvent(new CustomEvent(name, {
        detail: detail, bubbles: true, cancelable: !!cancelable
      }));
    }

    /* ---- acciones ---- */
    _onSort(col) {
      if (!isTrueAttr(this, "sortable") || col.sortable === false) return;
      if (this._sortKey !== col.key) { this._sortKey = col.key; this._sortDir = 1; }
      else if (this._sortDir === 1) { this._sortDir = -1; }
      else if (this._sortDir === -1) { this._sortKey = null; this._sortDir = 0; }
      else { this._sortDir = 1; }
      this._emit("sort", { key: this._sortKey, dir: this._sortDir });
      this._render();
    }

    _onSearch(value) {
      this._search = value || ""; this._page = 1;
      var tokens = this._search.toLowerCase().split(/\s+/).filter(Boolean);
      this._emit("filter", { search: this._search, tokens: tokens });
      this._render();
    }

    _onReorder(fromItem, toItem, before) {
      var from = this._data.indexOf(fromItem);
      var to = this._data.indexOf(toItem);
      if (from === -1 || to === -1 || from === to) return;
      this._data.splice(from, 1);
      to = this._data.indexOf(toItem);
      var insert = before ? to : to + 1;
      this._data.splice(insert, 0, fromItem);
      this._emit("reorder", { from: from, to: insert, data: this.data });
      this._emit("change", { reason: "reorder", data: this.data });
      this._render();
    }

    _doExport(format) {
      var cols = this._columns, rows = this._computeView().rows;
      var content, mime, ext;
      if (format === "json") {
        content = JSON.stringify(rows, null, 2);
        mime = "application/json"; ext = "json";
      } else {
        content = toCSV(cols, rows); mime = "text/csv"; ext = "csv";
      }
      var proceed = this._emit("export", {
        format: format, content: content, rows: rows.slice()
      }, true);
      if (proceed) download("data-table." + ext, content, mime);
    }

    _doImport(file) {
      var self = this, reader = new FileReader();
      reader.onload = function () {
        var text = String(reader.result || "");
        var rows;
        try {
          if (/\.json$/i.test(file.name) || /^\s*[\[{]/.test(text)) {
            var parsed = JSON.parse(text);
            rows = Array.isArray(parsed) ? parsed : (parsed.data || []);
          } else {
            rows = csvToObjects(text, self._columns);
          }
        } catch (e) {
          self._emit("importerror", { message: "Archivo no válido", error: String(e) });
          return;
        }
        var proceed = self._emit("import", { rows: rows, file: file.name }, true);
        if (proceed) { self.data = rows; self._emit("change", { reason: "import", data: self.data }); }
      };
      reader.onerror = function () {
        self._emit("importerror", { message: "No se pudo leer el archivo" });
      };
      reader.readAsText(file);
    }

    /* ---- construcción del DOM ---- */
    _render() {
      if (!this._ready) return;
      var self = this;
      this.textContent = "";

      var wrap = el("div", { class: "data-table-wrap" });

      // barra de herramientas
      var showSearch = isTrueAttr(this, "searchable");
      var showExport = isTrueAttr(this, "exportable");
      var showImport = isTrueAttr(this, "importable");
      if (showSearch || showExport || showImport) {
        var tb = el("div", { class: "d-flex flex-wrap gap-2 align-items-center mb-2" });
        if (showSearch) {
          tb.appendChild(el("input", {
            class: "form-control form-control-sm",
            attrs: {
              type: "search",
              placeholder: "Buscar (varias palabras = todas deben coincidir)…",
              "aria-label": "Buscar"
            },
            props: { value: this._search },
            on: { input: function (e) { self._onSearch(e.target.value); } }
          }));
        }
        var spacer = el("div", { class: "ms-auto d-flex gap-2" });
        if (showImport) {
          var fileInput = el("input", {
            class: "d-none",
            attrs: { type: "file", accept: ".csv,.json,text/csv,application/json" },
            on: { change: function (e) {
              if (e.target.files && e.target.files[0]) self._doImport(e.target.files[0]);
              e.target.value = "";
            } }
          });
          spacer.appendChild(el("button", {
            class: "btn btn-sm btn-outline-secondary", attrs: { type: "button" },
            text: "Importar",
            on: { click: function () { fileInput.click(); } }
          }));
          spacer.appendChild(fileInput);
        }
        if (showExport) {
          spacer.appendChild(el("button", {
            class: "btn btn-sm btn-outline-secondary", attrs: { type: "button" },
            text: "Exportar CSV",
            on: { click: function () { self._doExport("csv"); } }
          }));
          spacer.appendChild(el("button", {
            class: "btn btn-sm btn-outline-secondary", attrs: { type: "button" },
            text: "Exportar JSON",
            on: { click: function () { self._doExport("json"); } }
          }));
        }
        if (spacer.childNodes.length) tb.appendChild(spacer);
        wrap.appendChild(tb);
      }

      // tabla
      var view = this._computeView();
      var cls = "table";
      if (isTrueAttr(this, "striped")) cls += " table-striped";
      if (isTrueAttr(this, "hover")) cls += " table-hover";
      if (isTrueAttr(this, "bordered")) cls += " table-bordered";
      if (this.getAttribute("size") === "sm") cls += " table-sm";
      var table = el("table", { class: cls });

      if (this.getAttribute("caption")) {
        table.appendChild(el("caption", { text: this.getAttribute("caption") }));
      }

      // cabecera
      var thead = el("thead");
      var hr = el("tr");
      if (isTrueAttr(this, "reorderable")) hr.appendChild(el("th", { attrs: { scope: "col" }, text: "" }));
      this._columns.forEach(function (col) {
        var th = el("th", { attrs: { scope: "col" } });
        if (col.align) th.style.textAlign = col.align;
        var sortable = isTrueAttr(self, "sortable") && col.sortable !== false;
        if (sortable) {
          th.style.cursor = "pointer";
          th.style.userSelect = "none";
          th.setAttribute("role", "button");
        }
        th.appendChild(el("span", { text: col.label }));
        if (sortable && self._sortKey === col.key && self._sortDir) {
          th.appendChild(el("span", {
            class: "ms-1", text: self._sortDir === 1 ? "▲" : "▼"
          }));
        }
        if (sortable) {
          th.addEventListener("click", function () { self._onSort(col); });
        }
        hr.appendChild(th);
      });
      thead.appendChild(hr);
      table.appendChild(thead);

      // cuerpo
      var tbody = el("tbody");
      var reorderable = isTrueAttr(this, "reorderable");
      if (!view.rows.length) {
        var span = this._columns.length + (reorderable ? 1 : 0);
        var tr0 = el("tr");
        tr0.appendChild(el("td", {
          class: "text-center text-muted py-3",
          attrs: { colspan: String(span || 1) },
          text: this.getAttribute("empty-text") || "Sin datos"
        }));
        tbody.appendChild(tr0);
      } else {
        view.rows.forEach(function (row) {
          var tr = el("tr");
          if (reorderable) {
            tr.setAttribute("draggable", "true");
            var handle = el("td", { class: "text-muted", text: "⠿", attrs: { "aria-hidden": "true" } });
            handle.style.cursor = "grab";
            tr.appendChild(handle);
            tr.addEventListener("dragstart", function (e) {
              self._dragItem = row;
              tr.classList.add("table-active");
              if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
            });
            tr.addEventListener("dragend", function () {
              tr.classList.remove("table-active");
              self._dragItem = null;
            });
            tr.addEventListener("dragover", function (e) { e.preventDefault(); });
            tr.addEventListener("drop", function (e) {
              e.preventDefault();
              if (!self._dragItem || self._dragItem === row) return;
              var rect = tr.getBoundingClientRect();
              var before = (e.clientY - rect.top) < rect.height / 2;
              self._onReorder(self._dragItem, row, before);
            });
          }
          self._columns.forEach(function (col) {
            var td = el("td", { text: cellText(row, col) });
            if (col.align) td.style.textAlign = col.align;
            tr.appendChild(td);
          });
          tr.addEventListener("click", function () {
            self._emit("rowclick", { row: row });
          });
          tbody.appendChild(tr);
        });
      }
      table.appendChild(tbody);

      wrap.appendChild(el("div", { class: "table-responsive" }, [table]));

      // paginación
      if (isTrueAttr(this, "paginated") && view.total) {
        var foot = el("div", { class: "d-flex flex-wrap align-items-center justify-content-between gap-2" });
        foot.appendChild(el("small", {
          class: "text-muted",
          text: "Mostrando " + view.rows.length + " de " + view.total +
                " · Página " + view.page + "/" + view.pages
        }));
        var nav = el("div", { class: "btn-group btn-group-sm" });
        nav.appendChild(el("button", {
          class: "btn btn-outline-secondary", attrs: { type: "button" },
          props: { disabled: view.page <= 1 }, text: "‹ Anterior",
          on: { click: function () { self._page = view.page - 1; self._render(); } }
        }));
        nav.appendChild(el("button", {
          class: "btn btn-outline-secondary", attrs: { type: "button" },
          props: { disabled: view.page >= view.pages }, text: "Siguiente ›",
          on: { click: function () { self._page = view.page + 1; self._render(); } }
        }));
        foot.appendChild(nav);
        wrap.appendChild(foot);
      }

      this.appendChild(wrap);
    }
  };

  customElements.define("data-table", DataTable);
})();