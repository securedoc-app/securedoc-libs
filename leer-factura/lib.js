/**
 * Librería: Leer Factura (input-invoice)
 * Un Web Component nativo que permite cargar/fotografiar una factura, procesarla
 * mediante Tesseract.js (OCR) y extraer fecha, total e ítems mediante RegEx.
 */
(() => {
  // Garantizar la carga asíncrona de Tesseract.js si la app receptora no lo cargó
  let tesseractLoadingPromise = null;
  function ensureTesseractLoaded() {
    if (window.Tesseract) return Promise.resolve();
    if (tesseractLoadingPromise) return tesseractLoadingPromise;

    tesseractLoadingPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
      script.async = true;

      // Event listeners para la carga del script externo (evitando atributos inline)
      script.addEventListener("load", () => resolve());
      script.addEventListener("error", () => reject(new Error("No se pudo cargar Tesseract.js desde la CDN.")));

      document.head.appendChild(script);
    });

    return tesseractLoadingPromise;
  }

  // Lógica pura de parsing con Expresiones Regulares
  function parseInvoiceText(rawText) {
    const lines = rawText.split("\n").map(l => l.trim()).filter(Boolean);

    let fecha = null;
    let total = null;
    const items = [];

    // Patrones de fecha
    const fechaRegex = /(\b\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{2,4}\b|\b\d{4}[\/\.-]\d{1,2}[\/\.-]\d{1,2}\b)/;

    // Patrones de total (evitando confundir subtotal o IVA si hay una línea explícita de TOTAL)
    const totalRegex = /(?:total|importe\s+total|gran\s+total|monto\s+total)[\s\:\$]*([\d\.,]+)/i;
    const fallbackTotalRegex = /(?:total)[\s\:\$]*([\d\.,]+)/i;

    // Patrón de línea de ítem: Texto + Cantidad opcional + Precio (ej: "1x Leche Entera 1.50" o "Pan integral 2.20")
    const itemRegex = /^(.+?)\s+(?:(\d+)\s*x\s+)?([\d]+[\.\,]\d{2})$/i;

    lines.forEach(line => {
      // 1. Extraer fecha
      if (!fecha) {
        const matchFecha = line.match(fechaRegex);
        if (matchFecha) fecha = matchFecha[1];
      }

      // 2. Extraer total
      if (!total) {
        const matchTotal = line.match(totalRegex) || line.match(fallbackTotalRegex);
        if (matchTotal) {
          const parsedNum = parseFloat(matchTotal[1].replace(",", "."));
          if (!isNaN(parsedNum)) total = parsedNum;
        }
      }

      // 3. Extraer ítems
      const matchItem = line.match(itemRegex);
      if (matchItem) {
        const descripcion = matchItem[1].replace(/^[\d\.\-\*]+/, "").trim(); // Limpiar viñetas o números iniciales
        const cantidad = matchItem[2] ? parseInt(matchItem[2], 10) : 1;
        const precio = parseFloat(matchItem[3].replace(",", "."));

        // Evitar catalogar la línea de 'TOTAL' como un ítem de compra
        if (!/total|subtotal|iva|tax|cambio|efectivo/i.test(descripcion) && !isNaN(precio)) {
          items.push({ descripcion, cantidad, precio });
        }
      }
    });

    return {
      fecha: fecha || "",
      total: total !== null ? total : 0,
      items: items,
      rawText: rawText
    };
  }

  // Definición del Web Component nativo <input-invoice>
  class InputInvoice extends HTMLElement {
    static get observedAttributes() {
      return ["lang"];
    }

    constructor() {
      super();
      this._lang = "spa";
      this._value = { fecha: "", total: 0, items: [], rawText: "" };
      this._isProcessing = false;
    }

    get lang() {
      return this.getAttribute("lang") || this._lang;
    }

    set lang(val) {
      this.setAttribute("lang", val);
    }

    get value() {
      return this._value;
    }

    set value(val) {
      this._value = val || { fecha: "", total: 0, items: [], rawText: "" };
      this.render();
    }

    connectedCallback() {
      if (!this._initialized) {
        this._initialized = true;
        this.render();
      }
    }

    attributeChangedCallback(name, oldValue, newValue) {
      if (oldValue !== newValue && name === "lang") {
        this._lang = newValue || "spa";
      }
    }

    render() {
      // Limpiar contenido actual sin usar innerHTML
      this.textContent = "";

      const container = document.createElement("div");
      container.className = "card p-3 shadow-sm border";

      const label = document.createElement("label");
      label.className = "form-label fw-bold mb-2";
      label.textContent = "Seleccionar o fotografiar factura:";

      const fileInput = document.createElement("input");
      fileInput.type = "file";
      fileInput.accept = "image/*";
      fileInput.capture = "environment"; // Permitir cámara directa en móviles
      fileInput.className = "form-control mb-3";

      const statusDiv = document.createElement("div");
      statusDiv.className = "small text-muted mb-2";

      if (this._isProcessing) {
        fileInput.disabled = true;
        statusDiv.className = "small text-primary fw-semibold mb-2";
        statusDiv.textContent = "Procesando imagen con OCR (esto puede tomar unos segundos)...";
      }

      // Registro explícito mediante addEventListener (cero atributos inline)
      fileInput.addEventListener("change", (e) => this._handleFileSelect(e));

      container.appendChild(label);
      container.appendChild(fileInput);
      container.appendChild(statusDiv);

      // Si ya hay datos procesados, mostrar vista previa resumida
      if (!this._isProcessing && (this._value.total > 0 || this._value.items.length > 0 || this._value.fecha)) {
        const previewBox = document.createElement("div");
        previewBox.className = "bg-light p-2 rounded border small";

        const pFecha = document.createElement("p");
        pFecha.className = "mb-1";
        pFecha.textContent = `Fecha detectada: ${this._value.fecha || "No encontrada"}`;

        const pTotal = document.createElement("p");
        pTotal.className = "mb-1 fw-bold text-success";
        pTotal.textContent = `Total detectado: $${this._value.total}`;

        const pItems = document.createElement("p");
        pItems.className = "mb-0";
        pItems.textContent = `Ítems detectados: ${this._value.items.length}`;

        previewBox.appendChild(pFecha);
        previewBox.appendChild(pTotal);
        previewBox.appendChild(pItems);
        container.appendChild(previewBox);
      }

      this.appendChild(container);
    }

    async _handleFileSelect(event) {
      const file = event.target.files && event.target.files[0];
      if (!file) return;

      this._isProcessing = true;
      this.render();

      try {
        await ensureTesseractLoaded();

        const lang = this.lang || "spa";
        const worker = await window.Tesseract.createWorker(lang);
        const { data: { text } } = await worker.recognize(file);
        await worker.terminate();

        const parsedData = parseInvoiceText(text);
        this._value = parsedData;

        // Emitir CustomEvent "change" con los datos estructurados
        this.dispatchEvent(
          new CustomEvent("change", {
            detail: parsedData,
            bubbles: true,
            composed: true
          })
        );
      } catch (err) {
        this.dispatchEvent(
          new CustomEvent("error", {
            detail: { message: err.message || "Error procesando la imagen" },
            bubbles: true,
            composed: true
          })
        );
      } finally {
        this._isProcessing = false;
        this.render();
      }
    }
  }

  // Registrar Web Component nativo
  if (!customElements.get("input-invoice")) {
    customElements.define("input-invoice", InputInvoice);
  }
})();