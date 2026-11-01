/*
 * Reproductor Audio — <audio-player>
 * Librería reutilizable (Web Component nativo, sin Shadow DOM).
 * Hereda Bootstrap 5 de la página anfitriona y usa sus clases de color.
 * Los iconos van INCRUSTADOS como SVG: NO depende de "Bootstrap Icons".
 *
 * Uso:
 *   <audio-player src="...mp3" song="Título" artist="Autor"></audio-player>
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
      "audio-player .ap-vol{width:90px}" +
      "audio-player svg{width:1em;height:1em;vertical-align:-.125em;fill:currentColor}";
    document.head.appendChild(st);
  }

  // Iconos SVG (trazados de Bootstrap Icons, MIT) — sin dependencia de la fuente.
  var SVG_NS = "http://www.w3.org/2000/svg";
  var ICONS = {
    "play":        ["m11.596 8.697-6.363 3.692C4.692 12.702 4 12.322 4 11.692V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393z"],
    "pause":       ["M5.5 3.5A1.5 1.5 0 0 1 7 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5zm5 0A1.5 1.5 0 0 1 12 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5z"],
    "download":    ["M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z",
                    "M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"],
    "volume-up":   ["M11.536 14.01A8.473 8.473 0 0 0 14.026 8a8.473 8.473 0 0 0-2.49-6.01l-.708.707A7.476 7.476 0 0 1 13.025 8c0 2.071-.84 3.946-2.197 5.303l.708.707z",
                    "M10.121 12.596A6.48 6.48 0 0 0 12.025 8a6.48 6.48 0 0 0-1.904-4.596l-.707.707A5.483 5.483 0 0 1 11.025 8a5.483 5.483 0 0 1-1.61 3.89l.706.706z",
                    "M8.707 11.182A4.486 4.486 0 0 0 10.025 8a4.486 4.486 0 0 0-1.318-3.182L8 5.525A3.489 3.489 0 0 1 9.025 8 3.49 3.49 0 0 1 8 10.475l.707.707z",
                    "M6.717 3.55A.5.5 0 0 1 7 4v8a.5.5 0 0 1-.812.39L3.825 10.5H1.5A.5.5 0 0 1 1 10V6a.5.5 0 0 1 .5-.5h2.325l2.363-1.89a.5.5 0 0 1 .529-.06z"],
    "volume-mute": ["M6.717 3.55A.5.5 0 0 1 7 4v8a.5.5 0 0 1-.812.39L3.825 10.5H1.5A.5.5 0 0 1 1 10V6a.5.5 0 0 1 .5-.5h2.325l2.363-1.89a.5.5 0 0 1 .529-.06zm7.137 2.096a.5.5 0 0 1 0 .708L12.207 8l1.647 1.646a.5.5 0 0 1-.708.708L11.5 8.707l-1.646 1.647a.5.5 0 0 1-.708-.708L10.793 8 9.146 6.354a.5.5 0 1 1 .708-.708L11.5 7.293l1.646-1.647a.5.5 0 0 1 .708 0z"],
    "plus":        ["M8 2a.5.5 0 0 1 .5.5v5h5a.5.5 0 0 1 0 1h-5v5a.5.5 0 0 1-1 0v-5h-5a.5.5 0 0 1 0-1h5v-5A.5.5 0 0 1 8 2Z"],
    "dash":        ["M2 8a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11A.5.5 0 0 1 2 8Z"],
    "chevron-right":["M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z"],
    "chevron-left": ["M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0z"]
  };

  function svgIcon(name) {
    var s = document.createElementNS(SVG_NS, "svg");
    s.setAttribute("viewBox", "0 0 16 16");
    s.setAttribute("aria-hidden", "true");
    (ICONS[name] || []).forEach(function (d) {
      var p = document.createElementNS(SVG_NS, "path");
      p.setAttribute("fill-rule", "evenodd");
      p.setAttribute("d", d);
      s.appendChild(p);
    });
    return s;
  }
  function setIcon(host, name) {
    while (host.firstChild) host.removeChild(host.firstChild);
    host.appendChild(svgIcon(name));
  }

  function el(tag, cls, attrs) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }
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

    // ---- Control programático (la app puede iniciar/pausar la reproducción) ----
    play() {
      if (!this._audio) return;
      var p = this._audio.play();
      if (p && p.catch) p.catch(function () {}); // el navegador puede bloquear autoplay sin gesto
    }
    pause() { if (this._audio) this._audio.pause(); }

    _build() {
      var self = this;

      // Pestaña lateral (mostrar/ocultar)
      var tab = el("button", "ap-tab btn btn-primary rounded-0 rounded-start d-flex align-items-center justify-content-center fs-5",
                   { type: "button", title: "Ocultar / mostrar" });
      setIcon(tab, "chevron-right");
      this._tab = tab;
      tab.addEventListener("click", function () {
        var hidden = self.classList.toggle("ap-hidden");
        setIcon(self._tab, hidden ? "chevron-left" : "chevron-right");
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
      setIcon(dl, "download");
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
      this._play = el("button", "btn btn-primary btn-sm d-flex align-items-center fs-5", { type: "button", title: "Reproducir / pausar" });
      setIcon(this._play, "play");
      this._play.addEventListener("click", function () {
        if (self._audio.paused) self._audio.play(); else self._audio.pause();
      });

      this._mute = el("button", "btn btn-danger btn-sm", { type: "button", title: "Silenciar" });
      setIcon(this._mute, "volume-up");
      this._mute.addEventListener("click", function () {
        self._audio.muted = !self._audio.muted;
        self._syncMute();
      });
      left.appendChild(this._play); left.appendChild(this._mute);

      var right = el("div", "d-flex align-items-center gap-1");
      this._down = el("button", "btn btn-outline-danger btn-sm", { type: "button", title: "Bajar volumen (clic inicia, clic detiene)" });
      setIcon(this._down, "dash");
      this._down.addEventListener("click", function () { self._startRamp(-1, self._down); });

      this._vol = el("input", "form-range ap-vol", { type: "range", min: "0", max: "1", value: "1", step: "0.01", "aria-label": "Volumen" });
      this._vol.addEventListener("input", function () {
        self._audio.volume = parseFloat(self._vol.value);
        if (self._audio.volume > 0 && self._audio.muted) self._audio.muted = false;
        self._syncMute();
      });

      this._up = el("button", "btn btn-success btn-sm", { type: "button", title: "Subir volumen (clic inicia, clic detiene)" });
      setIcon(this._up, "plus");
      this._up.addEventListener("click", function () { self._startRamp(1, self._up); });

      right.appendChild(this._down); right.appendChild(this._vol); right.appendChild(this._up);

      row.appendChild(left); row.appendChild(right);

      card.appendChild(top);
      card.appendChild(this._seek);
      card.appendChild(times);
      card.appendChild(row);

      // Audio
      this._audio = el("audio", null, { preload: "metadata" });
      this._audio.addEventListener("play",  function () { setIcon(self._play, "pause"); self._emit("ap-play"); });
      this._audio.addEventListener("pause", function () { setIcon(self._play, "play"); self._emit("ap-pause"); });
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
        setIcon(this._mute, "volume-mute");
        this._mute.className = "btn btn-danger btn-sm";
      } else {
        setIcon(this._mute, "volume-up");
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