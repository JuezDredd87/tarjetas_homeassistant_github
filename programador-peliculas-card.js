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
    
    // Estado para vistas
    this._viewState = 'main'; // 'main', 'detail', 'summary'
    
    // Estado para la vista detalle
    this._selectedItem = null;
    this._seasons = [];
    this._episodes = [];
    this._selectedSeason = null;
    this._selectedEpisode = null;
    this._selectedDate = '';
    this._loadingDetails = false;
    
    // Estado para la vista de resumen y cancelacion
    this._scheduledId = null;
    this._fetchedSynopsis = '';
    this._seriesSynopsis = '';
    this._episodeSynopsis = '';
    this._showCancelModal = false;
    this._schedules = [];
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

    const tabAtRequest = this._currentTab;
    const folderId = this._currentTab === 'movies' ? this._config.movies_folder_id : this._config.series_folder_id;
    if (!folderId) {
      if (this._currentTab === tabAtRequest) {
        this._mediaItems = [];
        this._loading = false;
        this.updateUI();
      }
      return;
    }

    try {
      const formattedId = folderId.startsWith('media-source://') ? folderId : `media-source://jellyfin/${folderId}`;
      const response = await this._hass.callWS({
        type: 'media_source/browse_media',
        media_content_id: formattedId
      });
      if (this._currentTab === tabAtRequest) {
        this._mediaItems = response.children || [];
      }
    } catch (err) {
      if (this._currentTab === tabAtRequest) {
        console.error("Error al obtener la biblioteca multimedia:", err);
        this._mediaItems = [];
      }
    }
    
    if (this._currentTab === tabAtRequest) {
      this._loading = false;
      this.updateUI();
    }
  }

  switchTab(tab) {
    if (this._currentTab === tab) return;
    this._currentTab = tab;
    this._searchQuery = '';
    this._viewState = 'main';
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
    this._seriesSynopsis = '';
    this._episodeSynopsis = '';
    this._viewState = 'detail';
    
    this.updateUI();

    const rawId = item.media_content_id || "";
    const cleanId = rawId.replace('media-source://jellyfin/', '');
    this.fetchSeriesSynopsis(cleanId);

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

  async fetchSeriesSynopsis(mediaId) {
    try {
      const res = await this._hass.callWS({
        type: 'call_service',
        domain: 'rest_command',
        service: 'obtener_sinopsis_apolo',
        service_data: { media_id: mediaId },
        return_response: true
      });
      const synResp = res && res.response ? res.response : res;
      if (synResp && synResp.content) {
        const parsed = typeof synResp.content === 'string' ? JSON.parse(synResp.content) : synResp.content;
        this._seriesSynopsis = parsed.synopsis || "";
        
        const el = this.shadowRoot.getElementById('series-synopsis');
        if (el && this._seriesSynopsis) {
          el.innerHTML = this._seriesSynopsis;
        }
      }
    } catch(e) {}
  }

  async fetchEpisodeSynopsis(episodeId) {
    this._episodeSynopsis = '';
    try {
      const cleanId = episodeId.replace('media-source://jellyfin/', '');
      const res = await this._hass.callWS({
        type: 'call_service',
        domain: 'rest_command',
        service: 'obtener_sinopsis_apolo',
        service_data: { media_id: cleanId },
        return_response: true
      });
      const synResp = res && res.response ? res.response : res;
      if (synResp && synResp.content) {
        const parsed = typeof synResp.content === 'string' ? JSON.parse(synResp.content) : synResp.content;
        this._episodeSynopsis = parsed.synopsis || "";
        
        const el = this.shadowRoot.getElementById('episode-synopsis');
        if (el) {
          if (this._episodeSynopsis) {
            el.innerHTML = `<strong>Sinopsis del capítulo:</strong><br>${this._episodeSynopsis}`;
            el.style.display = 'block';
          } else {
            el.style.display = 'none';
          }
        }
      }
    } catch(e) {}
  }

  resetToMain() {
    this._viewState = 'main';
    this._selectedItem = null;
    this._scheduledId = null;
    this._fetchedSynopsis = '';
    this._showCancelModal = false;
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
          
          /* Detail & Summary View Styles */
          #detail-view, #summary-view { display: none; position: relative; min-height: 400px; }
          .back-btn { background: var(--secondary-background-color); color: var(--primary-text-color); border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; margin-bottom: 16px; font-weight: bold; z-index: 2; position: relative; transition: background 0.2s; }
          .back-btn:hover { background: var(--divider-color); }
          
          .detail-content, .summary-content { display: flex; flex-direction: column; gap: 16px; position: relative; z-index: 2; }
          @media (min-width: 500px) { .detail-content, .summary-content { flex-direction: row; } }
          
          .detail-poster-large { width: 100%; max-width: 200px; flex-shrink: 0; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.5); overflow: hidden; align-self: flex-start; }
          .detail-poster-large hui-image { width: 100%; display: block; }
          
          .detail-info { flex: 1; background: rgba(var(--rgb-card-background-color, 30, 30, 30), 0.85); padding: 16px; border-radius: 8px; backdrop-filter: blur(8px); box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
          .detail-title-large { font-size: 20px; font-weight: bold; margin-bottom: 12px; line-height: 1.2; }
          .detail-synopsis { font-size: 14px; margin-bottom: 20px; line-height: 1.5; opacity: 0.9; }
          
          .detail-bg { position: absolute; top: -16px; left: -16px; right: -16px; bottom: -16px; opacity: 0.3; filter: blur(20px); z-index: 1; overflow: hidden; pointer-events: none; }
          .detail-bg hui-image { width: 100%; height: 100%; }
          
          .form-group { margin-bottom: 12px; }
          .form-group label { display: block; margin-bottom: 6px; font-size: 13px; font-weight: bold; opacity: 0.9; }
          .form-group select, .form-group input { width: 100%; padding: 10px; border-radius: 4px; border: 1px solid var(--divider-color); background: var(--card-background-color); color: var(--primary-text-color); box-sizing: border-box; }
          
          .btn-programar { width: 100%; padding: 12px; background: var(--primary-color); color: white; border: none; border-radius: 4px; font-size: 16px; font-weight: bold; cursor: pointer; transition: all 0.3s; margin-top: 10px; }
          .btn-programar:disabled { opacity: 0.7; cursor: not-allowed; }
          .btn-programar.success { background: #4caf50 !important; }
          .btn-programar.error { background: #f44336 !important; }

          /* Summary screen specific styles */
          .summary-schedule-info { margin-top: 20px; padding: 12px; background: var(--secondary-background-color); border-radius: 8px; font-size: 14px; }
          .summary-schedule-info p { margin: 4px 0; }
          .summary-actions { display: flex; gap: 10px; margin-top: 20px; flex-wrap: wrap; }
          .summary-actions button { flex: 1; padding: 10px; border: none; border-radius: 4px; font-size: 14px; font-weight: bold; cursor: pointer; transition: opacity 0.2s; min-width: 80px; }
          .summary-actions button:hover { opacity: 0.9; }
          .btn-accept { background: var(--primary-color); color: white; }
          .btn-edit { background: #2196F3; color: white; }
          .btn-cancel { background: #f44336; color: white; }

          /* Modal styles */
          .modal-overlay { position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.6); z-index: 10; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(4px); border-radius: var(--ha-card-border-radius, 12px); }
          .modal-content { background: var(--card-background-color); padding: 24px; border-radius: 8px; text-align: center; max-width: 300px; box-shadow: 0 8px 24px rgba(0,0,0,0.3); }
          .modal-content h3 { margin-top: 0; margin-bottom: 12px; color: var(--primary-text-color); }
          .modal-content p { margin-bottom: 24px; color: var(--secondary-text-color); }
          .modal-actions { display: flex; gap: 12px; justify-content: center; }
          .modal-actions button { padding: 10px 24px; border: none; border-radius: 4px; font-weight: bold; cursor: pointer; }
          .btn-modal-no { background: var(--secondary-background-color); color: var(--primary-text-color); }
          .btn-modal-yes { background: #f44336; color: white; }
        </style>
        
        <ha-card header="Biblioteca Multimedia">
          <div class="header-actions" style="position:absolute; top: 16px; right: 16px; z-index: 10;">
            <button class="btn-icon" id="btn-manage-schedules" title="Gestionar Programaciones" style="background:none; border:none; font-size:24px; cursor:pointer; padding: 4px; border-radius: 50%;">⚙️</button>
          </div>
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
            <div id="summary-view"></div>
            <div id="crud-view"></div>
            
            <div id="cancel-modal" class="modal-overlay" style="display: none;">
              <div class="modal-content">
                <h3>¿Cancelar programación?</h3>
                <p>La programación será eliminada.</p>
                <div class="modal-actions">
                  <button class="btn-modal-no" id="btn-modal-no">No</button>
                  <button class="btn-modal-yes" id="btn-modal-yes">Sí, cancelar</button>
                </div>
              </div>
            </div>
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

      this.shadowRoot.getElementById('btn-modal-no').addEventListener('click', () => {
        this._showCancelModal = false;
        this.updateUI();
      });

      this.shadowRoot.getElementById('btn-modal-yes').addEventListener('click', () => this.handleCancelarConfirmado());
      this.shadowRoot.getElementById('btn-manage-schedules').addEventListener('click', () => this.fetchSchedules());
    }

    this.updateUI();
  }

  updateUI() {
    if (!this.shadowRoot.querySelector('.card-container')) return;
    const mainView = this.shadowRoot.getElementById('main-view');
    const detailView = this.shadowRoot.getElementById('detail-view');
    const summaryView = this.shadowRoot.getElementById('summary-view');
    const crudView = this.shadowRoot.getElementById('crud-view');
    const cancelModal = this.shadowRoot.getElementById('cancel-modal');
    
    cancelModal.style.display = this._showCancelModal ? 'flex' : 'none';

    if (this._viewState === 'detail') {
      mainView.style.display = 'none';
      summaryView.style.display = 'none';
      crudView.style.display = 'none';
      detailView.style.display = 'block';
      this.renderDetailView(detailView);
    } else if (this._viewState === 'summary') {
      mainView.style.display = 'none';
      detailView.style.display = 'none';
      crudView.style.display = 'none';
      summaryView.style.display = 'block';
      this.renderSummaryView(summaryView);
    } else if (this._viewState === 'crud') {
      mainView.style.display = 'none';
      detailView.style.display = 'none';
      summaryView.style.display = 'none';
      crudView.style.display = 'block';
      this.renderCrudView(crudView);
    } else {
      mainView.style.display = 'block';
      detailView.style.display = 'none';
      summaryView.style.display = 'none';
      crudView.style.display = 'none';
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

    const basicSynopsis = this._seriesSynopsis || item.summary || item.description || "Sinopsis no disponible.";
    const epSynDisplay = this._episodeSynopsis ? 'block' : 'none';
    const epSynHtml = this._episodeSynopsis ? `<strong>Sinopsis del capítulo:</strong><br>${this._episodeSynopsis}` : '';

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
          <div class="detail-synopsis" id="detail-synopsis-container">
            <div id="series-synopsis">${basicSynopsis}</div>
            <div id="episode-synopsis" style="margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--divider-color); display: ${epSynDisplay};">${epSynHtml}</div>
          </div>
          ${formHtml}
        </div>
      </div>
    `;

    container.querySelectorAll('hui-image').forEach(img => { img.hass = this._hass; });

    container.querySelector('#btn-back').addEventListener('click', () => {
      this.resetToMain();
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
        if (this._selectedEpisode) {
          this.fetchEpisodeSynopsis(this._selectedEpisode);
        } else {
          this._episodeSynopsis = '';
          const el = this.shadowRoot.getElementById('episode-synopsis');
          if (el) el.style.display = 'none';
        }
      });
    }

    container.querySelector('#input-date').addEventListener('change', (e) => {
      this._selectedDate = e.target.value;
    });

    container.querySelector('#btn-programar').addEventListener('click', () => this.handleProgramar());
  }

  renderSummaryView(container) {
    const item = this._selectedItem;
    if (!item) return;

    let scheduleInfoHtml = '';
    if (this._currentTab === 'series') {
      const seasonObj = this._seasons.find(s => s.media_content_id === this._selectedSeason);
      const episodeObj = this._episodes.find(e => e.media_content_id === this._selectedEpisode);
      const sTitle = seasonObj ? seasonObj.title : this._selectedSeason;
      const eTitle = episodeObj ? episodeObj.title : this._selectedEpisode;
      scheduleInfoHtml += `<p><strong>Episodio:</strong> ${sTitle} - ${eTitle}</p>`;
    }

    let displayDate = this._selectedDate.replace('T', ' ');
    if (displayDate) {
      scheduleInfoHtml += `<p><strong>Programado para:</strong> ${displayDate}</p>`;
    }
    
    // Si la API falla al traer la sinopsis, usamos el texto de Jellyfin como fallback
    const synopsisToDisplay = this._fetchedSynopsis || item.summary || item.description || "Sinopsis no disponible.";

    container.innerHTML = `
      <div class="detail-bg">
        ${item.thumbnail ? `<hui-image image="${item.thumbnail}"></hui-image>` : ''}
      </div>
      <div class="summary-content">
        <div class="detail-poster-large">
          ${item.thumbnail ? `<hui-image image="${item.thumbnail}"></hui-image>` : ''}
        </div>
        <div class="detail-info">
          <div class="detail-title-large">¡Programado con éxito!</div>
          <div style="font-weight: bold; font-size: 16px; margin-bottom: 8px;">${item.title}</div>
          <div class="detail-synopsis" style="max-height: 150px; overflow-y: auto;">${synopsisToDisplay}</div>
          
          <div class="summary-schedule-info">
            ${scheduleInfoHtml}
          </div>
          
          <div class="summary-actions">
            <button class="btn-accept" id="btn-summary-accept">Aceptar</button>
            <button class="btn-edit" id="btn-summary-edit">Editar</button>
            <button class="btn-cancel" id="btn-summary-cancel">Cancelar</button>
          </div>
        </div>
      </div>
    `;

    container.querySelectorAll('hui-image').forEach(img => { img.hass = this._hass; });

    container.querySelector('#btn-summary-accept').addEventListener('click', () => {
      this.resetToMain();
    });
    
    container.querySelector('#btn-summary-edit').addEventListener('click', () => {
      this._viewState = 'detail';
      this.updateUI();
    });

    container.querySelector('#btn-summary-cancel').addEventListener('click', () => {
      this._showCancelModal = true;
      this.updateUI();
    });
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

    const rawId = this._selectedItem.media_content_id || "";
    const cleanId = rawId.replace('media-source://jellyfin/', '');
    
    // Ensure the date has seconds for Java's LocalDateTime to parse correctly
    let safeDate = this._selectedDate;
    if (safeDate && safeDate.length === 16) {
      safeDate += ':00';
    }

    const payload = {
      id: cleanId,
      nombre: this._selectedItem.title,
      programacion: safeDate,
      temporada: "",
      capitulo: "",
      usuario: this._hass.user.name,
      return_response: true
    };

    if (this._currentTab === 'series') {
      const seasonObj = this._seasons.find(s => s.media_content_id === this._selectedSeason);
      const episodeObj = this._episodes.find(e => e.media_content_id === this._selectedEpisode);
      payload.temporada = seasonObj ? seasonObj.title : this._selectedSeason;
      payload.capitulo = episodeObj ? episodeObj.title : this._selectedEpisode;
    }

    btn.textContent = 'Programando...';
    btn.disabled = true;

    try {
      // 1. Programar la película o serie
      const res = await this._hass.callWS({
        type: 'call_service',
        domain: 'rest_command',
        service: 'programar_apolo',
        service_data: payload,
        return_response: true
      });
      const response = res && res.response ? res.response : res;
      
      if (response && response.status && (response.status < 200 || response.status >= 300)) {
        throw new Error(`API error: ${response.status}`);
      }
      
      // Parsear la respuesta para obtener el ID de la programación
      if (response && response.content) {
        try {
          const parsed = typeof response.content === 'string' ? JSON.parse(response.content) : response.content;
          this._scheduledId = parsed.id;
        } catch (e) {
          console.warn("No se pudo parsear el ID del schedule", e);
        }
      }

      // 2. Obtener la sinopsis usando el nuevo endpoint
      btn.textContent = 'Obteniendo sinopsis...';
      try {
        const synRes = await this._hass.callWS({
          type: 'call_service',
          domain: 'rest_command',
          service: 'obtener_sinopsis_apolo',
          service_data: { media_id: cleanId },
          return_response: true
        });
        const synResp = synRes && synRes.response ? synRes.response : synRes;
        
        if (synResp && synResp.content) {
          const parsedSyn = typeof synResp.content === 'string' ? JSON.parse(synResp.content) : synResp.content;
          this._fetchedSynopsis = parsedSyn.synopsis || "";
        }
      } catch (errSyn) {
        console.warn("Fallo al obtener la sinopsis (no crítico)", errSyn);
        this._fetchedSynopsis = "";
      }

      // 3. Cambiar a vista de resumen
      this._viewState = 'summary';
      this.updateUI();

    } catch (err) {
      console.error("Error al programar en Apolo", err);
      btn.classList.add('error');
      btn.textContent = 'Error al programar';
      
      setTimeout(() => {
        btn.classList.remove('success', 'error');
        btn.textContent = 'Programar';
        btn.disabled = false;
      }, 3000);
    }
  }

  async handleCancelarConfirmado() {
    this._showCancelModal = false;
    
    if (this._scheduledId) {
      try {
        await this._hass.callWS({
          type: 'call_service',
          domain: 'rest_command',
          service: 'cancelar_programacion_apolo',
          service_data: { schedule_id: this._scheduledId },
          return_response: true
        });
        console.log("Programación cancelada exitosamente");
      } catch(err) {
        console.error("Error al cancelar la programación", err);
        alert("Hubo un error al intentar cancelar la programación en el servidor.");
      }
    } else {
      console.warn("No hay ID de programación para cancelar.");
    }
    
    // Volver a la pantalla inicial en cualquier caso (asumimos que el usuario no la quiere)
    this.resetToMain();
  }

  async fetchSchedules() {
    this._viewState = 'crud';
    this._schedules = [];
    this.updateUI(); // Shows empty/loading initially

    try {
      const res = await this._hass.callWS({
        type: 'call_service',
        domain: 'rest_command',
        service: 'obtener_programaciones_apolo',
        service_data: {},
        return_response: true
      });
      const response = res && res.response ? res.response : res;
      if (response && response.content) {
        const parsed = typeof response.content === 'string' ? JSON.parse(response.content) : response.content;
        this._schedules = Array.isArray(parsed) ? parsed : [];
      }
    } catch (err) {
      console.error("Error al obtener programaciones", err);
    }
    
    this.updateUI();
  }

  renderCrudView(container) {
    let listHtml = '';
    
    if (this._schedules.length === 0) {
      listHtml = '<div class="info-msg">No hay programaciones o se están cargando...</div>';
    } else {
      listHtml = this._schedules.map(sch => {
        const title = sch.season && sch.episode ? `${sch.mediaName} - ${sch.season} ${sch.episode}` : sch.mediaName;
        // Format date string from backend (e.g. 2026-10-02T20:00:00)
        let dateVal = sch.scheduledDate ? sch.scheduledDate.substring(0, 16) : '';
        
        return `
          <div class="schedule-row" style="background: rgba(var(--rgb-card-background-color, 30, 30, 30), 0.85); padding: 12px; border-radius: 8px; margin-bottom: 12px; display: flex; flex-direction: column; gap: 8px; border: 1px solid var(--divider-color);">
            <div style="font-weight: bold; font-size: 15px; color: var(--primary-text-color);">${title}</div>
            <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
              <input type="datetime-local" id="date-${sch.id}" value="${dateVal}" style="flex: 1; min-width: 200px; padding: 8px; border-radius: 4px; border: 1px solid var(--divider-color); background: var(--card-background-color); color: var(--primary-text-color);">
              <button class="btn-edit-sch" data-id="${sch.id}" style="padding: 8px 12px; border-radius: 4px; border: none; background: #2196F3; color: white; font-weight: bold; cursor: pointer; transition: opacity 0.2s;">Guardar</button>
              <button class="btn-cancel-sch" data-id="${sch.id}" style="padding: 8px 12px; border-radius: 4px; border: none; background: #f44336; color: white; font-weight: bold; cursor: pointer; transition: opacity 0.2s;">Borrar</button>
            </div>
          </div>
        `;
      }).join('');
    }

    container.innerHTML = `
      <button class="back-btn" id="btn-back-crud" style="margin-bottom: 20px;">⬅ Volver</button>
      <h3 style="margin-top:0; margin-bottom: 16px; color: var(--primary-text-color); font-size: 20px;">Mis Programaciones</h3>
      <div class="schedules-list" style="max-height: 500px; overflow-y: auto; padding-right: 8px;">
        ${listHtml}
      </div>
    `;

    container.querySelector('#btn-back-crud').addEventListener('click', () => {
      this.resetToMain();
    });

    container.querySelectorAll('.btn-edit-sch').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.target.dataset.id;
        const dateInput = container.querySelector(`#date-${id}`);
        this.handleEditSchedule(id, dateInput.value, e.target);
      });
    });

    container.querySelectorAll('.btn-cancel-sch').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.target.dataset.id;
        if (confirm("¿Estás seguro de que quieres borrar esta programación?")) {
          this.handleDeleteSchedule(id, e.target);
        }
      });
    });
  }

  async handleEditSchedule(id, newDate, btnElement) {
    if (!newDate) return;
    
    let safeDate = newDate;
    if (safeDate.length === 16) {
      safeDate += ':00';
    }
    
    const originalText = btnElement.textContent;
    btnElement.textContent = '...';
    btnElement.disabled = true;

    try {
      await this._hass.callWS({
        type: 'call_service',
        domain: 'rest_command',
        service: 'actualizar_programacion_apolo',
        service_data: { schedule_id: id, programacion: safeDate },
        return_response: true
      });
      
      btnElement.style.background = '#4caf50';
      btnElement.textContent = 'OK';
      
      // Update local state
      const sch = this._schedules.find(s => s.id === id);
      if (sch) sch.scheduledDate = safeDate;

      setTimeout(() => {
        btnElement.style.background = '#2196F3';
        btnElement.textContent = originalText;
        btnElement.disabled = false;
      }, 2000);
    } catch(err) {
      console.error("Error updating schedule", err);
      btnElement.style.background = '#f44336';
      btnElement.textContent = 'Error';
      setTimeout(() => {
        btnElement.style.background = '#2196F3';
        btnElement.textContent = originalText;
        btnElement.disabled = false;
      }, 2000);
    }
  }

  async handleDeleteSchedule(id, btnElement) {
    const originalText = btnElement.textContent;
    btnElement.textContent = '...';
    btnElement.disabled = true;

    try {
      await this._hass.callWS({
        type: 'call_service',
        domain: 'rest_command',
        service: 'cancelar_programacion_apolo',
        service_data: { schedule_id: id },
        return_response: true
      });
      
      this._schedules = this._schedules.filter(s => s.id !== id);
      this.renderCrudView(this.shadowRoot.getElementById('crud-view'));
      
    } catch(err) {
      console.error("Error deleting schedule", err);
      btnElement.textContent = 'Error';
      setTimeout(() => {
        btnElement.textContent = originalText;
        btnElement.disabled = false;
      }, 2000);
    }
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
