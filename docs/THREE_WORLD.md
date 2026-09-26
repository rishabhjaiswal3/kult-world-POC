# Interactive Three.js World Layer

`static/world3d.js` is a progressive, interactive visual layer over the accessible DOM World map.

## What it adds

- A low-poly 3D version of Radiant Hollow with six visually distinct districts: Agent Home, Commons, Work Hub, Creator Forge, AI Arena and Observatory.
- Pointer/touch camera orbit and bounded zoom on capable devices.
- Raycast district selection: selecting a 3D district invokes the existing authoritative DOM district action rather than creating a parallel gameplay path.
- Smooth camera focus for districts and the living Agent.
- Agent movement between districts driven only by `kult:world-state` events from the existing frontend state.
- Earned evolution changes Agent scale/appearance without changing gameplay state.
- Three ambient NPC Agents, skyline, paths, particles and district motion to make the World feel alive.
- DOM district labels are projected from the real 3D scene every frame so labels stay aligned as the camera moves.
- `Find Agent` focuses the 3D camera on the same Agent represented by the DOM UI.
- A small reset control and interaction hint are injected only after Three.js has loaded successfully.

## Production boundaries

- The DOM district buttons remain authoritative and keyboard accessible.
- Three.js cannot mutate Agent state, award evidence, submit missions, spend funds or trigger chain writes directly.
- 3D selection routes through the same DOM actions used by keyboard/touch users.
- Three.js failure never blocks gameplay; the CSS/SVG World remains usable.
- `prefers-reduced-motion` uses a static rendered scene.
- Save-Data and small coarse-pointer devices skip the heavier layer and retain the accessible fallback.
- Rendering pauses while the tab is hidden.
- Device pixel ratio is capped to protect mobile/GPU performance.

## Dependency

Three.js is pinned to `0.185.1` from jsDelivr. The production CSP already permits that origin. For a fully self-contained deployment, vendor the exact pinned module under `static/vendor/` and change `THREE_URL` accordingly.
