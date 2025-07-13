import '@oggeh/js-sdk';

const OggehTag = 'oggeh-content';
const OggehAntiFlickerId = 'oggeh-anti-flicker';
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
const OggehRoutes = {
  PAGE: 'page',
  NEWS: 'news',
  ARTICLE: 'article',
  ALBUMS: 'albums',
  SEARCH: 'search',
  CONTACT: 'contact',
};
const OggehConfig = {
  ANTI_FLICKER: 'anti-flicker',
  ROUTER: 'router',
  SCRIPTS: 'scripts',
};
const OggehRender = {
  META: 'meta',
  NAV: 'nav',
  SLIDER: 'slider',
  LOCATIONS: 'locations',
  SOCIAL: 'social',
  CONTACT: 'contact',
};

class OggehData {
  #key = 'oggeh.data';
  #api;
  #data = {};
  #lock = Promise.resolve(); // a simple mutex: an already-resolved promise.
  constructor(api = sessionStorage) {
    this.#api = api;
    this.#data = JSON.parse(this.#api.getItem(this.#key) || '{}');
  }
  get(key, {maxRetries = 50, interval = 100} = {}) {
    this.#data = JSON.parse(this.#api.getItem(this.#key) || '{}');
    if (!maxRetries) return Promise.resolve(this.#data[key]);
    return waitFor(() => this.#data[key], {maxRetries, interval});
  }
  async set(key, value) {
    await this.#lock;
    this.#lock = this.#lock.then(() => {
      const current = JSON.parse(this.#api.getItem(this.#key) || '{}');
      const merged = objectDeepMerge(current, { [key]: value });
      this.#api.setItem(this.#key, JSON.stringify(merged));
      this.#data = merged;
    }).catch((err) => {
      console.debug(`OGGEH: Error updating ${this.#key}`, err);
    });
    await this.#lock;
  }
}

class OggehSDK {
  constructor({api_key, sandbox_key = '', domain = location.hostname, endpoint = 'https://api.oggeh.com', lang = 'en'}) {
    this.api_key = api_key;
    this.sandbox_key = sandbox_key;
    this.domain = domain;
    this.endpoint = endpoint;
    this.status = OggehStatus.IDLE;
    this.error = '';
    this.cache = new OggehData();
    this.newsPagination = new OggehData(localStorage);
    (async () => {
      const cachePagination = await this.newsPagination.get('news.pagination', {maxRetries: 0});
      if (!cachePagination) this.newsPagination.set('news.pagination', []);
    })();
    window.oggeh = window.oggeh|| {};
    window.oggeh.data = this.cache;
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
      const cacheKey = 'app';
      const cacheApp = await this.cache.get(cacheKey, {maxRetries: 0});
      if (cacheApp) {
        this.status = OggehStatus.SUCCESS;
        return cacheApp;
      }
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
      data.slider = {list: data.slider};
      await this.newsPagination.set('news.pagination', data.news.map(({timestamp}) => timestamp));
      await this.cache.set(cacheKey, data);
      this.status = OggehStatus.SUCCESS;
      return data;
    } catch (error) {
      this.status = OggehStatus.ERROR;
      this.error = error.message;
    }
    return;
  }

  async getModel(model, start_key = '') {
    if (!model) return;
    this.status = OggehStatus.PENDING;
    try {
      const res = {};
      if (start_key) {
        const cacheKey = `model.${start_key}`;
        const cachePage = await this.cache.get(cacheKey, {maxRetries: 0});
        if (cachePage) {
          res.page = cachePage;
        } else {
          const page = await this.oggeh
            .get({ method: 'get.page', key: start_key, select: 'key,subject,header,cover,blocks' })
            .promise();
          if (typeof page === 'string' || !page) {
            this.status = OggehStatus.ERROR;
            this.error = page;
            return;
          }
          await this.cache.set(cacheKey, page);
          res.page = page;
        }
      }
      const cacheKey = `model.${model}`;
      const cacheModel = await this.cache.get(cacheKey, {maxRetries: 0});
      if (cacheModel) {
        this.status = OggehStatus.SUCCESS;
        res.model = cacheModel;
        return res;
      }
      const output = await this.oggeh
        .get({ method: 'get.pages', model, only_models: true, ...(start_key ? {start_key} : {}), select: 'key,subject,header,cover,blocks' })
        .promise();
      if (typeof output === 'string' || !output) {
        this.status = OggehStatus.ERROR;
        this.error = output;
        return;
      }
      await this.cache.set(cacheKey, output);
      res.model = output;
      this.status = OggehStatus.SUCCESS;
      return res;
    } catch (error) {
      this.status = OggehStatus.ERROR;
      this.error = error.message;
    }
    return;
  }

  async getPages(start_key = '', limit = 4) {
    const cacheKey = `pages${start_key ? `.${start_key}` : ''}.${limit}`;
    const cachePages = await this.cache.get(cacheKey, {maxRetries: 0});
    if (cachePages) {
      this.status = OggehStatus.SUCCESS;
      return cachePages;
    }
    const output = await this.oggeh
      .get({ method: 'get.pages', ...(start_key ? {start_key} : {}), limit, select: 'timestamp,subject,header,cover,tags' })
      .promise();
    if (typeof output === 'string' || !output) {
      this.status = OggehStatus.ERROR;
      this.error = output;
      return;
    }
    await this.cache.set(cacheKey, {list: output});
    return {list: output};
  }

  async getPage(key, model = '', scope = '') {
    if (!key) return;
    this.status = OggehStatus.PENDING;
    try {
      const cacheKey = `page.${key}${model ? `.${model}` : ''}`;
      const cachePage = await this.cache.get(cacheKey, {maxRetries: 0});
      if (cachePage) {
        this.status = OggehStatus.SUCCESS;
        if (scope === 'childs') return {list: cachePage.childs};
        if (scope in cachePage) return cachePage[scope];
        return cachePage;
      }
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
      await this.cache.set(cacheKey, {...page, childs});
      this.status = OggehStatus.SUCCESS;
      if (scope === 'childs') return {list: childs};
      if (scope in page) return page[scope];
      return {...page, childs};
    } catch (error) {
      this.status = OggehStatus.ERROR;
      this.error = error.message;
    }
    return;
  }

  async getPageRelated(key) {
    const cacheKey = `page.related.${key}`;
    const cachePageRelated = await this.cache.get(cacheKey, {maxRetries: 0});
    if (cachePageRelated) {
      this.status = OggehStatus.SUCCESS;
      return cachePageRelated;
    }
    const output = await this.oggeh
      .get({ method: 'get.page.related', key, limit: 4, select: 'timestamp,subject,header,cover,tags' })
      .promise();
    if (typeof output === 'string' || !output) {
      this.status = OggehStatus.ERROR;
      this.error = output;
      return;
    }
    await this.cache.set(cacheKey, {list: output});
    return {list: output};
  }

  async getSearchResults(keyword) {
    if (!keyword) return;
    this.status = OggehStatus.PENDING;
    try {
      const cacheKey = `search.results.${keyword}`;
      const cacheSearchResults = await this.cache.get(cacheKey, {maxRetries: 0});
      if (cacheSearchResults) {
        this.status = OggehStatus.SUCCESS;
        return cacheSearchResults;
      }
      const output = await this.oggeh
        .get({ method: 'get.search.results', keyword, target: 'pages,news' })
        .promise();
      if (typeof output === 'string' || !output) {
        this.status = OggehStatus.ERROR;
        this.error = output;
        return;
      }
      await this.cache.set(cacheKey, output.map(({items}) => items).flat());
      this.status = OggehStatus.SUCCESS;
      return output.map(({items}) => items).flat();
    } catch (error) {
      this.status = OggehStatus.ERROR;
      this.error = error.message;
    }
    return;
  }

  async getNewsArticle(start_date, scope = '') {
    if (!start_date) return;
    this.status = OggehStatus.PENDING;
    try {
      const cacheKey = `news.article.${start_date}`;
      const cacheNewsArticle = await this.cache.get(cacheKey, {maxRetries: 0});
      if (cacheNewsArticle) {
        this.status = OggehStatus.SUCCESS;
        if (scope in cacheNewsArticle) return cacheNewsArticle[scope];
        return cacheNewsArticle;
      }
      const output = await this.oggeh
        .get({ method: 'get.news', start_date, limit: 1, select: 'timestamp,subject,header,cover,blocks,tags' })
        .promise();
      if (typeof output === 'string' || !output) {
        this.status = OggehStatus.ERROR;
        this.error = output;
        return;
      }
      if (!output.length) return;
      const result = output.find((article) => article?.timestamp === start_date);
      await this.cache.set(cacheKey, result);
      this.status = OggehStatus.SUCCESS;
      if (scope in result) return result[scope];
      return result;
    } catch (error) {
      this.status = OggehStatus.ERROR;
      this.error = error.message;
    }
    return;
  }

  async getNews(start_date = '', limit = 2) {
    this.status = OggehStatus.PENDING;
    try {
      const cacheKey = `news${start_date ? `.${start_date}` : ''}.${limit}`;
      const cacheNews = await this.cache.get(cacheKey, {maxRetries: 0});
      if (cacheNews) {
        this.status = OggehStatus.SUCCESS;
        return cacheNews;
      }
      const cachePagination = await this.newsPagination.get('news.pagination', {maxRetries: 0});
      const start = start_date && cachePagination.length ? cachePagination.findIndex((timestamp) => timestamp === start_date) : 0;
      const list = await this.oggeh
        .get({ method: 'get.news', ...(start_date ? {start_date} : {}), limit, select: 'timestamp,subject,header,cover,tags' })
        .promise();
      if (typeof list === 'string' || !list) {
        this.status = OggehStatus.ERROR;
        this.error = list;
        return;
      }
      await this.newsPagination.set('news.pagination', list.map(({timestamp}) => timestamp));
      const pagination = await this.newsPagination.get('news.pagination', {maxRetries: 0});
      const previous = pagination[start - limit];
      const next = pagination[pagination.length - 1];
      await this.cache.set(cacheKey, {list, previous, next});
      this.status = OggehStatus.SUCCESS;
      return {list, previous, next};
    } catch (error) {
      this.status = OggehStatus.ERROR;
      this.error = error.message;
    }
    return;
  }

  async getNewsRelated(timestamp = '', limit = 4) {
    const cacheKey = `news.related${timestamp ? `.${timestamp}` : ''}.${limit}`;
    const cacheNewsRelated = await this.cache.get(cacheKey, {maxRetries: 0});
    if (cacheNewsRelated) {
      this.status = OggehStatus.SUCCESS;
      return cacheNewsRelated;
    }
    const cachePagination = await this.newsPagination.get('news.pagination', {maxRetries: 0});
    const output = await this.oggeh
      .get({ method: 'get.news.related', timestamp: timestamp || cachePagination?.[0] || getDefaultTimestamp(), limit, select: 'timestamp,subject,header,cover,tags' })
      .promise();
    if (typeof output === 'string' || !output) {
      this.status = OggehStatus.ERROR;
      this.error = output;
      return;
    }
    await this.cache.set(cacheKey, {list: output});
    return {list: output};

    function getDefaultTimestamp() {
      const date = new Date();
      date.setMonth(0);
      date.setDate(1);
      return Math.floor(date.getTime() / 1000);
    }
  }

  async getFormToken(key) {
    this.status = OggehStatus.PENDING;
    try {
      const token = await this.oggeh
        .get({method: 'get.form.token', key})
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
        .post({ method: 'post.contact.form', key: 'contact', ...formData });
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
        .post({ method: 'post.page.form', ...formData });
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
    contact: false,
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
    let event;

    const config = this.getAttribute('config');
    if (config) {
      if (!Object.values(OggehConfig).includes(config)) {
        event = {
          data: {
            error: `Configuration ${config} not supported`,
          },
        };
        this.dispatchEvent(new CustomEvent(OggehEvent.ERROR, {
          bubbles: true,
          detail: event,
        }));
        return;
      }
      switch (config) {
        case OggehConfig.ANTI_FLICKER:
          this.#setupAntiFlicker();
          return;
        case OggehConfig.ROUTER:
          this.#setupRouter();
          return;
        case OggehConfig.SCRIPTS:
          this.#injectScripts();
          return;
      }
    }

    let get = this.getAttribute('get');
    const custom = this.getAttribute('custom');
    if (!get) get = custom;
    if (!get) {
      event = {
        data: {
          get,
          error: `Missing required get/custom attribute`,
        },
      };
      this.dispatchEvent(new CustomEvent(OggehEvent.ERROR, {
        bubbles: true,
        detail: event,
      }));
      return;
    }
    const method = `get${getMethodName(get || custom)}`;
    if (typeof this.oggeh[method] !== 'function' && typeof window.oggeh[method] !== 'function') {
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
    const timestamp = Number(this.getAttribute('timestamp') || this.#getRequestParam('timestamp') || '0');
    const startDate = Number(this.getAttribute('start-date') || this.#getRequestParam('start-date') || '0');
    const model = this.getAttribute('model') || this.#getRequestParam('model') || '';
    const keyword = this.getAttribute('keyword') || this.#getRequestParam('keyword') || '';
    const limit = Number(this.getAttribute('limit') || this.#getRequestParam('limit') || '2');
    const scope = this.getAttribute('scope') || this.#getRequestParam('scope') || '';

    let data;
    switch (method) {
      case 'getApp':
        if (!Object.values(OggehRender).includes(render)) {
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
      case 'getPages':
        data = await this.oggeh[method](startKey, limit);
        break;
      case 'getPage':
        data = await this.oggeh[method](key, model, scope);
        break;
      case 'getPageRelated':
        data = await this.oggeh[method](key);
        break;
      case 'getSearchResults':
        data = await this.oggeh[method](keyword);
        break;
      case 'getNews':
        data = await this.oggeh[method](startDate, limit);
        break;
      case 'getNewsArticle':
        data = await this.oggeh[method](timestamp, scope);
        break;
      case 'getNewsRelated':
        data = await this.oggeh[method](timestamp, limit);
        break;
      default:
        if (typeof window.oggeh[method] === 'function') {
          await this.#isComplete();
          // expected to be defined in the window.oggeh object
          data = await window.oggeh[method]();
        } else {
          data = await this.oggeh[method]();
        }
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
      await this.#isDocumentReady();
      if (method === 'getApp') {
        this.#injectMeta(data);
        if (Array.isArray(data?.nav)) {
          switch (render) {
            case OggehRender.META:
              const meta = {...data.app.meta, title: data.app.title};
              event.data = {meta};
              this.#renderContent({get, data: meta, custom, event, render});
              break;
            case OggehRender.NAV:
              event.data = {nav: data.nav};
              this.#renderNavigation({get, data: data.nav, custom, event, render});
              break;
            case OggehRender.SLIDER:
              event.data = {slider: data.slider};
              this.#renderContent({get, data: data.slider, custom, event, render});
              break;
            case OggehRender.LOCATIONS:
              event.data = {locations: data.locations};
              this.#renderContent({get, data: {list: data.locations}, custom, event, render});
              break;
            case OggehRender.SOCIAL:
              event.data = {social: data.app.social};
              const list = Object.entries(data.app.social).map(([provider, url]) => ({provider, url}));
              this.#renderContent({get, data: {list}, custom, event, render});
              break;
            case OggehRender.CONTACT:
              const contact = {...(data.contacts[0] || {}), ...(data.locations[0] || {})};
              event.data = {contact};
              this.#renderContent({get, data: contact, custom, event, render});
              break;
          }
        }
      } else if (Array.isArray(data)) {
        // can only handle data-oggeh-repeat attribute
        this.#renderList({get, data, custom, event});
      } else {
        if (data?.key) data.token = await this.oggeh.getFormToken(data.key);
        // can only handle oggeh-repeat template
        this.#renderContent({get, data, custom, event});
      }
    }

    this.#renderContactForm();

    function getMethodName(value) {
      return value.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join('');
    }
  }

  #getRequestParam(param) {
    const url = new URL(location.href);
    if (['key', 'start-key', 'timestamp', 'keyword'].includes(param)) {
      const last = url.pathname.split('/').filter(p => !!p).pop();
      if (!Object.values(OggehRoutes).includes(last)) return last;
    }
    const params = new URLSearchParams(location.search);
    return params.get(param);
  }

  #setupAntiFlicker() {
    if (document.getElementById(OggehAntiFlickerId)) return;
    document.head.insertAdjacentHTML(
      'beforeend',
      `<style id="${OggehAntiFlickerId}" type="text/css" media="all">body::after{position:fixed;top:0;bottom:0;left:0;right:0;content:"";background:#fff;z-index:2147483647}</style>`
    );
  }

  #removeAntiFlicker() {
    if (!document.getElementById(OggehAntiFlickerId)) return;
    document.head.removeChild(document.getElementById(OggehAntiFlickerId));
  }

  #ready({event, custom}) {
    this.#removeAntiFlicker();
    if (!event) return;
    if (!custom) OggehContent.events.push(event);
    this.dispatchEvent(new CustomEvent(OggehEvent.READY, {
      bubbles: true,
      detail: event,
    }));
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
      this.#processForm(form, data);
    });
  }

  async #processForm(form, data, isContact = false) {
    const event = {
      process: 'form',
    };
    try {
      let output;
      if (isContact) {
        output = await this.oggeh.submitContactForm(data);
      } else {
        output = await this.oggeh.submitPageForm(data);
      }
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
      const alert = document.body.querySelector('[data-oggeh-form-error]');
      if (alert) alert.style.setProperty('display', 'block', 'important');
      document.dispatchEvent(new CustomEvent(OggehEvent.ERROR, {
        bubbles: true,
        detail: event,
      }));
    } else {
      const alert = document.body.querySelector('[data-oggeh-form-success]');
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
      OggehContent.state.meta = true;
      if (document.head.querySelector('title')) document.head.querySelector('title').textContent = data.app.title;
      document.head.insertAdjacentHTML('afterbegin', `
        <meta name="keywords" content="${data.app.meta.keywords}">
        <meta name="description" content="${data.app.meta.description}">
        <meta name="og:title" content="${data.app.title}">
        <meta name="og:description" content="${data.app.meta.description}">
      `);
    }
  }

  #isDocumentReady() {
    return waitFor(() => document.readyState === 'complete' || document.readyState === 'interactive', {maxRetries: 50, interval: 100});
  }

  #isComplete() {
    return waitFor(() => OggehContent.events.length === Array.from(document?.body?.querySelectorAll?.(OggehTag)).filter((el) => el.hasAttribute('get')).length, {maxRetries: 50, interval: 100});
  }

  #renderNavigation({get, data, custom, event, render}) {
    const templates = {
      container: this.querySelector('template#oggeh-nav'),
      leaf: this.querySelector('template#oggeh-nav-leaf'),
      branch: this.querySelector('template#oggeh-nav-branch'),
    };
    if (!templates.container) {
      const event = {
        data: {
          get,
          ...(render ? {render} : {}),
          error: 'Missing required container template',
        },
      };
      this.dispatchEvent(new CustomEvent(OggehEvent.ERROR, {
        bubbles: true,
        detail: event,
      }));
      return;
    } else if (!(templates.leaf || templates.branch)) {
      const event = {
        data: {
          get,
          ...(render ? {render} : {}),
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
    if (navigationElement) this.insertAdjacentElement('afterend', navigationElement);

    this.#ready({event, custom});

    function buildNavItems(items) {
      const fragment = document.createDocumentFragment();
      items.forEach((item, index) => {
        if (item.childs && item.childs.length > 0) {
          const useBranch = addNavBranch(item, index);
          if (!useBranch) addNavLeaf(item, index);
        } else {
          addNavLeaf(item, index);
        }
      });
      return fragment;

      function addNavBranch(item, index) {
        const branchTpl = templates.branch;
        if (!branchTpl) return;
        const branchHTML = fillTemplate(branchTpl.innerHTML, item, {blockId: getBlockId(index)});
        const clone = document.createElement('div');
        clone.innerHTML = branchHTML;
        const childFragment = buildNavItems(item.childs);
        const slot = clone.querySelector('slot');
        if (slot) slot.parentNode.replaceChild(childFragment, slot);
        fragment.appendChild(clone.firstElementChild);
        return true;
      }

      function addNavLeaf(item, index) {
        const leafTpl = templates.leaf;
        if (!leafTpl) return;
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

  #renderList({get, data, custom, event}) {
    const templates = {
      container: this.querySelector('template#oggeh-container'),
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
    } else if (!Array.isArray(data)) {
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
        }
      }
    }

    this.#ready({event, custom});

    function constructContent() {
      const tpl = templates.container;
      const containerClone = document.importNode(tpl.content, true);
      processIterables(containerClone, data);
      if (!containerClone.firstElementChild.innerHTML) return;
      const clone = document.createElement('div');
      clone.innerHTML = fillTemplate(containerClone.firstElementChild.innerHTML, data, {blockId: getBlockId()});
      return Array.from(clone.childNodes).reverse();
    }
  }

  #renderContent({get, data, custom, event, render}) {
    const templates = {
      container: this.querySelector('template#oggeh-container'),
      iterable: this.querySelector('template#oggeh-repeat'),
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
          ...(render ? {render} : {}),
          error: 'Missing required container template',
        },
      };
      this.dispatchEvent(new CustomEvent(OggehEvent.ERROR, {
        bubbles: true,
        detail: event,
      }));
      return;
    } else if (templates.iterable && !Array.isArray(data?.list)) {
      const event = {
        data: {
          get,
          ...(render ? {render} : {}),
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
    }

    this.#ready({event, custom});

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
            if (hasPhotos) addMediaBlock('photos', index, item);
            const hasAudio = item.media.filter(({type}) => type === 'audio').length > 1;
            if (hasAudio) addMediaBlock('audio', index, item);
            const hasVideos = item.media.filter(({type}) => type === 'video').length > 1;
            if (hasVideos) addMediaBlock('videos', index, item);
            break;
          case 'files':
            addFilesBlock(item, index);
            break;
          case 'table':
            addTableBlock(item, index);
            break;
          case 'form':
            addFormBlock(item, index);
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

      function addMediaBlock(type, index, item) {
        const tpl = templates[type];
        if (!tpl) return;
        const clone = document.importNode(tpl.content, true);
        processIterables(clone, item.media);
        const blocks = Array.from(clone.childNodes).filter(b => b.nodeType === Node.ELEMENT_NODE);
        for (const block of blocks) {
          block.classList.value = fillTemplate(block.classList.value, item, {blockId: getBlockId(index)});
          block.innerHTML = fillTemplate(block.innerHTML, item, {blockId: getBlockId(index)});
          fragment.appendChild(block);
        }
      }

      function addFilesBlock(item, index) {
        const tpl = templates.files;
        if (!tpl) return;
        const clone = document.importNode(tpl.content, true);
        processIterables(clone, item.files);
        const blocks = Array.from(clone.childNodes).filter(b => b.nodeType === Node.ELEMENT_NODE);
        for (const block of blocks) {
          block.classList.value = fillTemplate(block.classList.value, item, {blockId: getBlockId(index)});
          block.innerHTML = fillTemplate(block.innerHTML, item, {blockId: getBlockId(index)});
          fragment.appendChild(block);
        }
      }

      function addTableBlock(item, index) {
        if (!Array.isArray(item.table) || item.table.length < 2) return;
        const tpl = templates.table;
        const containerClone = document.importNode(tpl.content, true);
        // we cannot use DocumentFragment here because of the restricted HTML content model for the table element
        const tableEl = containerClone.querySelector('table');
        if (!tableEl) return;
        let thead = tableEl.querySelector('thead');
        let tbody = tableEl.querySelector('tbody');
        if (!thead) thead = document.createElement('thead'); tableEl.prepend(thead);
        if (!tbody) tbody = document.createElement('tbody'); tableEl.appendChild(tbody);
        const headerData = item.table[0];
        let headerHTML = '';
        headerData.forEach((cellValue, colIndex) => {
          const headerCellTpl = templates.tableHeaderCell;
          headerHTML += fillTemplate(headerCellTpl.innerHTML, headerData, { index: colIndex });
        });
        const headerTr = document.createElement('tr');
        headerTr.innerHTML = headerHTML;
        thead.innerHTML = '';
        thead.appendChild(headerTr);
        const bodyRows = item.table.slice(1);
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
        containerClone.firstElementChild.classList.value = fillTemplate(containerClone.firstElementChild.classList.value, item, {blockId: getBlockId(index)});
        containerClone.firstElementChild.innerHTML = fillTemplate(containerClone.firstElementChild.innerHTML, item, {blockId: getBlockId(index)});
        fragment.appendChild(containerClone.firstElementChild);
      }

      function addFormBlock(item, index) {
        if (!Array.isArray(item.form)) return;
        const tpl = templates.form;
        const containerClone = document.importNode(tpl.content, true);
        let fieldsHTML = '';
        item.form.forEach((field, idx) => {
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
        containerClone.firstElementChild.classList.value = fillTemplate(containerClone.firstElementChild.classList.value, item, {blockId: getBlockId(index)});
        containerClone.firstElementChild.innerHTML = fillTemplate(containerClone.firstElementChild.innerHTML, item, {blockId: getBlockId(index)});
        fragment.appendChild(containerClone.firstElementChild);
      }

    }

    function constructContent() {
      const html = fillTemplate(templates.container.innerHTML, data, {blockId: getBlockId()});
      const containerClone = document.createElement('div');
      containerClone.innerHTML = html;
      let fragment;
      if (templates.iterable && Array.isArray(data?.list)) {
        fragment = buildIterableItems(data.list);
      } else if (Array.isArray(data?.blocks)) {
        fragment = buildBlocks(data.blocks);
      }
      if (fragment) {
        const slot = containerClone.querySelector('slot');
        if (slot) slot.parentNode.replaceChild(fragment, slot);
      }
      const clone = document.createElement('div');
      clone.innerHTML = fillTemplate(containerClone.innerHTML, data, {blockId: getBlockId()});
      return Array.from(clone.childNodes).reverse();
    }
  }

  async #renderContactForm() {
    if (OggehContent.state.contact) return;
    OggehContent.state.contact = true;
    const form = document.querySelector('[data-oggeh-form-contact]');
    if (!form) return;
    form.insertAdjacentHTML('beforeend', '<input type="hidden" name="key" value="contact">');
    const token = await this.oggeh.getFormToken('contact');
    form.insertAdjacentHTML('beforeend', `<input type="hidden" name="token" value="${token}">`);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const formData = new FormData(form);
      const data = Object.fromEntries(formData);
      this.#processForm(form, data, true);
    });
  }
}

function waitFor(evaluate, {maxRetries = 50, interval = 100} = {}) {
  let retries = 0;
  const check = (resolve) => {
    const value = evaluate();
    if (value) {
      resolve(value);
    } else if (retries < maxRetries) {
      retries++;
      setTimeout(() => check(resolve), interval);
    } else {
      resolve();
    }
  };
  return new Promise((resolve) => check(resolve));
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;

  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (let key of keysA) {
    if (!deepEqual(a[key], b[key])) return false;
  }
  return true;
}

function mergeArrays(arr1, arr2) {
  const merged = [...arr1];

  arr2.forEach(item => {
    let found = false;
    for (let i = 0; i < merged.length; i++) {
      if (deepEqual(merged[i], item)) {
        // If both items are objects, merge them deeply.
        if (merged[i] && typeof merged[i] === 'object' && item && typeof item === 'object') {
          merged[i] = objectDeepMerge(merged[i], item);
        }
        found = true;
        break;
      }
    }
    if (!found) {
      merged.push(item);
    }
  });

  return merged;
}

function objectDeepMerge(...objects) {
  const isObject = (obj) => obj && typeof obj === 'object' && !Array.isArray(obj);

  return objects.reduce((prev, obj) => {
    Object.keys(obj).forEach(key => {
      const pVal = prev[key];
      const oVal = obj[key];

      if (Array.isArray(pVal) && Array.isArray(oVal)) {
        prev[key] = mergeArrays(pVal, oVal);
      } else if (isObject(pVal) && isObject(oVal)) {
        prev[key] = objectDeepMerge(pVal, oVal);
      } else {
        prev[key] = oVal;
      }
    });
    return prev;
  }, {});
}

function getBlockId(index = 0) {
  return `${(Date.now() + Math.random()).toString(36)}.${index}`;
}

function fillTemplate(templateStr, data, { index = 0, blockId = '' } = {}) {
  return templateStr
      .replace(/=""/g, '') // fix placeholder if mutated by the HTML content model restrictions
      .replace(/{{\s*([^}]+)\s*}}/g, (match, input) => {
    const [expression, modifier] = input.trim().split('|').map(p => p.trim());
    let value = getValue(expression);
    if (modifier) {
      if (modifier.includes('is')) {
        const evaluate = modifier.match(/is\((.*)\)/)?.[1];
        if (getValue(evaluate)) {
          return expression;
        } else {
          return '';
        }
      } else if (modifier.includes('fallback')) {
        const fallback = modifier.match(/fallback\(['"](.*)['"]\)/)?.[1];
        if (!value) return fallback;
      } else if (modifier.includes('join')) {
        const separator = modifier.match(/join\(['"](.*)['"]\)/)?.[1];
        if (Array.isArray(value)) {
          return value.join(separator);
        } else {
          return '';
        }
      } else if (modifier === 'formatDate') {
        if (!value) return '';
        return new Intl.DateTimeFormat("en-US", {
          year: "numeric",
          month: "long",
          day: "2-digit"
        }).format(new Date(Number(value) * 1000));
      } else if (modifier === 'formatTime') {
        if (!value) return '';
        return new Intl.DateTimeFormat("en-US", {
          hour: "numeric",
          minute: "numeric",
          second: "numeric"
        }).format(new Date(Number(value) * 1000));
      } else {
        return value || getValue(modifier) || '';
      }
    }
    return (value !== undefined && value !== null) ? value : '';

    function getValue(expression) {
      const parts = expression.split('.');
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
        const arrMatch = part.match(/^([^\[\]]+)(?:\[(\d+|\*)\])?$/);
        if (arrMatch) {
          const key = arrMatch[1];
          let idx = arrMatch[2];
          if (typeof value !== 'object') continue;
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
      return value;
    }
  });
}

function processIterables(tpl, items) {
  const nodes = tpl.querySelectorAll('[data-oggeh-repeat]');
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
      clone.removeAttribute('data-oggeh-repeat');
      fragment.appendChild(clone);
    });
    parent.insertBefore(fragment, node);
    parent.removeChild(node);
  });
}

customElements.define(OggehTag, OggehContent);
