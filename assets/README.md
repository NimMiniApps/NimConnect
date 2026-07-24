# NimConnect brand assets

The files in this directory are generated from three master artworks:

- `source-icon-panel.png`
- `source-banner.png`
- `nimconnect-logo-full.png`

Run `./assets/generate-assets.sh` from the repository root to rebuild the
derived files. The export script keeps the complete banner artwork visible,
removes the stray strip from the icon source, and uses a dedicated,
large-format logo composition for social previews.

## Requested assets

- `app-icon-512x512.png` — app icon, exactly 512 × 512 px
- `thumbnail-240x240.png` — thumbnail, exactly 240 × 240 px

## Other useful assets

- `header-1500x500.png`
- `header-1600x500.png`
- `social-card-1200x630.png`
- `nimconnect-logo-full.png`
- `favicon.ico`
- `apple-touch-icon.png`
- `android-chrome-192x192.png`
- `android-chrome-512x512.png`

## Suggested project layout

```text
public/
  brand/
    app-icon-512x512.png
    thumbnail-240x240.png
    header-1500x500.png
    social-card-1200x630.png
    favicon.ico
    apple-touch-icon.png
```

## HTML metadata

```html
<link rel="icon" href="/brand/favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="32x32" href="/brand/nimconnect-icon-32x32.png">
<link rel="apple-touch-icon" href="/brand/apple-touch-icon.png">

<meta property="og:image" content="/brand/social-card-1200x630.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="/brand/social-card-1200x630.png">
```
