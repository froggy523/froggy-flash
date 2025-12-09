const path = require('path');
const fs = require('fs');
const JimpModule = require('jimp');

// Handle different export styles between Jimp versions
const Jimp = typeof JimpModule.read === 'function' ? JimpModule : JimpModule.Jimp;

async function main() {
  const projectRoot = path.join(__dirname, '..');
  const src = path.join(projectRoot, 'images', 'Cards x32.png');
  const dest = path.join(projectRoot, 'images', 'Cards-256.png');
   const icoDest = path.join(projectRoot, 'images', 'Cards.ico');

  if (!fs.existsSync(src)) {
    console.error('Source icon not found at', src);
    // Do not fail the build if the small icon is missing; just warn.
    return;
  }

  try {
    const image = await Jimp.read(src);
    // Newer Jimp versions expect an options object for resize.
    image.resize({ w: 256, h: 256 });
    image.write(dest);
    console.log('Generated high-resolution icon at', dest);

    try {
      const pngToIcoModule = await import('png-to-ico');
      const pngToIco = pngToIcoModule.default || pngToIcoModule;
      const icoBuffer = await pngToIco([src, dest]);
      fs.writeFileSync(icoDest, icoBuffer);
      console.log('Generated Windows ICO icon at', icoDest);
    } catch (icoErr) {
      console.error('Failed to generate ICO icon:', icoErr);
    }
  } catch (err) {
    console.error('Failed to generate high-resolution icon:', err);
    // Don't crash the build; fall back to whatever icon electron-builder uses.
  }
}

main().catch((err) => {
  console.error('Unexpected error while generating icon:', err);
});


