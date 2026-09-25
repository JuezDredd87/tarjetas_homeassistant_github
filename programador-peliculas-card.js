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
    
    // Estado para la vista detalle
    this._selectedItem = null;
    this._seasons = [];
    this._episodes = [];
    this._selectedSeason = null;
    this._selectedEpisode = null;
    this._selectedDate = '';
    this._loadingDetails = false;
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
      this.fetchMedia();
    }
  }

  async fetchMedia() {
    if (!this._hass || !this._config) return;
    this._loading = true;
    this.updateUI();

    const folderId = this._currentTab === 'movies' ? this._config.movies_folder_id : this._config.series_folder_id;
    if (!folderId) {
      this._mediaItems = [];
      this._loading = false;
      this.updateUI();
      return;
    }

    try {
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
    this.updateUI();
  }

  switchTab(tab) {
    if (this._currentTab === tab) return;
    this._currentTab = tab;
    this._searchQuery = '';
    this._selectedItem = null;
    this.fetchMedia();
  }

  async selectItem(item) {
    this._selectedItem = item;
    this._seasons = [];
    this._episodes = [];
    this._selectedSeason = null;
    this._selectedEpisode = null;
    this._selectedDate = '';
    this._loadingDetails = false;
    
    this.updateUI();

    if (this._currentTab === 'series') {
      this._loadingDetails = true;
      this.updateUI();
      try {
        const response = await this._hass.callWS({
          type: 'media_source/browse_media',
          media_content_id: item.media_content_id
        });
        this._seasons = response.children || [];
      } catch (err) {
        console.error("Error al obtener temporadas:", err);
      }
      this._loadingDetails = false;
      this.updateUI();
    }
  }

  async fetchEpisodes(seasonId) {
    this._selectedSeason = seasonId;
    this._selectedEpisode = null;
    this._episodes = [];
    this._loadingDetails = true;
    this.updateUI();
    
    try {
      const response = await this._hass.callWS({
        type: 'media_source/browse_media',
        media_content_id: seasonId
      });
      this._episodes = response.children || [];
    } catch (err) {
      console.error("Error al obtener capitulos:", err);
    }
    this._loadingDetails = false;
    this.updateUI();
  }

  render() {
    if (!this._config) return;

    if (!this.shadowRoot.querySelector('.card-container')) {
      this.shadowRoot.innerHTML = `
        <style>
          ha-card { padding: 16px; overflow: hidden; position: relative; }
          .tabs { display: flex; justify-content: center; margin-bottom: 16px; gap: 10px; }
          .tab { padding: 8px 16px; border-radius: 20px; background: var(--secondary-background-color); color: var(--primary-text-color); cursor: pointer; font-weight: bold; transition: background 0.3s; }
          .tab.active { background: var(--primary-color); color: white; }
          .search-container { margin-bottom: 16px; }
          .search-input { width: 100%; padding: 8px 16px; border-radius: 20px; border: 1px solid var(--divider-color); background: var(--card-background-color); color: var(--primary-text-color); box-sizing: border-box; outline: none; }
          .search-input:focus { border-color: var(--primary-color); }
          
          .media-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 16px; max-height: 500px; overflow-y: auto; padding-right: 8px; }
          .media-item { display: flex; flex-direction: column; gap: 8px; cursor: pointer; transition: transform 0.2s; }
          .media-item:hover { transform: scale(1.05); }
          .media-poster { width: 100%; aspect-ratio: 2 / 3; background-color: var(--secondary-background-color); border-radius: 8px; display: flex; align-items: center; justify-content: center; color: var(--secondary-text-color); font-size: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); overflow: hidden; }
          .media-poster hui-image { width: 100%; height: 100%; display: block; }
          .media-title { font-size: 13px; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          
          .info-msg, .loader { text-align: center; padding: 20px; color: var(--secondary-text-color); font-style: italic; }
          
          /* Detail View Styles */
          #detail-view { display: none; position: relative; min-height: 400px; }
          .back-btn { background: var(--secondary-background-color); color: var(--primary-text-color); border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; margin-bottom: 16px; font-weight: bold; z-index: 2; position: relative; transition: background 0.2s; }
          .back-btn:hover { background: var(--divider-color); }
          
          .detail-content { display: flex; flex-direction: column; gap: 16px; position: relative; z-index: 2; }
          @media (min-width: 500px) { .detail-content { flex-direction: row; } }
          
          .detail-poster-large { width: 100%; max-width: 200px; flex-shrink: 0; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.5); overflow: hidden; align-self: flex-start; }
          .detail-poster-large hui-image { width: 100%; display: block; }
          
          .detail-info { flex: 1; background: rgba(var(--rgb-card-background-color, 30, 30, 30), 0.85); padding: 16px; border-radius: 8px; backdrop-filter: blur(8px); box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
          .detail-title-large { font-size: 20px; font-weight: bold; margin-bottom: 12px; line-height: 1.2; }
          .detail-synopsis { font-size: 14px; margin-bottom: 20px; line-height: 1.5; opacity: 0.9; }
          
          .detail-bg { position: absolute; top: -16px; left: -16px; right: -16px; bottom: -16px; opacity: 0.3; filter: blur(20px); z-index: 1; overflow: hidden; }
          .detail-bg hui-image { width: 100%; height: 100%; }
          
          .form-group { margin-bottom: 12px; }
          .form-group label { display: block; margin-bottom: 6px; font-size: 13px; font-weight: bold; opacity: 0.9; }
          .form-group select, .form-group input { width: 100%; padding: 10px; border-radius: 4px; border: 1px solid var(--divider-color); background: var(--card-background-color); color: var(--primary-text-color); box-sizing: border-box; }
          
          .btn-programar { width: 100%; padding: 12px; background: var(--primary-color); color: white; border: none; border-radius: 4px; font-size: 16px; font-weight: bold; cursor: pointer; transition: all 0.3s; margin-top: 10px; }
          .btn-programar:disabled { opacity: 0.7; cursor: not-allowed; }
          .btn-programar.success { background: #4caf50 !important; }
          .btn-programar.error { background: #f44336 !important; }
        </style>
        
        <ha-card header="Biblioteca Multimedia">
          <div class="card-container">
            <div id="main-view">
              <div class="tabs">
                <div class="tab" id="tab-movies">Películas</div>
                <div class="tab" id="tab-series">Series</div>
              </div>
              <div class="search-container">
                <input type="text" class="search-input" id="search-input" placeholder="Buscar...">
              </div>
              <div id="grid-container"></div>
            </div>
            
            <div id="detail-view"></div>
          </div>
        </ha-card>
      `;

      this.shadowRoot.getElementById('tab-movies').addEventListener('click', () => this.switchTab('movies'));
      this.shadowRoot.getElementById('tab-series').addEventListener('click', () => this.switchTab('series'));
      
      const searchInput = this.shadowRoot.getElementById('search-input');
      searchInput.addEventListener('input', (e) => {
        this._searchQuery = e.target.value;
        this.updateUI();
      });

      this.shadowRoot.getElementById('grid-container').addEventListener('click', (e) => {
        const itemEl = e.target.closest('.media-item');
        if (itemEl) {
          const id = itemEl.dataset.id;
          const item = this._mediaItems.find(m => m.media_content_id === id);
          if (item) this.selectItem(item);
        }
      });
    }

    this.updateUI();
  }

  updateUI() {
    if (!this.shadowRoot.querySelector('.card-container')) return;
    const mainView = this.shadowRoot.getElementById('main-view');
    const detailView = this.shadowRoot.getElementById('detail-view');
    
    if (this._selectedItem) {
      mainView.style.display = 'none';
      detailView.style.display = 'block';
      this.renderDetailView(detailView);
    } else {
      mainView.style.display = 'block';
      detailView.style.display = 'none';
      this.updateGrid();
    }
  }

  updateGrid() {
    const gridContainer = this.shadowRoot.getElementById('grid-container');
    const searchInput = this.shadowRoot.getElementById('search-input');
    const tabMovies = this.shadowRoot.getElementById('tab-movies');
    const tabSeries = this.shadowRoot.getElementById('tab-series');

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
      <div class="media-item" data-id="${item.media_content_id}">
        <div class="media-poster">
          ${item.thumbnail ? `<hui-image image="${item.thumbnail}"></hui-image>` : '<span>Sin Imagen</span>'}
        </div>
        <div class="media-title" title="${item.title}">${item.title}</div>
      </div>
    `).join('');

    gridContainer.innerHTML = `<div class="media-grid">${itemsHtml}</div>`;

    this.shadowRoot.querySelectorAll('#grid-container hui-image').forEach(img => {
      img.hass = this._hass;
    });
  }

  renderDetailView(container) {
    const item = this._selectedItem;
    if (!item) return;

    let formHtml = '';
    
    if (this._currentTab === 'series') {
      const seasonOptions = this._seasons.length > 0 
        ? this._seasons.map(s => `<option value="${s.media_content_id}" ${this._selectedSeason === s.media_content_id ? 'selected' : ''}>${s.title}</option>`).join('')
        : (this._loadingDetails ? '<option value="">Cargando...</option>' : '<option value="">No hay temporadas</option>');

      const episodeOptions = this._episodes.length > 0
        ? this._episodes.map(e => `<option value="${e.media_content_id}" ${this._selectedEpisode === e.media_content_id ? 'selected' : ''}>${e.title}</option>`).join('')
        : (this._loadingDetails ? '<option value="">Cargando...</option>' : '<option value="">Selecciona temporada...</option>');

      formHtml += `
        <div class="form-group">
          <label>Temporada</label>
          <select id="select-season">
            <option value="">-- Elige Temporada --</option>
            ${seasonOptions}
          </select>
        </div>
        <div class="form-group">
          <label>Capítulo</label>
          <select id="select-episode">
            <option value="">-- Elige Capítulo --</option>
            ${episodeOptions}
          </select>
        </div>
      `;
    }

    formHtml += `
      <div class="form-group">
        <label>Fecha y Hora de Visionado</label>
        <input type="datetime-local" id="input-date" value="${this._selectedDate}">
      </div>
      <button class="btn-programar" id="btn-programar">Programar</button>
    `;

    const synopsis = item.summary || item.description || "Sinopsis no disponible en la respuesta de la integración.";

    container.innerHTML = `
      <div class="detail-bg">
        ${item.thumbnail ? `<hui-image image="${item.thumbnail}"></hui-image>` : ''}
      </div>
      <button class="back-btn" id="btn-back">⬅ Volver</button>
      <div class="detail-content">
        <div class="detail-poster-large">
          ${item.thumbnail ? `<hui-image image="${item.thumbnail}"></hui-image>` : ''}
        </div>
        <div class="detail-info">
          <div class="detail-title-large">${item.title}</div>
          <div class="detail-synopsis">${synopsis}</div>
          ${formHtml}
        </div>
      </div>
    `;

    container.querySelectorAll('hui-image').forEach(img => { img.hass = this._hass; });

    container.querySelector('#btn-back').addEventListener('click', () => {
      this._selectedItem = null;
      this.updateUI();
    });

    if (this._currentTab === 'series') {
      container.querySelector('#select-season').addEventListener('change', (e) => {
        if (e.target.value) {
          this.fetchEpisodes(e.target.value);
        } else {
          this._selectedSeason = null;
          this._selectedEpisode = null;
          this._episodes = [];
          this.updateUI();
        }
      });
      container.querySelector('#select-episode').addEventListener('change', (e) => {
        this._selectedEpisode = e.target.value;
      });
    }

    container.querySelector('#input-date').addEventListener('change', (e) => {
      this._selectedDate = e.target.value;
    });

    container.querySelector('#btn-programar').addEventListener('click', () => this.handleProgramar());
  }

  async handleProgramar() {
    const btn = this.shadowRoot.getElementById('btn-programar');
    if (!this._selectedDate) {
      alert("Por favor, selecciona una fecha y hora válidas.");
      return;
    }

    if (this._currentTab === 'series' && (!this._selectedSeason || !this._selectedEpisode)) {
      alert("Por favor, selecciona temporada y capítulo.");
      return;
    }

    const payload = {
      nombre: this._selectedItem.title,
      programacion: this._selectedDate
    };

    if (this._currentTab === 'series') {
      const seasonObj = this._seasons.find(s => s.media_content_id === this._selectedSeason);
      const episodeObj = this._episodes.find(e => e.media_content_id === this._selectedEpisode);
      payload.temporada = seasonObj ? seasonObj.title : this._selectedSeason;
      payload.capitulo = episodeObj ? episodeObj.title : this._selectedEpisode;
    }

    btn.textContent = 'Enviando...';
    btn.disabled = true;

    try {
      if (!this._config.backend_api_url) {
        throw new Error("La URL de la API del backend no está configurada.");
      }

      const response = await fetch(this._config.backend_api_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        btn.classList.add('success');
        btn.textContent = '¡Programado!';
      } else {
        throw new Error('Error: ' + response.status);
      }
    } catch (err) {
      console.error(err);
      btn.classList.add('error');
      btn.textContent = 'Error al programar';
    }

    setTimeout(() => {
      btn.classList.remove('success', 'error');
      btn.textContent = 'Programar';
      btn.disabled = false;
    }, 3000);
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
