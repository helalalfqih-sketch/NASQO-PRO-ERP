# Store asset capture review — 1.0.163

The real signed APK from run `46010364174` was opened on an isolated Android 16 emulator at 1080×1920, density 420. Original screenshots from capture run `46020055618` confirmed a horizontal layout defect in the new catalog item form: the cost-help text and several fields extend past the left edge. The form screenshot is excluded from the store asset selection. The company settings screenshot is also excluded because it exposes default contact information.

The likely layout boundary is `items-catalog-field` in `src/prototype.css`, with the extra hybrid-only `items-unit-help` element rendered beside the cost input in `src/Prototype.tsx`. An eventual fix should wrap helper text beneath its field, keep flex/grid children shrinkable, and check the whole form at 360, 411 and 480 CSS-pixel widths, enlarged text and landscape. This finding is visual; it does not establish a data-loss or accounting defect.

This store asset task does not modify application UI code or rebuild the 1.0.163 binary. The screenshot source APK SHA-256 remains `b71e7cd141e438a2156cd82412d197659b195829215ba57b19292be61b16b937`. Only final visually reviewed screenshots should be uploaded to Google Play; a successful automation run alone is not visual acceptance.
