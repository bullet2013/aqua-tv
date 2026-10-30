# AQUA TV — Samsung Tizen prototype

This is an **experimental unsigned Tizen Web Application**, keeping the AQUA TV
interface in GitHub Pages and using the TV's native AVPlay for HTTP IPTV HLS.

## Build and install

- The CI workflow packages `AQUA-TV-Tizen-UNSIGNED.wgt` for inspection, **not installation**.
- Import `tizen/` as a Tizen Web Application project into Tizen Studio.
- Enable Samsung TV Extension, Developer Mode on the target television, connect using its IP,
  and create a Samsung certificate profile **including the television's DUID**.
- Build/sign using Tizen Studio's **Build Signed Package** (or supported CLI with
  the certificate profile), then install the signed `.wgt` via Device Manager.
- The TV must reach the AQUA TV GitHub Pages HTTPS origin and provider's HTTP host.

## Architecture

- Local index.html: existing AQUA TV markup; loads CSS and JS from GitHub Pages.
- Local config.js: absolute public playlist + cached EPG URLs.
- Local bridge.js: emulates `window.AquaAndroid.postMessage`, dispatching
  play/rect/mute commands to Samsung AVPlay; restricts stream host to 31.41.12.104.
- For AVPlay, codecs are provided by Samsung firmware, **not** Android's FFmpeg extension.
  AC-3, MP2 and video format support vary by Samsung TV model.
- Old Tizen browsers may require the ES5-compatible website scripts. The bridge itself
  uses ES5 syntax, but this package currently loads the main website JS and CSS.
- Browser-only preview is https://bullet2013.github.io/aqua-tv/legacy-test/
  and does not include AVPlay.

## Known limitations — need TV testing

1. AVPlay video must be visible through the transparent HTML layer and cutout.
2. Browser layout/window dimensions and AVPlay's screen display rectangle must match.
3. Remote key events, browser focus and EPG navigation need physical remote verification.
4. TV specific MIME support, HTTPS certificates, mixed HTTP streams need verification.
5. An unsigned archive is **not** ready-to-install on a retail television.

No stable Android version or main web interface is changed by this PR.
