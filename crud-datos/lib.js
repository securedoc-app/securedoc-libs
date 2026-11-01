/*
 * CRUD Datos — Librería reutilizable (Web Component nativo, sin Shadow DOM)
 * Etiqueta: <crud-data>
 *
 * Envoltorio de CRUD sobre la librería <data-table> ("Tabla de Datos").
 * Aporta la capa que <data-table> no tiene: botones de acción por fila
 * (Editar / Duplicar / Eliminar) y un formulario automático por campo
 * (modal Bootstrap 5) generado a partir de las columnas.
 *
 * El componente NO lee ni escribe datos por su cuenta: recibe columnas,
 * filas y procesos (hooks) por propiedades JS, y avisa de TODO con
 * CustomEvent para que la app decida qué hacer (persistir, validar…).
 *
 * Requiere: Bootstrap 5 CSS/JS y <data-table> ya cargados en la página.
 * Sin eval/Function, sin document.write, sin eventos inline, sin innerHTML
 * con datos dinámicos (solo textContent / createElement). Todo el código
 * vive dentro de una función privada: no declara nada en el ámbito global.
 */
(function () {
  "use strict";

  if (window.customElements && customElements.get("crud-data")) return;

  /* Versión con las correcciones de acciones (botones al paginar) y de
     apertura de formulario (Editar/Agregar). Sirve de sello para
     verificar en consola que el navegador NO está usando una copia vieja. */
  var CRUD_DATOS_VERSION = "1.1.0-hotfix-2026-11-01";
  try {
    if (window.console && console.log) {
      console.log("%c[crud-datos] versión " + CRUD_DATOS_VERSION + " cargada correctamente",
        "color:#0a7;font-weight:bold");
      console.log("[crud-datos] Si este mensaje NO aparece, el navegador o el CDN está sirviendo una copia antigua (usa recarga forzada: Ctrl+F5 / Cmd+Shift+R).");
    }
  } catch (e) { /* consola no disponible */ }

  /* ---------------- utilidades puras (ámbito privado) ---------------- */

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

  function clone(v) {
    if (v == null) return v;
    try { return JSON.parse(JSON.stringify(v)); } catch (e) { return v; }
  }

  // Llama a un proceso (hook) sin romper la app si no existe o falla.
  function safe(fn, arg) {
    if (typeof fn !== "function") return undefined;
    try { return fn(arg); } catch (e) { return undefined; }
  }

  function normCols(cols) {
    return (Array.isArray(cols) ? cols : []).map(function (c) {
      if (typeof c === "string") return { key: c, label: c, type: "string" };
      return {
        key: c.key,
        label: c.label != null ? c.label : c.key,
        type: c.type || "string",
        options: Array.isArray(c.options) ? c.options : null,
        required: c.required === true,
        editable: c.editable !== false,
        format: typeof c.format === "function" ? c.format : null,
        align: c.align || null,
        sortable: c.sortable !== false,
        help: c.help || null,
        placeholder: c.placeholder != null ? c.placeholder : null
      };
    });
  }

  /* Asegura el CSS de Bootstrap Icons (solo iconos, no toca el resto).
     Si la pagina ya lo trae, no duplica nada. */
  function ensureIconsCss() {
    var L = "https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css";
    if (document.querySelector('link[href="' + L + '"]')) return;
    var l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = L;
    (document.head || document.documentElement).appendChild(l);
  }

  function getField(row, key) {
    if (String(key).indexOf(".") === -1) return row ? row[key] : undefined;
    var parts = String(key).split("."), cur = row;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  function setField(row, key, value) {
    if (String(key).indexOf(".") === -1) { row[key] = value; return; }
    var parts = String(key).split("."), cur = row;
    for (var i = 0; i < parts.length - 1; i++) {
      if (cur[parts[i]] == null || typeof cur[parts[i]] !== "object") cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
  }

  function fmtDateInput(value) {
    var d = value instanceof Date ? value : new Date(value);
    if (isNaN(d.getTime())) return "";
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
  }

  function castValue(raw, col) {
    if (col.type === "number") {
      if (raw === "" || raw == null) return "";
      var n = parseFloat(String(raw).replace(",", "."));
      return isNaN(n) ? String(raw) : n;
    }
    if (col.type === "bool") return raw === true || raw === "true" || raw === "on" || raw === 1 || raw === "1";
    if (col.type === "date") return raw ? new Date(raw) : null;
    return raw == null ? "" : raw;
  }

  var uid = 0;
  function nextId(prefix) { uid++; return prefix + "-" + uid; }

  // Contexto que recibe cada proceso (hook). Se lee por nombre, sin ambigüedad
  // con "lo que devuelve el proceso" (evita confusiones tipo validar/ok).
  function ctx(props) {
    return props && typeof props === "object" ? props : {};
  }

  /* --------------------------- el componente --------------------------- */

  var CrudData = class extends HTMLElement {
    static get observedAttributes() {
      return [
        "title", "id-key", "add-label", "limit", "show-id", "dense",
        "table-searchable", "table-sortable", "table-paginated", "page-size",
        "table-reorderable", "table-exportable", "table-importable",
        "table-striped", "table-hover", "table-bordered",
        "empty-text", "confirm-delete"
      ];
    }

    constructor() {
      super();
      this._cols = [];
      this._data = [];
      this._ready = false;
      this._table = null;
      this._onTableClick = null;
      this._hooks = {
        transform: null, toForm: null, fromForm: null,
        validate: null, canAdd: null, canEdit: null, canDelete: null,
        confirmDelete: null, idGenerator: null
      };
      this._observer = null;
      this._paintQueued = false;
    }

    /* ---- ciclo de vida ---- */
    connectedCallback() {
      ensureIconsCss();
      this._ready = true;
      this._render();
    }
    attributeChangedCallback() {
      if (this._ready) this._render();
    }
    disconnectedCallback() {
      if (this._observer) { this._observer.disconnect(); this._observer = null; }
      if (this._table && this._onTableClick) {
        this._table.removeEventListener("rowclick", this._onTableClick);
      }
    }

    /* ---- propiedades JS: los "datos" ---- */
    get columns() { return this._cols.slice(); }
    set columns(v) { this._cols = normCols(v); this._render(); }

    get data() { return this._data.slice(); }
    set data(v) { this._data = Array.isArray(v) ? v.slice() : []; this._render(); }

    get idKey() { return this.getAttribute("id-key") || "id"; }
    set idKey(v) { this.setAttribute("id-key", String(v)); }

    get limit() {
      var n = parseInt(this.getAttribute("limit"), 10);
      return n >= 0 ? n : 0;
    }
    set limit(n) { this.setAttribute("limit", String(n)); }

    /* ---- propiedades JS: los "procesos" (hooks) ----
       Cada proceso recibe UN objeto con campos nombrados:
         transform(ctx)     ctx = { rows }            -> devuelve rows (o nada)
         toForm(ctx)        ctx = { row }             -> objeto con los valores del formulario
         fromForm(ctx)      ctx = { values, row }     -> fila a guardar (o nada)
         validate(ctx)      ctx = { values, row }     -> { ok:false, errors:{campo:mensaje} }
         canAdd(ctx)        ctx = { total, limit }    -> true/false
         canEdit(ctx)       ctx = { row }             -> true/false
         canDelete(ctx)     ctx = { row }             -> true/false
         confirmDelete(ctx) ctx = { row }             -> true/false (no imprimir avisos aquí)
         idGenerator(ctx)   ctx = { row }             -> id para el registro
    ---- */
    setTransform(fn) { this._hooks.transform = fn; }
    setToForm(fn) { this._hooks.toForm = fn; }
    setFromForm(fn) { this._hooks.fromForm = fn; }
    setValidate(fn) { this._hooks.validate = fn; }
    setCanAdd(fn) { this._hooks.canAdd = fn; }
    setCanEdit(fn) { this._hooks.canEdit = fn; }
    setCanDelete(fn) { this._hooks.canDelete = fn; }
    setConfirmDelete(fn) { this._hooks.confirmDelete = fn; }
    setIdGenerator(fn) { this._hooks.idGenerator = fn; }

    /* ---- API pública ---- */
    openCreate() { this._openForm(null); }                 // abre el formulario vacío
    openForm(row) { this._openForm(row); }                 // abre el formulario de una fila


    static get observedProcesses() {
      return ["transform", "toForm", "fromForm", "validate", "canAdd",
              "canEdit", "canDelete", "confirmDelete", "idGenerator"];
    }

    // Procesos en un solo objeto: { transform, toForm, fromForm, validate, idGenerator, ... }
    setProcesses(obj) {
      var self = this;
      if (!obj || typeof obj !== "object") return;
      Object.keys(obj).forEach(function (k) {
        if (typeof obj[k] !== "function") return;
        if (k === "transform") self._hooks.transform = obj[k];
        else if (k === "toForm") self._hooks.toForm = obj[k];
        else if (k === "fromForm") self._hooks.fromForm = obj[k];
        else if (k === "validate") self._hooks.validate = obj[k];
        else if (k === "canAdd") self._hooks.canAdd = obj[k];
        else if (k === "canEdit") self._hooks.canEdit = obj[k];
        else if (k === "canDelete") self._hooks.canDelete = obj[k];
        else if (k === "confirmDelete") self._hooks.confirmDelete = obj[k];
        else if (k === "idGenerator") self._hooks.idGenerator = obj[k];
      });
    }

    addRow(obj) {
      var row = clone(obj) || {};
      var t = safe(this._hooks.transform, ctx({ rows: clone(this._data) }));
      if (Array.isArray(t)) this._data = t;
      this._data.push(row);
      this._emit("crud-add", { row: row, data: this.data });
      this._emit("crud-change", { reason: "add", row: row, data: this.data });
      this._refresh();
      return row;
    }

    updateRow(idValue, patch) {
      var i = this._indexOf(idValue);
      if (i === -1) return false;
      var row = this._data[i];
      Object.keys(patch || {}).forEach(function (k) { row[k] = patch[k]; });
      this._emit("crud-update", { row: row, data: this.data });
      this._emit("crud-change", { reason: "update", row: row, data: this.data });
      this._refresh();
      return true;
    }

    removeRow(idValue) {
      var i = this._indexOf(idValue);
      if (i === -1) return false;
      var row = this._data.splice(i, 1)[0];
      this._emit("crud-delete", { row: row, data: this.data });
      this._emit("crud-change", { reason: "delete", row: row, data: this.data });
      this._refresh();
      return true;
    }

    findRow(idValue) {
      var i = this._indexOf(idValue);
      return i === -1 ? null : this._data[i];
    }

    getData() { return this.data; }

    /* ---- internos ---- */
    _indexOf(idValue) {
      for (var i = 0; i < this._data.length; i++) {
        if (getField(this._data[i], this.idKey) === idValue) return i;
      }
      return -1;
    }

    _emit(name, detail, cancelable) {
      return this.dispatchEvent(new CustomEvent(name, {
        detail: detail, bubbles: true, cancelable: !!cancelable
      }));
    }

    _actionButtons() {
      return this.getAttribute("actions") || "add,edit,duplicate,delete";
    }

    _canAdd() {
      if (this._hooks.canAdd && safe(this._hooks.canAdd, ctx({ total: this._data.length, limit: this.limit })) === false) return false;
      if (this.getAttribute("limit") != null && this.limit > 0 && this._data.length >= this.limit) return false;
      return true;
    }

    _ctxAdd() { return { total: this._data.length, limit: this.limit }; }

    _processRows(rows) {
      var out = clone(rows) || [];
      var t = safe(this._hooks.transform, ctx({ rows: out }));
      if (Array.isArray(t)) out = t;
      return out;
    }

    /* ------------------------- construcción ------------------------- */

    _render() {
      if (!this._ready) return;
      if (this._table && this._onTableClick) {
        this._table.removeEventListener("rowclick", this._onTableClick);
        this._table = null;
      }
      this._bAdd = null;
      this.textContent = "";

      var self = this;
      var lista = this._actionButtons();

      // Cabecera: título + botón Agregar
      var head = el("div", { class: "d-flex flex-wrap align-items-center gap-2 mb-2" });
      if (this.getAttribute("title")) {
        head.appendChild(el("h6", { class: "mb-0 me-auto fw-semibold", text: this.getAttribute("title") }));
      } else {
        head.appendChild(el("span", { class: "me-auto" }));
      }
      var bAdd = null;
      if (lista.indexOf("add") !== -1) {
        bAdd = el("button", {
          class: "btn btn-sm btn-primary", attrs: { type: "button" },
          text: this.getAttribute("add-label") || "+ Agregar"
        });
        bAdd.addEventListener("click", function () { if (self._emit("crud-open", { row: null, mode: "create" }, true)) self._openForm(null); });
        if (!this._canAdd()) bAdd.style.display = "none";
        head.appendChild(bAdd);
      }
      this._bAdd = bAdd;
      this.appendChild(head);

      // Contador de registros si hay límite
      if (this.getAttribute("limit") != null) {
        this.appendChild(el("div", {
          class: "crud-count small text-muted mb-2",
          text: this._data.length + " / " + this.limit + " registros"
        }));
      }

      // La tabla (data-table), con una columna extra de acciones
      var tbl = document.createElement("data-table");
      tbl.setAttribute("sortable", "");
      tbl.setAttribute("searchable", "");
      tbl.setAttribute("paginated", "");
      tbl.setAttribute("striped", "");
      if (this.hasAttribute("page-size")) tbl.setAttribute("page-size", this.getAttribute("page-size"));
      tbl.setAttribute("id-key", this.idKey);
      if (this.hasAttribute("table-hover")) tbl.setAttribute("hover", "");
      if (this.hasAttribute("table-bordered")) tbl.setAttribute("bordered", "");
      if (isTrueAttr(this, "dense")) tbl.setAttribute("size", "sm");
      if (isTrueAttr(this, "table-reorderable")) {
        tbl.setAttribute("reorderable", "");
      }
      if (isTrueAttr(this, "table-exportable")) tbl.setAttribute("exportable", "");
      if (isTrueAttr(this, "table-importable")) tbl.setAttribute("importable", "");
      if (this.getAttribute("empty-text")) tbl.setAttribute("empty-text", this.getAttribute("empty-text"));

      var rows = this._processRows(this._data);
      tbl.columns = this._cols.concat([this._actionColumn()]);
      tbl.data = rows;
      this._table = tbl;

      this._onTableClick = function (e) {
        var row = e && e.detail ? e.detail.row : null;
        if (row) self._emit("crud-rowclick", { row: row });
      };
      tbl.addEventListener("rowclick", this._onTableClick);
      this.appendChild(tbl);

      this._paintActions(rows);
      this._observeTable();
    }

    /* Columna "virtual" de acciones: data-table solo pinta texto, así que
       aporta un marcador y luego _paintActions mete los botones reales.   */
    _actionColumn() {
      return {
        key: "_crud_actions",
        label: this.getAttribute("actions-label") || "Acciones",
        sortable: false,
        align: "end",
        format: function () { return "…"; }
      };
    }

    /* Vigila la tabla para REPINTAR las acciones cada vez que se vuelve a
       dibujar por dentro (paginación, orden, búsqueda): la tabla no avisa
       de esos cambios, así que observamos su DOM. Observamos el propio
       elemento tabla porque al repintarse reemplaza TODO su contenido
       (incluido el tbody), no solo las filas.                            */
    _observeTable() {
      if (!this._table || typeof MutationObserver === "undefined") return;
      var self = this;
      if (!this._observer) {
        this._observer = new MutationObserver(function () { self._paintSoon(); });
      }
      try {
        this._observer.disconnect();
        this._observer.observe(this._table, { childList: true, subtree: true });
      } catch (e) { /* entornos sin soporte: se ignora */ }
    }

    /* Agrupa varios avisos seguidos en un solo repintado. */
    _paintSoon() {
      var self = this;
      if (this._paintQueued) return;
      this._paintQueued = true;
      var run = function () { self._paintQueued = false; self._paintActions(); };
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
      else setTimeout(run, 0);
    }

    /* Tras pintar data-table, sustituimos la última celda de cada fila
       por el grupo de botones (Editar / Duplicar / Eliminar).
       Empareja cada fila visible con su registro real por id (no por
       posición), porque la tabla puede ordenar/paginar y el orden ya no
       coincide con this._data. Pausa el observador mientras escribe para
       no realimentarse en bucle.                                        */
    _paintActions(viewRows) {
      if (!this._table) return;
      var tbody = this._table.querySelector("tbody");
      if (!tbody) return;
      if (this._observer) { try { this._observer.disconnect(); } catch (e) {} }
      var list = viewRows || this._processRows(this._data);
      var trs = tbody.querySelectorAll("tr");
      for (var i = 0; i < trs.length; i++) {
        var celda = trs[i].lastElementChild;
        if (!celda) continue;
        // Restaurar el marcador si aún es el texto plano "…" de la tabla
        if (!celda.classList.contains("crud-actions-cell")) {
          celda.classList.add("crud-actions-cell", "text-end");
        }
        celda.textContent = "";
        celda.classList.add("text-end");
        // 1) id real estampado por la tabla (si esa versión lo aporta)
        var idVal = celda.getAttribute("data-crud-id");
        if (idVal == null) idVal = trs[i].getAttribute("data-row-id");
        var fila = null;
        // 2) respaldo: identificar la fila comparando el texto de las celdas
        if (idVal == null) {
          var tds = trs[i].querySelectorAll("td");
          var textos = [];
          for (var t = 0; t < tds.length - 1; t++) textos.push((tds[t].textContent || "").trim());
          for (var k = 0; k < list.length; k++) {
            var igual = true;
            for (var c = 0; c < this._cols.length; c++) {
              var col = this._cols[c];
              if (!col || col.key === "_crud_actions") continue;
              var esperado = col.format ? String(col.format(list[k], list[k][col.key])).trim()
                                        : String(list[k][col.key] == null ? "" : list[k][col.key]).trim();
              if (textos[c] != null && textos[c] !== esperado) { igual = false; break; }
            }
            if (igual) { fila = list[k]; break; }
          }
          if (fila) idVal = getField(fila, this.idKey);
        } else {
          fila = this.findRow(idVal);
        }
        if (!fila) continue;
        var caja = this._actionCell(fila);
        if (caja.childNodes.length) celda.appendChild(caja);
      }
      this._observeTable();
    }

    _actionCell(row) {
      var self = this;
      var lista = this._actionButtons();
      var idVal = getField(row, this.idKey);
      var chk = el("div", { class: "btn-group btn-group-sm", attrs: { role: "group" } });
      // Los botones son solo iconos de Bootstrap Icons; el texto va en title y
      // en aria-label, y se muestra un tooltip al pasar el raton.

      if (lista.indexOf("edit") !== -1 && safe(this._hooks.canEdit, ctx({ row: row })) !== false) {
        var bEdit = el("button", {
          class: "btn btn-outline-primary",
          attrs: { type: "button", title: "Editar", "aria-label": "Editar" }
        });
        bEdit.appendChild(el("i", { class: "bi bi-pencil-square", attrs: { "aria-hidden": "true" } }));
        self._hoverTooltip(bEdit);
        bEdit.addEventListener("click", function (e) { e.stopPropagation();
          var idTx = getField(row, self.idKey);
          var ok = self._emit("crud-open", { row: row, mode: "edit" }, true);
          if (window.console && console.log) console.log("[crud-datos] clic Editar -> id=", idTx, "| aviso crud-open cancelado:", !ok);
          if (ok) self._openForm(row);
        });
        chk.appendChild(bEdit);
      }
      if (lista.indexOf("duplicate") !== -1) {
        var bDup = el("button", {
          class: "btn btn-outline-secondary",
          attrs: { type: "button", title: "Duplicar", "aria-label": "Duplicar" }
        });
        bDup.appendChild(el("i", { class: "bi bi-files", attrs: { "aria-hidden": "true" } }));
        self._hoverTooltip(bDup);
        bDup.addEventListener("click", function (e) { e.stopPropagation(); self._duplicate(row); });
        chk.appendChild(bDup);
      }
      if (lista.indexOf("delete") !== -1 && safe(this._hooks.canDelete, ctx({ row: row })) !== false) {
        var bDel = el("button", {
          class: "btn btn-outline-danger",
          attrs: { type: "button", title: "Eliminar", "aria-label": "Eliminar" }
        });
        bDel.appendChild(el("i", { class: "bi bi-trash3", attrs: { "aria-hidden": "true" } }));
        self._hoverTooltip(bDel);
        bDel.addEventListener("click", function (e) { e.stopPropagation(); self._confirmDelete(row, idVal); });
        chk.appendChild(bDel);
      }
      return chk;
    }

    /* Muestra un tooltip de Bootstrap al pasar el raton sobre un boton.
       No usa atributos inline: crea la instancia por JS. Si Bootstrap no
       esta disponible, el navegador ya muestra el "title" nativo. */
    _hoverTooltip(btn) {
      btn.addEventListener("mouseenter", function () {
        if (window.bootstrap && bootstrap.Tooltip && !btn._tip) {
          btn._tip = new bootstrap.Tooltip(btn, { container: "body", trigger: "hover" });
          btn._tip.show();
        }
      });
      btn.addEventListener("mouseleave", function () {
        if (btn._tip) { btn._tip.dispose(); btn._tip = null; }
      });
    }

    _confirmDelete(row, idVal) {
      if (this._hooks.confirmDelete) {
        if (safe(this._hooks.confirmDelete, ctx({ row: row })) === false) return;
      } else if (isTrueAttr(this, "confirm-delete") && window.confirm) {
        if (!window.confirm("¿Eliminar este registro?")) return;
      }
      if (!this._emit("crud-before-delete", { row: row, id: idVal }, true)) return;
      this.removeRow(idVal);
    }

    _duplicate(row) {
      var copia = clone(row) || {};
      delete copia[this.idKey];
      if (!this._canAdd()) {
        this._emit("crud-error", { message: "Se alcanzó el límite de " + this.limit + " registros" });
        return;
      }
      var copiaId = getField(copia, this.idKey);
      if (copiaId == null || copiaId === "") {
        var gen = safe(this._hooks.idGenerator, ctx({ row: copia }));
        if (gen != null) setField(copia, this.idKey, gen);
      }
      if (!this._emit("crud-before-add", { row: copia }, true)) return;
      var t = safe(this._hooks.transform, ctx({ rows: clone(this._data) }));
      if (Array.isArray(t)) this._data = t;
      this._data.push(copia);
      this._emit("crud-duplicate", { from: row, row: copia, data: this.data });
      this._emit("crud-change", { reason: "duplicate", row: copia, data: this.data });
      this._refresh();
    }

    _refresh() {
      if (!this._ready || !this._table) return;
      var rows = this._processRows(this._data);
      this._table.columns = this._cols.concat([this._actionColumn()]);
      this._table.data = rows;
      this._paintActions(rows);
      var count = this.querySelector(":scope > .crud-count");
      if (count) count.textContent = this._data.length + " / " + this.limit + " registros";
      if (this._bAdd) this._bAdd.style.display = this._canAdd() ? "" : "none";
    }

    /* ---------------------------- modal ---------------------------- */

    _openForm(rowOriginal) {
      var self = this;
      var esEdicion = !!rowOriginal;
      if (window.console && console.log) console.log("[crud-datos] _openForm modo=", (esEdicion ? "editar" : "crear"), "| fila=", rowOriginal);

      if (!esEdicion) {
        if (this._hooks.canAdd && safe(this._hooks.canAdd, ctx({ total: this._data.length, limit: this.limit })) === false) {
          this._emit("crud-error", { message: "No está permitido agregar más registros" });
          return;
        }
        if (this.getAttribute("limit") != null && this.limit > 0 && this._data.length >= this.limit) {
          this._emit("crud-error", { message: "Se alcanzó el límite de " + this.limit + " registros" });
          return;
        }
      }

      // Valores iniciales del formulario
      var base = {};
      this._cols.forEach(function (c) { base[c.key] = ""; });
      if (esEdicion) {
        var vista = safe(self._hooks.toForm, ctx({ row: rowOriginal }));
        var origen = (vista && typeof vista === "object") ? vista : rowOriginal;
        this._cols.forEach(function (c) {
          var v = getField(origen, c.key);
          if (v !== undefined) base[c.key] = v;
        });
      }

      var inputs = {};
      var form = el("form", { attrs: { novalidate: "novalidate" } });

      this._cols.forEach(function (col) {
        var editable = col.editable !== false;
        var fid = nextId("crud-field");
        var wrap = el("div", { class: "mb-3" });
        var lab = el("label", { class: "form-label", attrs: { for: fid } });
        lab.appendChild(document.createTextNode(col.label));
        if (col.required) {
          lab.appendChild(el("span", { class: "text-danger ms-1", attrs: { "aria-hidden": "true" }, text: "*" }));
        }
        wrap.appendChild(lab);

        var control, val = base[col.key];

        if (!editable) {
          control = el("input", {
            class: "form-control", attrs: { id: fid, type: "text", readonly: "readonly" },
            props: { value: val == null ? "" : String(val) }
          });
        } else if (col.options) {
          control = el("select", { class: "form-select", attrs: { id: fid } });
          control.appendChild(el("option", { attrs: { value: "" }, text: "— Seleccione —" }));
          col.options.forEach(function (op) {
            var ov = (op != null && typeof op === "object") ? op.value : op;
            var ol = (op != null && typeof op === "object") ? op.label : op;
            control.appendChild(el("option", { attrs: { value: String(ov) }, text: String(ol != null ? ol : "") }));
          });
          control.value = val == null ? "" : String(val);
        } else if (col.type === "bool") {
          control = el("input", { class: "form-check-input", attrs: { id: fid, type: "checkbox" } });
          control.checked = val === true || val === "true" || val === 1 || val === "1";
          var chk = el("div", { class: "form-check" });
          chk.appendChild(control);
          chk.appendChild(el("label", { class: "form-check-label", attrs: { for: fid }, text: "Sí" }));
          wrap.appendChild(chk);
          inputs[col.key] = control;
          if (col.help) wrap.appendChild(el("div", { class: "form-text", text: col.help }));
          form.appendChild(wrap);
          return;
        } else {
          var tipo = col.type === "number" ? "number" : (col.type === "date" ? "date" : "text");
          control = el("input", { class: "form-control", attrs: { id: fid, type: tipo } });
          if (col.type === "date") control.value = val ? fmtDateInput(val) : "";
          else control.value = val == null ? "" : String(val);
          if (col.placeholder != null) control.setAttribute("placeholder", String(col.placeholder));
          if (col.type === "number") control.setAttribute("step", "any");
        }

        wrap.appendChild(control);
        wrap.appendChild(el("div", { class: "invalid-feedback", attrs: { "data-err": col.key } }));
        if (col.help) wrap.appendChild(el("div", { class: "form-text", text: col.help }));

        inputs[col.key] = control;
        form.appendChild(wrap);
      });

      var bCancel = el("button", {
        class: "btn btn-outline-secondary",
        attrs: { type: "button", "data-bs-dismiss": "modal" }, text: "Cancelar"
      });
      var bSave = el("button", {
        class: "btn btn-primary", attrs: { type: "submit" }, text: esEdicion ? "Guardar cambios" : "Agregar"
      });

      var content = el("div", { class: "modal-content" }, [
        el("div", { class: "modal-header" }, [
          el("h5", { class: "modal-title", text: (esEdicion ? "Editar " : "Nuevo ") + (this.getAttribute("title") || "registro") }),
          el("button", { class: "btn-close", attrs: { type: "button", "data-bs-dismiss": "modal", "aria-label": "Cerrar" } })
        ]),
        el("div", { class: "modal-body" }, [form]),
        el("div", { class: "modal-footer" }, [
          el("div", { class: "d-flex justify-content-end gap-2" }, [bCancel, bSave])
        ])
      ]);
      var dialog = el("div", { class: "modal-dialog modal-dialog-centered" }, [content]);
      var modal = el("div", { class: "modal fade", attrs: { tabindex: "-1", "aria-hidden": "true" } }, [dialog]);

      document.body.appendChild(modal);

      var cerrar = function () { if (modal.parentNode) modal.parentNode.removeChild(modal); };
      var instancia = null;
      if (window.bootstrap && window.bootstrap.Modal) {
        instancia = new window.bootstrap.Modal(modal);
        modal.addEventListener("hidden.bs.modal", cerrar);
        instancia.show();
      } else {
        modal.classList.add("show");
        modal.style.display = "block";
      }
      if (window.console && console.log) console.log("[crud-datos] formulario abierto para", (esEdicion ? "editar" : "crear"));

      var limpiarErrores = function () {
        Object.keys(inputs).forEach(function (k) {
          inputs[k].classList.remove("is-invalid");
          var e = form.querySelector('[data-err="' + k + '"]');
          if (e) e.textContent = "";
        });
      };
      var marcarError = function (key, msg) {
        if (inputs[key]) inputs[key].classList.add("is-invalid");
        var e = form.querySelector('[data-err="' + key + '"]');
        if (e) e.textContent = msg;
      };

      form.addEventListener("submit", function (e) {
        e.preventDefault();
        limpiarErrores();

        // 1) Leer los valores del formulario según el tipo de cada campo
        var valores = {};
        self._cols.forEach(function (col) {
          var c = inputs[col.key];
          if (!c) return;
          var raw;
          if (col.editable === false) raw = base[col.key];
          else if (col.type === "bool") raw = c.checked;
          else raw = c.value;
          valores[col.key] = castValue(raw, col);
        });

        // 2) Proceso previo: validación (puede vetar y marcar campos)
        var res = safe(self._hooks.validate, ctx({ values: valores, row: rowOriginal }));
        var hayError = false;
        if (res && typeof res === "object" && res.errors) {
          Object.keys(res.errors).forEach(function (k) { marcarError(k, res.errors[k]); hayError = true; });
        }
        if (res && typeof res === "object" && res.ok === false) hayError = true;
        if (!hayError) {
          self._cols.forEach(function (col) {
            if (!col.required) return;
            var v = valores[col.key];
            if (v === "" || v == null) { marcarError(col.key, "Este campo es obligatorio"); hayError = true; }
          });
        }
        if (hayError) return;

        // 3) Proceso previo: construir la fila (fromForm puede transformar)
        var fila;
        if (esEdicion) {
          var cambios = safe(self._hooks.fromForm, ctx({ values: valores, row: rowOriginal }));
          cambios = (cambios && typeof cambios === "object") ? cambios : valores;
          fila = clone(rowOriginal) || {};
          Object.keys(cambios).forEach(function (k) { setField(fila, k, cambios[k]); });
        } else {
          fila = safe(self._hooks.fromForm, ctx({ values: valores, row: null }));
          fila = (fila && typeof fila === "object") ? clone(fila) : clone(valores);
          // El id del registro siempre vive en la clave indicada (id-key).
          var idAct = getField(fila, self.idKey);
          if (idAct == null || idAct === "") {
            var gen = safe(self._hooks.idGenerator, ctx({ row: fila }));
            var genId = (gen != null && gen !== "") ? gen : fila.id;
            if (genId != null) setField(fila, self.idKey, genId);
            else {
              // Respaldo: si no hay id, genera uno simple para poder editar/eliminar.
              setField(fila, self.idKey, "row-" + Date.now() + "-" + Math.floor(Math.random() * 1000));
            }
          }
          if (self.idKey !== "id" && fila.id != null) delete fila.id;
        }

        // 4) Proceso posterior: aviso cancelable antes de aplicar
        if (!self._emit(esEdicion ? "crud-before-update" : "crud-before-add", {
          row: fila, values: valores, original: rowOriginal || null
        }, true)) return;

        var t = safe(self._hooks.transform, ctx({ rows: clone(self._data) }));
        if (Array.isArray(t)) self._data = t;

        if (esEdicion) {
          var i = self._indexOf(getField(rowOriginal, self.idKey));
          if (i !== -1) self._data[i] = fila; else self._data.push(fila);
          self._emit("crud-update", { row: fila, original: rowOriginal, data: self.data });
          self._emit("crud-change", { reason: "update", row: fila, data: self.data });
        } else {
          self._data.push(fila);
          self._emit("crud-add", { row: fila, data: self.data });
          self._emit("crud-change", { reason: "add", row: fila, data: self.data });
        }

        self._refresh();
        if (instancia) instancia.hide(); else cerrar();
      });
    }
  };

  customElements.define("crud-data", CrudData);
})();