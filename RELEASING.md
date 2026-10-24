# Aether-CAD releases

This repository owns the `cad` source. Development branch: `alpha-0.1`.
Each independently staged release receives the next `alpha-0.1.N` index.
Package-manager versions and the shared UI dependency version are separate.

1. Restore exact dependencies with `python3 tools/fetch-vendor.py`.
   The default local cache is `~/Library/Caches/Aether/packages`; override it with
   `AETHER_PACKAGE_CACHE`. Unpublished dependencies must be supplied by SHA-256.
   Product source must not import another repository's source files.
2. Run `npm ci`, tests and `npm run build` from `.`.
3. Commit the qualified source locally on `alpha-0.1`. Do not include scratch
   output, secrets or another contributor's unfinished work. Staging refuses
   tracked modifications and validates repository identity and artifact paths.
4. From Studio's operator checkout run:

   ```sh
   python3 dev/rebuild/app_update.py stage --app cad \
     --repo /absolute/Aether-CAD --frontend /absolute/Aether-CAD/dist \
     --backward-compatible
   ```

   Add `--worker /absolute/Aether-CAD/service/aether_cad_service/runtime/native-worker.json` for the product-packaged matching compatible worker.

5. Inspect `app_update.py status`, then activate the returned release and SHA-256
   with the app's exact `--expected-current`. Staging alone never activates.
   Studio copies and verifies releases; later checkout changes cannot affect
   installed apps. Other apps and their versions remain untouched.



Current source setup is local. Installed app bytes remain unchanged.
Stable `0.1` on `master` and remote publication are later release operations.
