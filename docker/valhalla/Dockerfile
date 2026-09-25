# Motorul de rutare (Valhalla), cu tile-urile construite la prima pornire.
#
# Imaginea oficială are toate binarele (`valhalla_build_config`, `valhalla_build_tiles`,
# `valhalla_service`), dar nu are entrypoint și nu construiește nimic — deci scriptul de pornire e al
# nostru, iar aici e copiat în imagine ca să nu depindă de un fișier montat de pe gazdă.
FROM ghcr.io/valhalla/valhalla:latest

COPY build.sh /usr/local/bin/build-valhalla.sh
# `sed` nu e o precauție de prisos: `docker build` copiază fișierul din arborele de lucru, iar pe
# Windows un checkout cu `core.autocrlf=true` îl aduce cu CRLF — bash ar căuta atunci comanda
# `set -euo pipefail\r`. `.gitattributes` păzește checkout-ul, dar imaginea nu trebuie să depindă de el.
RUN sed -i 's/\r$//' /usr/local/bin/build-valhalla.sh && chmod +x /usr/local/bin/build-valhalla.sh

# Tile-urile și configurația stau în volum (`/custom_files`), nu în stratul imaginii: altfel fiecare
# repornire ar reconstrui 378 MB de tile-uri.
VOLUME ["/custom_files"]
EXPOSE 8002

ENTRYPOINT ["/usr/local/bin/build-valhalla.sh"]
