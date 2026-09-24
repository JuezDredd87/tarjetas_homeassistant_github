class ProgramadorPeliculasCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config;
  }

  set hass(hass) {
    this._hass = hass;
  }

  connectedCallback() {
    this.render();
  }

  render() {
    if (!this._config || !this._hass) {
      return;
    }

    this.innerHTML = `
      <div class="card-config">
        <div class="side-by-side">
          <paper-input
            label="Backend API URL (requerido)"
            .value="${this._config.backend_api_url || ''}"
            @value-changed="${this._valueChanged}"
            configValue="backend_api_url"
          ></paper-input>
        </div>
      </div>
    `;

    // Attach event listeners for HA input changes
    const input = this.querySelector('paper-input');
    input.addEventListener('value-changed', this._valueChanged.bind(this));
  }

  _valueChanged(ev) {
    if (!this._config || !this._hass) {
      return;
    }
    const target = ev.target;
    if (this[`_${target.configValue}`] === target.value) {
      return;
    }
    if (target.configValue) {
      if (target.value === '') {
        const newConfig = { ...this._config };
        delete newConfig[target.configValue];
        this._config = newConfig;
      } else {
        this._config = {
          ...this._config,
          [target.configValue]: target.value,
        };
      }
    }
    
    // Fire the config-changed event to HA
    const event = new CustomEvent("config-changed", {
      detail: { config: this._config },
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(event);
  }
}

customElements.define("programador-peliculas-card-editor", ProgramadorPeliculasCardEditor);

class ProgramadorPeliculasCard extends HTMLElement {
  // Return the editor element to HA
  static getConfigElement() {
    return document.createElement("programador-peliculas-card-editor");
  }

  static getStubConfig() {
    return { 
      backend_api_url: "http://localhost:8080/api" 
    };
  }

  setConfig(config) {
    if (!config.backend_api_url) {
      throw new Error("Es necesario definir 'backend_api_url' en la configuración");
    }
    this._config = config;
    this.render();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._content) {
      this.render();
    }
  }

  render() {
    if (!this._config) {
      return;
    }

    if (!this._content) {
      const card = document.createElement('ha-card');
      card.header = 'Programador de Películas y Series';
      this._content = document.createElement('div');
      this._content.style.padding = '16px';
      card.appendChild(this._content);
      this.appendChild(card);
    }

    this._content.innerHTML = `
      <div style="text-align: center;">
        <p>✅ Tarjeta inicializada correctamente.</p>
        <p><strong>Backend Configurado:</strong> <code>${this._config.backend_api_url}</code></p>
        <p style="color: gray; font-size: 0.9em; margin-top: 20px;">
          (Aquí se renderizará el listado de Jellyfin en próximas actualizaciones)
        </p>
      </div>
    `;
  }

  getCardSize() {
    return 3;
  }
}

customElements.define('programador-peliculas-card', ProgramadorPeliculasCard);

// Configure the card in the HA UI card picker
window.customCards = window.customCards || [];
window.customCards.push({
  type: "programador-peliculas-card",
  name: "Programador de Películas",
  description: "Tarjeta tipo póster para programar películas y series desde Jellyfin.",
  preview: true,
});
