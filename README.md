# Tarjetas Home Assistant

Colección de custom cards para Home Assistant (Frontend). Actualmente contiene la tarjeta para la integración y programación de películas y series con Jellyfin y el backend *CestaCore*.

## 🎬 Programador de Películas y Series Card

Una tarjeta interactiva tipo póster que permite navegar por el catálogo de Jellyfin de tu servidor, visualizar sinopsis y portadas, y finalmente programar su visionado enviando la configuración a una API externa (backend CestaCore).

---

## 🚀 Instalación

Este proyecto está preparado para ser distribuido fácilmente mediante **HACS** (Home Assistant Community Store) o bien instalarse manualmente.

### Opción A: Instalación vía HACS (Recomendado)

Dado que este repositorio incluye el archivo `hacs.json`, puedes instalar la tarjeta fácilmente:

1. Abre **HACS** en tu panel de Home Assistant.
2. Ve a **Frontend** > **Integraciones Personalizadas** (Custom repositories).
3. Añade la URL de este repositorio en Gitea e indica la categoría como **Panel de control** (Dashboard / Plugin).
4. Busca "Programador Peliculas Card" en HACS, dale a Descargar.
5. Home Assistant añadirá el recurso automáticamente a tu Dashboard. (Si no lo hace, reinicia o refresca caché).

### Opción B: Instalación Manual

1. Descarga la última Release o simplemente copia el archivo `dist/programador-peliculas-card.js`.
2. Súbelo a tu servidor de Home Assistant dentro del directorio `www/custom_cards/` (crea la carpeta si no existe).
3. Añade la tarjeta a tus recursos en el dashboard (Ajustes -> Paneles de Control -> Tres puntos arriba a la derecha -> Recursos):
   - **URL**: `/local/custom_cards/programador-peliculas-card.js`
   - **Tipo de recurso**: Módulo JavaScript (JavaScript Module)

---

## ⚙️ Configuración

La tarjeta incorpora un **Editor Visual** (GUI) nativo para que puedas configurarla directamente desde el Dashboard sin tener que tocar código YAML.

Añade una nueva tarjeta en tu Dashboard y selecciona **"Programador de Películas"**. Rellena el siguiente campo:

| Parámetro | Requerido | Tipo | Descripción |
| :--- | :---: | :--- | :--- |
| `backend_api_url` | Sí | string | La URL de tu API del backend (CestaCore) que recibirá la petición POST con la información de la programación elegida. |

### Configuración en YAML (Opcional)

Si prefieres usar el editor de código YAML:
```yaml
type: custom:programador-peliculas-card
backend_api_url: "http://192.168.1.100:8080/api/programar"
```

---

## 🛠️ Desarrollo y CI/CD (Drone)

El proyecto utiliza **Drone CI** integrado con **Gitea** para automatizar la integración continua y el despliegue de las releases a HACS.

El pipeline (`.drone.yml`) incluye:
1. **Validation (PRs)**: Cada Pull Request lanza un contenedor de Node para validar el código, instalar dependencias y ejecutar posibles linters/tests automáticos.
2. **Publish Release (Push a main)**: Al integrar los cambios en la rama principal (`main`), el pipeline ejecuta `.drone/scripts/publish-hacs-release.sh`. Este script:
   - Hace un "bump" de la versión parche en `package.json` utilizando `npm version patch`.
   - Realiza un commit y genera un *Git Tag* automatizado (ej. `v1.0.1`).
   - Envía el tag de vuelta a Gitea para que HACS notifique inmediatamente a los usuarios de Home Assistant de que hay una nueva actualización disponible.

*Nota: Para que Drone CI pueda ejecutar scripts de forma segura o recuperar secretos, se conecta con la bóveda **OpenBao** en el clúster usando variables de entorno y certificados raíz firmados por el laboratorio.*

---

## 🤖 Directrices del Agente de IA

El desarrollo de este proyecto se rige estrictamente por la metodología documentada en el archivo `AGENTS.md`. Cualquier IA o humano operando sobre el código debe seguir el modelo **Spec-Driven Development (SDD)**:

1. Nunca escribir código sin antes haber redactado y validado una especificación en `/specs/`.
2. Todo el código debe desarrollarse en ramas con el prefijo `feature/`, `bugfix/`, etc.
3. El estado de las tareas debe reflejarse y mantenerse actualizado en el tablero Kanban de **Vikunja**.
