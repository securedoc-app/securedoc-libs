/*
 * Reproductor Audio — <audio-player>
 * Librería reutilizable (Web Component nativo, sin Shadow DOM).
 * Hereda Bootstrap 5 de la página anfitriona y usa sus clases de color.
 * Requiere Bootstrap 5 CSS/JS y Bootstrap Icons cargados en la página.
 */
(function () {
  "use strict";

  // CSS mínimo: solo lo que Bootstrap no ofrece (deslizamiento y ancho fijo).
  if (!document.getElementById("audio-player-style")) {
    var st = document.createElement("style");
    st.id = "audio-player-style";
    st.textContent =
      "audio-player{position:fixed;right:0;bottom:20px;z-index:1050;" +
      "display:flex;align-items:stretch;transition:transform .35s ease}" +
      "audio-player.ap-hidden{transform:translateX(calc(100% - 34px))}" +
      "audio-player .ap-card{width:320px}" +
      "audio-player .ap-tab{width:34px}" +
      "audio-player .ap-vol{width:90px}";
    document.head.appendChild(st);
  }

  function el(tag, cls, attrs) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }
  function icon(name) { return el("i", "bi bi-" + name); }
  function fmt(s) {
    if (!isFinite(s)) return "0:00";
    var m = Math.floor(s / 60), r = Math.floor(s % 60);
    return m + ":" + (r < 10 ? "0" : "") + r;
  }

  class AudioPlayer extends HTMLElement {
    static get observedAttributes() { return ["src", "song", "artist"]; }

    constructor() {
      super();
      this._ramp = null;
      this._rampDir = 0;
    }

    connectedCallback() {
      if (this._built) return;
      this._build();
      this._built = true;
      this._render();
    }

    attributeChangedCallback() {
      if (this._built) this._render();
    }

    // ---- Propiedades ----
    get src()    { return this.getAttribute("src") || ""; }
    set src(v)   { this.setAttribute("src", v); }
    get song()   { return this.getAttribute("song") || ""; }
    set song(v)  { this.setAttribute("song", v); }
    get artist() { return this.getAttribute("artist") || ""; }
    set artist(v){ this.setAttribute("artist", v); }

    _emit(name, detail) {
      this.dispatchEvent(new CustomEvent(name, { detail: detail, bubbles: true }));
    }

    _build() {
      var self = this;

      // Pestaña lateral (mostrar/ocultar)
      var tab = el("button", "ap-tab btn btn-primary rounded-0 rounded-start d-flex align-items-center justify-content-center fs-5",
                   { type: "button", title: "Ocultar / mostrar" });
      tab.appendChild(icon("chevron-right"));
      this._tab = tab;
      this._tabIco = tab.firstChild;
      tab.addEventListener("click", function () {
        var hidden = self.classList.toggle("ap-hidden");
        self._tabIco.className = "bi bi-chevron-" + (hidden ? "left" : "right");
      });

      // Tarjeta
      var card = el("div", "ap-card bg-white shadow rounded-start p-3");

      // Fila: info + descargar
      var top = el("div", "d-flex align-items-start justify-content-between mb-2");
      var info = el("div", "me-2 text-truncate");
      this._song = el("div", "fw-semibold text-truncate");
      this._artist = el("div", "small text-secondary text-truncate");
      info.appendChild(this._song);
      info.appendChild(this._artist);

      var dl = el("button", "btn btn-sm btn-outline-primary border-0", { type: "button", title: "Descargar audio" });
      dl.appendChild(icon("download"));
      dl.addEventListener("click", function () {
        var a = el("a");
        a.href = self.src;
        a.download = (self.song || "audio") + ".mp3";
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        self._emit("ap-download", { src: self.src });
      });
      top.appendChild(info); top.appendChild(dl);

      // Barra de progreso (avanzar la música)
      this._seek = el("input", "form-range", { type: "range", min: "0", max: "100", value: "0", step: "0.1", "aria-label": "Avanzar música" });
      this._seek.addEventListener("input", function () {
        if (self._audio.duration) self._audio.currentTime = (self._seek.value / 100) * self._audio.duration;
      });

      var times = el("div", "d-flex justify-content-between small text-secondary mb-2");
      this._cur = el("span"); this._cur.textContent = "0:00";
      this._dur = el("span"); this._dur.textContent = "0:00";
      times.appendChild(this._cur); times.appendChild(this._dur);

      // Controles
      var row = el("div", "d-flex align-items-center justify-content-between");

      var left = el("div", "d-flex align-items-center gap-1");
      this._play = el("button", "btn btn-primary btn-sm d-flex align-items-center", { type: "button", title: "Reproducir / pausar" });
      this._playIco = icon("play-fill"); this._playIco.classList.add("fs-5");
      this._play.appendChild(this._playIco);
      this._play.addEventListener("click", function () {
        if (self._audio.paused) self._audio.play(); else self._audio.pause();
      });

      this._mute = el("button", "btn btn-danger btn-sm", { type: "button", title: "Silenciar" });
      this._muteIco = icon("volume-up-fill");
      this._mute.appendChild(this._muteIco);
      this._mute.addEventListener("click", function () {
        self._audio.muted = !self._audio.muted;
        self._syncMute();
      });
      left.appendChild(this._play); left.appendChild(this._mute);

      var right = el("div", "d-flex align-items-center gap-1");
      this._down = el("button", "btn btn-outline-danger btn-sm", { type: "button", title: "Bajar volumen (clic inicia, clic detiene)" });
      this._down.appendChild(icon("dash-lg"));
      this._down.addEventListener("click", function () { self._startRamp(-1, self._down); });

      this._vol = el("input", "form-range ap-vol", { type: "range", min: "0", max: "1", value: "1", step: "0.01", "aria-label": "Volumen" });
      this._vol.addEventListener("input", function () {
        self._audio.volume = parseFloat(self._vol.value);
        if (self._audio.volume > 0 && self._audio.muted) self._audio.muted = false;
        self._syncMute();
      });

      this._up = el("button", "btn btn-success btn-sm", { type: "button", title: "Subir volumen (clic inicia, clic detiene)" });
      this._up.appendChild(icon("plus-lg"));
      this._up.addEventListener("click", function () { self._startRamp(1, self._up); });

      right.appendChild(this._down); right.appendChild(this._vol); right.appendChild(this._up);

      row.appendChild(left); row.appendChild(right);

      card.appendChild(top);
      card.appendChild(this._seek);
      card.appendChild(times);
      card.appendChild(row);

      // Audio
      this._audio = el("audio", null, { preload: "metadata" });
      this._audio.addEventListener("play",  function () { self._playIco.className = "bi bi-pause-fill fs-5"; self._emit("ap-play"); });
      this._audio.addEventListener("pause", function () { self._playIco.className = "bi bi-play-fill fs-5"; self._emit("ap-pause"); });
      this._audio.addEventListener("ended", function () { self._emit("ap-ended"); });
      this._audio.addEventListener("loadedmetadata", function () { self._dur.textContent = fmt(self._audio.duration); });
      this._audio.addEventListener("timeupdate", function () {
        if (self._audio.duration) self._seek.value = (self._audio.currentTime / self._audio.duration) * 100;
        self._cur.textContent = fmt(self._audio.currentTime);
      });

      this.appendChild(tab);
      this.appendChild(card);
      this.appendChild(this._audio);
    }

    _render() {
      this._song.textContent = this.song || "\u2014";
      this._artist.textContent = this.artist || "\u2014";
      if (this._audio.getAttribute("src") !== this.src) {
        this._audio.src = this.src;
      }
    }

    _syncMute() {
      if (this._audio.muted || this._audio.volume === 0) {
        this._muteIco.className = "bi bi-volume-mute-fill";
        this._mute.className = "btn btn-danger btn-sm";
      } else {
        this._muteIco.className = "bi bi-volume-up-fill";
        this._mute.className = "btn btn-outline-danger btn-sm";
      }
    }

    _stopRamp() {
      if (this._ramp) { clearInterval(this._ramp); this._ramp = null; this._rampDir = 0; }
      this._up.className = "btn btn-success btn-sm";
      this._down.className = "btn btn-outline-danger btn-sm";
    }

    _startRamp(dir, btn) {
      var self = this;
      if (this._rampDir === dir) { this._stopRamp(); return; } // segundo clic = detener
      this._stopRamp();
      this._rampDir = dir;
      if (dir > 0) this._up.className = "btn btn-success btn-sm";
      else this._down.className = "btn btn-danger btn-sm";
      this._ramp = setInterval(function () {
        var v = self._audio.volume + dir * 0.03;
        if (v <= 0) { v = 0; self._stopRamp(); }
        if (v >= 1) { v = 1; self._stopRamp(); }
        self._audio.volume = v;
        self._vol.value = v;
        if (v > 0 && self._audio.muted) self._audio.muted = false;
        self._syncMute();
      }, 120);
    }
  }

  if (!customElements.get("audio-player")) {
    customElements.define("audio-player", AudioPlayer);
  }
})();