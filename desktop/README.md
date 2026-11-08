# Standalone Aether CAD

The desktop shell packages the same `dist` frontend, OCCT WebAssembly kernel,
examples and version-pinned CAD container services as the hosted editor. It does
not connect to Studio, require an account, or depend on an installed Python/Node.
Files use the existing local-folder adapter and content fingerprint save guards.
Studio collaboration, PDM and accounts remain server services.

## Install and use

Use the matching alpha release: Windows x64 `.exe`, Apple Silicon Mac `arm64.dmg`,
or Intel Mac `x64.dmg`. On Windows, run the installer; on Mac, open the DMG and
copy Aether CAD into Applications. Alpha builds are unsigned on Windows and
ad-hoc signed (not notarized) on Mac, so system approval may be required.

Launch Aether CAD and choose a local folder. Create or open a `.aethercad` design;
that folder holds your saved documents. The editor and geometry engine run on
your machine without a Studio account or an internet connection. Keep the folder
available between sessions. Files can also be uploaded to hosted CAD; the native
sketches and feature history use the same format in both editions.

Studio accounts, collaboration and server PDM are not offline services. The
Studio Server installer is intentionally unavailable from the CAD download page.

## Build

Build on the target platform/architecture. Python 3.13 and Node are build tools
only; PyInstaller bundles Python and Electron supplies the runtime Node.

```sh
python3 tools/fetch-vendor.py
npm --prefix aether-engine ci
npm ci
npm run build
python3 -m pip install pyinstaller==6.16.0
python3 desktop/build-service.py
npm run desktop:test
npm run desktop:package -- --mac --arm64
# Intel Mac: --mac --x64, on an Intel builder
# Windows: --win --x64, on a Windows builder
```

Outputs are in `build/installers`. The GitHub `Standalone installers` workflow
builds these three targets and retains artifacts. It does not automatically
publish an unqualified installer. Do not cross-package an ARM Python sidecar
inside an Intel or Windows installer.

## Qualification and publishing

Run `node scripts/verify-desktop.mjs` with Playwright available. Set
`AETHER_DESKTOP_EXECUTABLE` to the packaged executable to test the actual app.
The test uses a disposable profile and browser filesystem handles; it does not
exercise the native folder-selection dialog. Also manually test that dialog,
create/edit/save/reopen, installation/uninstallation, and disconnected networking
on each target platform. Preserve feature history and compare with hosted CAD.

Developer ID signing/notarization and Windows signing are not configured here.
Unsigned alpha artifacts are test candidates, not a signed public release.
Never instruct users to disable system security globally.

After qualification, upload `.dmg` (arm64/x64) and `.exe` (x64) plus checksums to
the matching `desktop-v<desktop/package.json version>` GitHub release. Only then
set CAD's `desktop_release` in Studio `dev/site/apps.py`, regenerate with
`python3 dev/site/build_pages.py --app cad`, and publish the CAD site. The page
keeps unavailable platform downloads disabled until that release is uploaded.
Aether Studio Server installation remains disabled.

The loopback origin is private to the desktop runtime and stable across launches
so local file grants and recovery drafts survive restarts. A port conflict fails
visibly instead of silently switching origins and abandoning recovery data.
