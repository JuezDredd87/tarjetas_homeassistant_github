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
        <div style="margin-bottom: 16px;">
           <label style="display:block; font-weight:bold; margin-bottom:4px;">Backend API URL</label>
           <input type="text" style="width: 100%; padding: 8px; box-sizing: border-box;" id="backend_api_url" value="${this._config.backend_api_url || ''}">
        </div>
        <div style="margin-bottom: 16px;">
           <label style="display:block; font-weight:bold; margin-bottom:4px;">ID de la carpeta de Películas</label>
           <input type="text" style="width: 100%; padding: 8px; box-sizing: border-box;" id="movies_folder_id" value="${this._config.movies_folder_id || ''}" placeholder="Ej: media-source://jellyfin/xyz">
        </div>
        <div style="margin-bottom: 16px;">
           <label style="display:block; font-weight:bold; margin-bottom:4px;">ID de la carpeta de Series</label>
           <input type="text" style="width: 100%; padding: 8px; box-sizing: border-box;" id="series_folder_id" value="${this._config.series_folder_id || ''}" placeholder="Ej: media-source://jellyfin/93062...">
        </div>
      </div>
    `;

    const inputs = this.querySelectorAll('input');
    inputs.forEach(input => {
      // Usamos input en lugar de change para que guarde en tiempo real
      input.addEventListener('input', this._valueChanged.bind(this));
    });
  }

  _valueChanged(ev) {
    if (!this._config || !this._hass) return;
    const target = ev.target;
    const configValue = target.id;
    if (this._config[configValue] === target.value) return;

    if (configValue) {
      if (target.value === '') {
        const newConfig = { ...this._config };
        delete newConfig[configValue];
        this._config = newConfig;
      } else {
        this._config = {
          ...this._config,
          [configValue]: target.value,
        };
      }
    }

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
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._currentTab = 'movies'; // 'movies' o 'series'
    this._mediaItems = [];
    this._searchQuery = '';
    this._loading = false;
  }

  static getConfigElement() {
    return document.createElement("programador-peliculas-card-editor");
  }

  static getStubConfig() {
    return { 
      backend_api_url: "http://localhost:8080/api",
      movies_folder_id: "media-source://jellyfin/AQUI_ID_PELIS",
      series_folder_id: "media-source://jellyfin/93062c10852389d61e40aa657ebce78c"
    };
  }

  setConfig(config) {
    this._config = config;
    this.render();
  }

  set hass(hass) {
    const oldHass = this._hass;
    this._hass = hass;
    if (!oldHass && this._hass) {
      // Fetch media la primera vez que tenemos hass
      this.fetchMedia();
    }
  }

  async fetchMedia() {
    if (!this._hass || !this._config) return;

    this._loading = true;
    this.render();

    const folderId = this._currentTab === 'movies'
      ? this._config.movies_folder_id
      : this._config.series_folder_id;

    if (!folderId) {
      this._mediaItems = [];
      this._loading = false;
      this.render();
      return;
    }

    try {
      // Es posible que el ID proporcionado necesite el prefijo si no lo tiene
      const formattedId = folderId.startsWith('media-source://') ? folderId : `media-source://jellyfin/${folderId}`;

      const response = await this._hass.callWS({
        type: 'media_source/browse_media',
        media_content_id: formattedId
      });

      this._mediaItems = response.children || [];
    } catch (err) {
      console.error("Error al obtener la biblioteca multimedia:", err);
      this._mediaItems = [];
    }

    this._loading = false;
    this.render();
  }

  switchTab(tab) {
    if (this._currentTab === tab) return;
    this._currentTab = tab;
    this._searchQuery = '';
    this.fetchMedia();
  }

  render() {
    if (!this._config) return;

    if (!this.shadowRoot.querySelector('.card-container')) {
      this.shadowRoot.innerHTML = `
        <style>
          ha-card {
            padding: 16px;
          }
          .tabs {
            display: flex;
            justify-content: center;
            margin-bottom: 16px;
            gap: 10px;
          }
          .tab {
            padding: 8px 16px;
            border-radius: 20px;
            background: var(--secondary-background-color);
            color: var(--primary-text-color);
            cursor: pointer;
            font-weight: bold;
            transition: background 0.3s;
          }
          .tab.active {
            background: var(--primary-color);
            color: white;
          }
          .search-container {
            margin-bottom: 16px;
          }
          .search-input {
            width: 100%;
            padding: 8px 16px;
            border-radius: 20px;
            border: 1px solid var(--divider-color);
            background: var(--card-background-color);
            color: var(--primary-text-color);
            box-sizing: border-box;
            outline: none;
          }
          .search-input:focus {
            border-color: var(--primary-color);
          }
          .media-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
            gap: 16px;
            max-height: 500px;
            overflow-y: auto;
            padding-right: 8px;
          }
          .media-item {
            display: flex;
            flex-direction: column;
            gap: 8px;
            cursor: pointer;
            transition: transform 0.2s;
          }
          .media-item:hover {
            transform: scale(1.05);
          }
          .media-poster {
            width: 100%;
            aspect-ratio: 2 / 3;
            background-color: var(--secondary-background-color);
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--secondary-text-color);
            font-size: 12px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            overflow: hidden;
          }
          .media-poster hui-image {
            width: 100%;
            height: 100%;
            display: block;
          }
          .media-title {
            font-size: 13px;
            text-align: center;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          .info-msg {
            text-align: center;
            padding: 20px;
            color: var(--secondary-text-color);
            font-style: italic;
          }
          .loader {
            text-align: center;
            padding: 20px;
          }
        </style>
        <ha-card header="Biblioteca Multimedia">
          <div class="card-container">
            <div class="tabs">
              <div class="tab" id="tab-movies">Películas</div>
              <div class="tab" id="tab-series">Series</div>
            </div>
            
            <div class="search-container">
              <input type="text" class="search-input" id="search-input" placeholder="Buscar...">
            </div>

            <div id="grid-container"></div>
          </div>
        </ha-card>
      `;

      // Eventos solo se añaden una vez
      this.shadowRoot.getElementById('tab-movies').addEventListener('click', () => this.switchTab('movies'));
      this.shadowRoot.getElementById('tab-series').addEventListener('click', () => this.switchTab('series'));
      
      const searchInput = this.shadowRoot.getElementById('search-input');
      searchInput.addEventListener('input', (e) => {
        this._searchQuery = e.target.value;
        this.updateGrid();
      });
    }

    this.updateGrid();
  }

  updateGrid() {
    const gridContainer = this.shadowRoot.getElementById('grid-container');
    const searchInput = this.shadowRoot.getElementById('search-input');
    const tabMovies = this.shadowRoot.getElementById('tab-movies');
    const tabSeries = this.shadowRoot.getElementById('tab-series');

    if (!gridContainer) return;

    // Sincronizar el input por si cambió desde otro sitio
    if (searchInput.value !== this._searchQuery) {
      searchInput.value = this._searchQuery;
    }

    if (this._currentTab === 'movies') {
      tabMovies.classList.add('active');
      tabSeries.classList.remove('active');
    } else {
      tabSeries.classList.add('active');
      tabMovies.classList.remove('active');
    }

    const folderId = this._currentTab === 'movies' ? this._config.movies_folder_id : this._config.series_folder_id;

    if (this._loading) {
      gridContainer.innerHTML = '<div class="loader">Cargando biblioteca...</div>';
      return;
    }

    if (!folderId) {
      gridContainer.innerHTML = `<div class="info-msg">Configura el ID de ${this._currentTab === 'movies' ? 'Películas' : 'Series'} en el editor de la tarjeta.</div>`;
      return;
    }

    if (this._mediaItems.length === 0) {
      gridContainer.innerHTML = `<div class="info-msg">No se encontraron elementos en esta biblioteca.</div>`;
      return;
    }

    const filteredItems = this._searchQuery
      ? this._mediaItems.filter(item => item.title.toLowerCase().includes(this._searchQuery.toLowerCase()))
      : this._mediaItems;

    if (filteredItems.length === 0) {
      gridContainer.innerHTML = `<div class="info-msg">No hay coincidencias con tu búsqueda.</div>`;
      return;
    }

    const itemsHtml = filteredItems.map(item => `
      <div class="media-item">
        <div class="media-poster">
          ${item.thumbnail ? `<hui-image image="${item.thumbnail}"></hui-image>` : '<span>Sin Imagen</span>'}
        </div>
        <div class="media-title" title="${item.title}">${item.title}</div>
      </div>
    `).join('');

    gridContainer.innerHTML = `<div class="media-grid">${itemsHtml}</div>`;

    // Asignar objeto hass a las imágenes nativas
    this.shadowRoot.querySelectorAll('hui-image').forEach(img => {
      img.hass = this._hass;
    });
  }

  getCardSize() {
    return 6;
  }
}

customElements.define('programador-peliculas-card', ProgramadorPeliculasCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "programador-peliculas-card",
  name: "Programador de Películas",
  description: "Explora la biblioteca de Jellyfin para programar contenido.",
  preview: true,
});
