#!/usr/bin/env bash
#
# Construiește tile-urile Valhalla dintr-un extract OSM și pornește serviciul de rutare.
#
# Rulează la pornirea containerului. Reconstrucția e scumpă (măsurat 2026-09-24: 356 s pentru toată
# România, cu 10 fire, pe un extract de 314 MB), dar se face **o singură dată**: tile-urile stau într-un
# volum, iar la următoarele porniri scriptul vede că există și trece direct la serviciu.
#
# De ce nu folosim o imagine gata făcută: imaginile „docker-valhalla" de pe Docker Hub ori nu există,
# ori sînt vechi (2023). Imaginea oficială `ghcr.io/valhalla/valhalla` are toate binarele, dar nu are
# entrypoint și nu construiește nimic — are `CMD=["/bin/bash"]`. Deci pașii se fac aici, explicit.
#
# Variabile de mediu:
#   PBF       — calea extractului OSM (implicit /custom_files/romania-latest.osm.pbf)
#   PBF_URL   — de unde se descarcă extractul, dacă lipsește (implicit Geofabrik, România)
#   DATA_DIR  — unde stau tile-urile și configurația (implicit /custom_files)
#   THREADS   — cîte fire folosește construcția (implicit cîte are mașina, plafonat la 10)

set -euo pipefail

DATA_DIR="${DATA_DIR:-/custom_files}"
PBF="${PBF:-$DATA_DIR/romania-latest.osm.pbf}"
PBF_URL="${PBF_URL:-https://download.geofabrik.de/europe/romania-latest.osm.pbf}"
THREADS="${THREADS:-$(nproc)}"
if [ "$THREADS" -gt 10 ]; then THREADS=10; fi

TILES_DIR="$DATA_DIR/valhalla_tiles"
CONFIG="$DATA_DIR/valhalla.json"

if [ ! -f "$PBF" ]; then
  echo "=== extractul OSM lipsește, îl descarc din $PBF_URL ==="
  # `--continue-at -` face descărcarea reluabilă: 314 MB pe o legătură slabă nu se iau dintr-o bucată.
  curl --fail --location --continue-at - --output "$PBF" "$PBF_URL"
fi

if [ ! -f "$CONFIG" ]; then
  echo "=== 1/3 generez configurația ==="
  valhalla_build_config \
    --mjolnir-tile-dir "$TILES_DIR" \
    --mjolnir-concurrency "$THREADS" \
    > "$CONFIG"
fi

if [ ! -d "$TILES_DIR/2" ]; then
  echo "=== 2/3 construiesc tile-urile (cîteva minute) ==="
  valhalla_build_tiles -c "$CONFIG" "$PBF"
  echo "=== BUILD DONE ==="
else
  echo "=== tile-urile există deja, sar peste construcție ==="
fi

echo "=== 3/3 pornesc serviciul pe 8002 ==="
exec valhalla_service "$CONFIG" "$THREADS"
