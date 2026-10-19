# Sky Dive Horror

A WebXR game for Meta Quest, with a desktop fallback. You witnessed a mob hit, and now you're on the mob's cargo plane at 3,200 m. Get past the hitmen to the open ramp, jump, dodge everything they throw at you on the way down, pull your chute and land on the target.

Built with plain HTML and JavaScript plus [three.js](https://threejs.org) loaded from a CDN. There's no build step. Every texture and sound is generated in code, so there are no asset files.

## Play on Quest via GitHub Pages

1. Create a GitHub repo and push these files (`index.html`, `main.js`, `.nojekyll`, `README.md`):
   ```sh
   git init && git add . && git commit -m "Sky Dive Horror"
   git branch -M main
   git remote add origin https://github.com/<you>/sky-dive-horror.git
   git push -u origin main
   ```
2. In the repo, open **Settings → Pages**, set **Source: Deploy from a branch**, then pick **Branch: main / (root)**.
3. After a minute, open `https://<you>.github.io/sky-dive-horror/` in the **Meta Quest Browser** and press **ENTER VR**.

WebXR requires HTTPS. GitHub Pages provides it, so a plain `file://` copy won't work in the headset.

## Controls

| | Quest | Browser |
|---|---|---|
| Move | Left thumbstick | WASD |
| Turn | Right thumbstick (snap) / your body | Mouse |
| Duck / dodge | Physically lean, step and crouch | C |
| Start / pull chute / retry | Trigger (or grip) | Space / click |

## How to survive

- **Cargo hold:** keep moving. The hitmen aim where you *are*, so zig-zag toward the open ramp at the back and walk off the edge.
- **Freefall:** stuff dropped from the plane is telegraphed by a **red beam with a ring at chest height**. Get out of it. The hitmen who jump after you throw suitcases, seats, barrels and bombs, so sidestep or duck.
- **Below 1,500 m** you can pull the chute. Below 900 m the HUD screams at you. Hit the ground in freefall and you die.
- **Under canopy:** follow the yellow arrow and the orange smoke to the bullseye. Your score is your health plus how close you land.

## Tuning

All the gameplay numbers (fall speed, altitudes, health, movement speeds, target location) live in the `CFG` object at the top of `main.js`.
