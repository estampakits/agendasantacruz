const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const distDir = path.join(__dirname, 'dist');
const indexFile = path.join(__dirname, 'index.html');

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

let htmlTemplate = fs.readFileSync(indexFile, 'utf-8');

// Copy original index.html to dist/index.html (fallback)
fs.copyFileSync(indexFile, path.join(distDir, 'index.html'));

// Replace Tailwind CDN with a placeholder during JSDOM render to prevent MutationObserver crash.
// We preserve the exact position to avoid breaking script order (ReferenceError on tailwind.config).
const tailwindRegex = /<script src="https:\/\/cdn\.tailwindcss\.com[^>]*><\/script>/g;
const placeholder = '<!-- TAILWIND_CDN_PLACEHOLDER -->';
let jsdomHtmlTemplate = htmlTemplate.replace(tailwindRegex, placeholder);

// Inject script to expose consts to window
jsdomHtmlTemplate = jsdomHtmlTemplate.replace('</body>', '<script>window.exp_localities = typeof localities !== "undefined" ? localities : []; window.exp_events = typeof baseEvents !== "undefined" ? baseEvents : []; window.exp_services = typeof services !== "undefined" ? services : []; window.exp_slugify = typeof slug !== "undefined" ? slug : null;</script></body>');

const jsdom = require("jsdom");

const virtualConsole = new jsdom.VirtualConsole();
virtualConsole.on("error", () => { /* No-op to suppress errors */ });

// Primary JSDOM to get routes
const dom = new JSDOM(jsdomHtmlTemplate, { runScripts: "dangerously", url: "http://localhost/", virtualConsole });
const window = dom.window;

// Wait for load to grab data
window.addEventListener("load", async () => {
  const localities = window.exp_localities || [];
  const baseEvents = window.exp_events || [];
  const services = window.exp_services || [];
  const slugify = window.exp_slugify;

  const routes = [
    '/',
    '/agenda',
    '/destinos',
    '/servicios',
    '/publicar/evento',
    '/publicar/servicio'
  ];

  if(slugify) {
    localities.forEach(loc => {
      const slug = slugify(loc);
      routes.push(`/localidad/${slug}`);
    });
  }

  baseEvents.forEach(ev => {
    if(ev.id) routes.push(`/evento/${ev.id}`);
  });

  services.forEach(svc => {
    if(svc.id) routes.push(`/prestador/${svc.id}`);
  });

  console.log(`Found ${routes.length} routes to generate.`);

  for (const route of routes) {
    await renderRoute(route, jsdomHtmlTemplate);
  }

  console.log('SSG Build Complete!');
  process.exit(0);
});

async function renderRoute(route, template) {
  return new Promise((resolve) => {
    const vc = new jsdom.VirtualConsole();
    vc.on("error", (err) => { console.error("JSDOM Error:", err.message || err); });

    const dom = new JSDOM(template, {
      url: `https://agendasantacruz.vercel.app${route}`,
      runScripts: "dangerously",
      resources: "usable",
      virtualConsole: vc
    });

    dom.window.addEventListener("load", () => {
      setTimeout(() => {
        const document = dom.window.document;
        
        let head = document.querySelector('head') || document.head;
        if(head) {
          // Remove existing og:title and og:description if any to prevent duplication
          const extOgTitle = document.querySelector('meta[property="og:title"]');
          if (extOgTitle) extOgTitle.remove();
          const extOgDesc = document.querySelector('meta[property="og:description"]');
          if (extOgDesc) extOgDesc.remove();

          const ogTitle = document.createElement('meta');
          ogTitle.setAttribute('property', 'og:title');
          ogTitle.setAttribute('content', document.title);
          head.appendChild(ogTitle);

          // Get the dynamic description set by the page JS
          const descTag = document.querySelector('meta[name="description"]');
          if (descTag) {
            const ogDesc = document.createElement('meta');
            ogDesc.setAttribute('property', 'og:description');
            ogDesc.setAttribute('content', descTag.getAttribute('content'));
            head.appendChild(ogDesc);
          } else {
            // Fallback description if none is set
            const metaDesc = document.createElement('meta');
            metaDesc.setAttribute('name', 'description');
            metaDesc.setAttribute('content', document.title + ' - Todo lo que pasa en Santa Cruz. Eventos, alojamientos, gastronomía y excursiones.');
            head.appendChild(metaDesc);
          }
        }

        // Restore Tailwind CDN in its original position
        const finalHtml = document.documentElement.outerHTML.replace(
          placeholder,
          '<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>'
        );
        const htmlContent = "<!DOCTYPE html>\n" + finalHtml;
        
        let savePath = path.join(distDir, route);
        if (route === '/') {
          savePath = path.join(distDir, 'index.html');
        } else {
          if (!fs.existsSync(savePath)) {
            fs.mkdirSync(savePath, { recursive: true });
          }
          savePath = path.join(savePath, 'index.html');
        }

        fs.writeFileSync(savePath, htmlContent);
        console.log(`Generated: ${route} -> Title: ${document.title}`);
        
        dom.window.close();
        resolve();
      }, 100);
    });
  });
}
