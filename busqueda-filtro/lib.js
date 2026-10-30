/*!
 * Busqueda Filtro — Web Component <search-filter>
 * Librería reutilizable en JavaScript puro (sin framework, sin build).
 * Cárgala con <script src="lib.js"></script> dentro de la misma página de tu app.
 *
 * Campo de búsqueda con autocompletado, resultados paginados y presentación
 * configurable (lista, tabla o tarjetas). No obtiene datos por su cuenta:
 * delega la búsqueda en una función que define la app (searchCallback) y
 * comunica la selección mediante el evento "item-selected".
 *
 * Diseño: sin Shadow DOM (hereda Bootstrap 5 de la app), seguro contra XSS
 * (todo dato dinámico se escapa), sin innerHTML y sin variables globales sueltas.
 */
(function () {
  "use strict";

  // Evita redefinir el elemento si el script se carga dos veces.
  if (window.customElements && customElements.get("search-filter")) {
    return;
  }

  var INTERACTIVE_TAGS = ["BUTTON", "A", "INPUT", "SELECT", "TEXTAREA"];
  var INTERACTIVE_SELECTOR = "button, a, input, select, textarea";

  class SearchFilter extends HTMLElement {
    // Atributos que, al cambiar, pueden requerir re-render del desplegable.
    static get observedAttributes() {
      return ["limit", "layout", "display-template", "value-field", "placeholder"];
    }

    constructor() {
      super();

      this._currentPage = 1;
      this._searchTerm = "";
      this._searchCallback = null;
      this._columns = [];
      this._debounceTimer = null;
      this._abortController = null;
      this._rendered = false;

      // Referencia fija para poder añadir/remover el mismo listener global.
      this._onDocumentClick = this._onDocumentClick.bind(this);
    }

    connectedCallback() {
      if (!this._rendered) {
        this.renderBaseStructure();
        this.bindEvents();
        this._rendered = true;
      }
    }

    disconnectedCallback() {
      // Limpieza de listeners globales, timers y peticiones pendientes (F10).
      document.removeEventListener("click", this._onDocumentClick);
      clearTimeout(this._debounceTimer);
      if (this._abortController) {
        this._abortController.abort();
        this._abortController = null;
      }
    }

    attributeChangedCallback(name, oldValue, newValue) {
      if (!this._rendered || oldValue === newValue) return;

      if (name === "placeholder" && this.searchInput) {
        this.searchInput.setAttribute(
          "placeholder",
          newValue || "Escriba para buscar..."
        );
        return;
      }
      // Si el desplegable está visible y cambia una opción de presentación,
      // re-ejecuta la búsqueda para reflejar la nueva configuración.
      if (
        this.resultsContainer &&
        !this.resultsContainer.classList.contains("d-none") &&
        this._searchTerm.length > 0
      ) {
        this.executeSearch();
      }
    }

    // ---------- Propiedades JS ----------

    set searchCallback(fn) {
      this._searchCallback = typeof fn === "function" ? fn : null;
    }
    get searchCallback() {
      return this._searchCallback;
    }

    set columns(config) {
      this._columns = Array.isArray(config) ? config : [];
    }
    get columns() {
      return this._columns;
    }

    // ---------- Utilidades de escapado (F9) ----------

    /** Escapa texto para insertarlo de forma segura dentro de HTML. */
    escapeHtml(value) {
      return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
        return {
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        }[c];
      });
    }

    /** Escapa un valor para insertarlo dentro de un atributo HTML. */
    escapeAttribute(value) {
      return this.escapeHtml(value);
    }

    /**
     * Convierte una cadena HTML (plantilla del desarrollador con los datos
     * YA escapados) en nodos DOM reales y los añade a `parent`, SIN usar
     * innerHTML. DOMParser no ejecuta scripts ni eventos inline, por lo que
     * el contenido se inserta de forma segura.
     */
    _appendHtml(parent, htmlString) {
      var doc = new DOMParser().parseFromString(
        String(htmlString == null ? "" : htmlString),
        "text/html"
      );
      var body = doc.body;
      if (!body) return;
      // appendChild adopta y MUEVE cada nodo, así que la lista se va vaciando.
      while (body.firstChild) {
        parent.appendChild(body.firstChild);
      }
    }

    // ---------- Estructura base ----------

    renderBaseStructure() {
      var placeholder = this.getAttribute("placeholder") || "Escriba para buscar...";

      var container = document.createElement("div");
      container.className = "search-filter-container position-relative";

      var input = document.createElement("input");
      input.type = "text";
      input.className = "form-control";
      input.setAttribute("placeholder", placeholder);
      input.setAttribute("autocomplete", "off");

      var results = document.createElement("div");
      results.className =
        "results-container mt-1 w-100 bg-white border rounded shadow-sm d-none z-3";
      results.style.position = "absolute";

      var body = document.createElement("div");
      body.className = "results-body p-2";
      body.style.maxHeight = "400px";
      body.style.overflowY = "auto";

      var footer = document.createElement("div");
      footer.className =
        "results-footer d-flex justify-content-between p-2 border-top bg-light";

      var prev = document.createElement("button");
      prev.type = "button";
      prev.className = "btn btn-sm btn-outline-secondary btn-prev d-none";
      prev.textContent = "Anterior";

      var indicator = document.createElement("span");
      indicator.className = "page-indicator text-muted small align-self-center";
      indicator.textContent = "Página 1";

      var next = document.createElement("button");
      next.type = "button";
      next.className = "btn btn-sm btn-outline-primary btn-next d-none";
      next.textContent = "Siguiente";

      footer.appendChild(prev);
      footer.appendChild(indicator);
      footer.appendChild(next);
      results.appendChild(body);
      results.appendChild(footer);
      container.appendChild(input);
      container.appendChild(results);

      // Limpia e inserta (solo nodos creados por nosotros, sin datos externos).
      while (this.firstChild) this.removeChild(this.firstChild);
      this.appendChild(container);

      this.searchInput = input;
      this.resultsContainer = results;
      this.resultsBody = body;
      this.prevButton = prev;
      this.nextButton = next;
      this.pageIndicator = indicator;
    }

    bindEvents() {
      var self = this;

      // F1 + F2: captura con anti-rebote de 300 ms.
      this.searchInput.addEventListener("input", function (e) {
        clearTimeout(self._debounceTimer);
        self._searchTerm = e.target.value.trim();
        self._currentPage = 1;

        if (self._searchTerm.length === 0) {
          self.hideResults();
          if (self._abortController) {
            self._abortController.abort();
            self._abortController = null;
          }
          return;
        }
        self._debounceTimer = setTimeout(function () {
          self.executeSearch();
        }, 300);
      });

      this.prevButton.addEventListener("click", function () {
        self.changePage(-1);
      });
      this.nextButton.addEventListener("click", function () {
        self.changePage(1);
      });

      // F8: cierre al hacer clic fuera del componente.
      document.addEventListener("click", this._onDocumentClick);
    }

    _onDocumentClick(e) {
      if (!this.contains(e.target)) {
        this.hideResults();
      }
    }

    // ---------- Búsqueda (F3, F4) ----------

    executeSearch() {
      var self = this;

      if (!this._searchCallback) {
        console.warn("search-filter: searchCallback no está definido.");
        return;
      }

      var limit = parseInt(this.getAttribute("limit"), 10);
      if (!limit || limit < 1) limit = 10;

      // F4: cancela cualquier petición anterior todavía en curso.
      if (this._abortController) {
        this._abortController.abort();
      }
      var abortController = new AbortController();
      this._abortController = abortController;

      var searchTerm = this._searchTerm;
      var page = this._currentPage;

      Promise.resolve()
        .then(function () {
          return self._searchCallback(searchTerm, page, limit, {
            signal: abortController.signal,
          });
        })
        .then(function (results) {
          // Descarta respuestas obsoletas: si ya hay otra búsqueda más reciente.
          if (self._abortController !== abortController) return;

          if (!Array.isArray(results)) results = [];

          if (results.length === 0 && self._currentPage > 1) {
            self._currentPage--;
            self.executeSearch();
            return;
          }
          self.renderResults(results, limit);
        })
        .catch(function (error) {
          if (error && error.name === "AbortError") return; // cancelada: ignorar
          if (self._abortController !== abortController) return;
          console.error("search-filter: error en searchCallback", error);
          self.renderResults([], limit);
        });
    }

    changePage(delta) {
      this._currentPage += delta;
      if (this._currentPage < 1) this._currentPage = 1;
      this.executeSearch();
    }

    // ---------- Presentación (F5, F6) ----------

    renderResults(results, limit) {
      this.resultsContainer.classList.remove("d-none");
      while (this.resultsBody.firstChild) {
        this.resultsBody.removeChild(this.resultsBody.firstChild);
      }
      this.pageIndicator.textContent = "Página " + this._currentPage;

      var layout = this.getAttribute("layout") || "list";

      if (results.length === 0) {
        var empty = document.createElement("div");
        empty.className = "text-muted text-center p-2";
        empty.textContent = "No se encontraron resultados";
        this.resultsBody.appendChild(empty);
      } else if (layout === "table") {
        this.renderTable(results);
      } else if (layout === "card") {
        this.renderCard(results);
      } else {
        this.renderList(results);
      }

      this.prevButton.classList.toggle("d-none", this._currentPage === 1);
      this.nextButton.classList.toggle("d-none", results.length < limit);
    }

    /**
     * Reemplaza {campo} por el valor del item, SIEMPRE escapado (F9).
     * La plantilla (definida por el desarrollador vía display-template) se
     * conserva tal cual; solo se escapan los DATOS dinámicos.
     */
    parseTemplate(item) {
      var self = this;
      var template = this.getAttribute("display-template") || "";
      return template.replace(/{([^}]+)}/g, function (match, key) {
        if (item[key] === undefined || item[key] === null) return "";
        return self.escapeHtml(item[key]);
      });
    }

    // F7: selección -> escribe en el input y emite "item-selected".
    processSelection(item, representativeText) {
      this.searchInput.value =
        representativeText == null ? "" : String(representativeText);
      this.hideResults();
      this.dispatchEvent(
        new CustomEvent("item-selected", {
          detail: item,
          bubbles: true,
          composed: true,
        })
      );
    }

    hideResults() {
      if (this.resultsContainer) this.resultsContainer.classList.add("d-none");
    }

    _isInteractiveClick(e) {
      return (
        INTERACTIVE_TAGS.indexOf(e.target.tagName) !== -1 ||
        !!e.target.closest(INTERACTIVE_SELECTOR)
      );
    }

    renderTable(results) {
      var self = this;
      var table = document.createElement("table");
      table.className = "table table-hover table-sm mb-0 align-middle";

      var valueField = this.getAttribute("value-field");

      var thead = document.createElement("thead");
      var trHead = document.createElement("tr");
      this._columns.forEach(function (col) {
        var th = document.createElement("th");
        th.textContent = col.header || "";
        trHead.appendChild(th);
      });
      thead.appendChild(trHead);
      table.appendChild(thead);

      var tbody = document.createElement("tbody");
      results.forEach(function (item) {
        var tr = document.createElement("tr");
        tr.style.cursor = "pointer";

        var firstColumnText = "";
        self._columns.forEach(function (col, index) {
          var td = document.createElement("td");
          if (typeof col.html === "function") {
            // col.html lo define el desarrollador; recibe escapeHtml para que
            // escape cualquier dato dinámico que inserte (p. ej. data-mp3).
            // Se parsea con DOMParser (sin innerHTML).
            self._appendHtml(td, col.html(item, self.escapeHtml.bind(self)));
          } else {
            td.textContent = item[col.field] == null ? "" : String(item[col.field]);
          }
          tr.appendChild(td);
          if (index === 0) firstColumnText = item[col.field] == null ? "" : item[col.field];
        });

        var representativeText =
          valueField && item[valueField] != null ? item[valueField] : firstColumnText;

        tr.addEventListener("click", function (e) {
          if (self._isInteractiveClick(e)) return;
          self.processSelection(item, representativeText);
        });

        tbody.appendChild(tr);
      });

      table.appendChild(tbody);
      this.resultsBody.appendChild(table);
    }

    renderList(results) {
      var self = this;
      var listDiv = document.createElement("div");
      listDiv.className = "list-group list-group-flush";

      var valueField = this.getAttribute("value-field");

      results.forEach(function (item) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className =
          "list-group-item list-group-item-action border-0 border-bottom";
        // Plantilla del desarrollador con datos ya escapados -> nodos DOM.
        self._appendHtml(btn, self.parseTemplate(item));

        var representativeText =
          valueField && item[valueField] != null
            ? item[valueField]
            : (btn.textContent || "").trim();

        btn.addEventListener("click", function (e) {
          if (self._isInteractiveClick(e)) return;
          self.processSelection(item, representativeText);
        });

        listDiv.appendChild(btn);
      });

      this.resultsBody.appendChild(listDiv);
    }

    renderCard(results) {
      var self = this;
      var rowDiv = document.createElement("div");
      rowDiv.className = "row g-2";

      var valueField = this.getAttribute("value-field");

      results.forEach(function (item) {
        var col = document.createElement("div");
        col.className = "col-12 col-md-6";

        var card = document.createElement("div");
        card.className = "card h-100";
        card.style.cursor = "pointer";

        var cardBody = document.createElement("div");
        cardBody.className = "card-body p-2";
        self._appendHtml(cardBody, self.parseTemplate(item));

        var representativeText =
          valueField && item[valueField] != null
            ? item[valueField]
            : (cardBody.textContent || "").trim();

        card.appendChild(cardBody);
        col.appendChild(card);

        card.addEventListener("click", function (e) {
          if (self._isInteractiveClick(e)) return;
          self.processSelection(item, representativeText);
        });

        rowDiv.appendChild(col);
      });

      this.resultsBody.appendChild(rowDiv);
    }
  }

  customElements.define("search-filter", SearchFilter);
})();