import { createGalleryServer, GALLERY_ORIGIN, GALLERY_PORT } from "./gallery_server.mjs";

const server = createGalleryServer();
server.listen(GALLERY_PORT, "127.0.0.1", () => console.log(`Serving ${GALLERY_ORIGIN}`));

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
