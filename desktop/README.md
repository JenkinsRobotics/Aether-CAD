# Standalone Aether CAD

The desktop shell packages the same `dist` frontend, OCCT WebAssembly kernel,
examples and version-pinned CAD container services as the hosted editor. It does
not connect to Studio, require an account, or depend on an installed Python/Node.
Files use the existing local-folder adapter and content fingerprint save guards.
Studio collaboration, PDM and accounts remain server services.

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
