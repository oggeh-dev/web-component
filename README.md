# OGGEH Web Component

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Supported Properties

1. `config`: Accepts one of the following values:

  | Value | Required Arguments | Example |
  | --- | --- | --- |
  | `router` | | `<oggeh-content config="router"></oggeh-content>` |
2. `get` (_required_): Accepts one of the following values:

  | Value | Required Arguments | Example |
  | --- | --- | --- |
  | `app` | `render` (_options: `nav`, `slider`_ ) | `<oggeh-content get="app" render="nav"></oggeh-content>` |
  | `page` | | `<oggeh-content get="page"></oggeh-content>` |
  | `search-results` | `keyword` | `<oggeh-content get="search-results" keyword=""></oggeh-content>` |
  | `news` | `start-date`, `limit` | `<oggeh-content get="news" start-date="" limit="4"></oggeh-content>` |
  | `news-article` | `timestamp` | `<oggeh-content get="news-article" timestamp=""></oggeh-content>` |
  | `news-related` |  `timestamp` | `<oggeh-content get="news-related" timestamp=""></oggeh-content>` |

### Example

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="X-UA-Compatible" content="IE=edge" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>OGGEH Demo</title>

    <!-- Begin of OGGEH Web Component -->
    <script>
      window.oggeh = window.oggeh || {
        api_key: "YOUR_OGGEH_APP_API_KEY", // Required
        // api_secret: "YOUR_OGGEH_APP_API_SECRET", // Use only in mobile/desktop/nodejs apps
        // sandbox_key: "YOUR_OGGEH_APP_SANDBOX_KEY", // Use only in development environment
        // domain: "YOUR_OGGEH_HOSTNAME", // Use only in mobile/desktop/nodejs apps
      };
      document.addEventListener('oggeh.error', (event) => {
        console.error('OGGEH Error:', event.detail.error);
      });
      document.addEventListener('oggeh.ready', (event) => {
        console.log('OGGEH Response:', event.detail.data);
      });
      document.addEventListener('oggeh.navigate', (event) => {
        console.log('OGGEH Navigate:', event.detail.path);
      });
    </script>
    <script src="https://unpkg.com/@oggeh/web-component/dist/oggeh.min.js"></script>
    <!-- End of OGGEH Web Component -->

  </head>
  <body>

    <oggeh-content config="router"></oggeh-content>

    <oggeh-content get="app" render="nav">
      <!-- A simple link template -->
      <template id="oggeh-link">
        <a href="/page/key={{ key }}">{{ subject }}</a>
      </template>
      <!-- Template for a leaf navigation item (a single link in a list item) -->
      <template id="oggeh-nav-leaf">
        <li>
          <a href="/page/key={{ key }}">{{ subject }}</a>
        </li>
      </template>
      <!-- Template for a branch navigation item (with nested children) -->
      <template id="oggeh-nav-branch">
        <li class="dropdown">
          <a href="/page/key={{ key }}">{{ subject }}</a>
          <ul>
            <!-- This slot is where child navigation items (leaf or branch) will be inserted -->
            <slot></slot>
          </ul>
        </li>
      </template>
      <!-- Template for the overall navigation container -->
      <template id="oggeh-nav">
        <div class="navbar-collapse collapse clearfix">
          <ul class="navigation">
            <!-- All navigation items will be slotted into this list -->
            <slot></slot>
            <!-- Predefined routes -->
            <li>
              <a href="/news">News</a>
            </li>
            <li>
              <a href="/contact">Contact</a>
            </li>
          </ul>
        </div>
      </template>
    </oggeh-content>

  </body>
</html>
```
