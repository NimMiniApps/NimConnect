#!/usr/bin/env bash

set -euo pipefail

asset_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
icon_source="${asset_dir}/source-icon-panel.png"
banner_source="${asset_dir}/source-banner.png"
logo_source="${asset_dir}/nimconnect-logo-full.png"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg is required to generate the NimConnect assets." >&2
  exit 1
fi

for source_file in "${icon_source}" "${banner_source}" "${logo_source}"; do
  if [[ ! -f "${source_file}" ]]; then
    echo "Missing source asset: ${source_file}" >&2
    exit 1
  fi
done

export_png() {
  local source_file="$1"
  local filter="$2"
  local output_file="$3"

  ffmpeg \
    -hide_banner \
    -loglevel error \
    -y \
    -i "${source_file}" \
    -vf "${filter}" \
    -frames:v 1 \
    -c:v png \
    -pred mixed \
    "${output_file}"
}

export_icon() {
  local size="$1"
  local output_file="$2"

  # The source panel has a five-pixel black strip on its right edge. Crop the
  # artwork to a true square before resizing so no export gains a hard inset.
  export_png \
    "${icon_source}" \
    "crop=205:205:0:0,scale=${size}:${size}:flags=lanczos" \
    "${output_file}"
}

for size in 16 32 48 64 128 180 192 240 256 512; do
  export_icon "${size}" "${asset_dir}/nimconnect-icon-${size}x${size}.png"
done

cp "${asset_dir}/nimconnect-icon-512x512.png" "${asset_dir}/app-icon-512x512.png"
cp "${asset_dir}/nimconnect-icon-240x240.png" "${asset_dir}/thumbnail-240x240.png"
cp "${asset_dir}/nimconnect-icon-180x180.png" "${asset_dir}/apple-touch-icon.png"
cp "${asset_dir}/nimconnect-icon-192x192.png" "${asset_dir}/android-chrome-192x192.png"
cp "${asset_dir}/nimconnect-icon-512x512.png" "${asset_dir}/android-chrome-512x512.png"

# Keep every part of the wide master visible. The small aspect-ratio adjustment
# is preferable to clipping the border, copy, or feature details.
export_png \
  "${banner_source}" \
  "scale=1500:500:flags=lanczos" \
  "${asset_dir}/header-1500x500.png"
export_png \
  "${banner_source}" \
  "scale=1600:500:flags=lanczos" \
  "${asset_dir}/header-1600x500.png"

export_png \
  "${logo_source}" \
  "scale=1200:360:flags=lanczos" \
  "${asset_dir}/nimconnect-logo-1200x360.png"

# Social previews need a larger, simpler focal point than the information-dense
# header. Use the compact logo lockup on a matching dark canvas.
export_png \
  "${logo_source}" \
  "scale=1050:333:flags=lanczos,pad=1200:630:75:148:color=0x050a15" \
  "${asset_dir}/social-card-1200x630.png"

# A 256px PNG-backed ICO is accepted by current browsers and avoids preserving
# the incorrectly inset frames from the old multi-resolution file.
ffmpeg \
  -hide_banner \
  -loglevel error \
  -y \
  -i "${asset_dir}/nimconnect-icon-256x256.png" \
  -frames:v 1 \
  "${asset_dir}/favicon.ico"

echo "Generated NimConnect assets in ${asset_dir}"
