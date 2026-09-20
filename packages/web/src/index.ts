import fs from "node:fs";
import path from "node:path";

export function buildWeb(): void {
  const src = path.resolve(import.meta.dir, "../public/index.html");
  const distDir = path.resolve(import.meta.dir, "../dist");
  const dest = path.join(distDir, "index.html");

  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  fs.copyFileSync(src, dest);
  console.log(`✓ Built web assets to ${dest}`);
}

export function startServer(port = 3000): void {
  const distDir = path.resolve(import.meta.dir, "../dist");
  const indexPath = path.join(distDir, "index.html");

  if (!fs.existsSync(indexPath)) {
    buildWeb();
  }

  const server = Bun.serve({
    port,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/" || url.pathname === "/index.html") {
        return new Response(Bun.file(indexPath), {
          headers: { "Content-Type": "text/html" },
        });
      }
      return new Response("Not Found", { status: 404 });
    },
  });

  console.log(`🌐 Shadow Web Viewer running at http://localhost:${server.port}`);
}

if (import.meta.main) {
  const cmd = process.argv[2];
  if (cmd === "build") {
    buildWeb();
  } else {
    startServer(Number(process.env.PORT) || 3000);
  }
}
