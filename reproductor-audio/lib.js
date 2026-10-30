/* ============================================================================
   Reproductor Audio  —  Web Component nativo <audio-player>
   Librería reutilizable (un solo archivo, JS puro, sin build, sin imports).
   Cárgala con: <script src="lib.js"></script>
   No usa Shadow DOM (hereda Bootstrap 5 y estilos de la app que la cargue).
   ========================================================================== */
(function () {
  "use strict";

  // Evita redefinir si el archivo se carga dos veces.
  if (window.customElements && customElements.get("audio-player")) {
    return;
  }

  var STYLE_ID = "audio-player-reproductor-css";
  var ANIM = "apTitleScroll";

  // --- CSS inyectado una sola vez (sin innerHTML con datos dinámicos) -------
  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) { return; }
    var css = "" +
      "audio-player{position:fixed;right:16px;bottom:16px;z-index:1080;" +
        "width:320px;max-width:calc(100vw - 32px);display:block;" +
        "font-size:.875rem;}" +
      "audio-player .ap-card{border-radius:.75rem;overflow:hidden;" +
        "box-shadow:0 .5rem 1.5rem rgba(0,0,0,.35);}" +
      "audio-player .ap-title-wrap{overflow:hidden;white-space:nowrap;" +
        "position:relative;}" +
      "audio-player .ap-title-track{display:inline-block;padding-left:100%;" +
        "will-change:transform;animation:" + ANIM + " 12s linear infinite;}" +
      "audio-player .ap-title-track.ap-paused{animation-play-state:paused;}" +
      "@keyframes " + ANIM + "{0%{transform:translateX(0);}" +
        "100%{transform:translateX(-100%);}}" +
      "audio-player .ap-btn{min-width:38px;}" +
      "audio-player .ap-range{height:.35rem;cursor:pointer;}" +
      "audio-player .ap-time{font-variant-numeric:tabular-nums;}" +
      "audio-player .ap-fading{animation:apPulse 1s ease-in-out infinite;}" +
      "@keyframes apPulse{0%,100%{opacity:1;}50%{opacity:.45;}}";
    var el = document.createElement("style");
    el.id = STYLE_ID;
    el.textContent = css;
    (document.head || document.documentElement).appendChild(el);
  }

  // --- Utilidades -----------------------------------------------------------
  function mkBtn(label, aria, extraClass) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "btn btn-outline-light btn-sm ap-btn " + (extraClass || "");
    b.textContent = label;              // texto escapado, nunca innerHTML
    b.setAttribute("aria-label", aria);
    b.title = aria;
    return b;
  }

  function fmtTime(s) {
    if (!isFinite(s) || s < 0) { s = 0; }
    var m = Math.floor(s / 60);
    var r = Math.floor(s % 60);
    return m + ":" + (r < 10 ? "0" + r : r);
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  // --- Definición del Web Component ----------------------------------------
  var AudioPlayer = class extends HTMLElement {

    static get observedAttributes() {
      return ["src", "name", "volume", "autoplay"];
    }

    constructor() {
      super();
      this._built = false;
      this._fadeTimer = null;     // intervalo de volumen continuo
      this._fadeDir = 0;          // -1 baja, +1 sube, 0 parado
      this._audio = null;
    }

    connectedCallback() {
      ensureStyles();
      if (!this._built) { this._build(); }
      // Aplica atributos ya presentes en el HTML.
      if (this.hasAttribute("src"))    { this._setSrc(this.getAttribute("src")); }
      if (this.hasAttribute("name"))   { this._setName(this.getAttribute("name")); }
      if (this.hasAttribute("volume")) { this._setVolume(parseFloat(this.getAttribute("volume"))); }
      if (this.hasAttribute("autoplay") && this._audio && this._audio.src) {
        var p = this._audio.play();
        if (p && p.catch) { p.catch(function () {}); }
      }
    }

    disconnectedCallback() {
      this._stopFade();
    }

    attributeChangedCallback(nameAttr, oldV, newV) {
      if (!this._built) { return; }
      if (oldV === newV) { return; }
      if (nameAttr === "src")    { this._setSrc(newV); }
      if (nameAttr === "name")   { this._setName(newV); }
      if (nameAttr === "volume") { this._setVolume(parseFloat(newV)); }
    }

    // ---- Propiedades JS normales ----
    get src()  { return this._audio ? this._audio.src : this.getAttribute("src"); }
    set src(v) { this.setAttribute("src", v == null ? "" : String(v)); }

    get name()  { return this._name || ""; }
    set name(v) { this.setAttribute("name", v == null ? "" : String(v)); }

    get volume() { return this._audio ? this._audio.volume : 1; }
    set volume(v) { this._setVolume(v); }

    play()  { if (this._audio) { var p = this._audio.play(); if (p && p.catch) { p.catch(function () {}); } } }
    pause() { if (this._audio) { this._audio.pause(); } }

    // ---- Construcción del DOM (una sola vez) ----
    _build() {
      this._built = true;

      var card = document.createElement("div");
      card.className = "ap-card bg-dark text-light p-2";

      // Título tipo carrusel
      var titleWrap = document.createElement("div");
      titleWrap.className = "ap-title-wrap mb-2 text-info fw-semibold";
      var track = document.createElement("span");
      track.className = "ap-title-track";
      track.textContent = "Reproductor Audio";
      titleWrap.appendChild(track);
      this._titleTrack = track;

      // Barra de progreso
      var prog = document.createElement("input");
      prog.type = "range";
      prog.className = "form-range ap-range mb-1";
      prog.min = "0"; prog.max = "100"; prog.value = "0"; prog.step = "0.1";
      prog.setAttribute("aria-label", "Progreso de reproducción");
      this._prog = prog;

      // Tiempos
      var timeRow = document.createElement("div");
      timeRow.className = "d-flex justify-content-between ap-time text-secondary mb-2";
      var cur = document.createElement("span"); cur.textContent = "0:00";
      var dur = document.createElement("span"); dur.textContent = "0:00";
      timeRow.appendChild(cur); timeRow.appendChild(dur);
      this._cur = cur; this._dur = dur;

      // Grupo de botones
      var controls = document.createElement("div");
      controls.className = "btn-group w-100";
      controls.setAttribute("role", "group");

      var playBtn = mkBtn("▶", "Reproducir / Pausar", "btn-primary");
      playBtn.classList.remove("btn-outline-light");
      var volDown = mkBtn("🔉", "Bajar volumen de forma continua (clic para iniciar / parar)");
      var volUp   = mkBtn("🔊", "Subir volumen de forma continua (clic para iniciar / parar)");
      var muteBtn = mkBtn("🔇", "Silenciar / Activar sonido");
      var dlBtn   = mkBtn("⬇", "Descargar la música", "btn-outline-info");
      dlBtn.classList.remove("btn-outline-light");

      controls.appendChild(playBtn);
      controls.appendChild(volDown);
      controls.appendChild(volUp);
      controls.appendChild(muteBtn);
      controls.appendChild(dlBtn);

      this._playBtn = playBtn;
      this._volDown = volDown;
      this._volUp = volUp;
      this._muteBtn = muteBtn;

      // Elemento <audio> real (oculto)
      var audio = document.createElement("audio");
      audio.preload = "metadata";
      audio.style.display = "none";
      this._audio = audio;

      card.appendChild(titleWrap);
      card.appendChild(prog);
      card.appendChild(timeRow);
      card.appendChild(controls);
      card.appendChild(audio);
      this.appendChild(card);

      this._wire();
    }

    // ---- Listeners (addEventListener, nunca onclick inline) ----
    _wire() {
      var self = this;
      var audio = this._audio;

      this._playBtn.addEventListener("click", function () {
        if (audio.paused) {
          var p = audio.play();
          if (p && p.catch) { p.catch(function () {}); }
        } else {
          audio.pause();
        }
      });

      audio.addEventListener("play", function () {
        self._playBtn.textContent = "⏸";
        self._titleTrack.classList.remove("ap-paused");
        self._emit("play");
      });
      audio.addEventListener("pause", function () {
        self._playBtn.textContent = "▶";
        self._titleTrack.classList.add("ap-paused");
        self._emit("pause");
      });
      audio.addEventListener("ended", function () {
        self._playBtn.textContent = "▶";
        self._emit("ended");
      });
      audio.addEventListener("loadedmetadata", function () {
        self._dur.textContent = fmtTime(audio.duration);
      });
      audio.addEventListener("timeupdate", function () {
        self._cur.textContent = fmtTime(audio.currentTime);
        if (audio.duration) {
          self._prog.value = String((audio.currentTime / audio.duration) * 100);
        }
      });
      audio.addEventListener("volumechange", function () {
        self._emit("volumechange", { volume: audio.volume, muted: audio.muted });
      });
      audio.addEventListener("error", function () {
        self._emit("error", { src: audio.currentSrc || "" });
      });

      this._prog.addEventListener("input", function () {
        if (audio.duration) {
          audio.currentTime = (parseFloat(self._prog.value) / 100) * audio.duration;
        }
      });

      this._muteBtn.addEventListener("click", function () {
        audio.muted = !audio.muted;
        self._muteBtn.classList.toggle("active", audio.muted);
      });

      // Volumen continuo: clic = iniciar; otro clic = parar.
      this._volDown.addEventListener("click", function () {
        self._toggleFade(-1);
      });
      this._volUp.addEventListener("click", function () {
        self._toggleFade(1);
      });

      // Descarga: intenta bajar el archivo y además avisa a la app por evento.
      this.querySelector(".btn-outline-info") &&
      this._muteBtn && // (referencia segura, no imprescindible)
      0; // noop para legibilidad
      var dlBtn = this.querySelectorAll("button")[4];
      if (dlBtn) {
        dlBtn.addEventListener("click", function () {
          self._download();
        });
      }
    }

    // ---- Lógica de volumen continuo ----
    _toggleFade(dir) {
      // Si ya se estaba desvaneciendo en la misma dirección -> parar.
      if (this._fadeDir === dir) { this._stopFade(); return; }
      this._stopFade();
      this._fadeDir = dir;
      var self = this;
      var audio = this._audio;
      var btn = dir < 0 ? this._volDown : this._volUp;
      btn.classList.add("active", "ap-fading");
      this._fadeTimer = window.setInterval(function () {
        var next = clamp(audio.volume + dir * 0.05, 0, 1);
        audio.volume = next;
        if ((dir < 0 && next <= 0) || (dir > 0 && next >= 1)) {
          self._stopFade();   // llegó al límite, se detiene solo
        }
      }, 150);
    }

    _stopFade() {
      if (this._fadeTimer) {
        window.clearInterval(this._fadeTimer);
        this._fadeTimer = null;
      }
      this._fadeDir = 0;
      if (this._volDown) { this._volDown.classList.remove("active", "ap-fading"); }
      if (this._volUp)   { this._volUp.classList.remove("active", "ap-fading"); }
    }

    // ---- Descarga ----
    _download() {
      var audio = this._audio;
      var url = audio ? (audio.currentSrc || audio.src) : "";
      this._emit("download", { src: url, name: this._name || "" });
      if (!url) { return; }
      var a = document.createElement("a");
      a.href = url;
      a.download = (this._name || "audio").replace(/[\\/:*?"<>|]+/g, "_");
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }

    // ---- Setters internos ----
    _setSrc(v) {
      this._stopFade();
      this._audio.src = v || "";
      this._prog.value = "0";
      this._cur.textContent = "0:00";
      this._dur.textContent = "0:00";
      if (!this._name && v) {
        var clean = String(v).split("?")[0].split("/").pop();
        this._setName(decodeURIComponent(clean || ""));
      }
    }

    _setName(v) {
      this._name = v || "";
      this._titleTrack.textContent = this._name || "Reproductor Audio";
    }

    _setVolume(v) {
      if (isNaN(v)) { return; }
      this._audio.volume = clamp(v, 0, 1);
    }

    // ---- Emisor de eventos ----
    _emit(type, detail) {
      this.dispatchEvent(new CustomEvent(type, {
        detail: detail || {},
        bubbles: true
      }));
    }
  };

  customElements.define("audio-player", AudioPlayer);

})();