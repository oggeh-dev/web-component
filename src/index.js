import '@oggeh/js-sdk';

const OggehTag = 'oggeh-content';

const OggehStatus = {
  IDLE: 'idle',
  PENDING: 'pending',
  SUCCESS: 'success',
  ERROR: 'error',
};

const OggehEvent = {
  READY: 'oggeh.ready',
  ERROR: 'oggeh.error',
  NAVIGATE: 'oggeh.navigate',
};

const OggehRoutes = ['page', 'news', 'article', 'albums', 'search', 'contact'];

class OggehSDK {

  constructor({api_key, sandbox_key = '', domain = location.hostname, endpoint = 'https://api.oggeh.com', lang = 'en'}) {
    this.api_key = api_key;
    this.sandbox_key = sandbox_key;
    this.domain = domain;
    this.endpoint = endpoint;
    this.status = OggehStatus.IDLE;
    this.error = '';
    this.data = {
      news: [],
    };
    this.refetch(String(lang).split('-')[0]);
  }

  refetch(lang) {
    if (!window.OGGEH) {
      const event = {
        data: {
          error: 'Unable to find SDK!',
        },
      };
      document.dispatchEvent(new CustomEvent(OggehEvent.ERROR, {
        bubbles: true,
        detail: event,
      }));
      return;
    }
    this.oggeh = new window.OGGEH({ lang, domain: this.domain, endpoint: this.endpoint, api_key: this.api_key, ...(this.sandbox_key ? {sandbox_key: this.sandbox_key} : {}) });
  }

  async getApp() {
    this.status = OggehStatus.PENDING;
    try {
      const data = await this.oggeh
        .get({ alias: 'app',  method: 'get.app', select: 'title,languages,meta,social' })
        .get({ alias: 'nav', method: 'get.pages' })
        .get({ alias: 'slider', method: 'get.albums.schedule', active_only: true, select: 'caption,maximum,tags' })
        .get({ alias: 'contacts', method: 'get.contacts', select: 'name,email' })
        .get({ alias: 'locations', method: 'get.locations', select: 'title,address,zone,phone,fax,latitude,longitude' })
        .get({ alias: 'news', method: 'get.news', limit: 4, select: 'timestamp,subject,header,cover,tags' })
        .promise();
      if (typeof data === 'string' || !data) {
        this.status = OggehStatus.ERROR;
        this.error = data;
        return;
      }
      this.status = OggehStatus.SUCCESS;
      return data;
    } catch (error) {
      this.status = OggehStatus.ERROR;
      this.error = error.message;
    }
    return;
  }

  async getModel(model, start_key) {
    if (!model) return;
    this.status = OggehStatus.PENDING;
    try {
      const res = {};
      if (start_key) {
        const {[start_key]: page} = await this.oggeh
          .get({ alias: start_key, method: 'get.page', key: start_key, select: 'key,subject,header,cover,blocks' })
          .promise();
        if (typeof page === 'string' || !page) {
          this.status = OggehStatus.ERROR;
          this.error = page;
          return;
        }
        res.page = page;
      }
      const output = await this.oggeh
        .get({ alias: model, method: 'get.pages', model, only_models: true, ...(start_key ? {start_key} : {}), select: 'key,subject,header,cover,blocks' })
        .promise();
      if (typeof output === 'string' || !output) {
        this.status = OggehStatus.ERROR;
        this.error = output;
        return;
      }
      res.model = output;
      this.status = OggehStatus.SUCCESS;
      return res;
    } catch (error) {
      this.status = OggehStatus.ERROR;
      this.error = error.message;
    }
    return;
  }

  async getPage(key, model) {
    if (!key) return;
    this.status = OggehStatus.PENDING;
    try {
      const {[key]: page, childs} = await this.oggeh
        .get({ alias: key, method: 'get.page', key, ...(model ? {model} : {}), select: 'key,subject,header,cover,tags,blocks' })
        .get({ alias: 'childs', method: 'get.pages', start_key: key, select: 'key,subject,header,cover,tags,blocks', block_type: 'rte' })
        .promise();
      if (typeof page === 'string' || !page) {
        this.status = OggehStatus.ERROR;
        this.error = page;
        return;
      } else if (typeof childs === 'string' || !childs) {
        this.status = OggehStatus.ERROR;
        this.error = childs;
        return;
      }
      this.status = OggehStatus.SUCCESS;
      return {...page, childs};
    } catch (error) {
      this.status = OggehStatus.ERROR;
      this.error = error.message;
    }
    return;
  }

  async getSearchResults(keyword) {
    if (!keyword) return;
    this.status = OggehStatus.PENDING;
    try {
      const {results: output} = await this.oggeh
        .get({ alias: 'results', method: 'get.search.results', keyword, target: 'pages,news' })
        .promise();
      if (typeof output === 'string' || !output) {
        this.status = OggehStatus.ERROR;
        this.error = output;
        return;
      }
      this.status = OggehStatus.SUCCESS;
      return {[keyword]: output.map(({items}) => items).flat()}
    } catch (error) {
      this.status = OggehStatus.ERROR;
      this.error = error.message;
    }
    return;
  }

  async getNewsArticle(timestamp) {
    if (!timestamp) return;
    this.status = OggehStatus.PENDING;
    try {
      const {news: output} = await this.oggeh.get({ alias: 'news', method: 'get.news', start_date: String(timestamp), limit: 1, select: 'timestamp,subject,header,cover,blocks,tags' }).promise();
      if (typeof output === 'string' || !output) {
        this.status = OggehStatus.ERROR;
        this.error = output;
        return;
      }
      if (!output.length) return;
      this.status = OggehStatus.SUCCESS;
      return output.find((article) => article?.timestamp === timestamp);
    } catch (error) {
      this.status = OggehStatus.ERROR;
      this.error = error.message;
    }
    return;
  }

  async getNews(start_date, limit = 2) {
    this.status = OggehStatus.PENDING;
    try {
      const start = start_date && this.data.news.length ? this.data.news.findIndex((article) => article?.timestamp === start_date) : 0;
      const cache = this.data.news.slice(start, start + limit);
      if (cache.length) return {articles: cache, previous: this.data.news[start - limit]?.timestamp, next: this.data.news[start + limit]?.timestamp};
      const {news: output} = await this.oggeh
        .get({ alias: 'news', method: 'get.news', ...(start_date ? {start_date: String(start_date)} : {}), limit, select: 'timestamp,subject,header,cover,tags' })
        .promise();
      if (typeof output === 'string' || !output) {
        this.status = OggehStatus.ERROR;
        this.error = output;
        return;
      }
      this.data.news = [...this.data.news, ...output];
      this.status = OggehStatus.SUCCESS;
      return {articles: output, previous: this.data.news[start - limit]?.timestamp, next: output[output.length]?.timestamp};
    } catch (error) {
      this.status = OggehStatus.ERROR;
      this.error = error.message;
    }
    return;
  }

  async getNewsRelated(timestamp) {
    const {news: output} = await this.oggeh
      .get({ alias: 'news', method: 'get.news.related', timestamp: String(timestamp || this.data.news?.[0]?.timestamp), limit: 4, select: 'timestamp,subject,header,cover,tags' })
      .promise();
    if (typeof output === 'string' || !output) {
      this.status = OggehStatus.ERROR;
      this.error = output;
      return;
    }
    return output;
  }

  async getFormToken(key) {
    this.status = OggehStatus.PENDING;
    try {
      const token = await this.oggeh
        .get({
          alias: 'token',
          method: 'get.form.token',
          key,
        })
        .promise();
      this.status = OggehStatus.SUCCESS;
      return token;
    } catch (error) {
      this.status = OggehStatus.ERROR;
      this.error = error.message;
    }
    return;
  }

  async submitContactForm(formData) {
    this.status = OggehStatus.PENDING;
    try {
      const output = await this.oggeh
        .post({ alias: 'response', method: 'post.contact.form', key: 'contact', ...formData });
      this.status = OggehStatus.SUCCESS;
      return output;
    } catch (error) {
      this.status = OggehStatus.ERROR;
      this.error = error.message;
    }
    return;
  }

  async submitPageForm(formData) {
    this.status = OggehStatus.PENDING;
    try {
      const output = await this.oggeh
        .post({ alias: 'response', method: 'post.page.form', ...formData });
      this.status = OggehStatus.SUCCESS;
      return output;
    } catch (error) {
      this.status = OggehStatus.ERROR;
      this.error = error.message;
    }
    return;
  }
}

class OggehContent extends HTMLElement {

  static state = {
    router: false,
    meta: false,
    nav: false,
    scripts: false,
  };
  static events = [];

  constructor() {
    super();
    if (!window?.oggeh?.api_key) {
      const event = {
        data: {
          error: 'Missing API key',
        },
      };
      this.dispatchEvent(new CustomEvent(OggehEvent.ERROR, {
        bubbles: true,
        detail: event,
      }));
      return;
    }
    this.oggeh = new OggehSDK(window.oggeh);
    this.attachShadow({ mode: 'open' });
  }

  async connectedCallback() {
    const config = this.getAttribute('config');
    switch (config) {
      case 'router':
        this.#setupRouter();
        return;
      case 'scripts':
        this.#injectScripts();
        return;
    }
    let event;
    const get = this.getAttribute('get');
    if (!get) {
      event = {
        data: {
          get,
          error: 'Missing required get attribute',
        },
      };
      this.dispatchEvent(new CustomEvent(OggehEvent.ERROR, {
        bubbles: true,
        detail: event,
      }));
      return;
    }
    const method = `get${get.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join('')}`;
    if (typeof this.oggeh[method] !== 'function') {
      event = {
        data: {
          get,
          error: `Method ${method} not supported`,
        },
      };
      this.dispatchEvent(new CustomEvent(OggehEvent.ERROR, {
        bubbles: true,
        detail: event,
      }));
      return;
    }
    const render = this.getAttribute('render');

    const key = this.getAttribute('key') || this.#getRequestParam('key') || '';
    const startKey = this.getAttribute('start-key') || this.#getRequestParam('start-key') || '';
    const timestamp = this.getAttribute('timestamp') || this.#getRequestParam('timestamp') || '';
    const startDate = this.getAttribute('start-date') || this.#getRequestParam('start-date') || '';
    const model = this.getAttribute('model') || this.#getRequestParam('model') || '';
    const keyword = this.getAttribute('keyword') || this.#getRequestParam('keyword') || '';
    const limit = Number(this.getAttribute('limit') || this.#getRequestParam('limit') || '1');

    let data;
    switch (method) {
      case 'getApp':
        if (!['nav', 'slider'].includes(render)) {
          event = {
            data: {
              get,
              error: 'Missing required render attribute',
            },
          };
          this.dispatchEvent(new CustomEvent(OggehEvent.ERROR, {
            bubbles: true,
            detail: event,
          }));
          return;
        }
        data = await this.oggeh[method]();
        break;
      case 'getModel':
        data = await this.oggeh[method](model, startKey);
        break;
      case 'getPage':
        data = await this.oggeh[method](key, model);
        break;
      case 'getSearchResults':
        data = await this.oggeh[method](keyword);
        break;
      case 'getNews':
        data = await this.oggeh[method](startDate, limit);
        break;
      case 'getNewsArticle':
        data = await this.oggeh[method](timestamp);
        break;
      case 'getNewsRelated':
        data = await this.oggeh[method](timestamp);
        break;
      default:
        data = await this.oggeh[method]();
        break;
    }
    if (this.oggeh.status === OggehStatus.ERROR) {
      event = {
        data: {
          get,
          error: this.oggeh.error,
        },
      };
      this.dispatchEvent(new CustomEvent(OggehEvent.ERROR, {
        bubbles: true,
        detail: event,
      }));
    } else {
      event = {
        get,
        data,
      };
      switch (render) {
        case 'nav':
          event.data = {nav: event.data.nav};
          break;
        case 'slider':
          event.data = {slider: event.data.slider};
          break;
      }
      OggehContent.events.push(event);
      this.dispatchEvent(new CustomEvent(OggehEvent.READY, {
        bubbles: true,
        detail: event,
      }));
      if (method === 'getApp') {
        this.#injectMeta(data);
        if (Array.isArray(data?.nav)) {
          switch (render) {
            case 'nav':
              this.#renderNavigation(data.nav);
              break;
            case 'slider':
              this.#renderContent(get, data.slider);
              break;
          }
        }
      } else {
        if (data?.key) data.token = await this.oggeh.getFormToken(data.key);
        this.#renderContent(get, data);
      }
    }
  }

  #getRequestParam(param) {
    const url = new URL(location.href);
    if (param === 'key') {
      const last = url.pathname.split('/').filter(p => !!p).pop();
      if (!OggehRoutes.includes(last)) return last;
    }
    const params = new URLSearchParams(location.search);
    return params.get(param);
  }

  #setupRouter() {
    if (OggehContent.state.router) return;
    OggehContent.state.router = true;

    window.oggehNavigate = (path) => {
      history.pushState({}, '', path);
      window.dispatchEvent(new Event('popstate'));
    };

    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[href]');
      if (!a) return;
      const href = a.getAttribute('href');
      if (href.startsWith('/') && !(href.endsWith('.html') || href.includes('.html?'))) {
        e.preventDefault();
        window.oggehNavigate(href);
      }
    });

    window.addEventListener('popstate', () => {
      const path = location.pathname;
      this.#reset();
      this.#loadTemplate(path);
      this.dispatchEvent(new CustomEvent(OggehEvent.NAVIGATE, {
        bubbles: true,
        detail: {
          path,
        },
      }));
    });

    this.remove();
  }

  #reset() {
    this.oggeh.error = '';
    OggehContent.events = [];
    OggehContent.state.scripts = false;
  }

  #loadTemplate(path) {
    const url = new URL(`${location.protocol}//${location.hostname}${path.startsWith('/') ? '' : '/'}${path}`);
    const tpl = url.pathname.split('/').filter(p => !!p).shift() || 'index';
    fetch(`/${tpl}.html`)
      .then(res => res.text())
      .then(html => {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const body = doc.querySelector('body');
        document.body.innerHTML = body.innerHTML;
      });
  }

  #injectScripts() {
    if (OggehContent.state.scripts) return;
    OggehContent.state.scripts = true;
    requestAnimationFrame(async () => {
      await this.#isComplete();
      const scripts = Array.from(this.querySelectorAll('script[type="text/oggeh-defer"]'));
      for (const script of scripts) {
        const src = script.getAttribute('src');
        const isAsync = script.hasAttribute('async');
        const isDefer = script.hasAttribute('defer');
        if (!src) continue;
        await inject({src, isAsync, isDefer});
      }
      this.remove();
    });

    async function inject({src, isAsync = false, isDefer = false}) {
      return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        if (isAsync) script.async = isAsync;
        if (isDefer) script.defer = isDefer;
        script.onload = () => resolve();
        script.onerror = () => reject();
        document.body.appendChild(script);
      });
    }
  }

  #handleForm(el) {
    const form = el.querySelector('[data-oggeh-form-post]');
    if (!form) return;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const formData = new FormData(form);
      const data = Object.fromEntries(formData);
      this.#processForm(el, form, data);
    });
  }

  async #processForm(el, form, data) {
    const event = {
      process: 'form',
    };
    try {
      const output = await this.oggeh.submitPageForm(data);
      if (this.oggeh.status === OggehStatus.ERROR) {
        event.error = this.oggeh.error;
        this.dispatchEvent(new CustomEvent(OggehEvent.ERROR, {
          bubbles: true,
          detail: event,
        }));
      } else {
        event.data = output;
      }
    } catch (error) {
      event.error = error.message;
    }
    if (event.error) {
      const alert = el.querySelector('[data-oggeh-form-error]');
      if (alert) alert.style.setProperty('display', 'block', 'important');
      document.dispatchEvent(new CustomEvent(OggehEvent.ERROR, {
        bubbles: true,
        detail: event,
      }));
    } else {
      const alert = el.querySelector('[data-oggeh-form-success]');
      if (alert) alert.style.setProperty('display', 'block', 'important');
      document.dispatchEvent(new CustomEvent(OggehEvent.READY, {
        bubbles: true,
        detail: event,
      }));
    }
    form.reset();
  }

  #injectMeta(data) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', inject);
    } else {
      inject();
    }

    function inject() {
      if (OggehContent.state.meta) return;
      if (document.head.querySelector('title')) document.head.querySelector('title').textContent = data.app.title;
      document.head.insertAdjacentHTML('afterbegin', `
        <meta name="keywords" content="${data.app.meta.keywords}">
        <meta name="description" content="${data.app.meta.description}">
        <meta name="og:title" content="${data.app.title}">
        <meta name="og:description" content="${data.app.meta.description}">
      `);
      OggehContent.state.meta = true;
    }
  }

  #isComplete({maxRetries = 50, interval = 100} = {}) {
    let retries = 0;
    const check = (resolve) => {
      if (OggehContent.events.length === Array.from(document?.body?.querySelectorAll?.(OggehTag)).filter((el) => el.hasAttribute('get')).length) {
        resolve();
      } else if (retries < maxRetries) {
        retries++;
        setTimeout(() => check(resolve), interval);
      } else {
        resolve();
      }
    };
    return new Promise((resolve) => check(resolve));
  }

  #renderNavigation(data) {
    const templates = {
      container: this.querySelector('template#oggeh-nav'),
      leaf: this.querySelector('template#oggeh-nav-leaf'),
      branch: this.querySelector('template#oggeh-nav-branch'),
      link: this.querySelector('template#oggeh-link'),
    };
    if (!templates.container) {
      const event = {
        data: {
          get: 'app',
          error: 'Missing required container template',
        },
      };
      this.dispatchEvent(new CustomEvent(OggehEvent.ERROR, {
        bubbles: true,
        detail: event,
      }));
      return;
    } else if (!templates.leaf || !templates.branch || !templates.link) {
      const event = {
        data: {
          get: 'app',
          error: 'Missing required navigation templates',
        },
      };
      this.dispatchEvent(new CustomEvent(OggehEvent.ERROR, {
        bubbles: true,
        detail: event,
      }));
      return;
    }
    const navigationElement = constructNavigation();
    if (navigationElement) {
      this.insertAdjacentElement('afterend', navigationElement);
      this.remove();
    }
    OggehContent.state.nav = true;

    function buildNavItems(items) {
      const fragment = document.createDocumentFragment();
      items.forEach((item, index) => {
        if (item.childs && item.childs.length > 0) {
          addNavBranch(item, index);
        } else {
          addNavLeaf(item, index);
        }
      });
      return fragment;

      function addNavBranch(item, index) {
        const branchTpl = templates.branch;
        const branchHTML = fillTemplate(branchTpl.innerHTML, item, {blockId: getBlockId(index)});
        const clone = document.createElement('div');
        clone.innerHTML = branchHTML;
        const childFragment = buildNavItems(item.childs);
        const slot = clone.querySelector('slot');
        if (slot) slot.parentNode.replaceChild(childFragment, slot);
        fragment.appendChild(clone.firstElementChild);
      }

      function addNavLeaf(item, index) {
        const leafTpl = templates.leaf;
        const leafHTML = fillTemplate(leafTpl.innerHTML, item, {blockId: getBlockId(index)});
        const clone = document.createElement('div');
        clone.innerHTML = leafHTML;
        fragment.appendChild(clone.firstElementChild);
      }
    }

    function constructNavigation() {
      const containerClone = document.importNode(templates.container.content, true);
      const fragment = buildNavItems(data);
      const slot = containerClone.querySelector('slot');
      if (slot) slot.parentNode.replaceChild(fragment, slot);
      return containerClone.firstElementChild;
    }
  }

  #renderContent(get, data) {
    const templates = {
      container: this.querySelector('template#oggeh-container'),
      iterable: this.querySelector('template#oggeh-iterable'),
      rte: this.querySelector('template#oggeh-text'),
      photos: this.querySelector('template#oggeh-photos'),
      videos: this.querySelector('template#oggeh-videos'),
      audio: this.querySelector('template#oggeh-audio'),
      files: this.querySelector('template#oggeh-files'),
      table: this.querySelector('template#oggeh-table'),
      tableHeaderCell: this.querySelector('template#oggeh-table-header-cell'),
      tableBodyCell: this.querySelector('template#oggeh-table-body-cell'),
      form: this.querySelector('template#oggeh-form'),
      formHeader: this.querySelector('template#oggeh-form-header'),
      formParagraph: this.querySelector('template#oggeh-form-paragraph'),
      formHr: this.querySelector('template#oggeh-form-hr'),
      formText: this.querySelector('template#oggeh-form-text'),
      formTextarea: this.querySelector('template#oggeh-form-textarea'),
      formSelect: this.querySelector('template#oggeh-form-select'),
      formSelectOption: this.querySelector('template#oggeh-form-select-option'),
      formCheckbox: this.querySelector('template#oggeh-form-checkbox'),
      formCheckboxGroup: this.querySelector('template#oggeh-form-checkbox-group'),
      formCheckboxGroupOption: this.querySelector('template#oggeh-form-checkbox-group-option'),
      formRadioGroup: this.querySelector('template#oggeh-form-radio-group'),
      formRadioGroupOption: this.querySelector('template#oggeh-form-radio-group-option'),
      formDate: this.querySelector('template#oggeh-form-date'),
      formFile: this.querySelector('template#oggeh-form-file'),
    };
    if (!templates.container) {
      const event = {
        data: {
          get,
          error: 'Missing required container template',
        },
      };
      this.dispatchEvent(new CustomEvent(OggehEvent.ERROR, {
        bubbles: true,
        detail: event,
      }));
      return;
    } else if (templates.iterable && !Array.isArray(data)) {
      const event = {
        data: {
          get,
          error: 'Data is not iterable',
        },
      };
      this.dispatchEvent(new CustomEvent(OggehEvent.ERROR, {
        bubbles: true,
        detail: event,
      }));
      return;
    }

    const contentElement = constructContent();
    if (Array.isArray(contentElement)) {
      for (const child of contentElement) {
        if (child.nodeType === Node.COMMENT_NODE) continue;
        if (child.nodeType === Node.TEXT_NODE) {
          this.insertAdjacentText('afterend', child.textContent);
        } else {
          this.insertAdjacentElement('afterend', child);
          this.#handleForm(child);
        }
      }
      this.remove();
    }

    function buildIterableItems(items) {
      const fragment = document.createDocumentFragment();
      items.forEach((item, index) => {
        const tpl = templates.iterable;
        const html = fillTemplate(tpl.innerHTML, item, {blockId: getBlockId(index)});
        const clone = document.createElement('div');
        clone.innerHTML = html;
        fragment.appendChild(clone.firstElementChild);
      });
      return fragment;
    }

    function buildBlocks(items) {
      const fragment = document.createDocumentFragment();
      items.forEach((item, index) => {
        switch (item.type) {
          case 'rte':
            addTextBlock(item, index);
            break;
          case 'media':
            const hasPhotos = item.media.filter(({type}) => type === 'photo').length > 1;
            if (hasPhotos) addMediaBlock('photos', item.media);
            const hasAudio = item.media.filter(({type}) => type === 'audio').length > 1;
            if (hasAudio) addMediaBlock('audio', item.media);
            const hasVideos = item.media.filter(({type}) => type === 'video').length > 1;
            if (hasVideos) addMediaBlock('videos', item.media);
            break;
          case 'files':
            addFilesBlock(item.files);
            break;
          case 'table':
            addTableBlock(item.table);
            break;
          case 'form':
            addFormBlock(item.form);
            break;
        }
      });
      return fragment;

      function addTextBlock(item, index) {
        const tpl = templates.rte;
        if (!tpl) return;
        const html = fillTemplate(tpl.innerHTML, item, {blockId: getBlockId(index)});
        const clone = document.createElement('div');
        clone.innerHTML = html;
        const blocks = Array.from(clone.childNodes).filter(b => b.nodeType === Node.ELEMENT_NODE);
        for (const block of blocks) fragment.appendChild(block);
      }

      function addMediaBlock(type, items) {
        const tpl = templates[type];
        if (!tpl) return;
        const clone = document.importNode(tpl.content, true);
        processIterables(clone, items);
        const blocks = Array.from(clone.childNodes).filter(b => b.nodeType === Node.ELEMENT_NODE);
        for (const block of blocks) fragment.appendChild(block);
      }

      function addFilesBlock(item) {
        const tpl = templates.files;
        if (!tpl) return;
        const clone = document.importNode(tpl.content, true);
        processIterables(clone, item);
        const blocks = Array.from(clone.childNodes).filter(b => b.nodeType === Node.ELEMENT_NODE);
        for (const block of blocks) fragment.appendChild(block);
      }

      function addTableBlock(item) {
        if (!Array.isArray(item) || item.length < 2) return;
        const tpl = templates.table;
        const containerClone = document.importNode(tpl.content, true);
        // we cannot use DocumentFragment here because of the restricted HTML content model for the table element
        const tableEl = containerClone.querySelector('table');
        if (!tableEl) return;
        let thead = tableEl.querySelector('thead');
        let tbody = tableEl.querySelector('tbody');
        if (!thead) thead = document.createElement('thead'); tableEl.prepend(thead);
        if (!tbody) tbody = document.createElement('tbody'); tableEl.appendChild(tbody);
        const headerData = item[0];
        let headerHTML = '';
        headerData.forEach((cellValue, colIndex) => {
          const headerCellTpl = templates.tableHeaderCell;
          headerHTML += fillTemplate(headerCellTpl.innerHTML, headerData, { index: colIndex });
        });
        const headerTr = document.createElement('tr');
        headerTr.innerHTML = headerHTML;
        thead.innerHTML = '';
        thead.appendChild(headerTr);
        const bodyRows = item.slice(1);
        tbody.innerHTML = '';
        bodyRows.forEach((rowData) => {
          let rowHTML = '';
          rowData.forEach((cellValue, colIndex) => {
            const bodyCellTpl = templates.tableBodyCell;
            rowHTML += fillTemplate(bodyCellTpl.innerHTML, rowData, { index: colIndex });
          });
          const rowTr = document.createElement('tr');
          rowTr.innerHTML = rowHTML;
          tbody.insertAdjacentElement('beforeend', rowTr);
        });
        fragment.appendChild(containerClone.firstElementChild);
      }

      function addFormBlock(item) {
        if (!Array.isArray(item)) return;
        const tpl = templates.form;
        const containerClone = document.importNode(tpl.content, true);
        let fieldsHTML = '';
        item.forEach((field, idx) => {
          let fieldTpl;
          switch (field.type) {
            case 'header':
              fieldTpl = templates.formHeader;
              break;
            case 'paragraph':
              fieldTpl = templates.formParagraph;
              break;
            case 'hr':
              fieldTpl = templates.formHr;
              break;
            case 'text':
              fieldTpl = templates.formText;
              break;
            case 'textarea':
              fieldTpl = templates.formTextarea;
              break;
            case 'select':
              fieldTpl = templates.formSelect;
              break;
            case 'checkbox':
              fieldTpl = templates.formCheckbox;
              break;
            case 'checkbox-group':
              fieldTpl = templates.formCheckboxGroup;
              break;
            case 'radio-group':
              fieldTpl = templates.formRadioGroup;
              break;
            case 'date':
              fieldTpl = templates.formDate;
              break;
            case 'file':
              fieldTpl = templates.formFile;
              break;
          }
          if (!fieldTpl) return;
          let html = fieldTpl.innerHTML;
          if (field.type === 'select') {
            let optionsHTML = '';
            if (Array.isArray(field.options)) {
              field.options.forEach((option, i) => {
                optionsHTML += fillTemplate(templates.formSelectOption.innerHTML, option, { index: i, blockId: getBlockId(i) });
              });
            }
            html = html.replace('{{ options }}', optionsHTML);
          } else if (field.type === 'checkbox-group') {
            let optionsHTML = '';
            if (Array.isArray(field.options)) {
              const {options, ...rest} = field;
              options.forEach((option, i) => {
                optionsHTML += fillTemplate(templates.formCheckboxGroupOption.innerHTML, {...rest, ...option}, { index: i, blockId: getBlockId(i) });
              });
            }
            html = html.replace('{{ options }}', optionsHTML);
          } else if (field.type === 'radio-group') {
            let optionsHTML = '';
            if (Array.isArray(field.options)) {
              const {options, ...rest} = field;
              options.forEach((option, i) => {
                optionsHTML += fillTemplate(templates.formRadioGroupOption.innerHTML, {...rest, ...option}, { index: i, blockId: getBlockId(i) });
              });
            }
            html = html.replace('{{ options }}', optionsHTML);
          } else if (['header', 'paragraph', 'hr'].includes(field.type)) {
            html = html.replace('&lt;', '<').replace('&gt;', '>').replace('<!--', '<').replace('-->', '>'); // fix placeholder if mutated by the HTML content model restrictions
          }
          fieldsHTML += fillTemplate(html, field, { index: idx, blockId: getBlockId(idx) });
        });
        if (data?.key) fieldsHTML += `<input type="hidden" name="key" value="${data.key}">`;
        if (data?.token) fieldsHTML += `<input type="hidden" name="token" value="${data.token}">`;
        const slot = containerClone.querySelector('slot');
        if (slot) {
          slot.insertAdjacentHTML('afterend', fieldsHTML);
        } else {
          const formEl = containerClone.querySelector('form');
          if (formEl) formEl.insertAdjacentHTML('beforeend', fieldsHTML);
        }
        fragment.appendChild(containerClone.firstElementChild);
      }

    }

    function constructContent() {
      const html = fillTemplate(templates.container.innerHTML, data, {blockId: getBlockId()});
      const containerClone = document.createElement('div');
      containerClone.innerHTML = html;
      let fragment;
      if (templates.iterable && Array.isArray(data)) {
        fragment = buildIterableItems(data);
      } else if (Array.isArray(data?.blocks)) {
        fragment = buildBlocks(data.blocks);
      }
      if (!fragment) return;
      const slot = containerClone.querySelector('slot');
      if (slot) slot.parentNode.replaceChild(fragment, slot);
      const clone = document.createElement('div');
      clone.innerHTML = fillTemplate(containerClone.innerHTML, data, {blockId: getBlockId()});
      return Array.from(clone.childNodes).reverse();
    }
  }
}

function getBlockId(index = 0) {
  return `${(Date.now() + Math.random()).toString(36)}.${index}`;
}

function fillTemplate(templateStr, data, { index = 0, blockId = '' } = {}) {
  return templateStr
      .replace(/=""/g, '') // fix placeholder if mutated by the HTML content model restrictions
      .replace(/{{\s*([^}]+)\s*}}/g, (match, expression) => {
    const parts = expression.trim().split('.');
    let value = data;
    for (let part of parts) {
      if (part.includes('=')) {
        const parts = part.split('=').map(p => p.trim());
        const position = parts.pop();
        const token = parts.join('=');
        if (Number(position) === index) {
          value = token;
          continue;
        }
      }
      if (part === 'block_id') {
        value = blockId;
        continue;
      }
      if (part === 'required') {
        value = data.required ? '*' : '';
        continue;
      }
      if (part === '*') {
        value = index;
        continue;
      }
      if (part === '[*]') {
        value = Array.isArray(value) ? value[index] : undefined;
        continue;
      }
      // Handle array index notation (e.g. name[0] or option_label[1])
      const arrMatch = part.match(/^([^\[\]]+)(?:\[(\d+|\*)\])?$/);
      if (arrMatch) {
        const key = arrMatch[1];
        let idx = arrMatch[2];
        value = value ? value[key] : undefined;
        if (idx !== undefined) {
          if (idx === '*') {
            value = Array.isArray(value) ? value[index] : undefined;
          } else {
            value = Array.isArray(value) ? value[Number(idx)] : undefined;
          }
        }
      } else {
        value = value ? value[part] : undefined;
      }
    }
    return (value !== undefined && value !== null) ? value : '';
  });
}

function processIterables(tpl, items) {
  const nodes = tpl.querySelectorAll('[data-oggeh-iterable]');
  nodes.forEach(node => {
    const parent = node.parentNode;
    const fragment = document.createDocumentFragment();
    items.forEach((item, index) => {
      const clone = node.cloneNode(true);
      clone.innerHTML = fillTemplate(clone.innerHTML, item, {index, blockId: getBlockId(index)});
      Array.from(clone.attributes).forEach(attr => {
        const newVal = fillTemplate(attr.value, item, {index, blockId: getBlockId(index)});
        clone.setAttribute(attr.name, newVal);
      });
      clone.removeAttribute('data-oggeh-iterable');
      fragment.appendChild(clone);
    });
    parent.insertBefore(fragment, node);
    parent.removeChild(node);
  });
}

customElements.define(OggehTag, OggehContent);
