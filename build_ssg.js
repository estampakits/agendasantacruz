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

// Remove Tailwind CDN to prevent MutationObserver crashes in JSDOM
// We keep the classes in HTML, which is all we need for SSG.
const tailwindRegex = /<script src="https:\/\/cdn\.tailwindcss\.com[^>]*><\/script>/g;
let jsdomHtmlTemplate = htmlTemplate.replace(tailwindRegex, '');

// Inject script to expose consts to window
jsdomHtmlTemplate = jsdomHtmlTemplate.replace('</body>', '<script>window.exp_localities = typeof localities !== "undefined" ? localities : []; window.exp_events = typeof baseEvents !== "undefined" ? baseEvents : []; window.exp_services = typeof services !== "undefined" ? services : []; window.exp_slugify = typeof slugify !== "undefined" ? slugify : null;</script></body>');

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
    vc.on("error", () => {}); // supress

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
          const ogTitle = document.createElement('meta');
          ogTitle.setAttribute('property', 'og:title');
          ogTitle.setAttribute('content', document.title);
          head.appendChild(ogTitle);

          const metaDesc = document.createElement('meta');
          metaDesc.setAttribute('name', 'description');
          metaDesc.setAttribute('content', document.title + ' - Todo lo que pasa en Santa Cruz. Eventos, alojamientos, gastronomía y excursiones.');
          head.appendChild(metaDesc);
        }

        // We must re-inject the Tailwind script so the real users get styling!
        const finalHtml = document.documentElement.outerHTML.replace(
          '</head>', 
          '  <script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>\n</head>'
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
